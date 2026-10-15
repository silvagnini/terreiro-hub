'use strict';
// Infra comum dos testes de integração: banco de teste limpo, servidor em porta livre e fábricas de dados.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/terreiro_test';
process.env.RODAR_ROTINAS = 'false';
process.env.ADMIN_EMAIL = 'admin@teste.dev';
process.env.ADMIN_SENHA = 'admin-teste-123';
process.env.WEBHOOK_TOKEN = 'token-webhook-teste';

const db = require('../src/db');
const { iniciar } = require('../src/server');
const { relogio } = require('../src/util');
const { simulado } = require('../src/gateway');

let server;
let base;

async function subir() {
  await db.query('drop schema public cascade; create schema public;');
  server = await iniciar(0);
  base = `http://127.0.0.1:${server.address().port}`;
  return base;
}

async function descer() {
  relogio.limpar();
  if (server) await new Promise((r) => server.close(r));
  await db.close();
}

async function req(metodo, caminho, { token, corpo, headers = {} } = {}) {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  return { status: r.status, body: json, headers: r.headers };
}

const cliente = (token) => ({
  token,
  get: (c) => req('GET', c, { token }),
  post: (c, corpo = {}) => req('POST', c, { token, corpo }),
  patch: (c, corpo = {}) => req('PATCH', c, { token, corpo }),
  put: (c, corpo = {}) => req('PUT', c, { token, corpo }),
  del: (c, corpo) => req('DELETE', c, { token, corpo }),
});

async function loginAdmin() {
  const r = await req('POST', '/api/auth/login', { corpo: { identificador: 'admin@teste.dev', senha: 'admin-teste-123' } });
  return cliente(r.body.token);
}

// CPFs válidos gerados a partir de uma semente
function gerarCpf(n) {
  const d = String(100000000 + n).slice(0, 9).split('').map(Number);
  const dv = (arr, peso) => {
    const s = arr.reduce((acc, x, i) => acc + x * (peso - i), 0);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  d.push(dv(d, 10));
  d.push(dv(d, 11));
  return d.join('');
}

// contador com base aleatória: único dentro do arquivo de teste (o banco é recriado por arquivo)
let seq = Math.floor(Math.random() * 1e6);
const unico = () => ++seq;

const tokenDoLink = (link) => link.split('/convite/')[1];

// Cria terreiro pelo admin, aceita o convite do sacerdote e (opcional) aprova a conta de recebimento
async function terreiroPronto({ admin, plano = 'Raiz', aprovarConta = true, mensalidade } = {}) {
  admin = admin || (await loginAdmin());
  const planos = (await admin.get('/api/admin/planos')).body;
  const n = unico();
  const cr = await admin.post('/api/admin/terreiros', {
    nome: `Tenda Teste ${n}`, documento: gerarCpf(n), responsavel_nome: `Pai Teste ${n}`, email: `pai${n}@teste.dev`,
    telefone: `1199${String(n).padStart(7, '0').slice(-7)}`, plano_id: planos.find((p) => p.nome === plano).id,
  });
  if (cr.status !== 201) throw new Error('criar terreiro falhou: ' + JSON.stringify(cr.body));
  const tid = cr.body.terreiro.id;
  const ac = await req('POST', '/api/convites/aceitar', { corpo: { token: tokenDoLink(cr.body.convite.link), senha: 'senha-forte-1' } });
  const sac = cliente(ac.body.token);
  if (aprovarConta) {
    const conta = await sac.post(`/api/t/${tid}/conta-recebimento`, { nome: `Tenda ${n}`, documento: gerarCpf(n), email: `pai${n}@teste.dev` });
    await req('POST', `/api/simulador/aprovar-conta/${conta.body.gateway_conta_id}`, { corpo: {} });
  }
  if (mensalidade) await sac.put(`/api/t/${tid}/mensalidade`, mensalidade);
  return { tid, sac, admin, n, email: `pai${n}@teste.dev`, criacao: cr.body };
}

let tel = 0;
const telefone = () => `1198${String(++tel * 7919 + Math.floor(Math.random() * 1000)).padStart(7, '0').slice(-7)}`;

async function novoFilho(sac, tid, extra = {}) {
  const r = await sac.post(`/api/t/${tid}/filhos`, { nome_civil: `Filho ${unico()}`, telefone: telefone(), ...extra });
  if (r.status !== 201) throw new Error('criar filho falhou: ' + JSON.stringify(r.body));
  return r.body;
}

async function filhoComAcesso(sac, tid, extra = {}) {
  const f = await novoFilho(sac, tid, extra);
  const conv = await sac.post(`/api/t/${tid}/filhos/${f.id}/convite`);
  const ac = await req('POST', '/api/convites/aceitar', { corpo: { token: tokenDoLink(conv.body.link), senha: 'senha-filho-1', consentimento: true, consentimento_religioso: true } });
  if (ac.status !== 201) throw new Error('aceitar convite falhou: ' + JSON.stringify(ac.body));
  return { filho: f, api: cliente(ac.body.token), sessao: ac.body };
}

async function pagarNoSimulador(gatewayId, forma = 'PIX') {
  return req('POST', `/api/simulador/pagar/${gatewayId}`, { corpo: { forma } });
}

module.exports = {
  unico,
  subir, descer, req, cliente, loginAdmin, terreiroPronto, novoFilho, filhoComAcesso, pagarNoSimulador, tokenDoLink, gerarCpf, telefone,
  db, relogio, simulado, get base() { return base; },
};
