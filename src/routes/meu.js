'use strict';
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { erro, wrap, campo, relogio, telefoneNormalizado } = require('../util');
const { auditar } = require('../services/base');
const { publicoCobranca } = require('./financeiro');
const { NO_PUBLICO } = require('./mural');

const r = express.Router({ mergeParams: true });
r.use(auth.exigir('filho'));

// US-30: tela inicial do filho — só os próprios dados (RN-07)
r.get('/inicio', wrap(async (req, res) => {
  const fid = req.vinculo.filho_id;
  const hoje = relogio.hoje();
  const [filho, cobrancas, proximo, avisos, mensalidade] = await Promise.all([
    db.one('select nome_civil, nome_santo, foto_url from filhos where id = $1', [fid]),
    db.many(`select * from cobrancas where filho_id = $1 and status = 'aberta' order by vencimento`, [fid]),
    db.one(
      `select e.id, e.tipo, e.titulo, e.descricao, e.inicio, p.resposta as minha_presenca,
              (select a.preceitos from avisos a where a.evento_id = e.id order by a.created_at desc limit 1) as preceitos
         from eventos e left join presencas p on p.evento_id = e.id and p.filho_id = $2
        where e.terreiro_id = $1 and not e.cancelado and e.inicio >= $3
          and (e.filho_id = $2 or (e.publico and e.tipo in ('gira','festa','outro')))
        order by e.inicio limit 1`,
      [req.terreiro.id, fid, relogio.agora()]
    ),
    db.many(
      `select a.id, a.titulo, a.categoria, a.created_at from avisos a join filhos f on f.id = $2
        where a.terreiro_id = $1 and (a.valido_ate is null or a.valido_ate >= $3) and ${NO_PUBLICO}
          and not exists (select 1 from aviso_leituras l where l.aviso_id = a.id and l.filho_id = f.id)
        order by a.created_at desc`,
      [req.terreiro.id, fid, hoje]
    ),
    db.one(`select status, vencimento, pago_em from cobrancas where filho_id = $1 and origem = 'mensalidade' and competencia = $2 and status <> 'cancelada'`, [fid, hoje.slice(0, 7)]),
  ]);
  const pend = cobrancas.map((c) => publicoCobranca(c, hoje));
  res.json({
    filho, terreiro: { nome: req.terreiro.nome, cor: req.terreiro.cor },
    pendencias: { quantidade: pend.length, vencidas: pend.filter((c) => c.situacao === 'vencida').length, total_centavos: pend.reduce((s, c) => s + c.valor_final_centavos, 0), itens: pend },
    proximo_compromisso: proximo, avisos_nao_lidos: { quantidade: avisos.length, itens: avisos.slice(0, 5) }, mensalidade_do_mes: mensalidade,
  });
}));

r.get('/cobrancas', wrap(async (req, res) => {
  const hoje = relogio.hoje();
  const linhas = await db.many(
    `select * from cobrancas where filho_id = $1 and status <> 'aguardando_conta' order by case when status = 'aberta' then 0 else 1 end, vencimento desc limit 200`,
    [req.vinculo.filho_id]
  );
  res.json(linhas.map((c) => publicoCobranca(c, hoje)));
}));

async function minhaCobranca(req) {
  const c = await db.one('select * from cobrancas where id = $1 and filho_id = $2', [req.params.id, req.vinculo.filho_id]);
  if (!c) throw erro.naoEncontrado('Cobrança não encontrada');
  return c;
}

// US-28: dados para pagar (Pix copia e cola / boleto)
r.get('/cobrancas/:id', wrap(async (req, res) => {
  res.json(publicoCobranca(await minhaCobranca(req), relogio.hoje()));
}));

// RF-50: recibo digital
r.get('/cobrancas/:id/recibo', wrap(async (req, res) => {
  const c = await minhaCobranca(req);
  if (c.status !== 'paga') throw erro.regra('Recibo disponível só para cobranças pagas');
  const f = await db.one('select nome_civil from filhos where id = $1', [c.filho_id]);
  res.json({
    numero: c.recibo_numero, terreiro: req.terreiro.nome, documento_terreiro: req.terreiro.documento, pagador: f.nome_civil, descricao: c.descricao,
    valor_centavos: c.valor_centavos - c.desconto_centavos, pago_em: c.pago_em, forma_pagamento: c.forma_pagamento,
  });
}));

// RF-59: perfil espiritual em modo leitura
r.get('/perfil', wrap(async (req, res) => {
  const f = await db.one(
    `select id, nome_civil, nome_santo, nascimento, telefone, email, foto_url, pai_cabeca, mae_cabeca, juntos, guias, data_entrada,
            consentimento_em, consentimento_versao, consentimento_religioso from filhos where id = $1`, [req.vinculo.filho_id]
  );
  const obrigacoes = await db.many('select tipo, data, observacao from obrigacoes where filho_id = $1 order by data desc', [f.id]);
  res.json({ ...f, obrigacoes });
}));

r.patch('/perfil', wrap(async (req, res) => {
  const b = req.body;
  const proibidos = ['pai_cabeca', 'mae_cabeca', 'juntos', 'guias', 'nome_civil', 'status', 'isento'].filter((k) => k in b);
  if (proibidos.length) throw erro.proibido(`Você não pode alterar: ${proibidos.join(', ')}. Fale com o sacerdote.`);
  const f = await db.one('select * from filhos where id = $1', [req.vinculo.filho_id]);
  const telefone = 'telefone' in b ? telefoneNormalizado(campo(b, 'telefone', { obrigatorio: true })) : f.telefone;
  if (telefone !== f.telefone && (await db.one('select 1 from filhos where terreiro_id = $1 and telefone = $2 and id <> $3 and not anonimizado', [f.terreiro_id, telefone, f.id]))) {
    throw erro.conflito('Telefone já usado por outra pessoa da casa', { campo: 'telefone' });
  }
  const novo = await db.one(
    'update filhos set nome_santo = $2, email = $3, foto_url = $4, telefone = $5 where id = $1 returning id, nome_santo, email, foto_url, telefone',
    [f.id, 'nome_santo' in b ? campo(b, 'nome_santo', { max: 120 }) ?? null : f.nome_santo, 'email' in b ? campo(b, 'email', { max: 160 }) ?? null : f.email,
     'foto_url' in b ? campo(b, 'foto_url', { max: 500 }) ?? null : f.foto_url, telefone]
  );
  res.json(novo);
}));

// LGPD: acesso / portabilidade
r.get('/dados', wrap(async (req, res) => {
  const fid = req.vinculo.filho_id;
  const [perfil, cobrancas, presencas, leituras] = await Promise.all([
    db.one('select * from filhos where id = $1', [fid]),
    db.many('select descricao, valor_centavos, desconto_centavos, vencimento, status, pago_em, forma_pagamento from cobrancas where filho_id = $1', [fid]),
    db.many('select e.titulo, e.inicio, p.resposta, p.checkin_em from presencas p join eventos e on e.id = p.evento_id where p.filho_id = $1', [fid]),
    db.many('select a.titulo, l.lido_em from aviso_leituras l join avisos a on a.id = l.aviso_id where l.filho_id = $1', [fid]),
  ]);
  await auditar(null, { terreiroId: req.terreiro.id, usuarioId: req.usuario.id, acao: 'lgpd_exportacao', entidade: 'filho', entidadeId: fid });
  res.setHeader('content-disposition', 'attachment; filename="meus-dados.json"');
  res.json({ gerado_em: new Date().toISOString(), terreiro: req.terreiro.nome, perfil, cobrancas, presencas, leituras });
}));

// LGPD: revogar o consentimento de dados religiosos — os campos religiosos são apagados
r.post('/consentimento', wrap(async (req, res) => {
  const religioso = campo(req.body, 'religioso', { obrigatorio: true, tipo: 'bool' });
  const f = await db.one(
    `update filhos set consentimento_religioso = $2,
            pai_cabeca = case when $2 then pai_cabeca else null end, mae_cabeca = case when $2 then mae_cabeca else null end,
            juntos = case when $2 then juntos else '[]' end, guias = case when $2 then guias else '[]' end
      where id = $1 returning consentimento_religioso`, [req.vinculo.filho_id, religioso]
  );
  if (!religioso) await db.query('delete from obrigacoes where filho_id = $1', [req.vinculo.filho_id]);
  await auditar(null, { terreiroId: req.terreiro.id, usuarioId: req.usuario.id, acao: religioso ? 'lgpd_consentiu_religioso' : 'lgpd_revogou_religioso', entidade: 'filho', entidadeId: req.vinculo.filho_id });
  res.json(f);
}));

// LGPD: pedido de exclusão (o sacerdote executa a anonimização)
r.post('/pedido-exclusao', wrap(async (req, res) => {
  await auditar(null, { terreiroId: req.terreiro.id, usuarioId: req.usuario.id, acao: 'lgpd_pedido_exclusao', entidade: 'filho', entidadeId: req.vinculo.filho_id, dados: { motivo: campo(req.body || {}, 'motivo', { max: 500 }) || null } });
  res.status(202).json({ recebido: true, mensagem: 'Pedido registrado. O terreiro tem até 15 dias para concluir a exclusão.' });
}));

module.exports = r;
