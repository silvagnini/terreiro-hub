'use strict';
// Despachante da fila de notificações: pega as pendentes, descobre o destinatário e envia pelo canal.
// Falha temporária → tenta de novo (1, 5 e 30 min). Falha definitiva ou canal desligado → registra e segue.
const db = require('../db');
const push = require('../canais/push');
const whatsapp = require('../canais/whatsapp');
const email = require('../canais/email');

const CANAIS = { push, whatsapp, email };
const ESPERA_MIN = [1, 5, 30];
const MAX_TENTATIVAS = ESPERA_MIN.length + 1;
let rodando = false;

// Dados de contato do destinatário (filho com ou sem acesso ao app, ou usuário direto)
async function destinatario(n) {
  if (n.filho_id) {
    const f = await db.one(
      `select f.nome_civil, f.telefone, coalesce(f.email, u.email) as email, f.usuario_id, f.status, f.anonimizado,
              coalesce(u.preferencias, '{}'::jsonb) as preferencias
         from filhos f left join usuarios u on u.id = f.usuario_id where f.id = $1`, [n.filho_id]
    );
    if (!f || f.anonimizado || ['bloqueado', 'desligado'].includes(f.status)) return null;
    return { nome: f.nome_civil.split(' ')[0], telefone: f.telefone, email: f.email, usuarioId: f.usuario_id, preferencias: f.preferencias };
  }
  if (n.usuario_id) {
    const u = await db.one('select nome, telefone, email, preferencias from usuarios where id = $1', [n.usuario_id]);
    if (!u) return null;
    return { nome: u.nome.split(' ')[0], telefone: u.telefone, email: u.email, usuarioId: n.usuario_id, preferencias: u.preferencias };
  }
  return null;
}

// Convite e senha são transacionais: vão mesmo que a pessoa tenha desligado o canal nas preferências
const TRANSACIONAL = (n) => /^(convite|senha):/.test(n.referencia || '');
const tipoDe = (n) => (n.referencia || '').split(':')[0];

async function enviarUma(n) {
  const d = await destinatario(n);
  if (!d) return { ignorada: 'destinatário inativo' };
  if (!TRANSACIONAL(n) && d.preferencias?.[n.canal] === false) return { ignorada: 'desligado pelo usuário' };
  const canal = CANAIS[n.canal];
  if (!canal) return { ignorada: `canal ${n.canal} desconhecido` };
  const base = { titulo: n.titulo, texto: n.texto, link: n.link, tag: n.referencia || n.id };
  if (n.canal === 'push') return canal.enviar({ ...base, usuarioId: d.usuarioId });
  if (n.canal === 'whatsapp') return canal.enviar({ ...base, telefone: d.telefone, nome: d.nome, tipo: tipoDe(n) === 'senha' ? 'senha' : 'aviso' });
  return canal.enviar({ ...base, email: d.email, rotuloLink: tipoDe(n) === 'senha' ? 'Criar nova senha' : tipoDe(n) === 'convite' ? 'Aceitar convite' : 'Abrir o app' });
}

async function despachar({ limite = 200 } = {}) {
  if (rodando) return { ocupado: true };
  rodando = true;
  const placar = { enviadas: 0, falharam: 0, ignoradas: 0, reagendadas: 0 };
  try {
    for (;;) {
      const lote = await db.tx((t) => t.many(
        `update notificacoes set proxima_tentativa = now() + interval '2 minutes'
          where id in (select id from notificacoes where status = 'pendente' and proxima_tentativa <= now()
                        order by created_at limit $1 for update skip locked)
          returning *`, [limite]
      ));
      if (!lote.length) break;
      for (const n of lote) {
        try {
          const r = await enviarUma(n);
          if (r?.ignorada) {
            await db.query(`update notificacoes set status = 'ignorada', erro = $2 where id = $1`, [n.id, r.ignorada]);
            placar.ignoradas++;
          } else {
            await db.query(`update notificacoes set status = 'enviada', enviada_em = now(), erro = null, tentativas = tentativas + 1 where id = $1`, [n.id]);
            placar.enviadas++;
          }
        } catch (e) {
          const tentativas = n.tentativas + 1;
          if (e.definitivo || tentativas >= MAX_TENTATIVAS) {
            await db.query(`update notificacoes set status = 'falhou', erro = $2, tentativas = $3 where id = $1`, [n.id, e.message.slice(0, 500), tentativas]);
            placar.falharam++;
            console.warn(`[notificacoes] falhou ${n.canal} ${n.id}: ${e.message}`);
          } else {
            await db.query(
              `update notificacoes set erro = $2, tentativas = $3, proxima_tentativa = now() + ($4 || ' minutes')::interval where id = $1`,
              [n.id, e.message.slice(0, 500), tentativas, String(ESPERA_MIN[tentativas - 1])]
            );
            placar.reagendadas++;
          }
        }
      }
      if (lote.length < limite) break;
    }
  } finally {
    rodando = false;
  }
  if (placar.enviadas + placar.falharam + placar.reagendadas) console.log('[notificacoes]', JSON.stringify(placar));
  return placar;
}

function situacaoCanais() {
  return {
    push: { ativo: true, observacao: 'Web Push com chaves VAPID geradas pelo sistema' },
    whatsapp: { ativo: whatsapp.configurado(), observacao: whatsapp.configurado() ? 'API oficial da Meta' : 'Defina WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID' },
    email: { ativo: email.configurado(), observacao: email.configurado() ? `Resend · ${process.env.EMAIL_FROM}` : 'Defina RESEND_API_KEY e EMAIL_FROM' },
  };
}

module.exports = { despachar, enviarUma, situacaoCanais, CANAIS };
