'use strict';
// Gateway simulado: imita o formato de dados do Asaas (ids pay_/acc_, eventos PAYMENT_RECEIVED)
// para que trocar pelo adaptador real não mude o resto do sistema.
const crypto = require('crypto');

function crc16(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    crc &= 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const campoEmv = (id, valor) => id + String(valor.length).padStart(2, '0') + valor;

function pixCopiaCola({ chave, nome, cidade, valorCentavos, txid }) {
  const conta = campoEmv('00', 'br.gov.bcb.pix') + campoEmv('01', chave);
  let p =
    campoEmv('00', '01') +
    campoEmv('01', '12') +
    campoEmv('26', conta) +
    campoEmv('52', '0000') +
    campoEmv('53', '986') +
    campoEmv('54', (valorCentavos / 100).toFixed(2)) +
    campoEmv('58', 'BR') +
    campoEmv('59', nome.normalize('NFD').replace(/[^\x20-\x7E]/g, '').slice(0, 25) || 'TERREIRO') +
    campoEmv('60', cidade.slice(0, 15)) +
    campoEmv('62', campoEmv('05', txid.slice(0, 25)));
  p += '6304';
  return p + crc16(p);
}

function linhaDigitavel(valorCentavos, vencimento) {
  const fator = Math.max(1000, Math.round((Date.parse(vencimento) - Date.parse('2025-02-22')) / 864e5) + 1000);
  const corpo = crypto.randomInt(1e9, 9.99e9).toString() + crypto.randomInt(1e9, 9.99e9).toString();
  return `46191.${corpo.slice(0, 5)} ${corpo.slice(5, 10)}.${corpo.slice(10, 16)} ${corpo.slice(16, 20)}0.000000 1 ${fator}${String(valorCentavos).padStart(10, '0')}`;
}

const id = (prefixo) => `${prefixo}_${crypto.randomBytes(8).toString('hex')}`;

module.exports = {
  nome: 'simulado',

  async criarSubconta({ nome, documento, email }) {
    if (!nome || !documento || !email) throw new Error('Dados da subconta incompletos');
    return { id: id('acc'), status: 'PENDING', apiKey: '$aact_sim_' + crypto.randomBytes(12).toString('hex') };
  },

  async criarCobranca({ contaId, valorCentavos, vencimento, descricao, referencia, pagador }) {
    if (!contaId) throw new Error('Conta de recebimento não informada');
    if (!(valorCentavos > 0)) throw new Error('Valor inválido');
    const gatewayId = id('pay');
    return {
      id: gatewayId,
      status: 'PENDING',
      valorCentavos,
      vencimento,
      descricao,
      externalReference: referencia,
      pixCopiaCola: pixCopiaCola({ chave: contaId, nome: pagador?.recebedor || 'TERREIRO', cidade: 'SAO PAULO', valorCentavos, txid: gatewayId.replace(/[^a-zA-Z0-9]/g, '') }),
      boletoLinha: linhaDigitavel(valorCentavos, vencimento),
    };
  },

  async cancelarCobranca(_gatewayId) {
    return { deleted: true };
  },

  async estornarCobranca(gatewayId) {
    return { id: gatewayId, status: 'REFUNDED' };
  },

  // Monta o corpo de webhook no formato do Asaas (usado pelo simulador e pelos testes de contrato)
  eventoPagamento({ gatewayId, valorCentavos, forma = 'PIX', data, referencia }) {
    return {
      id: id('evt'),
      event: 'PAYMENT_RECEIVED',
      dateCreated: new Date().toISOString(),
      payment: {
        object: 'payment',
        id: gatewayId,
        value: valorCentavos / 100,
        netValue: valorCentavos / 100,
        billingType: forma,
        status: 'RECEIVED',
        paymentDate: data,
        externalReference: referencia,
      },
    };
  },

  eventoConta({ contaId, aprovada = true }) {
    return {
      id: id('evt'),
      event: aprovada ? 'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED' : 'ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED',
      dateCreated: new Date().toISOString(),
      accountStatus: { id: contaId, general: aprovada ? 'APPROVED' : 'REJECTED' },
    };
  },

  pixCopiaCola,
  crc16,
};
