'use strict';
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { erro, wrap, campo, relogio, somarDias, competenciaDe, paginacao, diasNoMes, proximaCompetencia } = require('../util');
const C = require('../services/cobrancas');
const jobs = require('../services/jobs');
const { auditar } = require('../services/base');
const { criarAviso, NO_PUBLICO } = require('./mural');
const { CORES } = require('./agenda');

const r = express.Router({ mergeParams: true });
const fin = auth.exigir('staff', 'financeiro');
const sacerdote = auth.exigir('sacerdote');

const { publicoCobranca } = C;

// ---------- mensalidade recorrente (US-22) ----------
r.get('/mensalidade', fin, wrap(async (req, res) => res.json(req.terreiro.mensalidade || {})));

r.put('/mensalidade', sacerdote, wrap(async (req, res) => {
  const b = req.body;
  const cfg = {
    ativa: campo(b, 'ativa', { obrigatorio: true, tipo: 'bool' }),
    valor_centavos: campo(b, 'valor_centavos', { obrigatorio: true, tipo: 'int', min: 100 }),
    dia_geracao: campo(b, 'dia_geracao', { tipo: 'int', min: 1, max: 28 }) || 1,
    dia_vencimento: campo(b, 'dia_vencimento', { tipo: 'int', min: 1, max: 28 }) || 10,
    entrada: campo(b, 'entrada', { opcoes: ['integral', 'proporcional'] }) || 'integral',
  };
  await db.query(`update terreiros set mensalidade = $2, onboarding = onboarding || '{"mensalidade":"feita"}' where id = $1`, [req.terreiro.id, cfg]);
  await auditar(null, { terreiroId: req.terreiro.id, usuarioId: req.usuario.id, acao: 'mensalidade_configurada', entidade: 'terreiro', entidadeId: req.terreiro.id, dados: cfg });
  let geracao = null;
  if (b.gerar_agora === true && cfg.ativa) geracao = await jobs.gerarMensalidades(relogio.hoje(), req.terreiro.id);
  res.json({ ...cfg, geracao });
}));

// ---------- cobranças ----------
r.get('/cobrancas', fin, wrap(async (req, res) => {
  const { limite, offset } = paginacao(req.query);
  const hoje = relogio.hoje();
  const situacao = req.query.situacao || null;
  if (situacao && !['aguardando_conta', 'aberta', 'vencida', 'paga', 'cancelada', 'estornada', 'a_vencer'].includes(situacao)) throw erro.validacao('Situação inválida');
  const linhas = await db.many(
    `select c.*, f.nome_civil as filho_nome, count(*) over()::int as total
       from cobrancas c left join filhos f on f.id = c.filho_id
      where c.terreiro_id = $1
        and ($2::text is null
             or ($2 = 'vencida' and c.status = 'aberta' and c.vencimento < $3)
             or ($2 = 'a_vencer' and c.status = 'aberta' and c.vencimento >= $3)
             or ($2 not in ('vencida','a_vencer') and c.status::text = $2))
        and ($4::uuid is null or c.filho_id = $4) and ($5::text is null or c.origem = $5)
        and ($6::date is null or c.vencimento >= $6) and ($7::date is null or c.vencimento <= $7)
        and ($8::uuid is null or c.lote_id = $8)
      order by c.vencimento desc, c.created_at desc limit $9 offset $10`,
    [req.terreiro.id, situacao, hoje, req.query.filho_id || null, req.query.origem || null, req.query.de || null, req.query.ate || null,
     req.query.lote_id || null, limite, offset]
  );
  res.json({ itens: linhas.map((c) => publicoCobranca(c, hoje)), total: linhas[0]?.total || 0 });
}));

r.get('/cobrancas/:id', fin, wrap(async (req, res) => {
  const c = await db.one('select c.*, f.nome_civil as filho_nome from cobrancas c left join filhos f on f.id = c.filho_id where c.id = $1 and c.terreiro_id = $2', [req.params.id, req.terreiro.id]);
  if (!c) throw erro.naoEncontrado('Cobrança não encontrada');
  res.json(publicoCobranca(c, relogio.hoje()));
}));

async function filhoDaCasa(q, terreiroId, id) {
  const f = await q.one('select * from filhos where id = $1 and terreiro_id = $2 and not anonimizado', [id, terreiroId]);
  if (!f) throw erro.validacao('Filho não encontrado', { campo: 'filho_id' });
  return f;
}

// Cobrança avulsa individual
r.post('/cobrancas', fin, wrap(async (req, res) => {
  const b = req.body;
  const c = await db.tx(async (q) => {
    const filho = await filhoDaCasa(q, req.terreiro.id, campo(b, 'filho_id', { obrigatorio: true, tipo: 'uuid' }));
    if (filho.status === 'bloqueado' || filho.status === 'desligado') throw erro.regra(`Filho ${filho.status} não recebe novas cobranças`);
    const valor = campo(b, 'valor_centavos', { obrigatorio: true, tipo: 'int', min: 100 });
    const nova = await C.emitir(q, req.terreiro, {
      filho, descricao: campo(b, 'descricao', { obrigatorio: true, max: 140 }), valorCentavos: valor,
      descontoCentavos: campo(b, 'desconto_centavos', { tipo: 'int', min: 0, max: valor - 1 }) || 0,
      vencimento: campo(b, 'vencimento', { obrigatorio: true, tipo: 'date' }), origem: 'avulsa', criadoPor: req.usuario.id, canais: campo(b, 'canais', { tipo: 'array' }),
    });
    await auditar(q, { terreiroId: req.terreiro.id, usuarioId: req.usuario.id, acao: 'cobranca_criada', entidade: 'cobranca', entidadeId: nova.id, dados: { valor } });
    return nova;
  });
  res.status(201).json(publicoCobranca(c, relogio.hoje()));
}));

r.post('/cobrancas/:id/baixa', fin, wrap(async (req, res) => {
  const c = await C.baixaManual(req.terreiro.id, req.params.id, {
    data: campo(req.body, 'data', { tipo: 'date' }), forma: campo(req.body, 'forma', { opcoes: ['dinheiro', 'pix_direto', 'transferencia', 'outro'] }) || 'dinheiro',
    comprovanteUrl: campo(req.body, 'comprovante_url', { max: 500 }),
  }, req.usuario.id);
  res.json(publicoCobranca(c, relogio.hoje()));
}));

r.post('/cobrancas/:id/cancelar', fin, wrap(async (req, res) => {
  res.json(publicoCobranca(await C.cancelar(req.terreiro.id, req.params.id, req.body?.motivo, req.usuario.id), relogio.hoje()));
}));

r.post('/cobrancas/:id/estornar', sacerdote, wrap(async (req, res) => {
  res.json(publicoCobranca(await C.estornar(req.terreiro.id, req.params.id, req.body?.motivo, req.usuario.id), relogio.hoje()));
}));

// ---------- cobrança em lote (US-23) ----------
async function alvosDoLote(q, terreiroId, publico, incluirIsentos) {
  const todos = await q.many(
    `select f.* from filhos f, (select $2::jsonb as publico) a
      where f.terreiro_id = $1 and f.status = 'ativo' and not f.anonimizado and ${NO_PUBLICO} order by f.nome_civil`,
    [terreiroId, publico]
  );
  const alvos = incluirIsentos ? todos : todos.filter((f) => !f.isento);
  return { alvos, isentos: todos.length - alvos.length };
}

function lerLote(b) {
  const p = campo(b, 'publico', { tipo: 'object' }) || { tipo: 'todos' };
  const tipo = campo(p, 'tipo', { obrigatorio: true, opcoes: ['todos', 'grupos', 'filhos'] });
  const publico = tipo === 'todos' ? { tipo } : { tipo, ids: campo(p, 'ids', { obrigatorio: true, tipo: 'array' }) };
  return { publico, valor: campo(b, 'valor_centavos', { obrigatorio: true, tipo: 'int', min: 100 }), incluirIsentos: b.incluir_isentos === true };
}

r.post('/lotes/previa', fin, wrap(async (req, res) => {
  const { publico, valor, incluirIsentos } = lerLote(req.body);
  const { alvos, isentos } = await alvosDoLote(db, req.terreiro.id, publico, incluirIsentos);
  res.json({ quantidade: alvos.length, valor_centavos: valor, total_centavos: alvos.length * valor, isentos_excluidos: isentos, amostra: alvos.slice(0, 5).map((f) => f.nome_civil) });
}));

r.post('/lotes', fin, wrap(async (req, res) => {
  const { publico, valor, incluirIsentos } = lerLote(req.body);
  const descricao = campo(req.body, 'descricao', { obrigatorio: true, max: 140 });
  const vencimento = campo(req.body, 'vencimento', { obrigatorio: true, tipo: 'date' });
  if (vencimento < relogio.hoje()) throw erro.validacao('O vencimento não pode estar no passado', { campo: 'vencimento' });
  const out = await db.tx(async (q) => {
    const { alvos, isentos } = await alvosDoLote(q, req.terreiro.id, publico, incluirIsentos);
    if (!alvos.length) throw erro.regra('Nenhum filho ativo neste público');
    const lote = await q.one(
      `insert into lotes(terreiro_id, descricao, valor_centavos, vencimento, publico, quantidade, total_centavos, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [req.terreiro.id, descricao, valor, vencimento, publico, alvos.length, alvos.length * valor, req.usuario.id]
    );
    for (const f of alvos) {
      await C.emitir(q, req.terreiro, { filho: f, descricao, valorCentavos: valor, vencimento, origem: 'lote', loteId: lote.id, criadoPor: req.usuario.id, canais: campo(req.body, 'canais', { tipo: 'array' }) });
    }
    await auditar(q, { terreiroId: req.terreiro.id, usuarioId: req.usuario.id, acao: 'lote_criado', entidade: 'lote', entidadeId: lote.id, dados: { quantidade: alvos.length, valor } });
    return { ...lote, isentos_excluidos: isentos };
  });
  res.status(201).json(out);
}));

r.get('/lotes', fin, wrap(async (req, res) => {
  res.json(await db.many(
    `select l.*, (select count(*) from cobrancas c where c.lote_id = l.id and c.status = 'paga')::int as pagas
       from lotes l where l.terreiro_id = $1 order by l.created_at desc limit 100`, [req.terreiro.id]
  ));
}));

// ---------- trabalho individual (US-24): evento + cobrança + aviso privado de uma vez ----------
r.post('/trabalhos', fin, wrap(async (req, res) => {
  const b = req.body;
  const out = await db.tx(async (q) => {
    const filho = await filhoDaCasa(q, req.terreiro.id, campo(b, 'filho_id', { obrigatorio: true, tipo: 'uuid' }));
    if (filho.status === 'bloqueado' || filho.status === 'desligado') throw erro.regra(`Filho ${filho.status} não recebe novos trabalhos`);
    const servicoId = campo(b, 'servico_id', { tipo: 'uuid' });
    const servico = servicoId ? await q.one('select * from servicos where id = $1 and terreiro_id = $2', [servicoId, req.terreiro.id]) : null;
    if (servicoId && !servico) throw erro.validacao('Serviço não encontrado', { campo: 'servico_id' });
    const nome = campo(b, 'nome', { max: 80 }) || servico?.nome;
    if (!nome) throw erro.validacao('Informe o serviço', { campo: 'servico_id' });
    const valor = campo(b, 'valor_centavos', { tipo: 'int', min: 0 }) ?? servico?.preco_sugerido_centavos ?? 0;
    const data = new Date(campo(b, 'data', { obrigatorio: true, tipo: 'datetime' }));
    const parcelas = campo(b, 'parcelas', { tipo: 'int', min: 1, max: 12 }) || 1;
    const preceitos = campo(b, 'preceitos', { max: 2000 }) || null;
    const dataLocal = data.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const hoje = relogio.hoje();
    const venc1 = campo(b, 'vencimento', { tipo: 'date' }) || (somarDias(dataLocal, -1) < hoje ? hoje : somarDias(dataLocal, -1));

    const trabalho = await q.one(
      `insert into trabalhos(terreiro_id, filho_id, servico_id, nome, valor_centavos, data, preceitos) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [req.terreiro.id, filho.id, servico?.id || null, nome, valor, data, preceitos]
    );
    const evento = await q.one(
      `insert into eventos(terreiro_id, tipo, titulo, descricao, inicio, fim, publico, filho_id, valor_centavos)
       values ($1,'trabalho',$2,$3,$4,$5,false,$6,$7) returning *`,
      [req.terreiro.id, `${nome} · ${filho.nome_civil}`, preceitos, data, new Date(data.getTime() + (servico?.duracao_min || 60) * 60e3), filho.id, valor]
    );
    const cobrancas = [];
    if (valor > 0) {
      const base = Math.floor(valor / parcelas);
      for (let i = 1; i <= parcelas; i++) {
        const v = i === parcelas ? valor - base * (parcelas - 1) : base;
        const venc = i === 1 ? venc1 : somarDias(venc1, 30 * (i - 1));
        cobrancas.push(await C.emitir(q, req.terreiro, {
          filho, descricao: parcelas > 1 ? `${nome} (${i}/${parcelas})` : nome, valorCentavos: v, vencimento: venc, origem: 'trabalho',
          trabalhoId: trabalho.id, parcela: parcelas > 1 ? i : null, parcelas: parcelas > 1 ? parcelas : null, criadoPor: req.usuario.id,
        }, { notificarFilho: false }));
      }
    }
    const quando = data.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const aviso = await criarAviso(q, req, {
      titulo: `Seu ${nome.toLowerCase()} · ${quando}`, texto: preceitos ? `Preceitos: ${preceitos}` : 'Veja os detalhes com o sacerdote.',
      publico: { tipo: 'filhos', ids: [filho.id] }, categoria: 'privado', evento_id: evento.id,
      preceitos: preceitos ? preceitos.split(/[.;\n]+/).map((s) => s.trim()).filter(Boolean) : null,
    });
    await q.query('update trabalhos set evento_id = $2, aviso_id = $3 where id = $1', [trabalho.id, evento.id, aviso.id]);
    await auditar(q, { terreiroId: req.terreiro.id, usuarioId: req.usuario.id, acao: 'trabalho_criado', entidade: 'trabalho', entidadeId: trabalho.id, dados: { valor, parcelas } });
    return {
      trabalho: { ...trabalho, evento_id: evento.id, aviso_id: aviso.id },
      evento: { ...evento, cor: CORES.trabalho }, cobrancas: cobrancas.map((c) => publicoCobranca(c, hoje)), aviso: { id: aviso.id, titulo: aviso.titulo },
    };
  });
  res.status(201).json(out);
}));

r.get('/trabalhos', fin, wrap(async (req, res) => {
  res.json(await db.many(
    `select t.*, f.nome_civil as filho_nome from trabalhos t join filhos f on f.id = t.filho_id
      where t.terreiro_id = $1 and ($2::uuid is null or t.filho_id = $2) order by t.data desc limit 200`,
    [req.terreiro.id, req.query.filho_id || null]
  ));
}));

r.post('/trabalhos/:id/cancelar', fin, wrap(async (req, res) => {
  if (typeof req.body?.cancelar_cobranca !== 'boolean') {
    throw erro.validacao('Informe se a cobrança também deve ser cancelada (cancelar_cobranca: true ou false)', { campo: 'cancelar_cobranca' });
  }
  const out = await db.tx(async (q) => {
    const t = await q.one('select * from trabalhos where id = $1 and terreiro_id = $2', [req.params.id, req.terreiro.id]);
    if (!t) throw erro.naoEncontrado('Trabalho não encontrado');
    if (t.status === 'cancelado') throw erro.regra('Trabalho já cancelado');
    await q.query(`update trabalhos set status = 'cancelado' where id = $1`, [t.id]);
    if (t.evento_id) await q.query('update eventos set cancelado = true where id = $1', [t.evento_id]);
    let canceladas = 0;
    if (req.body.cancelar_cobranca) {
      const linhas = await q.many(
        `update cobrancas set status = 'cancelada', motivo = 'Trabalho cancelado' where trabalho_id = $1 and status in ('aberta','aguardando_conta') returning id`, [t.id]
      );
      canceladas = linhas.length;
    }
    await auditar(q, { terreiroId: req.terreiro.id, usuarioId: req.usuario.id, acao: 'trabalho_cancelado', entidade: 'trabalho', entidadeId: t.id, dados: { cancelar_cobranca: req.body.cancelar_cobranca } });
    return { cancelado: true, cobrancas_canceladas: canceladas };
  });
  res.json(out);
}));

// ---------- despesas (RF-52) ----------
const CATEGORIAS = ['velas', 'ervas', 'animais', 'aluguel', 'luz', 'agua', 'obras', 'festas', 'materiais', 'outros'];
const podeDespesas = auth.exigir('staff', 'despesas');

r.get('/despesas', podeDespesas, wrap(async (req, res) => {
  const comp = req.query.competencia || competenciaDe(relogio.hoje());
  res.json(await db.many(
    `select * from despesas where terreiro_id = $1 and to_char(data, 'YYYY-MM') = $2 order by data desc, created_at desc`, [req.terreiro.id, comp]
  ));
}));
r.post('/despesas', podeDespesas, wrap(async (req, res) => {
  const d = await db.one(
    'insert into despesas(terreiro_id, categoria, descricao, valor_centavos, data, created_by) values ($1,$2,$3,$4,$5,$6) returning *',
    [req.terreiro.id, campo(req.body, 'categoria', { obrigatorio: true, opcoes: CATEGORIAS }), campo(req.body, 'descricao', { max: 200 }) || null,
     campo(req.body, 'valor_centavos', { obrigatorio: true, tipo: 'int', min: 1 }), campo(req.body, 'data', { tipo: 'date' }) || relogio.hoje(), req.usuario.id]
  );
  await auditar(null, { terreiroId: req.terreiro.id, usuarioId: req.usuario.id, acao: 'despesa_criada', entidade: 'despesa', entidadeId: d.id, dados: { valor: d.valor_centavos } });
  res.status(201).json(d);
}));
r.delete('/despesas/:id', sacerdote, wrap(async (req, res) => {
  const d = await db.one('delete from despesas where id = $1 and terreiro_id = $2 returning *', [req.params.id, req.terreiro.id]);
  if (!d) throw erro.naoEncontrado('Despesa não encontrada');
  await auditar(null, { terreiroId: req.terreiro.id, usuarioId: req.usuario.id, acao: 'despesa_excluida', entidade: 'despesa', entidadeId: d.id, dados: { valor: d.valor_centavos } });
  res.status(204).end();
}));


// Receita x despesa dos 12 meses até `ini` (inclusive): uma agregação por faixa de datas, usando os índices
async function serieMensal(tid, ini) {
  const meses = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(ini + 'T12:00:00Z');
    d.setUTCMonth(d.getUTCMonth() - 11 + i);
    return d.toISOString().slice(0, 7);
  });
  const de = `${meses[0]}-01`;
  const ate = `${proximaCompetencia(meses[11])}-01`;
  const [rec, desp] = await Promise.all([
    db.many(
      `select to_char(date_trunc('month', pago_em at time zone 'America/Sao_Paulo'), 'YYYY-MM') as comp, sum(valor_centavos - desconto_centavos)::bigint as v
         from cobrancas where terreiro_id = $1 and status = 'paga'
          and pago_em >= ($2::date::timestamp at time zone 'America/Sao_Paulo') and pago_em < ($3::date::timestamp at time zone 'America/Sao_Paulo')
        group by 1`, [tid, de, ate]
    ),
    db.many(
      `select to_char(date_trunc('month', data), 'YYYY-MM') as comp, sum(valor_centavos)::bigint as v
         from despesas where terreiro_id = $1 and data >= $2 and data < $3 group by 1`, [tid, de, ate]
    ),
  ]);
  const r = new Map(rec.map((x) => [x.comp, x.v]));
  const d = new Map(desp.map((x) => [x.comp, x.v]));
  return meses.map((m) => ({ competencia: m, receita_centavos: r.get(m) || 0, despesa_centavos: d.get(m) || 0 }));
}

// ---------- dashboard (US-29) ----------
r.get('/dashboard', auth.exigir('staff', 'dashboard'), wrap(async (req, res) => {
  const hoje = relogio.hoje();
  const comp = campo(req.query, 'competencia') || competenciaDe(hoje);
  if (!/^\d{4}-\d{2}$/.test(comp)) throw erro.validacao('Competência inválida (AAAA-MM)');
  const ini = `${comp}-01`;
  const fim = `${comp}-${String(diasNoMes(comp)).padStart(2, '0')}`;
  const tid = req.terreiro.id;
  const [resumo, mensal, serie, porOrigem, atrasados] = await Promise.all([
    db.one(
      `select
         (select coalesce(sum(valor_centavos - desconto_centavos),0) from cobrancas where terreiro_id = $1 and status = 'paga'
             and pago_em >= ($2::date::timestamp at time zone 'America/Sao_Paulo') and pago_em < (($3::date + 1)::timestamp at time zone 'America/Sao_Paulo'))::bigint as recebido,
         (select coalesce(sum(valor_centavos - desconto_centavos),0) from cobrancas where terreiro_id = $1 and status in ('aberta','aguardando_conta')
             and vencimento between greatest($2::date, $4::date) and $3)::bigint as a_receber,
         (select coalesce(sum(valor_centavos - desconto_centavos),0) from cobrancas where terreiro_id = $1 and status = 'aberta' and vencimento < $4)::bigint as em_atraso,
         (select count(distinct filho_id) from cobrancas where terreiro_id = $1 and status = 'aberta' and vencimento < $4)::int as filhos_em_atraso,
         (select coalesce(sum(valor_centavos),0) from despesas where terreiro_id = $1 and data between $2 and $3)::bigint as despesas`,
      [tid, ini, fim, hoje]
    ),
    db.one(
      `select count(*) filter (where status = 'paga')::int as pagas, count(*) filter (where status <> 'cancelada')::int as total
         from cobrancas where terreiro_id = $1 and origem = 'mensalidade' and competencia = $2`, [tid, comp]
    ),
    serieMensal(tid, ini),
    db.many(
      `select origem, coalesce(sum(valor_centavos - desconto_centavos),0)::bigint as valor from cobrancas
        where terreiro_id = $1 and status = 'paga' and pago_em >= ($2::date::timestamp at time zone 'America/Sao_Paulo') and pago_em < (($3::date + 1)::timestamp at time zone 'America/Sao_Paulo')
        group by origem order by 2 desc`, [tid, ini, fim]
    ),
    db.many(
      `select f.id, f.nome_civil, count(*)::int as cobrancas, sum(c.valor_centavos - c.desconto_centavos)::bigint as valor, min(c.vencimento) as desde
         from cobrancas c join filhos f on f.id = c.filho_id
        where c.terreiro_id = $1 and c.status = 'aberta' and c.vencimento < $2
        group by f.id order by valor desc limit 20`, [tid, hoje]
    ),
  ]);
  res.json({
    competencia: comp,
    recebido_centavos: resumo.recebido, a_receber_centavos: resumo.a_receber, em_atraso_centavos: resumo.em_atraso,
    filhos_em_atraso: resumo.filhos_em_atraso, despesas_centavos: resumo.despesas, saldo_centavos: resumo.recebido - resumo.despesas,
    mensalidades: mensal, serie,
    receita_por_origem: porOrigem.map((o) => ({ origem: o.origem, valor_centavos: o.valor })), inadimplentes: atrasados,
  });
}));

// RF-55: relatório CSV
r.get('/relatorios/cobrancas.csv', auth.exigir('staff', 'dashboard'), wrap(async (req, res) => {
  const de = campo(req.query, 'de', { obrigatorio: true, tipo: 'date' });
  const ate = campo(req.query, 'ate', { obrigatorio: true, tipo: 'date' });
  const linhas = await db.many(
    `select c.vencimento, coalesce(f.nome_civil, c.consulente->>'nome') as pagador, c.descricao, c.origem, c.status,
            (c.valor_centavos - c.desconto_centavos) as valor, to_char(c.pago_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as pago_em, c.forma_pagamento
       from cobrancas c left join filhos f on f.id = c.filho_id
      where c.terreiro_id = $1 and c.vencimento between $2 and $3 order by c.vencimento`, [req.terreiro.id, de, ate]
  );
  const esc = (v) => (v == null ? '' : /[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const csv = ['vencimento;pagador;descricao;origem;status;valor;pago_em;forma']
    .concat(linhas.map((l) => [l.vencimento, l.pagador, l.descricao, l.origem, l.status, (l.valor / 100).toFixed(2).replace('.', ','), l.pago_em, l.forma_pagamento].map(esc).join(';')))
    .join('\n');
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="cobrancas-${de}-a-${ate}.csv"`);
  res.send('﻿' + csv);
}));

module.exports = r;
module.exports.publicoCobranca = publicoCobranca;
