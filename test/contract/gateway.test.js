'use strict';
// Contrato com o gateway de pagamento: o adaptador simulado e o do Asaas têm a mesma interface,
// os dados seguem o formato do Asaas e o receptor de webhooks aceita os eventos documentados.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const h = require('../helpers');
const { spec } = require('../../scripts/gerar-openapi');
const simulado = require('../../src/gateway/simulado');
const asaas = require('../../src/gateway/asaas');

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(spec, 'openapi');
const schema = (n) => ajv.getSchema(`openapi#/components/schemas/${n}`);
const TOKEN = { 'asaas-access-token': 'token-webhook-teste' };

describe('Contrato · Gateway de pagamento (formato Asaas)', () => {
  before(h.subir);
  after(h.descer);

  it('CG-01: Adaptador simulado e Asaas expõem a mesma interface', () => {
    const iface = ['criarSubconta', 'criarChavePix', 'criarCobranca', 'cancelarCobranca', 'estornarCobranca', 'testar'];
    for (const f of iface) {
      assert.equal(typeof simulado[f], 'function', `simulado.${f}`);
      assert.equal(typeof asaas[f], 'function', `asaas.${f}`);
    }
  });

  it('CG-02: Cobrança e subconta do simulador seguem o schema do contrato', async () => {
    const c = await simulado.criarCobranca({ contaId: 'acc_x', valorCentavos: 4990, vencimento: '2099-01-10', descricao: 'Teste', referencia: 'ref-1', pagador: { nome: 'Ana' } });
    const v = schema('GatewayCobranca');
    assert.ok(v(c), ajv.errorsText(v.errors));
    assert.equal(simulado.crc16(c.pixCopiaCola.slice(0, -4)), c.pixCopiaCola.slice(-4), 'CRC do Pix confere');
    const s = await simulado.criarSubconta({ nome: 'Casa', documento: '52998224725', email: 'a@b.dev' });
    assert.ok(schema('GatewaySubconta')(s));
    await assert.rejects(simulado.criarCobranca({ contaId: null, valorCentavos: 100 }), /Conta/);
  });

  it('CG-03: Eventos gerados pelo simulador obedecem ao formato de webhook do Asaas', () => {
    const p = simulado.eventoPagamento({ gatewayId: 'pay_abc', valorCentavos: 3500, forma: 'BOLETO', data: '2026-10-01', referencia: 'x' });
    const vp = schema('AsaasWebhookPagamento');
    assert.ok(vp(p), ajv.errorsText(vp.errors));
    const a = simulado.eventoConta({ contaId: 'acc_1', aprovada: false });
    assert.ok(schema('AsaasWebhookConta')(a));
  });

  it('CG-04: Receptor aceita os eventos documentados do Asaas e ignora os demais', async () => {
    const ctx = await h.terreiroPronto();
    const f = await h.novoFilho(ctx.sac, ctx.tid);
    const c1 = await ctx.sac.post(`/api/t/${ctx.tid}/cobrancas`, { filho_id: f.id, descricao: 'Boleto', valor_centavos: 9000, vencimento: '2099-01-10' });
    const c2 = await ctx.sac.post(`/api/t/${ctx.tid}/cobrancas`, { filho_id: f.id, descricao: 'Cartão', valor_centavos: 9000, vencimento: '2099-01-10' });
    // Corpos no formato do Asaas; o exemplo oficial mínimo está mais abaixo (campos extras são tolerados)
    const boleto = { id: 'evt_doc_1', event: 'PAYMENT_RECEIVED', dateCreated: '2026-10-01 10:00:00', payment: { object: 'payment', id: c1.body.gateway_id, customer: 'cus_000005219613', value: 90, netValue: 88.01, billingType: 'BOLETO', status: 'RECEIVED', dueDate: '2099-01-10', paymentDate: '2026-10-01', externalReference: c1.body.id, invoiceUrl: 'https://sandbox.asaas.com/i/x' } };
    const r1 = await h.req('POST', '/api/webhooks/gateway', { corpo: boleto, headers: TOKEN });
    assert.equal(r1.status, 200);
    assert.equal(r1.body.tipo, 'cobranca');
    const cartao = { id: 'evt_doc_2', event: 'PAYMENT_CONFIRMED', payment: { object: 'payment', id: c2.body.gateway_id, value: 90, billingType: 'CREDIT_CARD', status: 'CONFIRMED' } };
    const r2 = await h.req('POST', '/api/webhooks/gateway', { corpo: cartao, headers: TOKEN });
    assert.equal(r2.body.tipo, 'cobranca');
    const pagas = (await ctx.sac.get(`/api/t/${ctx.tid}/cobrancas?situacao=paga`)).body.itens;
    assert.deepEqual(pagas.map((x) => x.forma_pagamento).sort(), ['boleto', 'cartao']);
    const ignorado = await h.req('POST', '/api/webhooks/gateway', { corpo: { id: 'evt_doc_3', event: 'PAYMENT_OVERDUE', payment: { id: 'pay_x' } }, headers: TOKEN });
    assert.equal(ignorado.body.ignorado, true, 'evento não tratado é aceito e ignorado (gateway não reenvia)');
    const semPayment = await h.req('POST', '/api/webhooks/gateway', { corpo: { id: 'evt_doc_4', event: 'PAYMENT_RECEIVED' }, headers: TOKEN });
    assert.equal(semPayment.status, 200, 'malformado responde 200 para não pausar a fila do Asaas');
    assert.equal(semPayment.body.ignorado, true);
    // Corpo mínimo do exemplo oficial: só object e id dentro de payment
    const c3 = await ctx.sac.post(`/api/t/${ctx.tid}/cobrancas`, { filho_id: f.id, descricao: 'Mínimo', valor_centavos: 5000, vencimento: '2099-01-10' });
    const minimo = { id: 'evt_05b708f961d739ea7eba7e4db318f621&368604920', event: 'PAYMENT_RECEIVED', dateCreated: '2024-06-12 16:45:03', payment: { object: 'payment', id: c3.body.gateway_id } };
    assert.ok(schema('AsaasWebhookPagamento')(minimo), 'exemplo oficial passa no schema');
    const r3 = await h.req('POST', '/api/webhooks/gateway', { corpo: minimo, headers: TOKEN });
    assert.equal(r3.body.tipo, 'cobranca', 'payload mínimo do exemplo oficial dá baixa');
    const tokenErrado = await h.req('POST', '/api/webhooks/gateway', { corpo: boleto, headers: { 'asaas-access-token': 'errado' } });
    assert.equal(tokenErrado.status, 401);
  });

  it('CG-05: Pagamento desconhecido não quebra o receptor; repetição é idempotente', async () => {
    const ev = { id: 'evt_doc_9', event: 'PAYMENT_RECEIVED', payment: { object: 'payment', id: 'pay_inexistente', value: 1, billingType: 'PIX', status: 'RECEIVED' } };
    const a = await h.req('POST', '/api/webhooks/gateway', { corpo: ev, headers: TOKEN });
    assert.equal(a.body.tipo, 'desconhecido');
    const b = await h.req('POST', '/api/webhooks/gateway', { corpo: ev, headers: TOKEN });
    assert.equal(b.body.duplicado, true);
  });
});
