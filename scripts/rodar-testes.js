'use strict';
// Roda as suítes (unitários, integração por história, interface, contrato) e grava reports/testes.json
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const REL = path.join(RAIZ, 'reports');
fs.mkdirSync(REL, { recursive: true });

const SUITES = [
  { id: 'unitarios', nome: 'Unitários', glob: 'test/unit/**/*.test.js' },
  { id: 'integracao', nome: 'Integração (histórias)', glob: 'test/api/**/*.test.js' },
  { id: 'interface', nome: 'Interface (PWA)', glob: 'test/ui/**/*.test.js' },
  { id: 'contrato', nome: 'Contrato (OpenAPI e gateway)', glob: 'test/contract/**/*.test.js' },
];

const pedidas = process.argv.slice(2);
const resultado = { gerado_em: new Date().toISOString(), suites: [] };
let falhou = false;

for (const s of SUITES.filter((x) => !pedidas.length || pedidas.includes(x.id))) {
  const arq = path.join(REL, `testes-${s.id}.json`);
  const ini = Date.now();
  const r = spawnSync(process.execPath, [
    '--test', '--test-concurrency=1',
    '--test-reporter=spec', '--test-reporter-destination=stdout',
    `--test-reporter=${path.join(__dirname, 'reporter-json.mjs')}`, `--test-reporter-destination=${arq}`,
    s.glob,
  ], { cwd: RAIZ, stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
  const testes = fs.existsSync(arq) ? JSON.parse(fs.readFileSync(arq, 'utf8')) : [];
  const ok = testes.filter((t) => t.ok).length;
  resultado.suites.push({ ...s, total: testes.length, passaram: ok, falharam: testes.length - ok, duracao_ms: Date.now() - ini, codigo_saida: r.status, testes });
  if (r.status !== 0) falhou = true;
}

// Mapeia testes às histórias (US-xx) para o painel
const historias = {};
for (const s of resultado.suites) for (const t of s.testes) {
  const m = t.nome.match(/^(US-\d{2})/);
  if (m) historias[m[1]] = { ok: t.ok, teste: t.nome, suite: s.id };
}
resultado.historias = historias;
const ant = fs.existsSync(path.join(REL, 'testes.json')) ? JSON.parse(fs.readFileSync(path.join(REL, 'testes.json'), 'utf8')) : null;
if (ant && pedidas.length) {
  for (const s of ant.suites) if (!resultado.suites.find((x) => x.id === s.id)) resultado.suites.push(s);
  resultado.historias = { ...ant.historias, ...historias };
}
fs.writeFileSync(path.join(REL, 'testes.json'), JSON.stringify(resultado, null, 2));

// Histórico de execuções (alimenta a evolução no painel)
const arqHist = path.join(REL, 'historico.json');
const hist = fs.existsSync(arqHist) ? JSON.parse(fs.readFileSync(arqHist, 'utf8')) : [];
hist.push({
  em: resultado.gerado_em, suites: pedidas.length ? pedidas : SUITES.map((s) => s.id),
  ...Object.fromEntries(resultado.suites.filter((s) => !pedidas.length || pedidas.includes(s.id)).map((s) => [s.id, { total: s.total, passaram: s.passaram }])),
});
fs.writeFileSync(arqHist, JSON.stringify(hist, null, 2));
const tot = resultado.suites.reduce((a, s) => [a[0] + s.passaram, a[1] + s.total], [0, 0]);
console.log(`\n== ${tot[0]}/${tot[1]} testes passaram · ${Object.keys(resultado.historias).length} histórias cobertas · relatório em reports/testes.json`);
process.exit(falhou ? 1 : 0);
