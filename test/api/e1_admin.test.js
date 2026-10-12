'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');

describe('E1 · Contratação e Admin da plataforma', () => {
  let admin;
  before(async () => { await h.subir(); admin = await h.loginAdmin(); });
  after(h.descer);

  it('US-01: Admin cadastra terreiro em teste por 30 dias e convida o sacerdote', async () => {
    h.relogio.fixar('2026-03-10');
    const planos = (await admin.get('/api/admin/planos')).body;
    const r = await admin.post('/api/admin/terreiros', {
      nome: 'Tenda Caminho de Luz', documento: h.gerarCpf(4242), responsavel_nome: 'Pai João', email: 'pai.joao@teste.dev', plano_id: planos[0].id,
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.terreiro.status, 'teste');
    assert.equal(r.body.terreiro.teste_ate, '2026-04-09');
    assert.match(r.body.convite.link, /#\/convite\//);

    const dup = await admin.post('/api/admin/terreiros', { nome: 'Outro', documento: h.gerarCpf(4242), responsavel_nome: 'X', email: 'x@teste.dev' });
    assert.equal(dup.status, 409, 'CPF/CNPJ duplicado é recusado');
    const inv = await admin.post('/api/admin/terreiros', { nome: 'Outro', documento: '11111111111', responsavel_nome: 'X', email: 'x@teste.dev' });
    assert.equal(inv.status, 400, 'documento inválido é recusado');

    const ac = await h.req('POST', '/api/convites/aceitar', { corpo: { token: h.tokenDoLink(r.body.convite.link), senha: 'senha-forte-1' } });
    assert.equal(ac.status, 201);
    assert.equal(ac.body.vinculos[0].papel, 'sacerdote');
    const login = await h.req('POST', '/api/auth/login', { corpo: { identificador: 'pai.joao@teste.dev', senha: 'senha-forte-1' } });
    assert.equal(login.status, 200);
    const naoAdmin = await h.cliente(login.body.token).get('/api/admin/terreiros');
    assert.equal(naoAdmin.status, 403, 'sacerdote não acessa o painel admin');
    h.relogio.limpar();
  });

  it('US-02: Plano com limite avisa aos 90% e pede upgrade aos 100%', async () => {
    const p = await admin.post('/api/admin/planos', { nome: 'Mini', preco_centavos: 1000, limite_filhos: 3 });
    assert.equal(p.status, 201);
    const n = 9911;
    const cr = await admin.post('/api/admin/terreiros', { nome: 'Casa Mini', documento: h.gerarCpf(n), responsavel_nome: 'Mãe Ana', email: 'mae.ana@teste.dev', plano_id: p.body.id });
    const ac = await h.req('POST', '/api/convites/aceitar', { corpo: { token: h.tokenDoLink(cr.body.convite.link), senha: 'senha-forte-1' } });
    const sac = h.cliente(ac.body.token);
    const tid = cr.body.terreiro.id;
    await h.novoFilho(sac, tid);
    await h.novoFilho(sac, tid);
    let t = (await sac.get(`/api/t/${tid}`)).body;
    assert.equal(t.uso.alerta_limite, false, '2 de 3 (66%) ainda não alerta');
    await h.novoFilho(sac, tid);
    t = (await sac.get(`/api/t/${tid}`)).body;
    assert.equal(t.uso.alerta_limite, true, '3 de 3 alerta');
    const quarto = await sac.post(`/api/t/${tid}/filhos`, { nome_civil: 'Quarto', telefone: h.telefone() });
    assert.equal(quarto.status, 422);
    assert.equal(quarto.body.erro.detalhes.upgrade, true);
  });

  it('US-03: Fatura do SaaS é gerada no fim do teste e baixada pelo webhook', async () => {
    h.relogio.fixar('2026-01-01');
    const { tid } = await h.terreiroPronto({ admin });
    h.relogio.fixar('2026-02-01');
    const rot = await admin.post('/api/admin/rotinas/rodar', {});
    assert.equal(rot.status, 200);
    const t = (await admin.get(`/api/admin/terreiros/${tid}`)).body;
    assert.equal(t.status, 'ativo', 'teste terminou');
    const fatura = t.faturas.find((f) => f.competencia === '2026-02');
    assert.ok(fatura, 'fatura de fevereiro criada');
    assert.equal(fatura.vencimento, '2026-02-06');
    const rot2 = await admin.post('/api/admin/rotinas/rodar', {});
    assert.equal(rot2.body.faturas.geradas, 0, 'rotina é idempotente');
    const pg = await h.pagarNoSimulador(fatura.gateway_id);
    assert.equal(pg.status, 200);
    const depois = (await admin.get(`/api/admin/terreiros/${tid}`)).body.faturas.find((f) => f.id === fatura.id);
    assert.equal(depois.status, 'paga');
    h.relogio.limpar();
  });

  it('US-04: Régua de inadimplência: aviso (5d), somente leitura (15d), bloqueio (30d); filhos continuam pagando', async () => {
    h.relogio.fixar('2026-01-01');
    const { tid, sac, email } = await h.terreiroPronto({ admin });
    const { filho, api: apiFilho } = await h.filhoComAcesso(sac, tid);
    const cob = await sac.post(`/api/t/${tid}/cobrancas`, { filho_id: filho.id, descricao: 'Vela', valor_centavos: 2000, vencimento: '2026-03-30' });
    h.relogio.fixar('2026-02-01');
    await admin.post('/api/admin/rotinas/rodar', {});
    const fatura = (await admin.get(`/api/admin/terreiros/${tid}`)).body.faturas[0];

    h.relogio.fixar('2026-02-11');
    await admin.post('/api/admin/rotinas/rodar', {});
    assert.equal((await admin.get(`/api/admin/terreiros/${tid}`)).body.status, 'aviso');
    const info = (await sac.get(`/api/t/${tid}`)).body;
    assert.equal(info.inadimplencia.dias, 5, 'sacerdote vê o aviso');

    h.relogio.fixar('2026-02-21');
    await admin.post('/api/admin/rotinas/rodar', {});
    assert.equal((await admin.get(`/api/admin/terreiros/${tid}`)).body.status, 'somente_leitura');
    const escrita = await sac.post(`/api/t/${tid}/filhos`, { nome_civil: 'Novo', telefone: h.telefone() });
    assert.equal(escrita.status, 423, 'painel em modo somente leitura');
    assert.equal((await sac.get(`/api/t/${tid}/filhos`)).status, 200, 'leitura continua');
    assert.equal((await apiFilho.get(`/api/t/${tid}/meu/inicio`)).status, 200, 'filho continua acessando');
    const pago = await h.pagarNoSimulador(cob.body.gateway_id);
    assert.equal(pago.body.resposta.tipo, 'cobranca', 'cobrança do filho continua sendo paga');

    h.relogio.fixar('2026-03-08');
    await admin.post('/api/admin/rotinas/rodar', {});
    assert.equal((await admin.get(`/api/admin/terreiros/${tid}`)).body.status, 'bloqueado');
    const bloq = await sac.get(`/api/t/${tid}`);
    assert.equal(bloq.status, 423);

    await h.pagarNoSimulador(fatura.gateway_id);
    assert.equal((await admin.get(`/api/admin/terreiros/${tid}`)).body.status, 'ativo', 'pagou e voltou a ativo');
    const relog = await h.req('POST', '/api/auth/login', { corpo: { identificador: email, senha: 'senha-forte-1' } });
    assert.equal((await h.cliente(relog.body.token).get(`/api/t/${tid}`)).status, 200);
    h.relogio.limpar();
  });

  it('US-05: Admin bloqueia com motivo, desbloqueia e encerra com exportação', async () => {
    const { tid, email, sac } = await h.terreiroPronto({ admin });
    const b = await admin.post(`/api/admin/terreiros/${tid}/bloquear`, { motivo: 'Uso indevido' });
    assert.equal(b.status, 200);
    assert.equal((await sac.get(`/api/t/${tid}`)).status, 401, 'sessões abertas são encerradas no bloqueio');
    const login = await h.req('POST', '/api/auth/login', { corpo: { identificador: email, senha: 'senha-forte-1' } });
    const acesso = await h.cliente(login.body.token).get(`/api/t/${tid}`);
    assert.equal(acesso.status, 423);
    assert.match(acesso.body.erro.mensagem, /Uso indevido/, 'mensagem explica o motivo');
    assert.equal((await admin.post(`/api/admin/terreiros/${tid}/desbloquear`)).status, 200);
    assert.equal((await h.cliente(login.body.token).get(`/api/t/${tid}`)).status, 200);
    assert.equal((await admin.post(`/api/admin/terreiros/${tid}/encerrar`)).status, 200);
    const exp = await admin.get(`/api/admin/terreiros/${tid}/exportacao`);
    assert.equal(exp.status, 200);
    assert.equal(exp.body.terreiro.id, tid);
    assert.ok(Array.isArray(exp.body.filhos));
  });

  it('RF-06: Métricas do SaaS (MRR, inadimplência, filhos)', async () => {
    const m = await admin.get('/api/admin/metricas');
    assert.equal(m.status, 200);
    for (const k of ['terreiros_ativos', 'mrr_centavos', 'inadimplencia_centavos', 'filhos_ativos']) assert.ok(k in m.body, k);
  });
});
