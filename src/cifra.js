'use strict';
// AES-256-GCM para segredos guardados no banco (ex.: chave de API da subconta Asaas de cada terreiro).
// A chave vem de CHAVE_CIFRA (32 bytes em base64). Sem ela, só em desenvolvimento usa uma chave fixa.
const crypto = require('crypto');

function chave() {
  const k = process.env.CHAVE_CIFRA;
  if (k) {
    const b = Buffer.from(k, 'base64');
    if (b.length !== 32) throw new Error('CHAVE_CIFRA deve ter 32 bytes em base64');
    return b;
  }
  if (process.env.NODE_ENV === 'production') throw new Error('CHAVE_CIFRA não configurada');
  return crypto.createHash('sha256').update('terreiro-hub-dev-somente').digest();
}

function cifrar(texto) {
  if (texto == null) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', chave(), iv);
  const dados = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${dados.toString('base64')}`;
}

function decifrar(valor) {
  if (!valor) return null;
  const [v, iv, tag, dados] = String(valor).split(':');
  if (v !== 'v1') throw new Error('Formato cifrado desconhecido');
  const d = crypto.createDecipheriv('aes-256-gcm', chave(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(dados, 'base64')), d.final()]).toString('utf8');
}

module.exports = { cifrar, decifrar };
