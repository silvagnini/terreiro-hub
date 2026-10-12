'use strict';
const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

// date (1082) como string 'YYYY-MM-DD'; bigint (20) como número
types.setTypeParser(1082, (v) => v);
types.setTypeParser(20, (v) => Number(v));

let pool;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/terreiro';
    const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined;
    pool = new Pool({ connectionString, ssl, max: Number(process.env.DB_POOL_MAX || 20) });
  }
  return pool;
}

function query(text, params) {
  return getPool().query(text, params);
}

async function one(text, params) {
  const r = await query(text, params);
  return r.rows[0] || null;
}

async function many(text, params) {
  const r = await query(text, params);
  return r.rows;
}

async function tx(fn) {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const helpers = {
      query: (t, p) => client.query(t, p),
      one: async (t, p) => (await client.query(t, p)).rows[0] || null,
      many: async (t, p) => (await client.query(t, p)).rows,
    };
    const result = await fn(helpers);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function migrate() {
  await query('create table if not exists schema_migrations (nome text primary key, aplicada_em timestamptz not null default now())');
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const done = new Set((await many('select nome from schema_migrations')).map((r) => r.nome));
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    await tx(async (t) => {
      await t.query(sql);
      await t.query('insert into schema_migrations(nome) values ($1)', [f]);
    });
  }
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { getPool, query, one, many, tx, migrate, close };
