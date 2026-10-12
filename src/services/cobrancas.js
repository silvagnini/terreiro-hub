'use strict';
const db = require('../db');
const { gateway } = require('../gateway');
const { erro, relogio } = require('../util');
const { auditar, notificar } = require('./base');

function aplicarDesconto(valorCentavos, desconto) {
  if (!desconto || !desconto.valor) return 0;
  if (desconto.tipo === 'percentual') return Math.min(valorCentavos, Math.round((valorCentavos * Number(desconto.valor)) / 100));
  return Math.min(valorCentavos, Math.round(Number(desconto.valor)));
}

// Situação exibida: "vencida" é derivada de aberta + vencimento passado
function situacao(c, hoje = relogio.hoje()) {
  if (c.status === 'aberta' && c.vencimento < hoje) return 'vencida';
  return c.status;
}

const publicoCobranca = (c, hoje = relogio.hoje()) => ({
  id: c.id, filho_id: c.filho_id, filho_nome: c.filho_nome, consulente: c.consulente, descricao: c.descricao,
  valor_centavos: c.valor_centavos, desconto_centavos: c.desconto_centavos, valor_final_centavos: c.valor_centavos - c.desconto_centavos,
  vencimento: c.vencimento, status: c.status, situacao: situacao(c, hoje), origem: c.origem, competencia: c.competencia, lote_id: c.lote_id,
  trabalho_id: c.trabalho_id, parcela: c.parcela, parcelas: c.parcelas, pix_copia_cola: c.pix_copia_cola, boleto_linha: c.boleto_linha,
  gateway_id: c.gateway_id, pago_em: c.pago_em, forma_pagamento: c.forma_pagamento, motivo: c.motivo, recibo_numero: c.recibo_numero, created_at: c.created_at,
});

async function enviarAoGateway(q, terreiro, cobranca, filho) {
  const g = await gateway.criarCobranca({
    contaId: terreiro.gateway_conta_id,
    valorCentavos: cobranca.valor_centavos - cobranca.desconto_centavos,
    vencimento: cobranca.vencimento,
    descricao: cobranca.descricao,
    referencia: cobranca.id,
    pagador: { id: filho?.id, nome: filho?.nome_civil || cobranca.consulente?.nome || 'Consulente', telefone: filho?.telefone, cpf: filho?.cpf, recebedor: terreiro.nome },
  });
  return q.one(
    `update cobrancas set status = 'aberta', gateway_id = $2, pix_copia_cola = $3, boleto_linha = $4 where id = $1 returning *`,
    [cobranca.id, g.id, g.pixCopiaCola, g.boletoLinha]
  );
}

// Cria UMA cobrança. Sem conta de recebimento aprovada ela fica "aguardando_conta" (US-07).
async function emitir(q, terreiro, dados, { notificarFilho = true } = {}) {
  const pronta = terreiro.gateway_conta_status === 'aprovada';
  let c = await q.one(
    `insert into cobrancas(terreiro_id, filho_id, consulente, descricao, valor_centavos, desconto_centavos, vencimento, status, origem,
                           competencia, lote_id, trabalho_id, parcela, parcelas, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`,
    [
      terreiro.id, dados.filho?.id || null, dados.consulente || null, dados.descricao, dados.valorCentavos, dados.descontoCentavos || 0,
      dados.vencimento, pronta ? 'aberta' : 'aguardando_conta', dados.origem, dados.competencia || null, dados.loteId || null,
      dados.trabalhoId || null, dados.parcela || null, dados.parcelas || null, dados.criadoPor || null,
    ]
  );
  if (pronta) c = await enviarAoGateway(q, terreiro, c, dados.filho);
  if (pronta && notificarFilho && dados.filho) {
    await notificar(q, { terreiroId: terreiro.id, filhoIds: [dados.filho.id], tipo: 'cobranca', referencia: c.id, canais: dados.canais || ['push'] });
  }
  return c;
}

// Quando a subconta é aprovada, envia as cobranças que estavam esperando
async function liberarAguardando(terreiroId) {
  const terreiro = await db.one('select * from terreiros where id = $1', [terreiroId]);
  const pendentes = await db.many(
    `select c.*, row_to_json(f) as filho from cobrancas c left join filhos f on f.id = c.filho_id
      where c.terreiro_id = $1 and c.status = 'aguardando_conta' order by c.created_at`,
    [terreiroId]
  );
  for (const c of pendentes) {
    await db.tx(async (t) => {
      await enviarAoGateway(t, terreiro, c, c.filho);
      if (c.filho) await notificar(t, { terreiroId, filhoIds: [c.filho.id], tipo: 'cobranca', referencia: c.id });
    });
  }
  return pendentes.length;
}

async function buscar(q, terreiroId, id) {
  const c = await q.one('select * from cobrancas where id = $1 and terreiro_id = $2', [id, terreiroId]);
  if (!c) throw erro.naoEncontrado('Cobrança não encontrada');
  return c;
}

async function baixaManual(terreiroId, id, { data, forma = 'dinheiro', comprovanteUrl }, usuarioId) {
  return db.tx(async (t) => {
    const c = await buscar(t, terreiroId, id);
    if (!['aberta', 'aguardando_conta'].includes(c.status)) throw erro.regra(`Não é possível dar baixa: cobrança ${c.status}`);
    if (c.gateway_id) await gateway.cancelarCobranca(c.gateway_id);
    const r = await t.one(
      `update cobrancas set status = 'paga', pago_em = ($2::date + time '12:00') at time zone 'America/Sao_Paulo', forma_pagamento = $3,
              comprovante_url = $4, recibo_numero = nextval('recibos_seq') where id = $1 returning *`,
      [id, data || relogio.hoje(), forma, comprovanteUrl || null]
    );
    await auditar(t, { terreiroId, usuarioId, acao: 'baixa_manual', entidade: 'cobranca', entidadeId: id, dados: { forma, data, valor: c.valor_centavos } });
    return r;
  });
}

async function cancelar(terreiroId, id, motivo, usuarioId) {
  if (!motivo || !String(motivo).trim()) throw erro.validacao('Informe o motivo do cancelamento', { campo: 'motivo' });
  return db.tx(async (t) => {
    const c = await buscar(t, terreiroId, id);
    if (c.status === 'paga') throw erro.regra('Cobrança paga não pode ser cancelada nem excluída. Use o estorno.');
    if (!['aberta', 'aguardando_conta'].includes(c.status)) throw erro.regra(`Cobrança já está ${c.status}`);
    if (c.gateway_id) await gateway.cancelarCobranca(c.gateway_id);
    const r = await t.one(`update cobrancas set status = 'cancelada', motivo = $2 where id = $1 returning *`, [id, motivo]);
    await auditar(t, { terreiroId, usuarioId, acao: 'cancelamento', entidade: 'cobranca', entidadeId: id, dados: { motivo } });
    return r;
  });
}

async function estornar(terreiroId, id, motivo, usuarioId) {
  if (!motivo || !String(motivo).trim()) throw erro.validacao('Informe o motivo do estorno', { campo: 'motivo' });
  return db.tx(async (t) => {
    const c = await buscar(t, terreiroId, id);
    if (c.status !== 'paga') throw erro.regra('Só cobranças pagas podem ser estornadas');
    if (c.gateway_id && c.forma_pagamento !== 'dinheiro') await gateway.estornarCobranca(c.gateway_id);
    const r = await t.one(`update cobrancas set status = 'estornada', motivo = $2 where id = $1 returning *`, [id, motivo]);
    await auditar(t, { terreiroId, usuarioId, acao: 'estorno', entidade: 'cobranca', entidadeId: id, dados: { motivo, valor: c.valor_centavos } });
    return r;
  });
}

// Webhook de pagamento: idempotente pelo id do evento (RNF-05)
async function registrarPagamento(evento) {
  return db.tx(async (t) => {
    const novo = await t.one(
      'insert into webhook_eventos(evento_id, tipo, payload) values ($1,$2,$3) on conflict do nothing returning evento_id',
      [evento.id, evento.event, evento]
    );
    if (!novo) return { duplicado: true };
    const p = evento.payment;
    const forma = { BOLETO: 'boleto', CREDIT_CARD: 'cartao', PIX: 'pix', DEBIT_CARD: 'cartao' }[p.billingType] || 'gateway';
    const c = await t.one(
      `update cobrancas set status = 'paga', pago_em = now(), forma_pagamento = $2, recibo_numero = nextval('recibos_seq')
        where gateway_id = $1 and status = 'aberta' returning *`,
      [p.id, forma]
    );
    if (c) {
      await auditar(t, { terreiroId: c.terreiro_id, acao: 'pagamento_confirmado', entidade: 'cobranca', entidadeId: c.id, dados: { evento: evento.id, forma } });
      if (c.filho_id) await notificar(t, { terreiroId: c.terreiro_id, filhoIds: [c.filho_id], tipo: 'recibo', referencia: c.id });
      return { tipo: 'cobranca', id: c.id };
    }
    const f = await t.one(
      `update faturas_saas set status = 'paga', pago_em = now() where gateway_id = $1 and status = 'aberta' returning *`, [p.id]
    );
    if (f) {
      await auditar(t, { terreiroId: f.terreiro_id, acao: 'fatura_saas_paga', entidade: 'fatura_saas', entidadeId: f.id, dados: { evento: evento.id } });
      return { tipo: 'fatura_saas', id: f.id, terreiroId: f.terreiro_id };
    }
    return { tipo: 'desconhecido' };
  });
}

module.exports = { aplicarDesconto, situacao, publicoCobranca, emitir, liberarAguardando, baixaManual, cancelar, estornar, registrarPagamento, buscar };
