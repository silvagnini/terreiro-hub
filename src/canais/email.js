'use strict';
// E-mail pelo Resend (https://resend.com). Variáveis:
//   RESEND_API_KEY  chave de API
//   EMAIL_FROM      remetente num domínio verificado, ex.: "Terreiro Hub <nao-responda@seudominio.com.br>"
const configurado = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

const MAPA = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => MAPA[c]);

function html({ titulo, texto, link, rotuloLink }) {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F5F6F3;font-family:Arial,Helvetica,sans-serif;color:#1C1F1D">
<div style="max-width:480px;margin:0 auto;padding:32px 20px">
  <div style="background:#fff;border-radius:16px;padding:28px">
    <h1 style="font-size:20px;margin:0 0 12px">${esc(titulo)}</h1>
    <p style="font-size:16px;line-height:1.5;margin:0 0 24px">${esc(texto)}</p>
    ${link ? `<a href="${esc(link)}" style="display:inline-block;background:#0F5C4D;color:#fff;text-decoration:none;font-weight:bold;padding:14px 22px;border-radius:12px">${esc(rotuloLink || 'Abrir o app')}</a>
    <p style="font-size:12px;color:#555C58;margin:20px 0 0;word-break:break-all">Se o botão não funcionar, copie: ${esc(link)}</p>` : ''}
  </div>
  <p style="font-size:12px;color:#555C58;text-align:center;margin-top:16px">Terreiro Hub · você recebeu este e-mail por ter acesso ao app da sua casa.</p>
</div></body></html>`;
}

async function enviar({ email, titulo, texto, link, rotuloLink }) {
  if (!configurado()) return { ignorada: 'e-mail não configurado' };
  if (!email) return { ignorada: 'sem e-mail' };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM, to: [email], subject: titulo,
      html: html({ titulo, texto, link, rotuloLink }), text: `${texto}${link ? `\n\n${link}` : ''}`,
    }),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(`Resend ${r.status}: ${json.message || json.name || 'erro'}`);
    e.definitivo = r.status === 422 || r.status === 403;
    throw e;
  }
  return { id: json.id || null };
}

module.exports = { nome: 'email', configurado, enviar, html };
