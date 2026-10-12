'use strict';
// Lista todas as rotas registradas no Express (usado pelo teste de cobertura do contrato OpenAPI)
function caminhoDoMount(layer) {
  let s = layer.regexp.source;
  s = s.replace(/^\^/, '').replace(/\\\/\?\(\?=\\\/\|\$\)$/, '').replace(/\(\?=\\\/\|\$\)$/, '');
  let i = 0;
  s = s.replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, () => ':' + (layer.keys[i++]?.name || 'p'));
  return s.replace(/\\\//g, '/');
}

function listarRotas(app) {
  const out = [];
  (function andar(stack, prefixo) {
    for (const l of stack) {
      if (l.route) {
        for (const m of Object.keys(l.route.methods)) out.push({ metodo: m.toUpperCase(), caminho: (prefixo + l.route.path).replace(/\/$/, '') || '/' });
      } else if (l.name === 'router' && l.handle.stack) {
        andar(l.handle.stack, prefixo + caminhoDoMount(l));
      }
    }
  })(app._router.stack, '');
  return out
    .filter((r) => r.caminho.startsWith('/api'))
    .map((r) => ({ ...r, caminho: (r.caminho.replace(/^\/api/, '') || '/').replace('/t(?:/([^/]+?))', '/t/:tid') }));
}

if (require.main === module) {
  process.env.RODAR_ROTINAS = 'false';
  const { criarApp } = require('../src/app');
  const rotas = listarRotas(criarApp());
  console.log(rotas.length + ' rotas');
  for (const r of rotas) console.log(r.metodo.padEnd(7), r.caminho);
}

module.exports = { listarRotas };
