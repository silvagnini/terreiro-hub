'use strict';
const db = require('../db');

// RNF-06: toda ação sensível vai para a auditoria (tabela somente inserção)
async function auditar(exec, { terreiroId = null, usuarioId = null, acao, entidade, entidadeId = null, dados = null }) {
  const q = exec || db;
  await q.query(
    'insert into auditoria(terreiro_id, usuario_id, acao, entidade, entidade_id, dados) values ($1,$2,$3,$4,$5,$6)',
    [terreiroId, usuarioId, acao, entidade, entidadeId == null ? null : String(entidadeId), dados]
  );
}

// US-18 / Melhoria 7: notificações com texto neutro, sem termos religiosos na tela bloqueada.
const TEXTO_NEUTRO = {
  aviso: { titulo: 'Novo aviso', texto: 'Você tem um novo aviso. Abra o app para ver.' },
  cobranca: { titulo: 'Nova cobrança', texto: 'Você tem um novo pagamento disponível no app.' },
  lembrete: { titulo: 'Lembrete', texto: 'Você tem um pagamento próximo do vencimento.' },
  atraso: { titulo: 'Pagamento pendente', texto: 'Há um pagamento em aberto no app.' },
  recibo: { titulo: 'Pagamento confirmado', texto: 'Recebemos seu pagamento. O recibo está no app.' },
  compromisso: { titulo: 'Lembrete de compromisso', texto: 'Você tem um compromisso em breve. Veja no app.' },
};

async function notificar(exec, { terreiroId, filhoIds = [], usuarioId = null, tipo, referencia = null, canais = ['push'] }) {
  const q = exec || db;
  const msg = TEXTO_NEUTRO[tipo] || TEXTO_NEUTRO.aviso;
  if (usuarioId) {
    for (const canal of canais) {
      await q.query(
        `insert into notificacoes(terreiro_id, usuario_id, canal, titulo, texto, referencia, enviada_em) values ($1,$2,$3,$4,$5,$6, now())`,
        [terreiroId, usuarioId, canal, msg.titulo, msg.texto, referencia]
      );
    }
  }
  if (filhoIds.length) {
    for (const canal of canais) {
      await q.query(
        `insert into notificacoes(terreiro_id, filho_id, canal, titulo, texto, referencia, enviada_em)
         select $1, f, $2, $3, $4, $5, now() from unnest($6::uuid[]) f`,
        [terreiroId, canal, msg.titulo, msg.texto, referencia, filhoIds]
      );
    }
  }
}

module.exports = { auditar, notificar, TEXTO_NEUTRO };
