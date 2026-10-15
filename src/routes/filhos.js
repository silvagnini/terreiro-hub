'use strict';
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { erro, wrap, campo, telefoneNormalizado, soDigitos, cpfValido, paginacao, relogio } = require('../util');
const { auditar, notificar } = require('../services/base');
const { criarRecuperacao } = require('../auth');
const { gerarConvite, linkWhatsApp } = require('../services/terreiros');

const r = express.Router({ mergeParams: true });
const podeFilhos = auth.exigir('staff', 'filhos');
const sacerdote = auth.exigir('sacerdote');

// RN-13: limite de filhos ativos do plano
async function conferirLimite(q, terreiro) {
  const lim = await q.one(
    `select p.limite_filhos, (select count(*) from filhos where terreiro_id = $1 and status = 'ativo')::int as ativos
       from terreiros t left join planos p on p.id = t.plano_id where t.id = $1`,
    [terreiro.id]
  );
  if (lim?.limite_filhos && lim.ativos >= lim.limite_filhos) {
    throw erro.regra(`Limite de ${lim.limite_filhos} filhos ativos do plano atingido. Faça upgrade para cadastrar mais.`, { limite: lim.limite_filhos, ativos: lim.ativos, upgrade: true });
  }
}

async function buscarFilho(q, terreiroId, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw erro.naoEncontrado('Filho não encontrado');
  const f = await q.one('select * from filhos where id = $1 and terreiro_id = $2', [id, terreiroId]);
  if (!f) throw erro.naoEncontrado('Filho não encontrado');
  return f;
}

function lerDesconto(b) {
  if (!('desconto' in b)) return undefined;
  if (b.desconto === null) return null;
  const d = campo(b, 'desconto', { tipo: 'object' });
  const tipo = campo(d, 'tipo', { obrigatorio: true, opcoes: ['valor', 'percentual'] });
  const valor = Number(d.valor);
  if (!(valor > 0) || (tipo === 'percentual' && valor > 100)) throw erro.validacao('Desconto inválido', { campo: 'desconto' });
  return { tipo, valor };
}

const ESPIRITUAIS = ['pai_cabeca', 'mae_cabeca', 'juntos', 'guias'];

function visivel(f, papel) {
  const base = { ...f };
  delete base.consentimento_ip;
  if (papel !== 'sacerdote' && papel !== 'auxiliar') ESPIRITUAIS.forEach((k) => delete base[k]);
  return base;
}

r.get('/', podeFilhos, wrap(async (req, res) => {
  const { limite, offset } = paginacao(req.query);
  const busca = req.query.busca ? `%${req.query.busca}%` : null;
  const linhas = await db.many(
    `select f.id, f.nome_civil, f.nome_santo, f.telefone, f.status, f.isento, f.convite_status, f.pai_cabeca, f.mae_cabeca, f.foto_url,
            (select count(*) from cobrancas c where c.filho_id = f.id and c.status = 'aberta' and c.vencimento < $5)::int as em_atraso,
            count(*) over()::int as total
       from filhos f
      where f.terreiro_id = $1 and not f.anonimizado
        and ($2::text is null or f.status::text = $2)
        and ($3::text is null or f.nome_civil ilike $3 or f.nome_santo ilike $3 or f.telefone like $3)
        and ($4::uuid is null or exists (select 1 from filho_grupos g where g.filho_id = f.id and g.grupo_id = $4))
      order by f.nome_civil limit $6 offset $7`,
    [req.terreiro.id, req.query.status || null, busca, req.query.grupo || null, relogio.hoje(), limite, offset]
  );
  res.json({ itens: linhas.map(({ total, ...x }) => x), total: linhas[0]?.total || 0 });
}));

r.post('/', podeFilhos, wrap(async (req, res) => {
  const b = req.body;
  const nome = campo(b, 'nome_civil', { obrigatorio: true, max: 120 });
  const telefone = telefoneNormalizado(campo(b, 'telefone', { obrigatorio: true }));
  const cpf = soDigitos(campo(b, 'cpf'));
  if (cpf && !cpfValido(cpf)) throw erro.validacao('CPF inválido', { campo: 'cpf' });
  const espirituais = req.vinculo.papel === 'sacerdote';
  const grupos = campo(b, 'grupos', { tipo: 'array' }) || [];
  const f = await db.tx(async (q) => {
    await conferirLimite(q, req.terreiro);
    const dup = await q.one('select id from filhos where terreiro_id = $1 and telefone = $2 and not anonimizado', [req.terreiro.id, telefone]);
    if (dup) throw erro.conflito('Já existe um filho com este telefone nesta casa', { campo: 'telefone', filho_id: dup.id });
    const novo = await q.one(
      `insert into filhos(terreiro_id, nome_civil, nome_santo, nascimento, cpf, telefone, email, foto_url, pai_cabeca, mae_cabeca, juntos, guias,
                          data_entrada, isento, desconto)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`,
      [req.terreiro.id, nome, campo(b, 'nome_santo', { max: 120 }) || null, campo(b, 'nascimento', { tipo: 'date' }) || null, cpf || null, telefone,
       campo(b, 'email', { max: 160 })?.toLowerCase() || null, campo(b, 'foto_url', { max: 500 }) || null,
       espirituais ? campo(b, 'pai_cabeca', { max: 60 }) || null : null, espirituais ? campo(b, 'mae_cabeca', { max: 60 }) || null : null,
       JSON.stringify(espirituais ? campo(b, 'juntos', { tipo: 'array' }) || [] : []), JSON.stringify(espirituais ? campo(b, 'guias', { tipo: 'array' }) || [] : []),
       campo(b, 'data_entrada', { tipo: 'date' }) || relogio.hoje(), campo(b, 'isento', { tipo: 'bool' }) || false, lerDesconto(b) ?? null]
    );
    if (grupos.length) {
      await q.query(
        `insert into filho_grupos(filho_id, grupo_id) select $1, g.id from grupos g where g.terreiro_id = $2 and g.id = any($3::uuid[])`,
        [novo.id, req.terreiro.id, grupos]
      );
    }
    await q.query(`insert into vinculos(terreiro_id, papel, filho_id) values ($1,'filho',$2)`, [req.terreiro.id, novo.id]);
    await auditar(q, { terreiroId: req.terreiro.id, usuarioId: req.usuario.id, acao: 'filho_criado', entidade: 'filho', entidadeId: novo.id });
    return novo;
  });
  res.status(201).json(visivel(f, req.vinculo.papel));
}));

r.get('/:id', podeFilhos, wrap(async (req, res) => {
  const f = await buscarFilho(db, req.terreiro.id, req.params.id);
  const [grupos, obrigacoes, resumo] = await Promise.all([
    db.many('select g.id, g.nome from filho_grupos fg join grupos g on g.id = fg.grupo_id where fg.filho_id = $1 order by g.nome', [f.id]),
    db.many('select * from obrigacoes where filho_id = $1 order by data desc', [f.id]),
    db.one(
      `select count(*) filter (where status = 'aberta')::int as abertas,
              count(*) filter (where status = 'aberta' and vencimento < $2)::int as em_atraso,
              coalesce(sum(valor_centavos - desconto_centavos) filter (where status = 'aberta'), 0)::bigint as total_aberto_centavos
         from cobrancas where filho_id = $1`,
      [f.id, relogio.hoje()]
    ),
  ]);
  res.json({ ...visivel(f, req.vinculo.papel), grupos, obrigacoes, financeiro: resumo });
}));

r.patch('/:id', podeFilhos, wrap(async (req, res) => {
  const b = req.body;
  const f = await buscarFilho(db, req.terreiro.id, req.params.id);
  if (ESPIRITUAIS.some((k) => k in b) && req.vinculo.papel !== 'sacerdote') throw erro.proibido('Só o sacerdote altera dados espirituais');
  const telefone = 'telefone' in b ? telefoneNormalizado(campo(b, 'telefone', { obrigatorio: true })) : f.telefone;
  if (telefone !== f.telefone) {
    const dup = await db.one('select id from filhos where terreiro_id = $1 and telefone = $2 and id <> $3 and not anonimizado', [req.terreiro.id, telefone, f.id]);
    if (dup) throw erro.conflito('Já existe um filho com este telefone nesta casa', { campo: 'telefone' });
  }
  const v = (k, opt) => (k in b ? campo(b, k, opt) ?? null : f[k]);
  const novo = await db.one(
    `update filhos set nome_civil = $2, nome_santo = $3, nascimento = $4, telefone = $5, email = $6, foto_url = $7,
            pai_cabeca = $8, mae_cabeca = $9, juntos = $10, guias = $11, data_entrada = $12
      where id = $1 returning *`,
    [f.id, 'nome_civil' in b ? campo(b, 'nome_civil', { obrigatorio: true, max: 120 }) : f.nome_civil, v('nome_santo', { max: 120 }), v('nascimento', { tipo: 'date' }),
     telefone, v('email', { max: 160 }), v('foto_url', { max: 500 }), v('pai_cabeca', { max: 60 }), v('mae_cabeca', { max: 60 }),
     JSON.stringify('juntos' in b ? campo(b, 'juntos', { tipo: 'array' }) || [] : f.juntos), JSON.stringify('guias' in b ? campo(b, 'guias', { tipo: 'array' }) || [] : f.guias),
     v('data_entrada', { tipo: 'date' })]
  );
  res.json(visivel(novo, req.vinculo.papel));
}));

r.put('/:id/grupos', podeFilhos, wrap(async (req, res) => {
  const f = await buscarFilho(db, req.terreiro.id, req.params.id);
  const ids = campo(req.body, 'ids', { obrigatorio: true, tipo: 'array' });
  await db.tx(async (q) => {
    await q.query('delete from filho_grupos where filho_id = $1', [f.id]);
    await q.query(`insert into filho_grupos(filho_id, grupo_id) select $1, id from grupos where terreiro_id = $2 and id = any($3::uuid[])`, [f.id, req.terreiro.id, ids]);
  });
  res.json(await db.many('select g.id, g.nome from filho_grupos fg join grupos g on g.id = fg.grupo_id where fg.filho_id = $1', [f.id]));
}));

// US-27: isenção e desconto
r.patch('/:id/financeiro', auth.exigir('staff', 'financeiro'), wrap(async (req, res) => {
  const f = await buscarFilho(db, req.terreiro.id, req.params.id);
  const desconto = lerDesconto(req.body);
  const novo = await db.one(
    'update filhos set isento = $2, desconto = $3 where id = $1 returning id, isento, desconto',
    [f.id, 'isento' in req.body ? campo(req.body, 'isento', { tipo: 'bool' }) : f.isento, desconto === undefined ? f.desconto : desconto]
  );
  await auditar(null, { terreiroId: req.terreiro.id, usuarioId: req.usuario.id, acao: 'filho_financeiro', entidade: 'filho', entidadeId: f.id, dados: { isento: novo.isento, desconto: novo.desconto } });
  res.json(novo);
}));

// US-11: convite por WhatsApp, válido por 7 dias
r.post('/:id/convite', podeFilhos, wrap(async (req, res) => {
  const f = await buscarFilho(db, req.terreiro.id, req.params.id);
  if (f.convite_status === 'ativo') throw erro.regra('Este filho já ativou o acesso');
  if (f.status !== 'ativo') throw erro.regra('Só é possível convidar filhos ativos');
  const v = await db.one(`select id from vinculos where filho_id = $1 and papel = 'filho'`, [f.id]);
  const convite = await gerarConvite(db, v.id, 7);
  await db.query(`update filhos set convite_status = 'convidado' where id = $1`, [f.id]);
  if (f.email) await notificar(null, { terreiroId: req.terreiro.id, filhoIds: [f.id], tipo: 'convite', referencia: v.id, canais: ['email'], link: convite.link });
  const texto = `Olá, ${f.nome_civil.split(' ')[0]}! Este é o seu convite para o app da casa ${req.terreiro.nome}. Crie sua senha aqui: ${convite.link}`;
  res.json({ link: convite.link, whatsapp: linkWhatsApp(f.telefone, texto), expira_em_dias: 7, convite_status: 'convidado' });
}));

// Link de nova senha gerado pelo sacerdote (filho sem e-mail, ou que perdeu o acesso ao WhatsApp)
r.post('/:id/link-senha', sacerdote, wrap(async (req, res) => {
  const f = await buscarFilho(db, req.terreiro.id, req.params.id);
  if (!f.usuario_id || f.convite_status !== 'ativo') throw erro.regra('Este filho ainda não criou o acesso. Reenvie o convite.');
  if (f.status !== 'ativo' && f.status !== 'afastado') throw erro.regra(`Filho ${f.status} não pode receber link de senha`);
  const { link } = await criarRecuperacao(f.usuario_id, { criadoPor: req.usuario.id, canal: 'manual' });
  const texto = `Olá, ${f.nome_civil.split(' ')[0]}! Use este link para criar uma nova senha no app da casa (vale por 24 horas): ${link}`;
  res.json({ link, whatsapp: f.telefone ? linkWhatsApp(f.telefone, texto) : null, expira_em_horas: 24 });
}));

// US-13 / US-14: bloquear, desligar, reativar
async function mudarStatus(req, res, de, para, acao) {
  const f = await buscarFilho(db, req.terreiro.id, req.params.id);
  if (!de.includes(f.status)) throw erro.regra(`Não é possível ${acao}: filho está ${f.status}`);
  const novo = await db.tx(async (q) => {
    if (para === 'ativo') await conferirLimite(q, req.terreiro);
    const n = await q.one(
      `update filhos set status = $2::status_filho, desligado_em = case when $2::status_filho = 'desligado' then now() else null end where id = $1 returning *`, [f.id, para]
    );
    if (para === 'bloqueado' || para === 'desligado') {
      await q.query('delete from sessoes where usuario_id = $1 and $1 not in (select usuario_id from vinculos where usuario_id = $1 and terreiro_id <> $2 and ativo)', [f.usuario_id, req.terreiro.id]);
    }
    await auditar(q, { terreiroId: req.terreiro.id, usuarioId: req.usuario.id, acao: `filho_${acao}`, entidade: 'filho', entidadeId: f.id, dados: { de: f.status, para, motivo: req.body?.motivo || null } });
    return n;
  });
  res.json(visivel(novo, req.vinculo.papel));
}

r.post('/:id/bloquear', sacerdote, wrap((req, res) => mudarStatus(req, res, ['ativo', 'afastado'], 'bloqueado', 'bloquear')));
r.post('/:id/desbloquear', sacerdote, wrap((req, res) => mudarStatus(req, res, ['bloqueado'], 'ativo', 'desbloquear')));
r.post('/:id/afastar', podeFilhos, wrap((req, res) => mudarStatus(req, res, ['ativo'], 'afastado', 'afastar')));
r.post('/:id/desligar', sacerdote, wrap((req, res) => mudarStatus(req, res, ['ativo', 'afastado', 'bloqueado'], 'desligado', 'desligar')));
r.post('/:id/reativar', sacerdote, wrap((req, res) => mudarStatus(req, res, ['desligado', 'afastado'], 'ativo', 'reativar')));

// RN-08 / RF-21: exclusão só a pedido do titular; dados pessoais anonimizados, financeiro preservado
r.delete('/:id', sacerdote, wrap(async (req, res) => {
  if (req.body?.pedido_do_titular !== true) {
    throw erro.regra('Exclusão definitiva só a pedido do próprio filho (LGPD). Para quem saiu da casa, use "Desligar".');
  }
  const f = await buscarFilho(db, req.terreiro.id, req.params.id);
  await db.tx(async (q) => {
    await q.query(
      `update filhos set nome_civil = 'Ex-membro anonimizado', nome_santo = null, nascimento = null, cpf = null, telefone = null, email = null,
              foto_url = null, pai_cabeca = null, mae_cabeca = null, juntos = '[]', guias = '[]', consentimento_ip = null,
              anonimizado = true, status = 'desligado', desligado_em = coalesce(desligado_em, now()), usuario_id = null where id = $1`,
      [f.id]
    );
    await q.query('delete from filho_grupos where filho_id = $1', [f.id]);
    await q.query('delete from obrigacoes where filho_id = $1', [f.id]);
    await q.query('update vinculos set ativo = false, usuario_id = null where filho_id = $1', [f.id]);
    await auditar(q, { terreiroId: req.terreiro.id, usuarioId: req.usuario.id, acao: 'filho_anonimizado', entidade: 'filho', entidadeId: f.id });
  });
  res.status(204).end();
}));

// RF-19: histórico de obrigações
r.get('/:id/obrigacoes', podeFilhos, wrap(async (req, res) => {
  const f = await buscarFilho(db, req.terreiro.id, req.params.id);
  res.json(await db.many('select * from obrigacoes where filho_id = $1 order by data desc', [f.id]));
}));
r.post('/:id/obrigacoes', sacerdote, wrap(async (req, res) => {
  const f = await buscarFilho(db, req.terreiro.id, req.params.id);
  res.status(201).json(await db.one(
    'insert into obrigacoes(terreiro_id, filho_id, tipo, data, observacao) values ($1,$2,$3,$4,$5) returning *',
    [req.terreiro.id, f.id, campo(req.body, 'tipo', { obrigatorio: true, max: 60 }), campo(req.body, 'data', { obrigatorio: true, tipo: 'date' }), campo(req.body, 'observacao', { max: 500 }) || null]
  ));
}));

module.exports = r;
module.exports.buscarFilho = buscarFilho;
