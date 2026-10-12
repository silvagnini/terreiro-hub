'use strict';
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { erro, wrap, campo, relogio, somarDias } = require('../util');
const { auditar, notificar } = require('../services/base');
const { emitir, publicoCobranca } = require('../services/cobrancas');

const r = express.Router({ mergeParams: true });
const podeAgenda = auth.exigir('staff', 'agenda');

const CORES = { gira: '#0F5C4D', obrigacao: '#1F4E8C', trabalho: '#6B4FA0', buzios: '#B7791F', festa: '#A23B5A', outro: '#555C58' };
const TZ = '-03:00'; // America/Sao_Paulo (sem horário de verão desde 2019)

const naData = (data, hora) => new Date(`${data}T${hora.slice(0, 5)}:00${TZ}`);
const dataLocal = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

// Gera as ocorrências de uma regra semanal (US-20)
function ocorrenciasSemanais(inicio, regra) {
  const ate = regra.ate || somarDias(dataLocal(inicio), 7 * 51);
  const max = Math.min(Number(regra.ocorrencias) || 52, 104);
  const intervalo = Math.max(1, Number(regra.intervalo) || 1);
  const out = [];
  let d = new Date(inicio);
  while (out.length < max && dataLocal(d) <= ate) {
    out.push(new Date(d));
    d = new Date(d.getTime() + intervalo * 7 * 864e5);
  }
  return out;
}

r.get('/eventos', wrap(async (req, res) => {
  const de = campo(req.query, 'de', { tipo: 'date' }) || relogio.hoje();
  const ate = campo(req.query, 'ate', { tipo: 'date' }) || somarDias(de, 42);
  if (req.query.tipo && !CORES[req.query.tipo]) throw erro.validacao('Tipo inválido', { campo: 'tipo' });
  const filho = req.vinculo.papel === 'filho' ? req.vinculo.filho_id : null;
  if (req.vinculo.papel === 'auxiliar' && { ...auth.PERMISSOES_AUXILIAR_PADRAO, ...req.vinculo.permissoes }.agenda === false) throw erro.proibido();
  const linhas = await db.many(
    `select e.id, e.tipo, e.titulo, e.descricao, e.inicio, e.fim, e.serie_id, e.cancelado, e.publico, e.filho_id, e.valor_centavos,
            ${filho ? 'null::jsonb' : 'e.consulente'} as consulente, f.nome_civil as filho_nome,
            (select count(*) from presencas p where p.evento_id = e.id and p.resposta = 'vou')::int as confirmados
       from eventos e left join filhos f on f.id = e.filho_id
      where e.terreiro_id = $1 and e.inicio >= ($2::date::timestamp at time zone 'America/Sao_Paulo')
        and e.inicio < (($3::date + 1)::timestamp at time zone 'America/Sao_Paulo')
        and ($4::text is null or e.tipo = $4)
        and ($5::uuid is null or (not e.cancelado and (e.filho_id = $5 or (e.publico and e.tipo in ('gira','festa','outro')))))
      order by e.inicio`,
    [req.terreiro.id, de, ate, req.query.tipo || null, filho]
  );
  res.json(linhas.map((e) => ({ ...e, cor: CORES[e.tipo] })));
}));

r.post('/eventos', podeAgenda, wrap(async (req, res) => {
  const b = req.body;
  const tipo = campo(b, 'tipo', { obrigatorio: true, opcoes: Object.keys(CORES) });
  if (tipo === 'buzios') throw erro.validacao('Use o agendamento de búzios para este tipo');
  const inicio = new Date(campo(b, 'inicio', { obrigatorio: true, tipo: 'datetime' }));
  const fim = campo(b, 'fim', { tipo: 'datetime' });
  if (fim && new Date(fim) <= inicio) throw erro.validacao('O fim deve ser depois do início', { campo: 'fim' });
  const duracao = fim ? new Date(fim) - inicio : null;
  const regra = campo(b, 'recorrencia', { tipo: 'object' });
  if (regra) {
    campo(regra, 'freq', { obrigatorio: true, opcoes: ['semanal'] });
    if (regra.ate) campo(regra, 'ate', { tipo: 'date' });
  }
  const filhoId = campo(b, 'filho_id', { tipo: 'uuid' });
  if (filhoId && !(await db.one('select 1 from filhos where id = $1 and terreiro_id = $2', [filhoId, req.terreiro.id]))) throw erro.validacao('Filho não encontrado', { campo: 'filho_id' });
  const datas = regra ? ocorrenciasSemanais(inicio, regra) : [inicio];
  const criados = await db.tx(async (q) => {
    const serie = regra ? (await q.one('select gen_random_uuid() as id')).id : null;
    const out = [];
    for (const d of datas) {
      out.push(await q.one(
        `insert into eventos(terreiro_id, tipo, titulo, descricao, inicio, fim, serie_id, regra_recorrencia, publico, filho_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
        [req.terreiro.id, tipo, campo(b, 'titulo', { obrigatorio: true, max: 140 }), campo(b, 'descricao', { max: 2000 }) || null, d,
         duracao ? new Date(d.getTime() + duracao) : null, serie, regra || null, b.publico !== false, filhoId || null]
      ));
    }
    return out;
  });
  res.status(201).json({ serie_id: criados[0].serie_id, quantidade: criados.length, eventos: criados.map((e) => ({ ...e, cor: CORES[e.tipo] })) });
}));

r.patch('/eventos/:id', podeAgenda, wrap(async (req, res) => {
  const e = await db.one('select * from eventos where id = $1 and terreiro_id = $2', [req.params.id, req.terreiro.id]);
  if (!e) throw erro.naoEncontrado('Evento não encontrado');
  const b = req.body;
  const novo = await db.one(
    'update eventos set titulo = $2, descricao = $3, inicio = $4, fim = $5 where id = $1 returning *',
    [e.id, campo(b, 'titulo', { max: 140 }) ?? e.titulo, 'descricao' in b ? campo(b, 'descricao', { max: 2000 }) ?? null : e.descricao,
     campo(b, 'inicio', { tipo: 'datetime' }) ?? e.inicio, 'fim' in b ? campo(b, 'fim', { tipo: 'datetime' }) ?? null : e.fim]
  );
  res.json({ ...novo, cor: CORES[novo.tipo] });
}));

// US-20: cancela só esta data (padrão) ou esta e as próximas da série
r.post('/eventos/:id/cancelar', wrap(async (req, res) => {
  const e = await db.one('select * from eventos where id = $1 and terreiro_id = $2', [req.params.id, req.terreiro.id]);
  if (!e) throw erro.naoEncontrado('Evento não encontrado');
  const papel = req.vinculo.papel;
  if (papel === 'filho' && !(e.tipo === 'buzios' && e.filho_id === req.vinculo.filho_id)) throw erro.proibido();
  if (papel === 'auxiliar' && { ...auth.PERMISSOES_AUXILIAR_PADRAO, ...req.vinculo.permissoes }.agenda === false) throw erro.proibido();
  if (e.cancelado) throw erro.regra('Evento já cancelado');
  const serie = req.body?.serie === true && e.serie_id;
  const n = await db.tx(async (q) => {
    const linhas = serie
      ? await q.many('update eventos set cancelado = true where serie_id = $1 and inicio >= $2 and not cancelado returning id', [e.serie_id, e.inicio])
      : await q.many('update eventos set cancelado = true where id = $1 returning id', [e.id]);
    // RN-10: búzios cancelado em cima da hora mantém a cobrança
    if (e.tipo === 'buzios') {
      const horas = Number(req.terreiro.regras?.cancelamento_buzios_horas || 24);
      const emCima = new Date(e.inicio) - relogio.agora() < horas * 3600e3;
      if (!emCima) await q.query(`update cobrancas set status = 'cancelada', motivo = 'Agendamento cancelado' where origem = 'buzios' and status in ('aberta','aguardando_conta') and descricao like '%' || $1`, [e.id.slice(0, 8)]);
    }
    await auditar(q, { terreiroId: req.terreiro.id, usuarioId: req.usuario.id, acao: 'evento_cancelado', entidade: 'evento', entidadeId: e.id, dados: { serie: !!serie, quantidade: linhas.length } });
    return linhas.length;
  });
  res.json({ cancelados: n });
}));

// ---------- búzios (US-21) ----------
r.get('/buzios/disponibilidade', wrap(async (req, res) => {
  res.json({
    horarios: await db.many('select * from buzios_disponibilidade where terreiro_id = $1 order by dia_semana, hora_inicio', [req.terreiro.id]),
    bloqueios: (await db.many('select data from buzios_bloqueios where terreiro_id = $1 and data >= $2 order by data', [req.terreiro.id, relogio.hoje()])).map((b) => b.data),
  });
}));

r.post('/buzios/disponibilidade', podeAgenda, wrap(async (req, res) => {
  const hi = campo(req.body, 'hora_inicio', { obrigatorio: true });
  const hf = campo(req.body, 'hora_fim', { obrigatorio: true });
  if (!/^\d{2}:\d{2}$/.test(hi) || !/^\d{2}:\d{2}$/.test(hf) || hf <= hi) throw erro.validacao('Horário inválido');
  res.status(201).json(await db.one(
    'insert into buzios_disponibilidade(terreiro_id, dia_semana, hora_inicio, hora_fim, duracao_min, valor_centavos) values ($1,$2,$3,$4,$5,$6) returning *',
    [req.terreiro.id, campo(req.body, 'dia_semana', { obrigatorio: true, tipo: 'int', min: 0, max: 6 }), hi, hf,
     campo(req.body, 'duracao_min', { tipo: 'int', min: 10, max: 240 }) || 60, campo(req.body, 'valor_centavos', { tipo: 'int', min: 0 }) || 0]
  ));
}));

r.delete('/buzios/disponibilidade/:id', podeAgenda, wrap(async (req, res) => {
  await db.query('delete from buzios_disponibilidade where id = $1 and terreiro_id = $2', [req.params.id, req.terreiro.id]);
  res.status(204).end();
}));

r.post('/buzios/bloqueios', podeAgenda, wrap(async (req, res) => {
  const data = campo(req.body, 'data', { obrigatorio: true, tipo: 'date' });
  await db.query('insert into buzios_bloqueios(terreiro_id, data) values ($1,$2) on conflict do nothing', [req.terreiro.id, data]);
  res.status(201).json({ data });
}));

r.delete('/buzios/bloqueios/:data', podeAgenda, wrap(async (req, res) => {
  await db.query('delete from buzios_bloqueios where terreiro_id = $1 and data = $2', [req.terreiro.id, req.params.data]);
  res.status(204).end();
}));

async function horariosLivres(terreiroId, data) {
  if (await db.one('select 1 from buzios_bloqueios where terreiro_id = $1 and data = $2', [terreiroId, data])) return [];
  const dia = new Date(data + 'T00:00:00Z').getUTCDay();
  const faixas = await db.many('select * from buzios_disponibilidade where terreiro_id = $1 and dia_semana = $2', [terreiroId, dia]);
  const ocupados = new Set((await db.many(
    `select inicio from eventos where terreiro_id = $1 and tipo = 'buzios' and not cancelado
        and inicio >= ($2::date::timestamp at time zone 'America/Sao_Paulo') and inicio < (($2::date + 1)::timestamp at time zone 'America/Sao_Paulo')`,
    [terreiroId, data]
  )).map((e) => new Date(e.inicio).getTime()));
  const livres = [];
  for (const f of faixas) {
    let t = naData(data, f.hora_inicio);
    const fim = naData(data, f.hora_fim);
    while (t.getTime() + f.duracao_min * 60e3 <= fim.getTime()) {
      if (!ocupados.has(t.getTime()) && t > relogio.agora()) livres.push({ inicio: t.toISOString(), duracao_min: f.duracao_min, valor_centavos: f.valor_centavos });
      t = new Date(t.getTime() + f.duracao_min * 60e3);
    }
  }
  return livres.sort((a, b) => a.inicio.localeCompare(b.inicio));
}

r.get('/buzios/horarios', wrap(async (req, res) => {
  res.json(await horariosLivres(req.terreiro.id, campo(req.query, 'data', { obrigatorio: true, tipo: 'date' })));
}));

r.post('/buzios/agendar', wrap(async (req, res) => {
  const b = req.body;
  const inicio = campo(b, 'inicio', { obrigatorio: true, tipo: 'datetime' });
  const papel = req.vinculo.papel;
  let filhoId = campo(b, 'filho_id', { tipo: 'uuid' }) || null;
  let consulente = null;
  if (papel === 'filho') filhoId = req.vinculo.filho_id;
  else {
    if (papel === 'auxiliar' && { ...auth.PERMISSOES_AUXILIAR_PADRAO, ...req.vinculo.permissoes }.agenda === false) throw erro.proibido();
    if (!filhoId) {
      const c = campo(b, 'consulente', { obrigatorio: true, tipo: 'object' });
      consulente = { nome: campo(c, 'nome', { obrigatorio: true, max: 120 }), telefone: campo(c, 'telefone', { max: 20 }) || null };
    }
  }
  const data = dataLocal(inicio);
  const livre = (await horariosLivres(req.terreiro.id, data)).find((h) => new Date(h.inicio).getTime() === new Date(inicio).getTime());
  if (!livre) {
    const bloqueado = await db.one('select 1 from buzios_bloqueios where terreiro_id = $1 and data = $2', [req.terreiro.id, data]);
    throw bloqueado ? erro.regra('Esta data está bloqueada para búzios') : erro.conflito('Horário indisponível. Escolha outro.');
  }
  const filho = filhoId ? await db.one('select * from filhos where id = $1 and terreiro_id = $2', [filhoId, req.terreiro.id]) : null;
  if (filhoId && !filho) throw erro.validacao('Filho não encontrado', { campo: 'filho_id' });
  const out = await db.tx(async (q) => {
    let e;
    try {
      e = await q.one(
        `insert into eventos(terreiro_id, tipo, titulo, inicio, fim, publico, filho_id, consulente, valor_centavos)
         values ($1,'buzios',$2,$3,$4,false,$5,$6,$7) returning *`,
        [req.terreiro.id, `Jogo de búzios · ${filho?.nome_civil || consulente.nome}`, inicio, new Date(new Date(inicio).getTime() + livre.duracao_min * 60e3),
         filhoId, consulente, livre.valor_centavos]
      );
    } catch (err) {
      if (err.code === '23505') throw erro.conflito('Horário acabou de ser ocupado. Escolha outro.');
      throw err;
    }
    let cobranca = null;
    if (livre.valor_centavos > 0 && b.cobrar !== false) {
      cobranca = await emitir(q, req.terreiro, {
        filho, consulente, descricao: `Jogo de búzios ${data.split('-').reverse().join('/')} #${e.id.slice(0, 8)}`, valorCentavos: livre.valor_centavos,
        vencimento: data < relogio.hoje() ? relogio.hoje() : data, origem: 'buzios', criadoPor: req.usuario.id,
      });
    }
    if (filhoId && papel !== 'filho') await notificar(q, { terreiroId: req.terreiro.id, filhoIds: [filhoId], tipo: 'compromisso', referencia: e.id });
    return { evento: { ...e, cor: CORES.buzios }, cobranca: cobranca && publicoCobranca(cobranca) };
  });
  res.status(201).json(out);
}));

module.exports = r;
module.exports.CORES = CORES;
module.exports.ocorrenciasSemanais = ocorrenciasSemanais;
