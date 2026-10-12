'use strict';
const nome = process.env.GATEWAY || 'simulado';
const gateway = nome === 'asaas' ? require('./asaas') : require('./simulado');

// Token que o gateway envia no cabeçalho asaas-access-token (configurado no painel do gateway)
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || 'dev-webhook-token';
if (process.env.NODE_ENV === 'production' && (WEBHOOK_TOKEN.length < 32 || WEBHOOK_TOKEN === 'dev-webhook-token')) {
  console.warn('[seguranca] WEBHOOK_TOKEN fraco: use de 32 a 255 caracteres aleatórios (recomendação do Asaas)');
}

module.exports = { gateway, WEBHOOK_TOKEN, simulado: require('./simulado') };
