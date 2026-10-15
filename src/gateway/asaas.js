'use strict';
// Adaptador Asaas (API v3), modelo de subcontas: cada terreiro tem a própria subconta (o dinheiro cai
// direto nela) e a chave de API dessa subconta, guardada cifrada no banco. A fatura do SaaS usa a
// conta principal (ASAAS_API_KEY).
// Variáveis: ASAAS_API_KEY (conta principal), ASAAS_BASE_URL (sandbox por padrão), APP_URL, WEBHOOK_TOKEN.
const BASE = () => (process.env.ASAAS_BASE_URL || 'https://sandbox.asaas.com/api/v3').replace(/\/$/, '');

class ErroAsaas extends Error {
  constructor(status, json, caminho) {
    const msgs = (json?.errors || []).map((e) => e.description).filter(Boolean);
    super(msgs.length ? msgs.join(' · ') : `Asaas respondeu ${status} em ${caminho}`);
    this.status = status;
    this.erros = json?.errors || [];
    this.definitivo = status >= 400 && status < 500 && status !== 429;
  }
}

async function chamar(caminho, { metodo = 'GET', corpo, apiKey } = {}) {
  const chave = apiKey || process.env.ASAAS_API_KEY;
  if (!chave) throw new Error('ASAAS_API_KEY não configurada');
  const r = await fetch(BASE() + caminho, {
    method: metodo,
    headers: { 'content-type': 'application/json', access_token: chave, 'user-agent': 'terreiro-hub' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErroAsaas(r.status, json, caminho);
  return json;
}

const EVENTOS = ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED', 'ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED'];

function webhookConfig(email) {
  const app = (process.env.APP_URL || '').replace(/\/$/, '');
  return {
    name: 'Terreiro Hub', url: `${app}/api/webhooks/gateway`, email, enabled: true, interrupted: false,
    apiVersion: 3, authToken: process.env.WEBHOOK_TOKEN, sendType: 'SEQUENTIALLY', events: EVENTOS,
  };
}

async function garantirCliente({ apiKey, clienteId, pagador }) {
  if (clienteId) return clienteId;
  const c = await chamar('/customers', {
    metodo: 'POST', apiKey,
    corpo: {
      name: pagador.nome, mobilePhone: pagador.telefone ? String(pagador.telefone).replace(/^55/, '') : undefined,
      cpfCnpj: pagador.cpf || undefined, email: pagador.email || undefined, externalReference: pagador.id || undefined,
      notificationDisabled: true, // quem avisa é o Terreiro Hub (texto neutro)
    },
  });
  return c.id;
}

module.exports = {
  nome: 'asaas',
  ErroAsaas,

  async criarSubconta({ nome, documento, email, telefone, nascimento, tipoEmpresa, cep, endereco, numero, bairro, faturamentoMensalCentavos }) {
    const cnpj = String(documento).length === 14;
    const conta = await chamar('/accounts', {
      metodo: 'POST',
      corpo: {
        name: nome, email, cpfCnpj: documento, mobilePhone: telefone ? String(telefone).replace(/^55/, '') : undefined,
        birthDate: cnpj ? undefined : nascimento, companyType: cnpj ? tipoEmpresa || 'ASSOCIATION' : undefined,
        incomeValue: (faturamentoMensalCentavos || 500000) / 100,
        postalCode: cep, address: endereco, addressNumber: numero, province: bairro,
        webhooks: [webhookConfig(email)],
      },
    });
    if (!conta.apiKey) throw new Error('Asaas não devolveu a chave da subconta (verifique se o white label está habilitado)');
    return { id: conta.id, walletId: conta.walletId || null, apiKey: conta.apiKey, status: 'PENDING' };
  },

  // Chave Pix aleatória na subconta (necessária para gerar QR Code Pix). Ignora se já existir.
  async criarChavePix(apiKey) {
    try {
      return await chamar('/pix/addressKeys', { metodo: 'POST', apiKey, corpo: { type: 'EVP' } });
    } catch (e) {
      if (e.status === 400) return { jaExiste: true, motivo: e.message };
      throw e;
    }
  },

  async criarCobranca({ apiKey, clienteId, valorCentavos, vencimento, descricao, referencia, pagador }) {
    const cliente = await garantirCliente({ apiKey, clienteId, pagador });
    const p = await chamar('/payments', {
      metodo: 'POST', apiKey,
      corpo: { customer: cliente, billingType: 'UNDEFINED', value: valorCentavos / 100, dueDate: vencimento, description: descricao, externalReference: referencia },
    });
    // Pix e linha do boleto são consultas separadas; a falha de uma não impede a cobrança
    const [qr, linha] = await Promise.all([
      chamar(`/payments/${p.id}/pixQrCode`, { apiKey }).catch(() => null),
      chamar(`/payments/${p.id}/identificationField`, { apiKey }).catch(() => null),
    ]);
    return {
      id: p.id, status: p.status, valorCentavos, vencimento, descricao, externalReference: referencia, clienteId: cliente,
      pixCopiaCola: qr?.payload || null, boletoLinha: linha?.identificationField || null, linkPagamento: p.invoiceUrl || null,
    };
  },

  async cancelarCobranca(gatewayId, { apiKey } = {}) {
    try {
      return await chamar(`/payments/${gatewayId}`, { metodo: 'DELETE', apiKey });
    } catch (e) {
      if (e.status === 404) return { deleted: true };
      throw e;
    }
  },

  async estornarCobranca(gatewayId, { apiKey } = {}) {
    return chamar(`/payments/${gatewayId}/refund`, { metodo: 'POST', apiKey });
  },

  // Diagnóstico pelo painel do admin: cria cliente e cobrança de R$ 5 na conta principal e apaga em seguida
  async testar({ cpf }) {
    const passos = [];
    const passo = async (nome, fn) => {
      try { const r = await fn(); passos.push({ passo: nome, ok: true, detalhe: r }); return r; } catch (e) { passos.push({ passo: nome, ok: false, detalhe: e.message }); return null; }
    };
    const conta = await passo('Ler conta principal', async () => { const c = await chamar('/myAccount/commercialInfo'); return c.name || c.companyName || 'ok'; });
    if (!conta) return { ok: false, base: BASE(), passos };
    const cli = await passo('Criar cliente de teste', async () => (await chamar('/customers', { metodo: 'POST', corpo: { name: 'Teste Terreiro Hub', cpfCnpj: cpf, notificationDisabled: true } })).id);
    const amanha = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    const pg = cli && await passo('Criar cobrança de R$ 5,00', async () => (await chamar('/payments', { metodo: 'POST', corpo: { customer: cli, billingType: 'UNDEFINED', value: 5, dueDate: amanha, description: 'Teste de integração' } })).id);
    if (pg) {
      await passo('Gerar Pix copia e cola', async () => ((await chamar(`/payments/${pg}/pixQrCode`)).payload || '').slice(0, 30) + '…');
      await passo('Gerar linha do boleto', async () => (await chamar(`/payments/${pg}/identificationField`)).identificationField);
      await passo('Apagar cobrança de teste', async () => (await chamar(`/payments/${pg}`, { metodo: 'DELETE' })).deleted);
    }
    if (cli) await passo('Apagar cliente de teste', async () => (await chamar(`/customers/${cli}`, { metodo: 'DELETE' })).deleted);
    return { ok: passos.every((p) => p.ok || p.passo === 'Gerar Pix copia e cola'), base: BASE(), passos };
  },
};
