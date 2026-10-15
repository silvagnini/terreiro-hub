'use strict';
// Web Push (notificação no celular/computador com o app instalado). As chaves VAPID são geradas
// uma vez e guardadas na tabela config — ou vêm de VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.
// O payload leva só texto neutro (US-18): o service worker mostra título e texto sem termos religiosos.
const webpush = require('web-push');
const db = require('../db');

let vapid = null;

async function chaves() {
  if (vapid) return vapid;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    return vapid;
  }
  const atual = await db.one(`select valor from config where chave = 'vapid'`);
  if (atual) { vapid = JSON.parse(atual.valor); return vapid; }
  const novas = webpush.generateVAPIDKeys();
  await db.query(`insert into config(chave, valor) values ('vapid', $1) on conflict do nothing`, [JSON.stringify(novas)]);
  vapid = JSON.parse((await db.one(`select valor from config where chave = 'vapid'`)).valor);
  return vapid;
}

const configurado = () => true;

async function enviarPara(inscricao, { titulo, texto, link, tag }) {
  const k = await chaves();
  const sujeito = process.env.VAPID_SUBJECT || `mailto:${process.env.ADMIN_EMAIL || 'contato@terreirohub.dev'}`;
  const det = webpush.generateRequestDetails(
    { endpoint: inscricao.endpoint, keys: { p256dh: inscricao.p256dh, auth: inscricao.auth } },
    JSON.stringify({ titulo, texto, link, tag }),
    { vapidDetails: { subject: sujeito, publicKey: k.publicKey, privateKey: k.privateKey }, TTL: 24 * 3600, urgency: 'normal' }
  );
  const r = await fetch(det.endpoint, { method: det.method, headers: det.headers, body: det.body });
  if (r.status === 404 || r.status === 410) return { expirada: true };
  if (!r.ok) throw new Error(`Push ${r.status}`);
  return { ok: true };
}

// Envia para todos os aparelhos inscritos do usuário; remove inscrições expiradas
async function enviar({ usuarioId, titulo, texto, link, tag }) {
  if (!usuarioId) return { ignorada: 'sem acesso ao app' };
  const insc = await db.many('select * from push_inscricoes where usuario_id = $1', [usuarioId]);
  if (!insc.length) return { ignorada: 'nenhum aparelho com notificações ativadas' };
  let entregues = 0;
  let ultimoErro = null;
  for (const i of insc) {
    try {
      const r = await enviarPara(i, { titulo, texto, link, tag });
      if (r.expirada) await db.query('delete from push_inscricoes where endpoint = $1', [i.endpoint]);
      else entregues++;
    } catch (e) {
      ultimoErro = e;
      await db.query('update push_inscricoes set falhas = falhas + 1 where endpoint = $1', [i.endpoint]);
    }
  }
  if (!entregues && ultimoErro) throw ultimoErro;
  if (!entregues) return { ignorada: 'inscrições expiradas' };
  return { aparelhos: entregues };
}

module.exports = { nome: 'push', configurado, enviar, chaves };
