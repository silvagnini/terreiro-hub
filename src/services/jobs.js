'use strict';
const db = require('../db');
const { gateway } = require('../gateway');
const { relogio, somarDias, diasEntre, competenciaDe, diasNoMes, dataNaCompetencia } = require('../util');
const { emitir, aplicarDesconto, reenviarSemGateway } = require('./cobrancas');
const { auditar, notificar } = require('./base');

// US-22 / RN-04: gera a mensalidade do mês para cada filho ativo e não isento. Idempotente.
function valorMensalidade(cfg, filho, competencia) {
  const base = Number(cfg.valor_centavos);
  let valor = base;
  if (filho.data_entrada && competenciaDe(filho.data_entrada) === competencia && cfg.entrada === 'proporcional') {
    const dias = diasNoMes(competencia);
    const diaEntrada = Number(filho.data_entrada.slice(8, 10));
    valor = Math.round((base * (dias - diaEntrada + 1)) / dias);
  }
  return { valor, desconto: aplicarDesconto(valor, filho.desconto) };
}

async function gerarMensalidades(hoje = relogio.hoje(), terreiroId = null) {
  const competencia = competenciaDe(hoje);
  const dia = Number(hoje.slice(8, 10));
  const terreiros = await db.many(
    `select * from terreiros where (mensalidade->>'ativa')::boolean is true
       and status not in ('bloqueado','encerrado') and ($1::uuid is null or id = $1)`,
    [terreiroId]
  );
  let geradas = 0;
  for (const t of terreiros) {
    const cfg = t.mensalidade;
    if (dia < Number(cfg.dia_geracao || 1)) continue;
    const vencimento = dataNaCompetencia(competencia, Number(cfg.dia_vencimento || 10));
    const filhos = await db.many(
      `select f.* from filhos f
        where f.terreiro_id = $1 and f.status = 'ativo' and not f.isento and not f.anonimizado
          and (f.data_entrada is null or f.data_entrada <= $2)
          and not exists (select 1 from cobrancas c where c.filho_id = f.id and c.competencia = $3 and c.origem = 'mensalidade' and c.status <> 'cancelada')`,
      [t.id, hoje, competencia]
    );
    for (const f of filhos) {
      const { valor, desconto } = valorMensalidade(cfg, f, competencia);
      if (valor - desconto <= 0) continue;
      try {
        await db.tx((q) =>
          emitir(q, t, {
            filho: f, descricao: `Mensalidade ${competencia.slice(5)}/${competencia.slice(0, 4)}`, valorCentavos: valor, descontoCentavos: desconto,
            vencimento: vencimento < hoje ? hoje : vencimento, origem: 'mensalidade', competencia,
          })
        );
        geradas++;
      } catch (e) {
        if (e.code !== '23505') throw e; // corrida: outra execução já gerou
      }
    }
  }
  return { competencia, geradas };
}

// US-03: fatura mensal da assinatura do SaaS
async function faturarSaaS(hoje = relogio.hoje()) {
  const competencia = competenciaDe(hoje);
  const dia = Number(hoje.slice(8, 10));
  // fim do teste grátis
  await db.query(`update terreiros set status = 'ativo' where status = 'teste' and teste_ate < $1`, [hoje]);
  const terreiros = await db.many(
    `select t.*, p.preco_centavos from terreiros t join planos p on p.id = t.plano_id
      where t.status in ('ativo','aviso','somente_leitura') and t.dia_faturamento <= $1 and p.preco_centavos > 0
        and not exists (select 1 from faturas_saas f where f.terreiro_id = t.id and f.competencia = $2)`,
    [dia, competencia]
  );
  let geradas = 0;
  for (const t of terreiros) {
    const vencimento = somarDias(dataNaCompetencia(competencia, t.dia_faturamento), 5);
    let g;
    try {
      g = await gateway.criarCobranca({
        contaId: 'plataforma', clienteId: t.gateway_cliente_id, valorCentavos: t.preco_centavos, vencimento, descricao: `Assinatura Terreiro Hub ${competencia}`,
        referencia: `saas:${t.id}:${competencia}`,
        pagador: { id: t.id, nome: t.responsavel_nome, telefone: t.telefone, cpf: t.documento, email: t.email, recebedor: 'TERREIRO HUB' },
      });
    } catch (e) {
      console.error(`[faturas] terreiro ${t.id}: ${e.message}`);
      continue;
    }
    if (g.clienteId && g.clienteId !== t.gateway_cliente_id) await db.query('update terreiros set gateway_cliente_id = $2 where id = $1', [t.id, g.clienteId]);
    const ins = await db.one(
      `insert into faturas_saas(terreiro_id, competencia, valor_centavos, vencimento, gateway_id, pix_copia_cola, boleto_linha)
       values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing returning id`,
      [t.id, competencia, t.preco_centavos, vencimento, g.id, g.pixCopiaCola, g.boletoLinha]
    );
    if (ins) geradas++;
  }
  return { competencia, geradas };
}

// RN-09: régua de inadimplência do terreiro com o SaaS
function statusPorAtraso(dias) {
  if (dias >= 90) return 'encerrado';
  if (dias >= 30) return 'bloqueado';
  if (dias >= 15) return 'somente_leitura';
  if (dias >= 5) return 'aviso';
  return 'ativo';
}

async function reguaInadimplencia(hoje = relogio.hoje()) {
  const linhas = await db.many(
    `select t.id, t.status, min(f.vencimento) as mais_antiga
       from terreiros t left join faturas_saas f on f.terreiro_id = t.id and f.status = 'aberta' and f.vencimento < $1
      where not t.status_manual and t.status not in ('teste','encerrado')
      group by t.id`,
    [hoje]
  );
  const mudancas = [];
  for (const l of linhas) {
    const atraso = l.mais_antiga ? diasEntre(l.mais_antiga, hoje) : 0;
    const novo = statusPorAtraso(atraso);
    if (novo !== l.status) {
      await db.query(
        `update terreiros set status = $2::status_terreiro, encerrado_em = case when $2::status_terreiro = 'encerrado' then now() else encerrado_em end where id = $1`,
        [l.id, novo]
      );
      await auditar(null, { terreiroId: l.id, acao: 'regua_status', entidade: 'terreiro', entidadeId: l.id, dados: { de: l.status, para: novo, atraso } });
      mudancas.push({ terreiroId: l.id, de: l.status, para: novo, atraso });
    }
  }
  return { mudancas };
}

// RF-46: lembretes 3 dias antes, no dia e 3 dias depois do vencimento (sem repetir)
async function lembretes(hoje = relogio.hoje()) {
  const alvos = [
    { data: somarDias(hoje, 3), tipo: 'lembrete', marca: 'antes' },
    { data: hoje, tipo: 'lembrete', marca: 'no_dia' },
    { data: somarDias(hoje, -3), tipo: 'atraso', marca: 'depois' },
  ];
  let enviados = 0;
  for (const a of alvos) {
    const cobs = await db.many(
      `select c.id, c.terreiro_id, c.filho_id from cobrancas c
        where c.status = 'aberta' and c.vencimento = $1 and c.filho_id is not null
          and not exists (select 1 from notificacoes n where n.referencia = c.id || ':' || $2)`,
      [a.data, a.marca]
    );
    for (const c of cobs) {
      await notificar(null, { terreiroId: c.terreiro_id, filhoIds: [c.filho_id], tipo: a.tipo, referencia: `${c.id}:${a.marca}`, canais: ['push', 'whatsapp'] });
      enviados++;
    }
  }
  return { enviados };
}

async function rodarTudo(hoje = relogio.hoje()) {
  const faturas = await faturarSaaS(hoje);
  const regua = await reguaInadimplencia(hoje);
  const mensalidades = await gerarMensalidades(hoje);
  const avisos = await lembretes(hoje);
  const pix = await reenviarSemGateway();
  return { hoje, faturas, regua, mensalidades, lembretes: avisos, reenvio_pix: pix };
}

module.exports = { valorMensalidade, gerarMensalidades, faturarSaaS, statusPorAtraso, reguaInadimplencia, lembretes, rodarTudo };
