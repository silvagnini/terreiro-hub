'use strict';
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { gateway } = require('../gateway');
const { erro, wrap, campo, documentoValido, telefoneNormalizado, soDigitos, relogio, diasEntre, paginacao } = require('../util');
const { cifrar } = require('../cifra');
const { auditar, notificar } = require('../services/base');
const { gerarConvite } = require('../services/terreiros');

const r = express.Router({ mergeParams: true });
const sacerdote = auth.exigir('sacerdote');
const staff = auth.exigir('staff');

const ETAPAS = ['dados_casa', 'tradicao', 'mensalidade', 'conta_recebimento'];

r.get('/', wrap(async (req, res) => {
  const t = req.terreiro;
  const plano = t.plano_id ? await db.one('select * from planos where id = $1', [t.plano_id]) : null;
  const ativos = (await db.one(`select count(*)::int as n from filhos where terreiro_id = $1 and status = 'ativo'`, [t.id])).n;
  const faturaAtrasada = await db.one(
    `select min(vencimento) as v from faturas_saas where terreiro_id = $1 and status = 'aberta' and vencimento < $2`, [t.id, relogio.hoje()]
  );
  const base = {
    id: t.id, nome: t.nome, tradicao: t.tradicao, logo_url: t.logo_url, cor: t.cor, status: t.status, nomenclatura: t.nomenclatura,
    papel: req.vinculo.papel, filho_id: req.vinculo.filho_id || null, permissoes: req.vinculo.papel === 'auxiliar' ? { ...auth.PERMISSOES_AUXILIAR_PADRAO, ...req.vinculo.permissoes } : null,
  };
  if (req.vinculo.papel === 'filho') return res.json(base);
  const limite = plano?.limite_filhos || null;
  res.json({
    ...base, documento: t.documento, responsavel_nome: t.responsavel_nome, email: t.email, telefone: t.telefone, endereco: t.endereco,
    teste_ate: t.teste_ate, mensalidade: t.mensalidade, regras: t.regras, onboarding: { ...t.onboarding, etapas: ETAPAS },
    gateway_conta_status: t.gateway_conta_status,
    plano: plano && { id: plano.id, nome: plano.nome, preco_centavos: plano.preco_centavos, limite_filhos: limite },
    uso: { filhos_ativos: ativos, limite, percentual: limite ? Math.round((ativos * 100) / limite) : null, alerta_limite: limite ? ativos >= Math.ceil(limite * 0.9) : false },
    inadimplencia: faturaAtrasada?.v ? { desde: faturaAtrasada.v, dias: diasEntre(faturaAtrasada.v, relogio.hoje()) } : null,
  });
}));

r.patch('/', sacerdote, wrap(async (req, res) => {
  const b = req.body;
  const t = req.terreiro;
  const novo = await db.one(
    `update terreiros set nome = $2, tradicao = $3, logo_url = $4, cor = $5, endereco = $6, telefone = $7, nomenclatura = $8, regras = $9
      where id = $1 returning *`,
    [t.id, campo(b, 'nome', { max: 120 }) ?? t.nome, campo(b, 'tradicao', { max: 60 }) ?? t.tradicao, campo(b, 'logo_url', { max: 500 }) ?? t.logo_url,
     campo(b, 'cor', { max: 9 }) ?? t.cor, campo(b, 'endereco', { max: 300 }) ?? t.endereco,
     b.telefone !== undefined ? telefoneNormalizado(b.telefone) || null : t.telefone,
     campo(b, 'nomenclatura', { tipo: 'object' }) ?? t.nomenclatura, campo(b, 'regras', { tipo: 'object' }) ?? t.regras]
  );
  res.json({ id: novo.id, nome: novo.nome, tradicao: novo.tradicao, cor: novo.cor, nomenclatura: novo.nomenclatura, regras: novo.regras });
}));

// US-06: assistente de primeiro acesso — pode pular e voltar
r.post('/onboarding', sacerdote, wrap(async (req, res) => {
  const etapa = campo(req.body, 'etapa', { obrigatorio: true, opcoes: ETAPAS });
  const situacao = campo(req.body, 'situacao', { obrigatorio: true, opcoes: ['feita', 'pulada'] });
  const t = await db.one(`update terreiros set onboarding = onboarding || jsonb_build_object($2::text, $3::text) where id = $1 returning onboarding`, [req.terreiro.id, etapa, situacao]);
  res.json({ ...t.onboarding, etapas: ETAPAS, concluido: ETAPAS.every((e) => t.onboarding[e] === 'feita') });
}));

// US-07: conta de recebimento (subconta no gateway). A chave da subconta é guardada cifrada.
r.post('/conta-recebimento', sacerdote, wrap(async (req, res) => {
  const t = req.terreiro;
  if (t.gateway_conta_status === 'aprovada') throw erro.regra('A conta de recebimento já está aprovada');
  if (t.gateway_conta_status === 'pendente') throw erro.regra('A conta de recebimento já está em análise');
  const b = req.body;
  const documento = documentoValido(campo(b, 'documento', { obrigatorio: true }));
  if (!documento) throw erro.validacao('CPF ou CNPJ inválido', { campo: 'documento' });
  const cnpj = documento.length === 14;
  const dados = {
    nome: campo(b, 'nome', { obrigatorio: true, max: 120 }), documento,
    email: campo(b, 'email', { obrigatorio: true, max: 160 }), telefone: telefoneNormalizado(campo(b, 'telefone')),
    nascimento: cnpj ? undefined : campo(b, 'nascimento', { tipo: 'date' }),
    tipoEmpresa: cnpj ? campo(b, 'tipo_empresa', { opcoes: ['MEI', 'LIMITED', 'INDIVIDUAL', 'ASSOCIATION'] }) || 'ASSOCIATION' : undefined,
    cep: soDigitos(campo(b, 'cep', { max: 9 })) || undefined, endereco: campo(b, 'endereco', { max: 200 }),
    numero: campo(b, 'numero', { max: 20 }), bairro: campo(b, 'bairro', { max: 100 }),
  };
  if (gateway.nome === 'asaas') {
    const faltam = ['telefone', 'cep', 'endereco', 'numero', 'bairro', ...(cnpj ? [] : ['nascimento'])].filter((k) => !dados[k]);
    if (faltam.length) throw erro.validacao(`Para abrir a conta de recebimento preencha: ${faltam.join(', ')}`, { campo: faltam[0] });
  }
  let sub;
  try {
    sub = await gateway.criarSubconta(dados);
  } catch (e) {
    throw erro.regra(`O banco recusou a abertura da conta: ${e.message}`);
  }
  await db.query(
    `update terreiros set gateway_conta_id = $2, gateway_wallet_id = $3, gateway_api_key = $4, gateway_conta_status = 'pendente',
            onboarding = onboarding || '{"conta_recebimento":"feita"}' where id = $1`,
    [t.id, sub.id, sub.walletId || null, sub.apiKey ? cifrar(sub.apiKey) : null]
  );
  await auditar(null, { terreiroId: t.id, usuarioId: req.usuario.id, acao: 'conta_recebimento_solicitada', entidade: 'terreiro', entidadeId: t.id });
  // Versão de teste (gateway simulado + SIMULADO_AUTO=true): a "análise do banco" aprova na hora
  if (gateway.nome === 'simulado' && process.env.SIMULADO_AUTO === 'true') {
    await fetch(`http://127.0.0.1:${req.socket.localPort}/api/simulador/aprovar-conta/${sub.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    return res.status(201).json({ gateway_conta_id: sub.id, gateway_conta_status: 'aprovada' });
  }
  res.status(201).json({ gateway_conta_id: sub.id, gateway_conta_status: 'pendente' });
}));

// ---------- catálogos: entidades (US-09), serviços (US-08), grupos (US-15) ----------
r.get('/entidades', wrap(async (req, res) => {
  const todos = req.vinculo.papel === 'sacerdote' && req.query.todos === 'true';
  res.json(await db.many(`select * from entidades_casa where terreiro_id = $1 and ($2 or not oculto) order by tipo, nome`, [req.terreiro.id, todos]));
}));
r.post('/entidades', sacerdote, wrap(async (req, res) => {
  try {
    res.status(201).json(await db.one(
      'insert into entidades_casa(terreiro_id, tipo, nome) values ($1,$2,$3) returning *',
      [req.terreiro.id, campo(req.body, 'tipo', { obrigatorio: true, opcoes: ['orixa', 'entidade'] }), campo(req.body, 'nome', { obrigatorio: true, max: 60 })]
    ));
  } catch (e) {
    if (e.code === '23505') throw erro.conflito('Já existe com esse nome');
    throw e;
  }
}));
r.patch('/entidades/:id', sacerdote, wrap(async (req, res) => {
  const e = await db.one(
    `update entidades_casa set nome = coalesce($3, nome), oculto = coalesce($4, oculto) where id = $1 and terreiro_id = $2 returning *`,
    [req.params.id, req.terreiro.id, campo(req.body, 'nome', { max: 60 }) ?? null, 'oculto' in req.body ? campo(req.body, 'oculto', { tipo: 'bool' }) : null]
  );
  if (!e) throw erro.naoEncontrado();
  res.json(e);
}));

r.get('/servicos', staff, wrap(async (req, res) => {
  res.json(await db.many('select * from servicos where terreiro_id = $1 order by nome', [req.terreiro.id]));
}));
r.post('/servicos', sacerdote, wrap(async (req, res) => {
  try {
    res.status(201).json(await db.one(
      'insert into servicos(terreiro_id, nome, preco_sugerido_centavos, duracao_min) values ($1,$2,$3,$4) returning *',
      [req.terreiro.id, campo(req.body, 'nome', { obrigatorio: true, max: 60 }), campo(req.body, 'preco_sugerido_centavos', { tipo: 'int', min: 0 }) || 0,
       campo(req.body, 'duracao_min', { tipo: 'int', min: 5 }) || null]
    ));
  } catch (e) {
    if (e.code === '23505') throw erro.conflito('Já existe um serviço com esse nome');
    throw e;
  }
}));
r.patch('/servicos/:id', sacerdote, wrap(async (req, res) => {
  const s = await db.one(
    `update servicos set nome = coalesce($3, nome), preco_sugerido_centavos = coalesce($4, preco_sugerido_centavos), ativo = coalesce($5, ativo)
      where id = $1 and terreiro_id = $2 returning *`,
    [req.params.id, req.terreiro.id, campo(req.body, 'nome', { max: 60 }) ?? null, campo(req.body, 'preco_sugerido_centavos', { tipo: 'int', min: 0 }) ?? null,
     'ativo' in req.body ? campo(req.body, 'ativo', { tipo: 'bool' }) : null]
  );
  if (!s) throw erro.naoEncontrado();
  res.json(s);
}));

r.get('/grupos', staff, wrap(async (req, res) => {
  res.json(await db.many(
    `select g.*, (select count(*) from filho_grupos fg join filhos f on f.id = fg.filho_id where fg.grupo_id = g.id and f.status = 'ativo')::int as filhos
       from grupos g where g.terreiro_id = $1 order by g.nome`, [req.terreiro.id]
  ));
}));
r.post('/grupos', auth.exigir('staff', 'filhos'), wrap(async (req, res) => {
  try {
    res.status(201).json(await db.one('insert into grupos(terreiro_id, nome) values ($1,$2) returning *', [req.terreiro.id, campo(req.body, 'nome', { obrigatorio: true, max: 60 })]));
  } catch (e) {
    if (e.code === '23505') throw erro.conflito('Já existe um grupo com esse nome');
    throw e;
  }
}));
r.delete('/grupos/:id', sacerdote, wrap(async (req, res) => {
  const g = await db.one('delete from grupos where id = $1 and terreiro_id = $2 returning id', [req.params.id, req.terreiro.id]);
  if (!g) throw erro.naoEncontrado();
  res.status(204).end();
}));

// ---------- auxiliares (RF-14) ----------
r.get('/auxiliares', sacerdote, wrap(async (req, res) => {
  res.json(await db.many(
    `select v.id, v.permissoes, v.ativo, v.filho_id, coalesce(u.nome, f.nome_civil) as nome, coalesce(u.email, f.email) as email, coalesce(u.telefone, f.telefone) as telefone,
            (v.convite_token_hash is not null or v.usuario_id is null) as convite_pendente
       from vinculos v left join usuarios u on u.id = v.usuario_id left join filhos f on f.id = v.filho_id
      where v.terreiro_id = $1 and v.papel = 'auxiliar' and v.ativo order by nome`,
    [req.terreiro.id]
  ));
}));
r.post('/auxiliares', sacerdote, wrap(async (req, res) => {
  const nome = campo(req.body, 'nome', { obrigatorio: true, max: 120 });
  const email = campo(req.body, 'email', { max: 160 })?.toLowerCase();
  const telefone = telefoneNormalizado(campo(req.body, 'telefone'));
  if (!email && !telefone) throw erro.validacao('Informe e-mail ou telefone');
  const permissoes = { ...auth.PERMISSOES_AUXILIAR_PADRAO, ...(campo(req.body, 'permissoes', { tipo: 'object' }) || {}) };
  const out = await db.tx(async (q) => {
    let u = await q.one('select * from usuarios where ($1::text is not null and lower(email) = $1) or ($2::text is not null and telefone = $2)', [email || null, telefone || null]);
    if (!u) u = await q.one('insert into usuarios(nome, email, telefone) values ($1,$2,$3) returning *', [nome, email || null, telefone || null]);
    const ja = await q.one('select * from vinculos where usuario_id = $1 and terreiro_id = $2 and ativo', [u.id, req.terreiro.id]);
    if (ja && ja.papel === 'filho') {
      // já é filho da casa: ganha as permissões de auxiliar sem perder a área de filho
      const v = await q.one(`update vinculos set papel = 'auxiliar', permissoes = $2 where id = $1 returning *`, [ja.id, permissoes]);
      await auditar(q, { terreiroId: req.terreiro.id, usuarioId: req.usuario.id, acao: 'auxiliar_criado', entidade: 'vinculo', entidadeId: v.id, dados: { permissoes, filho_id: ja.filho_id } });
      return { id: v.id, nome, permissoes, convite: null, filho_id: ja.filho_id };
    }
    if (ja) throw erro.conflito('Esta pessoa já tem acesso a este terreiro');
    const v = await q.one(`insert into vinculos(usuario_id, terreiro_id, papel, permissoes) values ($1,$2,'auxiliar',$3) returning *`, [u.id, req.terreiro.id, permissoes]);
    const convite = u.senha_hash ? null : await gerarConvite(q, v.id);
    if (convite && u.email) await notificar(q, { terreiroId: req.terreiro.id, usuarioId: u.id, tipo: 'convite', referencia: v.id, canais: ['email'], link: convite.link });
    await auditar(q, { terreiroId: req.terreiro.id, usuarioId: req.usuario.id, acao: 'auxiliar_criado', entidade: 'vinculo', entidadeId: v.id, dados: { permissoes } });
    return { id: v.id, nome, permissoes, convite };
  });
  res.status(201).json(out);
}));
r.patch('/auxiliares/:id', sacerdote, wrap(async (req, res) => {
  const atual = await db.one(`select * from vinculos where id = $1 and terreiro_id = $2 and papel = 'auxiliar'`, [req.params.id, req.terreiro.id]);
  if (!atual) throw erro.naoEncontrado();
  if (atual.filho_id && req.body.ativo === false) {
    // auxiliar que é filho: perde só as permissões de auxiliar e volta a ser filho
    await db.query(`update vinculos set papel = 'filho', permissoes = '{}' where id = $1`, [atual.id]);
    await auditar(null, { terreiroId: req.terreiro.id, usuarioId: req.usuario.id, acao: 'auxiliar_removido', entidade: 'vinculo', entidadeId: atual.id, dados: { filho_id: atual.filho_id } });
    return res.json({ id: atual.id, permissoes: {}, ativo: false });
  }
  const v = await db.one(
    `update vinculos set permissoes = coalesce($3, permissoes), ativo = coalesce($4, ativo) where id = $1 and terreiro_id = $2 and papel = 'auxiliar' returning id, permissoes, ativo`,
    [req.params.id, req.terreiro.id, campo(req.body, 'permissoes', { tipo: 'object' }) ?? null, 'ativo' in req.body ? campo(req.body, 'ativo', { tipo: 'bool' }) : null]
  );
  if (!v) throw erro.naoEncontrado();
  await auditar(null, { terreiroId: req.terreiro.id, usuarioId: req.usuario.id, acao: 'auxiliar_alterado', entidade: 'vinculo', entidadeId: v.id, dados: req.body });
  res.json(v);
}));

// ---------- assinatura do SaaS e suporte ----------
r.get('/assinatura', sacerdote, wrap(async (req, res) => {
  res.json(await db.many('select id, competencia, valor_centavos, vencimento, status, pix_copia_cola, boleto_linha, pago_em, gateway_id from faturas_saas where terreiro_id = $1 order by competencia desc', [req.terreiro.id]));
}));
r.post('/assinatura/consentir-suporte', sacerdote, wrap(async (req, res) => {
  const horas = campo(req.body, 'horas', { tipo: 'int', min: 1, max: 72 }) || 24;
  const t = await db.one(`update terreiros set suporte_consentido_ate = now() + ($2 || ' hours')::interval where id = $1 returning suporte_consentido_ate`, [req.terreiro.id, String(horas)]);
  await auditar(null, { terreiroId: req.terreiro.id, usuarioId: req.usuario.id, acao: 'suporte_consentido', entidade: 'terreiro', entidadeId: req.terreiro.id, dados: { horas } });
  res.json(t);
}));

r.get('/auditoria', sacerdote, wrap(async (req, res) => {
  const { limite, offset } = paginacao(req.query);
  res.json(await db.many(
    `select a.id, a.acao, a.entidade, a.entidade_id, a.dados, a.created_at, u.nome as usuario
       from auditoria a left join usuarios u on u.id = a.usuario_id where a.terreiro_id = $1 order by a.id desc limit $2 offset $3`,
    [req.terreiro.id, limite, offset]
  ));
}));

module.exports = r;
