'use strict';
// Limpeza única da base: apaga todos os dados de uso e mantém apenas os usuários admin,
// os planos e as configurações do sistema (chaves de notificação).
// Acionada por LIMPAR_BASE=<qualquer código>. Cada código roda uma vez só (fica marcado na tabela config),
// então reinícios do servidor não apagam de novo. Depois de rodar, a variável pode ser removida.
const db = require('../db');

const MANTER = new Set(['usuarios', 'planos', 'config', 'schema_migrations', 'sessoes', 'push_inscricoes']);

async function limparSePedido() {
  const codigo = process.env.LIMPAR_BASE;
  if (!codigo) return null;
  const marca = `limpeza:${codigo}`;
  if (await db.one('select 1 from config where chave = $1', [marca])) return null;
  const tabelas = (await db.many(`select tablename from pg_tables where schemaname = 'public'`)).map((r) => r.tablename).filter((t) => !MANTER.has(t));
  const antes = {};
  for (const t of tabelas) antes[t] = (await db.one(`select count(*)::int as n from "${t}"`)).n;
  await db.tx(async (q) => {
    await q.query(`truncate ${tabelas.map((t) => `"${t}"`).join(', ')} restart identity cascade`);
    await q.query('delete from sessoes where usuario_id not in (select id from usuarios where is_admin)');
    await q.query('delete from push_inscricoes where usuario_id not in (select id from usuarios where is_admin)');
    await q.query('delete from usuarios where not is_admin');
    await q.query('insert into config(chave, valor) values ($1, $2)', [marca, JSON.stringify({ em: new Date().toISOString(), antes })]);
  });
  const restantes = await db.one('select count(*)::int as usuarios from usuarios');
  console.log('[limpeza] base limpa. Registros apagados por tabela:', JSON.stringify(antes), '· usuários restantes (admin):', restantes.usuarios);
  return antes;
}

module.exports = { limparSePedido };
