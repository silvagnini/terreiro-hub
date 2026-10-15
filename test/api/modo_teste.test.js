'use strict';
// Versão de teste: conta de recebimento aprovada na hora e pagamento simulado pelo próprio filho.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');

describe('Modo de teste (gateway simulado)', () => {
  before(async () => { process.env.SIMULADO_AUTO = 'true'; await h.subir(); });
  after(async () => { delete process.env.SIMULADO_AUTO; await h.descer(); });

  it('TST-01: conta aprovada na hora e filho simula o pagamento', async () => {
    const ctx = await h.terreiroPronto({ aprovarConta: false });
    const r = await ctx.sac.post(`/api/t/${ctx.tid}/conta-recebimento`, { nome: 'Tenda', documento: h.gerarCpf(ctx.n), email: ctx.email });
    assert.equal(r.status, 201);
    assert.equal(r.body.gateway_conta_status, 'aprovada');
    assert.equal((await ctx.sac.get(`/api/t/${ctx.tid}`)).body.gateway_conta_status, 'aprovada');
    const { filho, api } = await h.filhoComAcesso(ctx.sac, ctx.tid);
    const c = await ctx.sac.post(`/api/t/${ctx.tid}/cobrancas`, { filho_id: filho.id, descricao: 'Bori', valor_centavos: 20000, vencimento: '2099-01-10' });
    const minha = (await api.get(`/api/t/${ctx.tid}/meu/cobrancas/${c.body.id}`)).body;
    assert.ok(minha.gateway_id && minha.pix_copia_cola);
    assert.equal((await h.req('GET', '/api/saude')).body.gateway, 'simulado');
    await api.post(`/api/simulador/pagar/${minha.gateway_id}`, { forma: 'PIX' });
    assert.equal((await api.get(`/api/t/${ctx.tid}/meu/cobrancas/${c.body.id}`)).body.status, 'paga');
  });
});
