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
  aviso: { titulo: 'Novo aviso', texto: 'Você tem um novo aviso. Abra o app para ver.', caminho: '#/mural' },
  cobranca: { titulo: 'Nova cobrança', texto: 'Você tem um novo pagamento disponível no app.', caminho: '#/pagamentos' },
  lembrete: { titulo: 'Lembrete', texto: 'Você tem um pagamento próximo do vencimento.', caminho: '#/pagamentos' },
  atraso: { titulo: 'Pagamento pendente', texto: 'Há um pagamento em aberto no app.', caminho: '#/pagamentos' },
  recibo: { titulo: 'Pagamento confirmado', texto: 'Recebemos seu pagamento. O recibo está no app.', caminho: '#/pagamentos' },
  compromisso: { titulo: 'Lembrete de compromisso', texto: 'Você tem um compromisso em breve. Veja no app.', caminho: '#/agenda' },
  convite: { titulo: 'Seu convite para o app', texto: 'Você recebeu um convite para acessar o app da sua casa. Crie sua senha pelo link.', caminho: '#/' },
  senha: { titulo: 'Redefinir sua senha', texto: 'Recebemos um pedido para redefinir sua senha. O link vale por 1 hora. Se não foi você, ignore esta mensagem.', caminho: '#/' },
};

const appUrl = () => (process.env.APP_URL || 'http://localhost:8080').replace(/\/$/, '');

// Enfileira a notificação; o despachante (services/notificacoes) envia por push, WhatsApp ou e-mail.
async function notificar(exec, { terreiroId = null, filhoIds = [], usuarioId = null, tipo, referencia = null, canais = ['push'], link = null }) {
  const q = exec || db;
  const msg = TEXTO_NEUTRO[tipo] || TEXTO_NEUTRO.aviso;
  const url = link || `${appUrl()}/${msg.caminho}`;
  const ref = ['convite', 'senha'].includes(tipo) ? `${tipo}:${referencia || ''}` : referencia;
  if (usuarioId) {
    for (const canal of canais) {
      await q.query(
        `insert into notificacoes(terreiro_id, usuario_id, canal, titulo, texto, referencia, link) values ($1,$2,$3,$4,$5,$6,$7)`,
        [terreiroId, usuarioId, canal, msg.titulo, msg.texto, ref, url]
      );
    }
  }
  if (filhoIds.length) {
    for (const canal of canais) {
      await q.query(
        `insert into notificacoes(terreiro_id, filho_id, canal, titulo, texto, referencia, link)
         select $1, f, $2, $3, $4, $5, $6 from unnest($7::uuid[]) f`,
        [terreiroId, canal, msg.titulo, msg.texto, ref, url, filhoIds]
      );
    }
  }
  if (usuarioId || filhoIds.length) agendarDespacho();
}

// Dispara o despachante logo depois do commit (desligado nos testes, que chamam despachar() direto)
let timer = null;
function agendarDespacho() {
  if (process.env.RODAR_ROTINAS === 'false' || timer) return;
  timer = setTimeout(() => {
    timer = null;
    require('./notificacoes').despachar().catch((e) => console.error('[notificacoes]', e.message));
  }, 1500);
  timer.unref?.();
}

module.exports = { auditar, notificar, TEXTO_NEUTRO, appUrl };
