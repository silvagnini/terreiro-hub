'use strict';
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { erro, wrap, campo, relogio, paginacao } = require('../util');
const { criarTerreiro } = require('../services/terreiros');
const { auditar } = require('../services/base');
const jobs = require('../services/jobs');

const r = express.Router();
r.use(auth.autenticar, auth.exigirAdmin);

// ---------- planos (US-02) ----------
r.get('/planos', wrap(async (_req, res) => {
  res.json(await db.many('select * from planos order by preco_centavos'));
}));

r.post('/planos', wrap(async (req, res) => {
  const p = await db.one(
    'insert into planos(nome, preco_centavos, limite_filhos, recursos) values ($1,$2,$3,$4) returning *',
    [campo(req.body, 'nome', { obrigatorio: true, max: 60 }), campo(req.body, 'preco_centavos', { obrigatorio: true, tipo: 'int', min: 0 }),
     campo(req.body, 'limite_filhos', { tipo: 'int', min: 1 }) ?? null, campo(req.body, 'recursos', { tipo: 'object' }) || {}]
  );
  await auditar(null, { usuarioId: req.usuario.id, acao: 'plano_criado', entidade: 'plano', entidadeId: p.id });
  res.status(201).json(p);
}));

r.patch('/planos/:id', wrap(async (req, res) => {
  const atual = await db.one('select * from planos where id = $1', [req.params.id]);
  if (!atual) throw erro.naoEncontrado();
  const b = req.body;
  const p = await db.one(
    'update planos set nome = $2, preco_centavos = $3, limite_filhos = $4, recursos = $5, ativo = $6 where id = $1 returning *',
    [atual.id, campo(b, 'nome', { max: 60 }) ?? atual.nome, campo(b, 'preco_centavos', { tipo: 'int', min: 0 }) ?? atual.preco_centavos,
     'limite_filhos' in b ? campo(b, 'limite_filhos', { tipo: 'int', min: 1 }) ?? null : atual.limite_filhos,
     campo(b, 'recursos', { tipo: 'object' }) ?? atual.recursos, 'ativo' in b ? campo(b, 'ativo', { tipo: 'bool' }) : atual.ativo]
  );
  res.json(p);
}));

// ---------- terreiros (US-01, US-05) ----------
r.get('/terreiros', wrap(async (req, res) => {
  const { limite, offset } = paginacao(req.query);
  const busca = req.query.busca ? `%${req.query.busca}%` : null;
  const linhas = await db.many(
    `select t.id, t.nome, t.documento, t.status, t.responsavel_nome, t.email, t.teste_ate, t.created_at, p.nome as plano,
            (select count(*) from filhos f where f.terreiro_id = t.id and f.status = 'ativo')::int as filhos_ativos,
            count(*) over()::int as total
       from terreiros t left join planos p on p.id = t.plano_id
      where ($1::text is null or t.nome ilike $1 or t.documento like $1) and ($2::text is null or t.status::text = $2)
      order by t.created_at desc limit $3 offset $4`,
    [busca, req.query.status || null, limite, offset]
  );
  res.json({ itens: linhas.map(({ total, ...x }) => x), total: linhas[0]?.total || 0 });
}));

r.post('/terreiros', wrap(async (req, res) => {
  const out = await db.tx((q) => criarTerreiro(q, req.body, req.usuario.id));
  res.status(201).json(out);
}));

r.get('/terreiros/:id', wrap(async (req, res) => {
  const t = await db.one('select * from terreiros where id = $1', [req.params.id]);
  if (!t) throw erro.naoEncontrado();
  const faturas = await db.many('select * from faturas_saas where terreiro_id = $1 order by competencia desc limit 24', [t.id]);
  res.json({ ...t, faturas });
}));

async function mudarStatus(req, res, status, manual) {
  const t = await db.one(
    `update terreiros set status = $2::status_terreiro, status_manual = $3, motivo_bloqueio = $4,
            encerrado_em = case when $2::status_terreiro = 'encerrado' then now() else null end
      where id = $1 returning *`,
    [req.params.id, status, manual, req.body?.motivo || null]
  );
  if (!t) throw erro.naoEncontrado();
  if (status === 'bloqueado' || status === 'encerrado') {
    await db.query('delete from sessoes where usuario_id in (select usuario_id from vinculos where terreiro_id = $1) and usuario_id not in (select id from usuarios where is_admin)', [t.id]);
  }
  await auditar(null, { terreiroId: t.id, usuarioId: req.usuario.id, acao: `terreiro_${status}`, entidade: 'terreiro', entidadeId: t.id, dados: { motivo: req.body?.motivo || null } });
  res.json(t);
}

r.post('/terreiros/:id/bloquear', wrap((req, res) => mudarStatus(req, res, 'bloqueado', true)));
r.post('/terreiros/:id/desbloquear', wrap((req, res) => mudarStatus(req, res, 'ativo', false)));
r.post('/terreiros/:id/encerrar', wrap((req, res) => mudarStatus(req, res, 'encerrado', true)));

// Exportação disponível por 90 dias após o encerramento (US-05)
r.get('/terreiros/:id/exportacao', wrap(async (req, res) => {
  const t = await db.one('select * from terreiros where id = $1', [req.params.id]);
  if (!t) throw erro.naoEncontrado();
  if (t.status === 'encerrado' && t.encerrado_em && Date.now() - new Date(t.encerrado_em).getTime() > 90 * 864e5) {
    throw erro.regra('A exportação ficou disponível por 90 dias após o encerramento e expirou');
  }
  const id = t.id;
  const [filhos, cobrancas, despesas, avisos, eventos] = await Promise.all([
    db.many('select * from filhos where terreiro_id = $1', [id]),
    db.many('select * from cobrancas where terreiro_id = $1', [id]),
    db.many('select * from despesas where terreiro_id = $1', [id]),
    db.many('select * from avisos where terreiro_id = $1', [id]),
    db.many('select * from eventos where terreiro_id = $1', [id]),
  ]);
  await auditar(null, { terreiroId: id, usuarioId: req.usuario.id, acao: 'exportacao', entidade: 'terreiro', entidadeId: id });
  res.setHeader('content-disposition', `attachment; filename="terreiro-${id}.json"`);
  res.json({ exportado_em: new Date().toISOString(), terreiro: t, filhos, cobrancas, despesas, avisos, eventos });
}));

// Link de nova senha para o sacerdote do terreiro (vale 24 h)
r.post('/terreiros/:id/link-senha', wrap(async (req, res) => {
  const s = await db.one(
    `select u.id, u.nome, u.telefone, u.senha_hash from vinculos v join usuarios u on u.id = v.usuario_id
      where v.terreiro_id = $1 and v.papel = 'sacerdote' and v.ativo order by v.created_at limit 1`, [req.params.id]
  );
  if (!s) throw erro.naoEncontrado('Sacerdote não encontrado');
  if (!s.senha_hash) throw erro.regra('O sacerdote ainda não aceitou o convite');
  const { link } = await auth.criarRecuperacao(s.id, { criadoPor: req.usuario.id, canal: 'manual' });
  res.json({ link, nome: s.nome, expira_em_horas: 24 });
}));

// ---------- integrações: situação e teste de cada canal ----------
r.get('/integracoes', wrap(async (_req, res) => {
  const { situacaoCanais } = require('../services/notificacoes');
  const { gateway } = require('../gateway');
  const fila = await db.many(
    `select canal, status, count(*)::int as n from notificacoes where created_at > now() - interval '7 days' group by canal, status order by canal, status`
  );
  const falhas = await db.many(`select canal, erro, created_at from notificacoes where status = 'falhou' order by created_at desc limit 10`);
  res.json({
    gateway: { nome: gateway.nome, base: gateway.nome === 'asaas' ? process.env.ASAAS_BASE_URL || 'https://sandbox.asaas.com/api/v3' : null, chave_cifra: Boolean(process.env.CHAVE_CIFRA) },
    canais: situacaoCanais(), fila_7_dias: fila, ultimas_falhas: falhas,
  });
}));

r.post('/integracoes/testar', wrap(async (req, res) => {
  const canal = campo(req.body, 'canal', { obrigatorio: true, opcoes: ['gateway', 'email', 'whatsapp', 'push'] });
  const eu = await db.one('select * from usuarios where id = $1', [req.usuario.id]);
  let resultado;
  try {
    if (canal === 'gateway') {
      const { gateway } = require('../gateway');
      resultado = await gateway.testar({ cpf: campo(req.body, 'cpf') || '24971563792' });
    } else {
      const destino = canal === 'whatsapp' ? campo(req.body, 'telefone') || eu.telefone : canal === 'email' ? campo(req.body, 'email') || eu.email : null;
      const { CANAIS } = require('../services/notificacoes');
      const base = { titulo: 'Teste do Terreiro Hub', texto: 'Se você recebeu esta mensagem, o envio está funcionando.', link: (process.env.APP_URL || '') + '/#/admin' };
      const r1 = canal === 'push' ? await CANAIS.push.enviar({ ...base, usuarioId: eu.id })
        : canal === 'whatsapp' ? await CANAIS.whatsapp.enviar({ ...base, telefone: require('../util').telefoneNormalizado(destino), nome: eu.nome.split(' ')[0], tipo: 'aviso' })
          : await CANAIS.email.enviar({ ...base, email: destino });
      resultado = r1.ignorada ? { ok: false, motivo: r1.ignorada } : { ok: true, destino, detalhe: r1 };
    }
  } catch (e) {
    resultado = { ok: false, motivo: e.message };
  }
  console.log(`[integracoes] teste ${canal}:`, JSON.stringify(resultado).slice(0, 2000));
  await auditar(null, { usuarioId: req.usuario.id, acao: 'teste_integracao', entidade: 'integracao', entidadeId: canal, dados: { ok: resultado.ok } });
  res.json({ canal, ...resultado });
}));

// Faturas do SaaS
r.get('/faturas', wrap(async (req, res) => {
  const { limite, offset } = paginacao(req.query);
  res.json(await db.many(
    `select f.*, t.nome as terreiro from faturas_saas f join terreiros t on t.id = f.terreiro_id
      where ($1::text is null or f.status = $1) order by f.vencimento desc limit $2 offset $3`,
    [req.query.status || null, limite, offset]
  ));
}));

// RF-06: métricas do SaaS
r.get('/metricas', wrap(async (_req, res) => {
  const hoje = relogio.hoje();
  const m = await db.one(
    `select
       (select count(*) from terreiros where status in ('ativo','aviso','somente_leitura'))::int as terreiros_ativos,
       (select count(*) from terreiros where status = 'teste')::int as terreiros_teste,
       (select count(*) from terreiros where status in ('bloqueado','encerrado'))::int as terreiros_inativos,
       (select coalesce(sum(p.preco_centavos),0) from terreiros t join planos p on p.id = t.plano_id where t.status in ('ativo','aviso','somente_leitura'))::bigint as mrr_centavos,
       (select coalesce(sum(valor_centavos),0) from faturas_saas where status = 'aberta' and vencimento < $1)::bigint as inadimplencia_centavos,
       (select count(*) from filhos where status = 'ativo')::int as filhos_ativos,
       (select count(*) from terreiros where status = 'encerrado' and encerrado_em > now() - interval '30 days')::int as churn_30d`,
    [hoje]
  );
  res.json(m);
}));

// Rotinas diárias (também rodam sozinhas no servidor)
r.post('/rotinas/rodar', wrap(async (req, res) => {
  res.json(await jobs.rodarTudo(campo(req.body || {}, 'hoje', { tipo: 'date' }) || relogio.hoje()));
}));

r.get('/auditoria', wrap(async (req, res) => {
  const { limite, offset } = paginacao(req.query);
  res.json(await db.many(
    'select * from auditoria where ($1::uuid is null or terreiro_id = $1) order by id desc limit $2 offset $3',
    [req.query.terreiro_id || null, limite, offset]
  ));
}));

module.exports = r;
