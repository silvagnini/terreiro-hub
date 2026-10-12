'use strict';
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { gateway, WEBHOOK_TOKEN, simulado } = require('../gateway');
const { erro, wrap, campo, sha256, relogio } = require('../util');
const { registrarPagamento, liberarAguardando } = require('../services/cobrancas');
const { auditar } = require('../services/base');
const { reguaInadimplencia } = require('../services/jobs');

const TERMO_VERSAO = '1.0';
const r = express.Router();

r.get('/saude', wrap(async (_req, res) => {
  await db.query('select 1');
  res.json({ ok: true, gateway: gateway.nome, versao: require('../../package.json').version });
}));

r.post('/auth/login', wrap(async (req, res) => {
  const { token, usuario } = await auth.login(req.body.identificador, req.body.senha);
  res.cookie?.('sessao', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 14 * 864e5 });
  res.json({ token, usuario, vinculos: await vinculosDo(usuario.id) }); // um usuário pode estar em vários terreiros (RF-62, RN-12)
}));

r.post('/auth/logout', auth.autenticar, wrap(async (req, res) => {
  await db.query('delete from sessoes where token_hash = $1', [req.sessao.tokenHash]);
  res.clearCookie?.('sessao');
  res.json({ ok: true });
}));

r.get('/auth/eu', auth.autenticar, wrap(async (req, res) => {
  res.json({ usuario: req.usuario, vinculos: await vinculosDo(req.usuario.id) });
}));

async function vinculosDo(usuarioId) {
  return db.many(
    `select v.terreiro_id, v.papel, v.permissoes, v.filho_id, t.nome as terreiro_nome, t.status as terreiro_status, t.cor
       from vinculos v join terreiros t on t.id = v.terreiro_id
      where v.usuario_id = $1 and v.ativo order by t.nome`,
    [usuarioId]
  );
}

// ---------- convites (US-01 sacerdote, US-11/US-12 filho, auxiliares) ----------
async function vinculoPorToken(token) {
  const v = await db.one(
    `select v.*, t.nome as terreiro_nome, f.nome_civil as filho_nome, f.telefone as filho_telefone, f.email as filho_email
       from vinculos v join terreiros t on t.id = v.terreiro_id left join filhos f on f.id = v.filho_id
      where v.convite_token_hash = $1`,
    [sha256(String(token || ''))]
  );
  if (!v) throw erro.naoEncontrado('Convite inválido');
  if (new Date(v.convite_expira) < new Date()) {
    if (v.filho_id) await db.query(`update filhos set convite_status = 'expirado' where id = $1 and convite_status = 'convidado'`, [v.filho_id]);
    throw erro.regra('Este convite expirou. Peça um novo ao sacerdote.', { expirado: true });
  }
  return v;
}

r.get('/convites/:token', wrap(async (req, res) => {
  const v = await vinculoPorToken(req.params.token);
  res.json({ terreiro: v.terreiro_nome, papel: v.papel, nome: v.filho_nome || null, exige_consentimento: v.papel === 'filho', termo_versao: TERMO_VERSAO });
}));

r.post('/convites/aceitar', wrap(async (req, res) => {
  const v = await vinculoPorToken(req.body.token);
  const senha = req.body.senha;
  auth.validarSenha(senha);
  if (v.papel === 'filho' && req.body.consentimento !== true) {
    throw erro.validacao('É preciso aceitar o termo de uso dos dados para entrar', { campo: 'consentimento' });
  }
  const resultado = await db.tx(async (t) => {
    let usuario;
    if (v.usuario_id) {
      usuario = await t.one('select * from usuarios where id = $1', [v.usuario_id]);
    } else {
      usuario = await t.one(
        'select * from usuarios where ($1::text is not null and telefone = $1) or ($2::text is not null and lower(email) = lower($2))',
        [v.filho_telefone, v.filho_email]
      );
    }
    if (!usuario) {
      usuario = await t.one(
        'insert into usuarios(nome, telefone, email, senha_hash) values ($1,$2,$3,$4) returning *',
        [campo(req.body, 'nome', { max: 120 }) || v.filho_nome || 'Usuário', v.filho_telefone, v.filho_email, auth.hashSenha(senha)]
      );
    } else if (!usuario.senha_hash) {
      usuario = await t.one('update usuarios set senha_hash = $2 where id = $1 returning *', [usuario.id, auth.hashSenha(senha)]);
    }
    await t.query(
      'update vinculos set usuario_id = $2, convite_token_hash = null, convite_expira = null where id = $1', [v.id, usuario.id]
    );
    if (v.filho_id) {
      await t.query(
        `update filhos set usuario_id = $2, convite_status = 'ativo', consentimento_em = now(), consentimento_versao = $3,
                consentimento_ip = $4, consentimento_religioso = $5 where id = $1`,
        [v.filho_id, usuario.id, TERMO_VERSAO, req.ip, req.body.consentimento_religioso === true]
      );
    }
    await auditar(t, { terreiroId: v.terreiro_id, usuarioId: usuario.id, acao: 'convite_aceito', entidade: 'vinculo', entidadeId: v.id, dados: { papel: v.papel, termo: v.papel === 'filho' ? TERMO_VERSAO : null } });
    return usuario;
  });
  const token = await auth.criarSessao(resultado.id);
  res.status(201).json({ token, usuario: auth.publico(resultado), vinculos: await vinculosDo(resultado.id) });
}));

// ---------- webhook do gateway (RF-49, RNF-05) ----------
r.post('/webhooks/gateway', wrap(async (req, res) => {
  if (req.get('asaas-access-token') !== WEBHOOK_TOKEN) throw erro.naoAutenticado('Webhook sem token válido');
  // O Asaas reenvia quando não recebe 200 e pausa a fila após 15 falhas seguidas:
  // evento malformado é aceito, registrado no log e ignorado (só token inválido é recusado).
  const ev = req.body || {};
  if (!ev.id || !ev.event) {
    console.warn('[webhook] evento sem id/event ignorado', JSON.stringify(ev).slice(0, 300));
    return res.json({ recebido: true, ignorado: true, motivo: 'evento sem id ou event' });
  }
  if (ev.event === 'PAYMENT_RECEIVED' || ev.event === 'PAYMENT_CONFIRMED') {
    if (!ev.payment || !ev.payment.id) {
      console.warn('[webhook] pagamento sem payment.id ignorado', ev.id);
      return res.json({ recebido: true, ignorado: true, motivo: 'pagamento sem payment.id' });
    }
    const r1 = await registrarPagamento(ev);
    if (r1.tipo === 'fatura_saas') await reguaInadimplencia(relogio.hoje());
    return res.json({ recebido: true, ...r1 });
  }
  if (ev.event.startsWith('ACCOUNT_STATUS_GENERAL_APPROVAL')) {
    const novo = await db.one(
      'insert into webhook_eventos(evento_id, tipo, payload) values ($1,$2,$3) on conflict do nothing returning evento_id', [ev.id, ev.event, ev]
    );
    if (!novo) return res.json({ recebido: true, duplicado: true });
    const aprovada = ev.event.endsWith('APPROVED');
    const t = await db.one(
      `update terreiros set gateway_conta_status = $2 where gateway_conta_id = $1 returning id`, [ev.accountStatus?.id, aprovada ? 'aprovada' : 'recusada']
    );
    let liberadas = 0;
    if (t && aprovada) liberadas = await liberarAguardando(t.id);
    return res.json({ recebido: true, terreiro: t?.id || null, liberadas });
  }
  res.json({ recebido: true, ignorado: true });
}));

// ---------- simulador (só com gateway simulado) ----------
if (gateway.nome === 'simulado') {
  r.post('/simulador/pagar/:gatewayId', wrap(async (req, res) => {
    const c = (await db.one('select valor_centavos - desconto_centavos as v, id from cobrancas where gateway_id = $1', [req.params.gatewayId]))
      || (await db.one('select valor_centavos as v, id from faturas_saas where gateway_id = $1', [req.params.gatewayId]));
    if (!c) throw erro.naoEncontrado('Cobrança não encontrada no simulador');
    const ev = simulado.eventoPagamento({ gatewayId: req.params.gatewayId, valorCentavos: c.v, forma: req.body?.forma || 'PIX', data: relogio.hoje(), referencia: c.id });
    const resp = await fetch(`http://127.0.0.1:${req.socket.localPort}/api/webhooks/gateway`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'asaas-access-token': WEBHOOK_TOKEN }, body: JSON.stringify(ev),
    });
    res.status(resp.status).json({ evento: ev, resposta: await resp.json() });
  }));

  r.post('/simulador/aprovar-conta/:contaId', wrap(async (req, res) => {
    const ev = simulado.eventoConta({ contaId: req.params.contaId, aprovada: req.body?.aprovada !== false });
    const resp = await fetch(`http://127.0.0.1:${req.socket.localPort}/api/webhooks/gateway`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'asaas-access-token': WEBHOOK_TOKEN }, body: JSON.stringify(ev),
    });
    res.status(resp.status).json({ evento: ev, resposta: await resp.json() });
  }));
}

module.exports = r;
module.exports.vinculosDo = vinculosDo;
module.exports.TERMO_VERSAO = TERMO_VERSAO;
