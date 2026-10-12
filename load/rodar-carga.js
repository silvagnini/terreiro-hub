'use strict';
// Teste de carga e volume: cresce a base em degraus e mede a API em cada um.
// Uso: node load/rodar-carga.js [--degraus 50,200,500,1000,2000] [--duracao 15] [--conexoes 20]
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const autocannon = require('autocannon');

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map((a) => a.trim().split(/\s+/)));
const DEGRAUS = (args.degraus || '50,200,500,1000,2000').split(',').map(Number);
const DURACAO = Number(args.duracao || 15);
const CONEXOES = Number(args.conexoes || 20);
const RAMPA = (args.rampa || '10,50,100,200').split(',').map(Number);
const DB_URL = process.env.CARGA_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/terreiro_carga';
const PORTA = 8181;
const BASE = `http://127.0.0.1:${PORTA}`;
const GRANDE = 999001; // terreiro com 300 filhos e 2 anos de histórico (RNF-07)

process.env.DATABASE_URL = DB_URL;
const db = require('../src/db');
const vol = require('./volume');
const { simulado } = require('../src/gateway');

const sorteio = (n) => 1 + Math.floor(Math.random() * n);
const bearer = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

async function subirServidor() {
  const p = spawn(process.execPath, ['src/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: DB_URL, PORT: String(PORTA), NODE_ENV: 'production', RODAR_ROTINAS: 'false', DB_POOL_MAX: '30', WEBHOOK_TOKEN: 'token-de-carga-com-mais-de-32-caracteres-xyz' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE + '/api/saude')).ok) return p; } catch { /* subindo */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('servidor de carga não subiu');
}

function medir(nome, opcoes) {
  return new Promise((resolve, reject) => {
    autocannon({ url: BASE, connections: CONEXOES, duration: DURACAO, timeout: 20, ...opcoes }, (err, r) => {
      if (err) return reject(err);
      resolve({
        cenario: nome, conexoes: opcoes.connections || CONEXOES, requisicoes: r.requests.total, rps: Math.round(r.requests.average),
        p50_ms: r.latency.p50, p90_ms: r.latency.p90, p97_5_ms: r.latency.p97_5, p99_ms: r.latency.p99, max_ms: r.latency.max,
        erros: r.errors + r.timeouts, nao_2xx: r.non2xx,
      });
    });
  });
}

async function amostras(qtdTerreiros) {
  // pares (terreiro, filho) e cobranças abertas para os cenários de escrita
  const casas = await db.many(
    `select t.id, (regexp_replace(t.email, '\\D', '', 'g'))::int as seq,
            (select f.id from filhos f where f.terreiro_id = t.id and f.status = 'ativo' limit 1) as filho
       from terreiros t where t.email like '%@carga.dev' order by (t.email = 'casa${GRANDE}@carga.dev') desc, random() limit 300`
  );
  const abertas = await db.many(`select gateway_id, valor_centavos from cobrancas where status = 'aberta' and gateway_id is not null order by random() limit 60000`);
  return { casas, abertas, qtdTerreiros };
}

function cenarios(a) {
  const casa = () => a.casas[Math.floor(Math.random() * a.casas.length)];
  const req = (fn) => ({ requests: [{ setupRequest: (r) => ({ ...r, ...fn() }) }] });
  let iPg = 0;
  const grande = a.casas.find((c) => c.seq === GRANDE) || { seq: GRANDE };
  return [
    ['Dashboard do sacerdote', req(() => { const c = casa(); return { method: 'GET', path: `/api/t/${c.id}/dashboard`, headers: bearer(vol.tokenSacerdote(c.seq)) }; })],
    ['Dashboard · casa de 300 filhos (RNF-07)', req(() => ({ method: 'GET', path: `/api/t/${grande.id}/dashboard`, headers: bearer(vol.tokenSacerdote(GRANDE)) }))],
    ['Lista de filhos', req(() => { const c = casa(); return { method: 'GET', path: `/api/t/${c.id}/filhos?status=ativo&limite=50`, headers: bearer(vol.tokenSacerdote(c.seq)) }; })],
    ['Cobranças vencidas', req(() => { const c = casa(); return { method: 'GET', path: `/api/t/${c.id}/cobrancas?situacao=vencida&limite=50`, headers: bearer(vol.tokenSacerdote(c.seq)) }; })],
    ['Início do filho', req(() => { const c = casa(); return { method: 'GET', path: `/api/t/${c.id}/meu/inicio`, headers: bearer(vol.tokenFilho(c.seq)) }; })],
    ['Mural do filho', req(() => { const c = casa(); return { method: 'GET', path: `/api/t/${c.id}/avisos?limite=30`, headers: bearer(vol.tokenFilho(c.seq)) }; })],
    ['Criar cobrança (escrita)', req(() => { const c = casa(); return { method: 'POST', path: `/api/t/${c.id}/cobrancas`, headers: bearer(vol.tokenSacerdote(c.seq)), body: JSON.stringify({ filho_id: c.filho, descricao: 'Carga', valor_centavos: 2500, vencimento: '2099-12-10' }) }; })],
    ['Webhook de pagamento (escrita)', req(() => {
      const p = a.abertas[iPg++ % a.abertas.length];
      const ev = simulado.eventoPagamento({ gatewayId: p.gateway_id, valorCentavos: p.valor_centavos, data: '2026-10-11' });
      return { method: 'POST', path: '/api/webhooks/gateway', headers: { 'content-type': 'application/json', 'asaas-access-token': 'token-de-carga-com-mais-de-32-caracteres-xyz' }, body: JSON.stringify(ev) };
    })],
    ['Métricas globais do admin', req(() => ({ method: 'GET', path: '/api/admin/metricas', headers: bearer('adm-carga') }))],
  ];
}

async function prepararAdmin() {
  const { hashSenha } = require('../src/auth');
  const u = await db.one(`insert into usuarios(nome, email, senha_hash, is_admin) values ('Admin carga', 'admin@carga.dev', $1, true) on conflict (email) do update set is_admin = true returning id`, [hashSenha('x-admin-123')]);
  await db.query(`insert into sessoes(token_hash, usuario_id, expira_em) values ($1, $2, now() + interval '30 days') on conflict do nothing`, [vol.sha('adm-carga'), u.id]);
}

async function main() {
  const inicio = Date.now();
  const CONTINUAR = 'continuar' in args; // retoma um teste interrompido sem apagar a massa já criada
  const arqRel = path.join(__dirname, '..', 'reports', 'carga.json');
  if (!CONTINUAR) await db.query('drop schema public cascade; create schema public;');
  await require('../src/server').preparar();
  await prepararAdmin();
  const ambiente = {
    cpus: os.cpus().length, modelo_cpu: os.cpus()[0]?.model, memoria_gb: Math.round(os.totalmem() / 1024 ** 3), node: process.version,
    postgres: (await db.one('show server_version')).server_version, shared_buffers: (await db.one('show shared_buffers')).shared_buffers,
    observacao: 'Servidor, banco e gerador de carga na mesma máquina; os números são um piso conservador.',
    duracao_cenario_s: DURACAO, conexoes: CONEXOES,
  };
  console.log('[carga] ambiente', JSON.stringify(ambiente));
  const anterior = CONTINUAR && fs.existsSync(arqRel) ? JSON.parse(fs.readFileSync(arqRel, 'utf8')) : null;
  const relatorio = anterior ? { ...anterior, ambiente } : { gerado_em: new Date().toISOString(), ambiente, degraus: [], rampa: [] };
  const salvar = () => {
    fs.mkdirSync(path.join(__dirname, '..', 'reports'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, '..', 'reports', 'carga.json'), JSON.stringify({ ...relatorio, duracao_total_s: Math.round((Date.now() - inicio) / 1000) }, null, 2));
  };

  // casa grande fixa (RNF-07: 300 filhos e 2 anos de histórico)
  if (!(await db.one(`select 1 from terreiros where email = 'casa${GRANDE}@carga.dev'`))) {
    await vol.semearTerreiros(GRANDE - 1, GRANDE, { filhos: 300, meses: 24, prefixo: 'Terreiro Grande' });
  }
  let atual = (await db.one(`select count(*)::int as n from terreiros where email like '%@carga.dev' and email <> 'casa${GRANDE}@carga.dev'`)).n;
  let servidor;
  const feitos = new Set(relatorio.degraus.map((d) => d.terreiros_carga - 1));
  for (const alvo of DEGRAUS) {
    const remedir = String(args.remedir || '').split(',').map(Number).includes(alvo);
    if (remedir) { console.log(`[carga] remedindo ${alvo}`); }
    else if (alvo < atual || feitos.has(alvo)) { console.log(`[carga] degrau ${alvo} já medido, pulando`); continue; }
    console.log(`\n[carga] degrau: ${alvo} terreiros × 100 filhos × 24 meses`);
    const ms = remedir ? 0 : await vol.semearTerreiros(atual, alvo, { filhos: 100, meses: 24 });
    atual = Math.max(atual, alvo);
    const contagem = await vol.contar();
    console.log('[carga] volume', JSON.stringify(contagem), `semeado em ${Math.round(ms / 1000)}s`);
    if (servidor) servidor.kill();
    servidor = await subirServidor();
    const a = await amostras(alvo);
    const resultados = [];
    for (const [nome, op] of cenarios(a)) {
      await medir(nome, { ...op, duration: 3 }); // aquecimento
      const r = await medir(nome, op);
      console.log(`  ${nome.padEnd(42)} ${String(r.rps).padStart(5)} req/s · p50 ${r.p50_ms}ms · p99 ${r.p99_ms}ms · erros ${r.erros} · não-2xx ${r.nao_2xx}`);
      resultados.push(r);
    }
    for (const r of resultados) if (r.nao_2xx > r.requisicoes * 0.01) console.warn(`  [aviso] ${r.cenario}: ${r.nao_2xx} respostas não-2xx — medição inválida`);
    relatorio.degraus = relatorio.degraus.filter((d) => d.terreiros_carga !== contagem.terreiros);
    relatorio.degraus.push({ terreiros: alvo + 1, ...contagem, terreiros_carga: contagem.terreiros, semeadura_s: Math.round(ms / 1000), cenarios: resultados });
    salvar();
  }

  if ('sem-rampa' in args) { if (servidor) servidor.kill(); salvar(); await db.close(); return; }
  // rampa de concorrência no maior volume: leitura mista (dashboard + início do filho)
  console.log('\n[carga] rampa de concorrência no maior volume');
  if (!servidor) servidor = await subirServidor();
  relatorio.rampa = [];
  const a = await amostras(atual);
  const [dash, , , , inicioFilho] = cenarios(a);
  for (const c of RAMPA) {
    const r1 = await medir(`${dash[0]} · ${c} conexões`, { ...dash[1], connections: c });
    const r2 = await medir(`${inicioFilho[0]} · ${c} conexões`, { ...inicioFilho[1], connections: c });
    console.log(`  ${String(c).padStart(4)} conexões · dashboard ${r1.rps} req/s p99 ${r1.p99_ms}ms · início filho ${r2.rps} req/s p99 ${r2.p99_ms}ms · erros ${r1.erros + r2.erros}`);
    relatorio.rampa.push({ conexoes: c, dashboard: r1, inicio_filho: r2 });
    salvar();
  }
  servidor.kill();
  salvar();
  await db.close();
  console.log(`\n[carga] concluído em ${Math.round((Date.now() - inicio) / 1000)}s → reports/carga.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
