'use strict';
// WhatsApp pela API oficial da Meta (WhatsApp Cloud API). Mensagens iniciadas pela empresa
// precisam de modelos (templates) aprovados no WhatsApp Manager. Variáveis:
//   WHATSAPP_TOKEN            token de acesso permanente (usuário do sistema no Business Manager)
//   WHATSAPP_PHONE_NUMBER_ID  id do número remetente
//   WHATSAPP_TEMPLATE_AVISO   modelo de aviso neutro (padrão: aviso_terreiro)  → {{1}} nome, {{2}} texto, {{3}} link
//   WHATSAPP_TEMPLATE_SENHA   modelo de nova senha (padrão: redefinir_senha)   → {{1}} link
//   WHATSAPP_IDIOMA           código do idioma do modelo (padrão: pt_BR)
const VERSAO = process.env.WHATSAPP_API_VERSION || 'v21.0';

const configurado = () => Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

function modelo(tipo) {
  return tipo === 'senha'
    ? process.env.WHATSAPP_TEMPLATE_SENHA || 'redefinir_senha'
    : process.env.WHATSAPP_TEMPLATE_AVISO || 'aviso_terreiro';
}

async function enviar({ telefone, nome, texto, link, tipo }) {
  if (!configurado()) return { ignorada: 'WhatsApp não configurado' };
  if (!telefone) return { ignorada: 'sem telefone' };
  const params = tipo === 'senha' ? [link] : [nome || 'tudo bem', texto, link];
  const corpo = {
    messaging_product: 'whatsapp',
    to: String(telefone).replace(/\D/g, ''),
    type: 'template',
    template: {
      name: modelo(tipo),
      language: { code: process.env.WHATSAPP_IDIOMA || 'pt_BR' },
      components: [{ type: 'body', parameters: params.map((t) => ({ type: 'text', text: String(t || '').slice(0, 900) })) }],
    },
  };
  const r = await fetch(`https://graph.facebook.com/${VERSAO}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(`WhatsApp ${r.status}: ${json.error?.message || 'erro'}`);
    // 131026 = número sem WhatsApp; 132001 = modelo inexistente/não aprovado: não adianta tentar de novo
    e.definitivo = r.status === 400 || [131026, 132000, 132001, 132012].includes(json.error?.code);
    throw e;
  }
  return { id: json.messages?.[0]?.id || null };
}

module.exports = { nome: 'whatsapp', configurado, enviar };
