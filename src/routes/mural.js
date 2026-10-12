'use strict';
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { erro, wrap, campo, relogio, paginacao } = require('../util');
const { notificar, auditar } = require('../services/base');

const r = express.Router({ mergeParams: true });
const podeMural = auth.exigir('staff', 'mural');
const soFilho = auth.exigir('filho');

// Condição SQL: o filho (alias f) está no público do aviso (alias a)
const NO_PUBLICO = `(a.publico->>'tipo' = 'todos'
  or (a.publico->>'tipo' = 'filhos' and a.publico->'ids' ? f.id::text)
  or (a.publico->>'tipo' = 'grupos' and exists (select 1 from filho_grupos fg where fg.filho_id = f.id and a.publico->'ids' ? fg.grupo_id::text)))`;

function lerPublico(b) {
  const p = campo(b, 'publico', { tipo: 'object' }) || { tipo: 'todos' };
  const tipo = campo(p, 'tipo', { obrigatorio: true, opcoes: ['todos', 'grupos', 'filhos'] });
  if (tipo === 'todos') return { tipo };
  const ids = campo(p, 'ids', { obrigatorio: true, tipo: 'array' });
  if (!ids.length) throw erro.validacao('Escolha ao menos um destinatário', { campo: 'publico' });
  ids.forEach((id) => { if (!/^[0-9a-f-]{36}$/i.test(id)) throw erro.validacao('Destinatário inválido', { campo: 'publico' }); });
  return { tipo, ids };
}

async function destinatarios(q, terreiroId, publico) {
  return (await q.many(
    `select f.id from filhos f, (select $2::jsonb as publico) a
      where f.terreiro_id = $1 and f.status = 'ativo' and not f.anonimizado and ${NO_PUBLICO}`,
    [terreiroId, publico]
  )).map((x) => x.id);
}

async function criarAviso(q, req, dados) {
  const a = await q.one(
    `insert into avisos(terreiro_id, titulo, texto, imagem_url, anexo_url, publico, fixado, valido_ate, evento_id, preceitos, categoria, autor_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
    [req.terreiro.id, dados.titulo, dados.texto || null, dados.imagem_url || null, dados.anexo_url || null, dados.publico, !!dados.fixado,
     dados.valido_ate || null, dados.evento_id || null, dados.preceitos || null, dados.categoria || 'aviso', req.usuario.id]
  );
  const ids = await destinatarios(q, req.terreiro.id, a.publico);
  if (ids.length && dados.notificar !== false) {
    await notificar(q, { terreiroId: req.terreiro.id, filhoIds: ids, tipo: 'aviso', referencia: a.id, canais: dados.canais || ['push'] });
  }
  return { ...a, destinatarios: ids.length };
}

// ---------- lista (sacerdote vê tudo com leituras; filho vê só o que é para ele) ----------
r.get('/avisos', wrap(async (req, res) => {
  const { limite, offset } = paginacao(req.query);
  const hoje = relogio.hoje();
  if (req.vinculo.papel === 'filho') {
    return res.json(await db.many(
      `select a.id, a.titulo, a.texto, a.imagem_url, a.anexo_url, a.fixado, a.valido_ate, a.evento_id, a.preceitos, a.categoria, a.created_at,
              (l.lido_em is not null) as lido, p.resposta as minha_presenca, e.inicio as evento_inicio
         from avisos a join filhos f on f.id = $2
         left join aviso_leituras l on l.aviso_id = a.id and l.filho_id = f.id
         left join presencas p on p.evento_id = a.evento_id and p.filho_id = f.id
         left join eventos e on e.id = a.evento_id
        where a.terreiro_id = $1 and (a.valido_ate is null or a.valido_ate >= $3) and ${NO_PUBLICO}
        order by a.fixado desc, a.created_at desc limit $4 offset $5`,
      [req.terreiro.id, req.vinculo.filho_id, hoje, limite, offset]
    ));
  }
  if (req.vinculo.papel === 'auxiliar' && { ...auth.PERMISSOES_AUXILIAR_PADRAO, ...req.vinculo.permissoes }.mural === false) throw erro.proibido();
  const linhas = await db.many(
    `select a.*, (a.valido_ate is not null and a.valido_ate < $2) as expirado,
            (select count(*) from aviso_leituras l where l.aviso_id = a.id)::int as lidos,
            (select count(*) from filhos f where f.terreiro_id = a.terreiro_id and f.status = 'ativo' and not f.anonimizado and ${NO_PUBLICO})::int as destinatarios
       from avisos a where a.terreiro_id = $1 and a.categoria <> 'privado'
      order by (a.fixado and (a.valido_ate is null or a.valido_ate >= $2)) desc, a.created_at desc limit $3 offset $4`,
    [req.terreiro.id, hoje, limite, offset]
  );
  res.json(linhas);
}));

r.post('/avisos', podeMural, wrap(async (req, res) => {
  const b = req.body;
  const a = await db.tx((q) => criarAviso(q, req, {
    titulo: campo(b, 'titulo', { obrigatorio: true, max: 140 }), texto: campo(b, 'texto', { max: 5000 }),
    imagem_url: campo(b, 'imagem_url', { max: 500 }), anexo_url: campo(b, 'anexo_url', { max: 500 }), publico: lerPublico(b),
    fixado: campo(b, 'fixado', { tipo: 'bool' }), valido_ate: campo(b, 'valido_ate', { tipo: 'date' }), canais: campo(b, 'canais', { tipo: 'array' }),
  }));
  res.status(201).json(a);
}));

r.patch('/avisos/:id', podeMural, wrap(async (req, res) => {
  const b = req.body;
  const atual = await db.one('select * from avisos where id = $1 and terreiro_id = $2', [req.params.id, req.terreiro.id]);
  if (!atual) throw erro.naoEncontrado('Aviso não encontrado');
  const a = await db.one(
    `update avisos set titulo = $2, texto = $3, fixado = $4, valido_ate = $5 where id = $1 returning *`,
    [atual.id, campo(b, 'titulo', { max: 140 }) ?? atual.titulo, 'texto' in b ? campo(b, 'texto', { max: 5000 }) ?? null : atual.texto,
     'fixado' in b ? campo(b, 'fixado', { tipo: 'bool' }) : atual.fixado, 'valido_ate' in b ? campo(b, 'valido_ate', { tipo: 'date' }) ?? null : atual.valido_ate]
  );
  res.json(a);
}));

r.delete('/avisos/:id', podeMural, wrap(async (req, res) => {
  const a = await db.one('delete from avisos where id = $1 and terreiro_id = $2 returning id', [req.params.id, req.terreiro.id]);
  if (!a) throw erro.naoEncontrado('Aviso não encontrado');
  await auditar(null, { terreiroId: req.terreiro.id, usuarioId: req.usuario.id, acao: 'aviso_excluido', entidade: 'aviso', entidadeId: a.id });
  res.status(204).end();
}));

// RF-27: relatório de quem leu
r.get('/avisos/:id/leituras', podeMural, wrap(async (req, res) => {
  const a = await db.one('select * from avisos where id = $1 and terreiro_id = $2', [req.params.id, req.terreiro.id]);
  if (!a) throw erro.naoEncontrado('Aviso não encontrado');
  const lista = await db.many(
    `select f.id, f.nome_civil, f.nome_santo from filhos f, (select $2::jsonb as publico) a
      where f.terreiro_id = $1 and f.status = 'ativo' and not f.anonimizado and ${NO_PUBLICO} order by f.nome_civil`,
    [req.terreiro.id, a.publico]
  );
  const lidos = new Map((await db.many('select filho_id, lido_em from aviso_leituras where aviso_id = $1', [a.id])).map((x) => [x.filho_id, x.lido_em]));
  const itens = lista.map((f) => ({ id: f.id, nome_civil: f.nome_civil, nome_santo: f.nome_santo, lido_em: lidos.get(f.id) || null }));
  res.json({ total: itens.length, lidos: itens.filter((i) => i.lido_em).length, itens });
}));

r.post('/avisos/:id/lido', soFilho, wrap(async (req, res) => {
  const ok = await db.one(
    `select a.id from avisos a join filhos f on f.id = $3 where a.id = $1 and a.terreiro_id = $2 and ${NO_PUBLICO}`,
    [req.params.id, req.terreiro.id, req.vinculo.filho_id]
  );
  if (!ok) throw erro.naoEncontrado('Aviso não encontrado');
  await db.query('insert into aviso_leituras(aviso_id, filho_id) values ($1,$2) on conflict do nothing', [ok.id, req.vinculo.filho_id]);
  res.json({ lido: true });
}));

// ---------- US-17: comunicado de gira com confirmação de presença ----------
r.post('/eventos/:id/comunicar', podeMural, wrap(async (req, res) => {
  const e = await db.one('select * from eventos where id = $1 and terreiro_id = $2', [req.params.id, req.terreiro.id]);
  if (!e) throw erro.naoEncontrado('Evento não encontrado');
  if (e.cancelado) throw erro.regra('Este evento foi cancelado');
  const preceitos = campo(req.body, 'preceitos', { tipo: 'array' }) || [];
  const quando = new Date(e.inicio).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const a = await db.tx((q) => criarAviso(q, req, {
    titulo: campo(req.body, 'titulo', { max: 140 }) || e.titulo, texto: campo(req.body, 'texto', { max: 5000 }) || `${quando}${e.descricao ? '. ' + e.descricao : ''}`,
    publico: lerPublico(req.body), fixado: true, valido_ate: new Date(e.inicio).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }),
    evento_id: e.id, preceitos: preceitos.map(String), categoria: 'gira', canais: campo(req.body, 'canais', { tipo: 'array' }),
  }));
  res.status(201).json(a);
}));

r.post('/eventos/:id/presenca', soFilho, wrap(async (req, res) => {
  const resposta = campo(req.body, 'resposta', { obrigatorio: true, opcoes: ['vou', 'nao_vou'] });
  const e = await db.one('select * from eventos where id = $1 and terreiro_id = $2 and not cancelado', [req.params.id, req.terreiro.id]);
  if (!e) throw erro.naoEncontrado('Evento não encontrado');
  if (new Date(e.inicio) < relogio.agora()) throw erro.regra('Este evento já começou');
  await db.query(
    `insert into presencas(evento_id, filho_id, resposta) values ($1,$2,$3)
     on conflict (evento_id, filho_id) do update set resposta = excluded.resposta, updated_at = now()`,
    [e.id, req.vinculo.filho_id, resposta]
  );
  res.json({ resposta });
}));

r.post('/eventos/:id/checkin', podeMural, wrap(async (req, res) => {
  const filhoId = campo(req.body, 'filho_id', { obrigatorio: true, tipo: 'uuid' });
  const e = await db.one('select id from eventos where id = $1 and terreiro_id = $2', [req.params.id, req.terreiro.id]);
  if (!e) throw erro.naoEncontrado('Evento não encontrado');
  await db.query(
    `insert into presencas(evento_id, filho_id, checkin_em) select $1, id, now() from filhos where id = $2 and terreiro_id = $3
     on conflict (evento_id, filho_id) do update set checkin_em = now()`, [e.id, filhoId, req.terreiro.id]
  );
  res.json({ checkin: true });
}));

r.get('/eventos/:id/presencas', podeMural, wrap(async (req, res) => {
  const e = await db.one('select * from eventos where id = $1 and terreiro_id = $2', [req.params.id, req.terreiro.id]);
  if (!e) throw erro.naoEncontrado('Evento não encontrado');
  const aviso = await db.one(`select publico from avisos where evento_id = $1 order by created_at desc limit 1`, [e.id]);
  const publico = aviso?.publico || { tipo: 'todos' };
  const itens = await db.many(
    `select f.id, f.nome_civil, f.nome_santo from filhos f, (select $2::jsonb as publico) a
      where f.terreiro_id = $1 and f.status = 'ativo' and not f.anonimizado and ${NO_PUBLICO} order by f.nome_civil`,
    [req.terreiro.id, publico]
  );
  const resp = new Map((await db.many('select filho_id, resposta, checkin_em from presencas where evento_id = $1', [e.id])).map((p) => [p.filho_id, p]));
  const lista = itens.map((f) => ({ id: f.id, nome_civil: f.nome_civil, nome_santo: f.nome_santo, resposta: resp.get(f.id)?.resposta || null, checkin_em: resp.get(f.id)?.checkin_em || null }));
  res.json({
    vou: lista.filter((x) => x.resposta === 'vou').length,
    nao_vou: lista.filter((x) => x.resposta === 'nao_vou').length,
    sem_resposta: lista.filter((x) => !x.resposta).length,
    checkins: lista.filter((x) => x.checkin_em).length,
    itens: lista,
  });
}));

module.exports = r;
module.exports.criarAviso = criarAviso;
module.exports.NO_PUBLICO = NO_PUBLICO;
