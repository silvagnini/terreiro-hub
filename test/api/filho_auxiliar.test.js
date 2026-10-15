'use strict';
// Pai/Mãe Pequeno: filho da casa que também ajuda na administração, com um único login.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');

describe('Filho que também é auxiliar (Pai/Mãe Pequeno)', () => {
  let ctx;
  before(async () => { await h.subir(); ctx = await h.terreiroPronto(); });
  after(h.descer);

  it('AUX-01: pela ficha, filho vira auxiliar e acessa o painel e a própria área de filho', async () => {
    const { filho, api } = await h.filhoComAcesso(ctx.sac, ctx.tid, { nome_civil: 'Carlos Pai Pequeno' });
    await ctx.sac.post(`/api/t/${ctx.tid}/cobrancas`, { filho_id: filho.id, descricao: 'Mensalidade', valor_centavos: 5000, vencimento: '2099-01-10' });
    assert.equal((await api.get(`/api/t/${ctx.tid}/filhos`)).status, 403, 'antes: filho não vê o painel');

    const r = await ctx.sac.post(`/api/t/${ctx.tid}/filhos/${filho.id}/auxiliar`, { permissoes: { financeiro: false } });
    assert.equal(r.status, 200);
    assert.equal(r.body.acesso_ativo, true);

    assert.equal((await api.get(`/api/t/${ctx.tid}/filhos`)).status, 200, 'depois: vê a lista de filhos');
    assert.equal((await api.get(`/api/t/${ctx.tid}/cobrancas`)).status, 403, 'sem permissão de financeiro');
    const minhas = await api.get(`/api/t/${ctx.tid}/meu/cobrancas`);
    assert.equal(minhas.status, 200, 'continua vendo as próprias cobranças');
    assert.equal(minhas.body.length, 1);
    const info = await api.get(`/api/t/${ctx.tid}`);
    assert.equal(info.body.papel, 'auxiliar');
    assert.equal(info.body.filho_id, filho.id);

    const ficha = await ctx.sac.get(`/api/t/${ctx.tid}/filhos/${filho.id}`);
    assert.ok(ficha.body.auxiliar?.vinculo_id);
    const lista = (await ctx.sac.get(`/api/t/${ctx.tid}/auxiliares`)).body;
    assert.ok(lista.some((a) => a.filho_id === filho.id && a.nome === 'Carlos Pai Pequeno'));
    assert.equal((await ctx.sac.post(`/api/t/${ctx.tid}/filhos/${filho.id}/auxiliar`)).status, 409);

    // remover: volta a ser só filho, sem perder o acesso
    await ctx.sac.patch(`/api/t/${ctx.tid}/auxiliares/${ficha.body.auxiliar.vinculo_id}`, { ativo: false });
    assert.equal((await api.get(`/api/t/${ctx.tid}/filhos`)).status, 403);
    assert.equal((await api.get(`/api/t/${ctx.tid}/meu/cobrancas`)).status, 200);
    assert.equal((await api.get(`/api/t/${ctx.tid}`)).body.papel, 'filho');
  });

  it('AUX-02: convidar como auxiliar o e-mail de um filho já ativo promove o mesmo acesso', async () => {
    const email = `pp${h.unico()}@teste.dev`;
    const { filho, api } = await h.filhoComAcesso(ctx.sac, ctx.tid, { email });
    const r = await ctx.sac.post(`/api/t/${ctx.tid}/auxiliares`, { nome: 'Mãe Pequena', email });
    assert.equal(r.status, 201);
    assert.equal(r.body.filho_id, filho.id);
    assert.equal(r.body.convite, null);
    assert.equal((await api.get(`/api/t/${ctx.tid}/filhos`)).status, 200);
    assert.equal((await api.get(`/api/t/${ctx.tid}/meu/inicio`)).status, 200);
  });

  it('AUX-03: filho bloqueado perde também o acesso de auxiliar', async () => {
    const { filho, api } = await h.filhoComAcesso(ctx.sac, ctx.tid);
    await ctx.sac.post(`/api/t/${ctx.tid}/filhos/${filho.id}/auxiliar`);
    await ctx.sac.post(`/api/t/${ctx.tid}/filhos/${filho.id}/bloquear`, { motivo: 'teste' });
    const r = await api.get(`/api/t/${ctx.tid}/filhos`);
    assert.ok([401, 403].includes(r.status));
  });

  it('AUX-04: filho que ainda não ativou o acesso vira auxiliar e o convite pede o termo LGPD', async () => {
    const f = await h.novoFilho(ctx.sac, ctx.tid);
    await ctx.sac.post(`/api/t/${ctx.tid}/filhos/${f.id}/auxiliar`);
    const conv = await ctx.sac.post(`/api/t/${ctx.tid}/filhos/${f.id}/convite`);
    assert.equal(conv.status, 200);
    const token = h.tokenDoLink(conv.body.link);
    assert.equal((await h.req('GET', `/api/convites/${token}`)).body.exige_consentimento, true);
    assert.equal((await h.req('POST', '/api/convites/aceitar', { corpo: { token, senha: 'senha-aux-12' } })).status, 400);
    const ac = await h.req('POST', '/api/convites/aceitar', { corpo: { token, senha: 'senha-aux-12', consentimento: true } });
    assert.equal(ac.status, 201);
    const api = h.cliente(ac.body.token);
    assert.equal((await api.get(`/api/t/${ctx.tid}/filhos`)).status, 200);
    assert.equal((await api.get(`/api/t/${ctx.tid}/meu/perfil`)).status, 200);
  });
});
