'use strict';
// Senha (troca, recuperação, link gerado por terceiros), fila de notificações (push, WhatsApp, e-mail)
// e resiliência do gateway. Serviços externos são simulados interceptando fetch pelo host.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const h = require('../helpers');

process.env.RESEND_API_KEY = 're_teste';
process.env.EMAIL_FROM = 'Terreiro Hub <nao-responda@teste.dev>';
process.env.WHATSAPP_TOKEN = 'wa-teste';
process.env.WHATSAPP_PHONE_NUMBER_ID = '123456';

const EXTERNOS = ['api.resend.com', 'graph.facebook.com', 'push.teste.dev', 'sandbox.asaas.com'];
const chamadas = [];
let respostas = {}; // host → fn(chamada) => {status, json}
const fetchReal = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  if (!EXTERNOS.includes(u.hostname)) return fetchReal(url, opts);
  let corpo = opts.body;
  if (typeof corpo === 'string') { try { corpo = JSON.parse(corpo); } catch { /* binário/texto */ } }
  const c = { host: u.hostname, caminho: u.pathname, metodo: opts.method || 'GET', headers: opts.headers || {}, corpo };
  chamadas.push(c);
  const r = respostas[u.hostname]?.(c) || { status: u.hostname === 'push.teste.dev' ? 201 : 200, json: { id: 'ext_' + chamadas.length, messages: [{ id: 'wamid.' + chamadas.length }] } };
  return new Response(JSON.stringify(r.json || {}), { status: r.status, headers: { 'content-type': 'application/json' } });
};
const de = (host) => chamadas.filter((c) => c.host === host);
const emailsDeSenha = (para) => de('api.resend.com').filter((c) => c.corpo.subject === 'Redefinir sua senha' && (!para || c.corpo.to[0] === para));
const despachar = () => require('../../src/services/notificacoes').despachar();

function inscricaoFalsa(id = crypto.randomUUID()) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { endpoint: `https://push.teste.dev/${id}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
}
const linkDe = (texto) => String(texto).match(/https?:\/\/\S+#\/(?:redefinir|convite)\/[A-Za-z0-9_-]+/)[0];

before(h.subir);
after(async () => { globalThis.fetch = fetchReal; await h.descer(); });
beforeEach(() => { chamadas.length = 0; respostas = {}; });

describe('Senha', () => {
  let admin;
  before(async () => { admin = await h.loginAdmin(); });

  it('PW-01: troca de senha exige a atual e desconecta os outros aparelhos', async () => {
    const { email } = await h.terreiroPronto({ admin });
    const a = h.cliente((await h.req('POST', '/api/auth/login', { corpo: { identificador: email, senha: 'senha-forte-1' } })).body.token);
    const b = h.cliente((await h.req('POST', '/api/auth/login', { corpo: { identificador: email, senha: 'senha-forte-1' } })).body.token);
    assert.equal((await a.post('/api/auth/senha', { senha_atual: 'errada', nova_senha: 'nova-senha-123' })).status, 400);
    assert.equal((await a.post('/api/auth/senha', { senha_atual: 'senha-forte-1', nova_senha: 'curta' })).status, 400);
    assert.equal((await a.post('/api/auth/senha', { senha_atual: 'senha-forte-1', nova_senha: 'nova-senha-123' })).status, 200);
    assert.equal((await a.get('/api/auth/eu')).status, 200, 'aparelho atual continua');
    assert.equal((await b.get('/api/auth/eu')).status, 401, 'outro aparelho foi desconectado');
    assert.equal((await h.req('POST', '/api/auth/login', { corpo: { identificador: email, senha: 'senha-forte-1' } })).status, 401);
    assert.equal((await h.req('POST', '/api/auth/login', { corpo: { identificador: email, senha: 'nova-senha-123' } })).status, 200);
  });

  it('PW-02: esqueci a senha por e-mail envia link de uso único que vale 1 hora', async () => {
    const { email, sac } = await h.terreiroPronto({ admin });
    const r = await h.req('POST', '/api/auth/esqueci', { corpo: { identificador: email } });
    assert.equal(r.status, 202);
    await despachar();
    const env = emailsDeSenha(email);
    assert.equal(env.length, 1);
    assert.deepEqual(env[0].corpo.to, [email]);
    assert.equal(env[0].headers.authorization, 'Bearer re_teste');
    const link = linkDe(env[0].corpo.text);
    const token = link.split('/redefinir/')[1];
    assert.equal((await h.req('GET', `/api/auth/redefinir/${token}`)).status, 200);
    const nova = await h.req('POST', '/api/auth/redefinir', { corpo: { token, senha: 'redefinida-123' } });
    assert.equal(nova.status, 200);
    assert.ok(nova.body.token, 'já entra logado');
    assert.equal((await sac.get('/api/auth/eu')).status, 401, 'sessões antigas encerradas');
    assert.equal((await h.req('POST', '/api/auth/redefinir', { corpo: { token, senha: 'outra-senha-123' } })).status, 422, 'link de uso único');
    assert.equal((await h.req('POST', '/api/auth/login', { corpo: { identificador: email, senha: 'redefinida-123' } })).status, 200);
  });

  it('PW-03: pedido pelo telefone chega por WhatsApp (modelo de senha) e não revela contas inexistentes', async () => {
    const { tid, sac } = await h.terreiroPronto({ admin });
    const f = await h.filhoComAcesso(sac, tid);
    const tel = f.filho.telefone;
    assert.equal((await h.req('POST', '/api/auth/esqueci', { corpo: { identificador: tel.slice(2) } })).status, 202);
    await despachar();
    const wa = de('graph.facebook.com');
    assert.equal(wa.length, 1);
    assert.equal(wa[0].caminho, '/v21.0/123456/messages');
    assert.equal(wa[0].corpo.to, tel);
    assert.equal(wa[0].corpo.template.name, 'redefinir_senha');
    assert.match(wa[0].corpo.template.components[0].parameters[0].text, /#\/redefinir\//);
    chamadas.length = 0;
    const ninguem = await h.req('POST', '/api/auth/esqueci', { corpo: { identificador: 'ninguem@teste.dev' } });
    assert.equal(ninguem.status, 202);
    assert.equal(ninguem.body.mensagem, (await h.req('POST', '/api/auth/esqueci', { corpo: { identificador: tel } })).body.mensagem, 'mesma resposta');
  });

  it('PW-04: no máximo 3 pedidos por hora; link vencido é recusado', async () => {
    const { email } = await h.terreiroPronto({ admin });
    for (let i = 0; i < 5; i++) await h.req('POST', '/api/auth/esqueci', { corpo: { identificador: email } });
    const u = await h.db.one('select id from usuarios where email = $1', [email]);
    assert.equal((await h.db.one('select count(*)::int as n from recuperacoes_senha where usuario_id = $1', [u.id])).n, 3);
    await despachar();
    const token = linkDe(emailsDeSenha(email)[0].corpo.text).split('/redefinir/')[1];
    await h.db.query(`update recuperacoes_senha set expira_em = now() - interval '1 minute' where usuario_id = $1`, [u.id]);
    const r = await h.req('POST', '/api/auth/redefinir', { corpo: { token, senha: 'qualquer-123' } });
    assert.equal(r.status, 422);
    assert.match(r.body.erro.mensagem, /expirou/);
  });

  it('PW-05: sacerdote gera link de nova senha para filho com acesso; admin para o sacerdote', async () => {
    const { tid, sac } = await h.terreiroPronto({ admin });
    const semAcesso = await h.novoFilho(sac, tid);
    assert.equal((await sac.post(`/api/t/${tid}/filhos/${semAcesso.id}/link-senha`)).status, 422);
    const f = await h.filhoComAcesso(sac, tid);
    const l = await sac.post(`/api/t/${tid}/filhos/${f.filho.id}/link-senha`);
    assert.equal(l.status, 200);
    assert.match(l.body.whatsapp, /^https:\/\/wa\.me\//);
    assert.equal(l.body.expira_em_horas, 24);
    const token = l.body.link.split('/redefinir/')[1];
    assert.equal((await h.req('POST', '/api/auth/redefinir', { corpo: { token, senha: 'filho-nova-123' } })).status, 200);
    assert.equal((await f.api.get(`/api/t/${tid}/meu/inicio`)).status, 401, 'sessão antiga do filho encerrada');
    assert.equal((await f.api.post(`/api/t/${tid}/filhos/${f.filho.id}/link-senha`)).status, 401);
    const ls = await admin.post(`/api/admin/terreiros/${tid}/link-senha`);
    assert.equal(ls.status, 200);
    const aud = await h.db.many(`select dados from auditoria where acao = 'senha_link_gerado' and entidade_id = $1`, [String((await h.db.one('select usuario_id from filhos where id = $1', [f.filho.id])).usuario_id)]);
    assert.ok(aud.some((a) => a.dados.por_terceiro === true), 'geração por terceiro fica na auditoria');
  });
});

describe('Notificações', () => {
  let admin;
  before(async () => { admin = await h.loginAdmin(); });

  it('NT-01: aviso chega por Web Push cifrado, com assinatura VAPID, só nos aparelhos do filho', async () => {
    const { tid, sac } = await h.terreiroPronto({ admin });
    const a = await h.filhoComAcesso(sac, tid);
    const b = await h.filhoComAcesso(sac, tid);
    const chave = await h.req('GET', '/api/push/chave');
    assert.ok(chave.body.chave_publica.length > 40);
    assert.equal((await a.api.post('/api/push/inscricao', { inscricao: inscricaoFalsa('aparelho-a') })).status, 201);
    await sac.post(`/api/t/${tid}/avisos`, { titulo: 'Obrigação de Oxum', publico: { tipo: 'filhos', ids: [a.filho.id] } });
    const placar = await despachar();
    assert.ok(placar.enviadas >= 1);
    const p = de('push.teste.dev');
    assert.equal(p.length, 1);
    assert.equal(p[0].caminho, '/aparelho-a');
    assert.equal(p[0].headers['Content-Encoding'], 'aes128gcm');
    assert.match(p[0].headers.Authorization, /^vapid t=/);
    assert.ok(!String(p[0].corpo).includes('Oxum'), 'conteúdo cifrado');
    const n = await h.db.one(`select status, texto from notificacoes where filho_id = $1 and canal = 'push'`, [a.filho.id]);
    assert.equal(n.status, 'enviada');
    assert.doesNotMatch(n.texto, /oxum|obriga/i);
    assert.ok(b);
  });

  it('NT-02: WhatsApp usa o modelo aprovado com nome, texto neutro e link do app', async () => {
    const { tid, sac } = await h.terreiroPronto({ admin });
    const f = await h.novoFilho(sac, tid, { nome_civil: 'Maria Souza' });
    await sac.post(`/api/t/${tid}/avisos`, { titulo: 'Gira de Exu', publico: { tipo: 'filhos', ids: [f.id] }, canais: ['whatsapp'] });
    await despachar();
    const wa = de('graph.facebook.com');
    assert.equal(wa.length, 1, 'filho sem login também recebe WhatsApp');
    assert.equal(wa[0].corpo.template.name, 'aviso_terreiro');
    assert.equal(wa[0].corpo.template.language.code, 'pt_BR');
    const [nome, texto, link] = wa[0].corpo.template.components[0].parameters.map((x) => x.text);
    assert.equal(nome, 'Maria');
    assert.doesNotMatch(texto, /exu|gira/i);
    assert.match(link, /#\/mural$/);
    assert.equal(wa[0].headers.authorization, 'Bearer wa-teste');
  });

  it('NT-03: preferência desligada é respeitada, exceto em convite e senha', async () => {
    const { tid, sac, email } = await h.terreiroPronto({ admin });
    const f = await h.filhoComAcesso(sac, tid, { email: `filho${Date.now()}@teste.dev` });
    await f.api.patch('/api/auth/preferencias', { whatsapp: false, email: false });
    await sac.post(`/api/t/${tid}/avisos`, { titulo: 'x', publico: { tipo: 'filhos', ids: [f.filho.id] }, canais: ['whatsapp'] });
    await despachar();
    assert.equal(de('graph.facebook.com').length, 0);
    const n = await h.db.one(`select status, erro from notificacoes where filho_id = $1 and canal = 'whatsapp'`, [f.filho.id]);
    assert.equal(n.status, 'ignorada');
    assert.match(n.erro, /desligado/);
    const u = await h.db.one('select id from usuarios where telefone = $1', [f.filho.telefone]);
    await h.db.query(`update usuarios set preferencias = '{"email":false,"whatsapp":false}' where email = $1`, [email]);
    await h.req('POST', '/api/auth/esqueci', { corpo: { identificador: email } });
    await despachar();
    assert.equal(emailsDeSenha(email).length, 1, 'e-mail de senha ignora a preferência');
    assert.ok(u);
  });

  it('NT-04: falha temporária reagenda; definitiva marca falha; aparelho expirado é removido', async () => {
    const { tid, sac } = await h.terreiroPronto({ admin });
    const f = await h.filhoComAcesso(sac, tid);
    await f.api.post('/api/push/inscricao', { inscricao: inscricaoFalsa('expirado') });
    respostas['graph.facebook.com'] = () => ({ status: 503, json: { error: { message: 'indisponível' } } });
    respostas['push.teste.dev'] = () => ({ status: 410, json: {} });
    await sac.post(`/api/t/${tid}/avisos`, { titulo: 'x', publico: { tipo: 'filhos', ids: [f.filho.id] }, canais: ['whatsapp', 'push'] });
    const p1 = await despachar();
    assert.equal(p1.reagendadas, 1, 'WhatsApp fora do ar → tenta de novo');
    const wa = await h.db.one(`select status, tentativas, proxima_tentativa > now() as futuro from notificacoes where filho_id = $1 and canal = 'whatsapp'`, [f.filho.id]);
    assert.deepEqual([wa.status, wa.tentativas, wa.futuro], ['pendente', 1, true]);
    assert.equal((await h.db.one('select count(*)::int as n from push_inscricoes where endpoint like $1', ['%/expirado'])).n, 0, 'inscrição 410 removida');
    respostas['graph.facebook.com'] = () => ({ status: 400, json: { error: { code: 132001, message: 'Template name does not exist' } } });
    await h.db.query(`update notificacoes set proxima_tentativa = now() where filho_id = $1`, [f.filho.id]);
    await despachar();
    const wa2 = await h.db.one(`select status, erro from notificacoes where filho_id = $1 and canal = 'whatsapp'`, [f.filho.id]);
    assert.equal(wa2.status, 'falhou');
    assert.match(wa2.erro, /Template/);
  });

  it('NT-05: canal sem configuração e filho bloqueado são ignorados com o motivo', async () => {
    const { tid, sac } = await h.terreiroPronto({ admin });
    const f = await h.novoFilho(sac, tid);
    const salvo = process.env.WHATSAPP_TOKEN;
    delete process.env.WHATSAPP_TOKEN;
    await sac.post(`/api/t/${tid}/avisos`, { titulo: 'x', publico: { tipo: 'filhos', ids: [f.id] }, canais: ['whatsapp'] });
    await despachar();
    process.env.WHATSAPP_TOKEN = salvo;
    assert.match((await h.db.one(`select erro from notificacoes where filho_id = $1`, [f.id])).erro, /não configurado/);
    const g = await h.novoFilho(sac, tid);
    await sac.post(`/api/t/${tid}/cobrancas`, { filho_id: g.id, descricao: 'x', valor_centavos: 1000, vencimento: '2099-01-01', canais: ['whatsapp'] });
    await sac.post(`/api/t/${tid}/filhos/${g.id}/bloquear`, { motivo: 'teste' });
    await despachar();
    const n = await h.db.one(`select status, erro from notificacoes where filho_id = $1 and canal = 'whatsapp'`, [g.id]);
    assert.deepEqual([n.status, n.erro], ['ignorada', 'destinatário inativo']);
  });

  it('NT-06: convite do sacerdote chega por e-mail com o link de aceite', async () => {
    const n = 800000000 + h.unico();
    const r = await admin.post('/api/admin/terreiros', { nome: 'Casa Convite', documento: h.gerarCpf(n), responsavel_nome: 'Mãe Teste', email: `convite${n}@teste.dev` });
    await despachar();
    const env = de('api.resend.com').find((c) => c.corpo.to[0] === `convite${n}@teste.dev`);
    assert.ok(env, 'e-mail enviado');
    assert.equal(linkDe(env.corpo.text), r.body.convite.link);
    assert.match(env.corpo.html, /Aceitar convite/);
  });

  it('NT-07: painel do admin mostra os canais e testa o envio', async () => {
    const i = await admin.get('/api/admin/integracoes');
    assert.equal(i.body.canais.email.ativo, true);
    assert.equal(i.body.canais.whatsapp.ativo, true);
    const t = await admin.post('/api/admin/integracoes/testar', { canal: 'email' });
    assert.equal(t.body.ok, true);
    assert.equal(de('api.resend.com').at(-1).corpo.to[0], 'admin@teste.dev');
    const g = await admin.post('/api/admin/integracoes/testar', { canal: 'gateway' });
    assert.equal(g.body.ok, true);
  });
});

describe('Gateway resiliente e Asaas', () => {
  let admin;
  before(async () => { admin = await h.loginAdmin(); });

  it('AS-01: gateway fora do ar não perde a cobrança; a rotina gera o Pix depois', async () => {
    const { tid, sac } = await h.terreiroPronto({ admin });
    const f = await h.novoFilho(sac, tid);
    globalThis.__falharGatewaySimulado = true;
    const c = await sac.post(`/api/t/${tid}/cobrancas`, { filho_id: f.id, descricao: 'Bori', valor_centavos: 35000, vencimento: '2099-01-10' });
    globalThis.__falharGatewaySimulado = false;
    assert.equal(c.status, 201);
    assert.equal(c.body.status, 'aberta');
    assert.equal(c.body.pix_pendente, true);
    const { reenviarSemGateway } = require('../../src/services/cobrancas');
    const r = await reenviarSemGateway();
    assert.ok(r.geradas >= 1);
    const depois = (await sac.get(`/api/t/${tid}/cobrancas/${c.body.id}`)).body;
    assert.equal(depois.pix_pendente, false);
    assert.match(depois.pix_copia_cola, /^000201/);
    assert.ok(depois.link_pagamento);
  });

  it('AS-02: a chave da subconta fica cifrada no banco', async () => {
    const { tid } = await h.terreiroPronto({ admin });
    const t = await h.db.one('select gateway_api_key from terreiros where id = $1', [tid]);
    assert.match(t.gateway_api_key, /^v1:/);
    assert.ok(!t.gateway_api_key.includes('$aact'));
    const { decifrar } = require('../../src/cifra');
    assert.match(decifrar(t.gateway_api_key), /^\$aact_sim_/);
  });

  it('AS-03: adaptador Asaas monta subconta com webhook, usa a chave da subconta e reaproveita o cliente', async () => {
    process.env.ASAAS_API_KEY = '$aact_principal';
    process.env.APP_URL = 'https://app.teste.dev';
    const asaas = require('../../src/gateway/asaas');
    respostas['sandbox.asaas.com'] = (c) => {
      if (c.caminho.endsWith('/accounts')) return { status: 200, json: { id: 'acc-1', walletId: 'wal-1', apiKey: '$aact_sub' } };
      if (c.caminho.endsWith('/customers')) return { status: 200, json: { id: 'cus_1' } };
      if (c.caminho.endsWith('/payments')) return { status: 200, json: { id: 'pay_1', status: 'PENDING', invoiceUrl: 'https://sandbox.asaas.com/i/1' } };
      if (c.caminho.endsWith('/pixQrCode')) return { status: 200, json: { payload: '00020126...6304ABCD' } };
      if (c.caminho.endsWith('/identificationField')) return { status: 200, json: { identificationField: '23793.38128 60000.000003 00000.000400 1 99990000005000' } };
      return { status: 404, json: {} };
    };
    const sub = await asaas.criarSubconta({ nome: 'Casa', documento: '52998224725', email: 'c@teste.dev', telefone: '5511987654321', nascimento: '1980-01-01', cep: '01001000', endereco: 'Praça da Sé', numero: '1', bairro: 'Sé' });
    assert.deepEqual(sub, { id: 'acc-1', walletId: 'wal-1', apiKey: '$aact_sub', status: 'PENDING' });
    const corpoConta = de('sandbox.asaas.com')[0].corpo;
    assert.equal(corpoConta.mobilePhone, '11987654321');
    assert.equal(corpoConta.webhooks[0].url, 'https://app.teste.dev/api/webhooks/gateway');
    assert.equal(corpoConta.webhooks[0].authToken, process.env.WEBHOOK_TOKEN);
    assert.ok(corpoConta.webhooks[0].events.includes('PAYMENT_RECEIVED'));
    assert.equal(de('sandbox.asaas.com')[0].headers.access_token, '$aact_principal');
    chamadas.length = 0;
    const c1 = await asaas.criarCobranca({ apiKey: '$aact_sub', valorCentavos: 5000, vencimento: '2099-01-10', descricao: 'Mensalidade', referencia: 'ref', pagador: { nome: 'Ana', telefone: '5511999990000' } });
    assert.deepEqual([c1.id, c1.clienteId, c1.linkPagamento], ['pay_1', 'cus_1', 'https://sandbox.asaas.com/i/1']);
    assert.match(c1.pixCopiaCola, /^000201/);
    assert.ok(de('sandbox.asaas.com').every((c) => c.headers.access_token === '$aact_sub'), 'usa a chave da subconta');
    assert.equal(de('sandbox.asaas.com').find((c) => c.caminho.endsWith('/payments')).corpo.value, 50);
    chamadas.length = 0;
    await asaas.criarCobranca({ apiKey: '$aact_sub', clienteId: 'cus_1', valorCentavos: 5000, vencimento: '2099-02-10', descricao: 'Mensalidade', referencia: 'ref2', pagador: { nome: 'Ana' } });
    assert.equal(de('sandbox.asaas.com').filter((c) => c.caminho.endsWith('/customers')).length, 0, 'cliente reaproveitado');
    respostas['sandbox.asaas.com'] = () => ({ status: 400, json: { errors: [{ code: 'invalid_cpfCnpj', description: 'O CPF/CNPJ informado é inválido.' }] } });
    await assert.rejects(asaas.criarCobranca({ apiKey: '$aact_sub', valorCentavos: 100, vencimento: '2099-01-10', descricao: 'x', referencia: 'y', pagador: { nome: 'x' } }), /CPF\/CNPJ informado é inválido/);
  });
});
