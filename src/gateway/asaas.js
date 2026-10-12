'use strict';
// Adaptador Asaas (API v3). Ainda NÃO exercitado contra o sandbox: precisa de ASAAS_API_KEY.
// Mantém a mesma interface do gateway simulado; os testes de contrato garantem o formato.
const BASE = process.env.ASAAS_BASE_URL || 'https://sandbox.asaas.com/api/v3';

async function chamar(caminho, { metodo = 'GET', corpo, apiKey } = {}) {
  const chave = apiKey || process.env.ASAAS_API_KEY;
  if (!chave) throw new Error('ASAAS_API_KEY não configurada');
  const r = await fetch(BASE + caminho, {
    method: metodo,
    headers: { 'content-type': 'application/json', access_token: chave, 'user-agent': 'terreiro-hub' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Asaas ${r.status}: ${JSON.stringify(json.errors || json)}`);
  return json;
}

module.exports = {
  nome: 'asaas',

  async criarSubconta({ nome, documento, email, telefone, faturamentoMensalCentavos }) {
    const conta = await chamar('/accounts', {
      metodo: 'POST',
      corpo: {
        name: nome, email, cpfCnpj: documento, mobilePhone: telefone,
        incomeValue: (faturamentoMensalCentavos || 500000) / 100,
      },
    });
    return { id: conta.walletId || conta.id, status: 'PENDING', apiKey: conta.apiKey };
  },

  async criarCobranca({ apiKey, valorCentavos, vencimento, descricao, referencia, pagador }) {
    const cliente = await chamar('/customers', {
      metodo: 'POST', apiKey,
      corpo: { name: pagador.nome, mobilePhone: pagador.telefone, cpfCnpj: pagador.cpf, externalReference: pagador.id, notificationDisabled: true },
    });
    const p = await chamar('/payments', {
      metodo: 'POST', apiKey,
      corpo: { customer: cliente.id, billingType: 'UNDEFINED', value: valorCentavos / 100, dueDate: vencimento, description: descricao, externalReference: referencia },
    });
    const qr = await chamar(`/payments/${p.id}/pixQrCode`, { apiKey });
    const linha = await chamar(`/payments/${p.id}/identificationField`, { apiKey }).catch(() => ({}));
    return { id: p.id, status: p.status, valorCentavos, vencimento, descricao, externalReference: referencia, pixCopiaCola: qr.payload, boletoLinha: linha.identificationField || null };
  },

  async cancelarCobranca(gatewayId, apiKey) {
    return chamar(`/payments/${gatewayId}`, { metodo: 'DELETE', apiKey });
  },

  async estornarCobranca(gatewayId, apiKey) {
    return chamar(`/payments/${gatewayId}/refund`, { metodo: 'POST', apiKey });
  },
};
