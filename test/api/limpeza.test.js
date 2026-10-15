'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');

describe('Manutenção · limpeza única da base', () => {
  before(h.subir);
  after(h.descer);

  it('MAN-01: apaga terreiros, filhos e cobranças, mantém admin e planos, e roda uma vez só', async () => {
    const ctx = await h.terreiroPronto({ mensalidade: { ativa: true, valor_centavos: 5000, gerar_agora: true } });
    await h.filhoComAcesso(ctx.sac, ctx.tid);
    const { limparSePedido } = require('../../src/services/limpeza');
    process.env.LIMPAR_BASE = 'teste-1';
    const antes = await limparSePedido();
    assert.ok(antes.terreiros >= 1 && antes.filhos >= 1);
    const c = await h.db.one(`select (select count(*) from terreiros)::int t, (select count(*) from filhos)::int f, (select count(*) from cobrancas)::int c,
      (select count(*) from usuarios)::int u, (select count(*) from usuarios where is_admin)::int a, (select count(*) from planos)::int p`);
    assert.deepEqual([c.t, c.f, c.c], [0, 0, 0]);
    assert.equal(c.u, c.a);
    assert.ok(c.a >= 1 && c.p === 3);
    assert.equal(await limparSePedido(), null, 'mesmo código não roda de novo');
    delete process.env.LIMPAR_BASE;
    const adm = await h.loginAdmin();
    assert.equal((await adm.get('/api/admin/terreiros')).body.total, 0);
  });
});
