'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');

describe('Segurança, isolamento e LGPD', () => {
  let admin;
  before(async () => { await h.subir(); admin = await h.loginAdmin(); });
  after(h.descer);

  it('RN-01: Sacerdote de uma casa não enxerga nada de outra', async () => {
    const a = await h.terreiroPronto({ admin });
    const b = await h.terreiroPronto({ admin });
    const fb = await h.novoFilho(b.sac, b.tid);
    assert.equal((await a.sac.get(`/api/t/${b.tid}`)).status, 404);
    assert.equal((await a.sac.get(`/api/t/${b.tid}/filhos`)).status, 404);
    assert.equal((await a.sac.get(`/api/t/${a.tid}/filhos/${fb.id}`)).status, 404, 'id de outra casa pelo caminho da própria');
    const c = await a.sac.post(`/api/t/${a.tid}/cobrancas`, { filho_id: fb.id, descricao: 'x', valor_centavos: 1000, vencimento: '2099-01-01' });
    assert.equal(c.status, 400, 'não cobra filho de outra casa');
  });

  it('RN-07: Filho só vê os próprios dados; dados espirituais em modo leitura', async () => {
    const { tid, sac } = await h.terreiroPronto({ admin });
    const f = await h.filhoComAcesso(sac, tid, { pai_cabeca: 'Ogum' });
    const perfil = await f.api.get(`/api/t/${tid}/meu/perfil`);
    assert.equal(perfil.body.pai_cabeca, 'Ogum');
    assert.equal((await f.api.patch(`/api/t/${tid}/meu/perfil`, { pai_cabeca: 'Xangô' })).status, 403);
    assert.equal((await f.api.patch(`/api/t/${tid}/meu/perfil`, { nome_santo: 'Filha de Ogum' })).status, 200);
    assert.equal((await f.api.get(`/api/t/${tid}/dashboard`)).status, 403);
    assert.equal((await f.api.post(`/api/t/${tid}/avisos`, { titulo: 'x' })).status, 403);
  });

  it('LGPD: filho baixa os próprios dados e revoga o consentimento religioso', async () => {
    const { tid, sac } = await h.terreiroPronto({ admin });
    const f = await h.filhoComAcesso(sac, tid, { pai_cabeca: 'Ogum', mae_cabeca: 'Iansã' });
    const dados = await f.api.get(`/api/t/${tid}/meu/dados`);
    assert.equal(dados.status, 200);
    assert.equal(dados.body.perfil.id, f.filho.id);
    await f.api.post(`/api/t/${tid}/meu/consentimento`, { religioso: false });
    const p = (await f.api.get(`/api/t/${tid}/meu/perfil`)).body;
    assert.equal(p.pai_cabeca, null);
    assert.equal(p.consentimento_religioso, false);
    assert.equal((await f.api.post(`/api/t/${tid}/meu/pedido-exclusao`, { motivo: 'Saí da casa' })).status, 202);
  });

  it('RF-14: Auxiliar tem só as permissões que o sacerdote liberar', async () => {
    const { tid, sac } = await h.terreiroPronto({ admin });
    const aux = await sac.post(`/api/t/${tid}/auxiliares`, { nome: 'Ogã Pedro', email: `oga${Date.now()}@teste.dev` });
    assert.equal(aux.status, 201);
    const ac = await h.req('POST', '/api/convites/aceitar', { corpo: { token: h.tokenDoLink(aux.body.convite.link), senha: 'senha-aux-12' } });
    const api = h.cliente(ac.body.token);
    assert.equal((await api.get(`/api/t/${tid}/filhos`)).status, 200, 'filhos liberado por padrão');
    assert.equal((await api.get(`/api/t/${tid}/cobrancas`)).status, 403, 'financeiro bloqueado por padrão');
    await sac.patch(`/api/t/${tid}/auxiliares/${aux.body.id}`, { permissoes: { financeiro: true } });
    assert.equal((await api.get(`/api/t/${tid}/cobrancas`)).status, 200);
    const f = await h.novoFilho(sac, tid);
    assert.equal((await api.post(`/api/t/${tid}/filhos/${f.id}/bloquear`)).status, 403, 'bloquear é só do sacerdote');
    assert.equal((await api.patch(`/api/t/${tid}/filhos/${f.id}`, { pai_cabeca: 'Oxalá' })).status, 403, 'dados espirituais só o sacerdote');
  });

  it('RNF-04: Login bloqueia por 15 minutos após 5 tentativas erradas', async () => {
    const { email } = await h.terreiroPronto({ admin });
    for (let i = 0; i < 5; i++) {
      const r = await h.req('POST', '/api/auth/login', { corpo: { identificador: email, senha: 'errada' } });
      assert.equal(r.status, 401);
    }
    const certa = await h.req('POST', '/api/auth/login', { corpo: { identificador: email, senha: 'senha-forte-1' } });
    assert.equal(certa.status, 401);
    assert.match(certa.body.erro.mensagem, /Muitas tentativas/);
  });

  it('RF-07: Admin só entra no terreiro com consentimento do sacerdote', async () => {
    const { tid, sac } = await h.terreiroPronto({ admin });
    assert.equal((await admin.get(`/api/t/${tid}`)).status, 404);
    await sac.post(`/api/t/${tid}/assinatura/consentir-suporte`, { horas: 2 });
    assert.equal((await admin.get(`/api/t/${tid}`)).status, 200);
    const aud = (await sac.get(`/api/t/${tid}/auditoria`)).body;
    assert.ok(aud.some((a) => a.acao === 'suporte_consentido'));
  });

  it('Entradas inválidas retornam 400/404, nunca 500', async () => {
    const { tid, sac } = await h.terreiroPronto({ admin });
    const casos = [
      await sac.get(`/api/t/${tid}/filhos/nao-e-uuid`),
      await sac.get(`/api/t/nao-e-uuid/filhos`),
      await sac.post(`/api/t/${tid}/cobrancas`, { filho_id: 'x', valor_centavos: 'abc' }),
      await sac.get(`/api/t/${tid}/eventos?de=ontem`),
      await sac.post(`/api/t/${tid}/eventos`, { tipo: 'gira', titulo: 'x', inicio: 'amanhã' }),
      await h.req('POST', '/api/auth/login', { corpo: {} }),
      await sac.get(`/api/t/${tid}/dashboard?competencia=2026-13x`),
    ];
    for (const c of casos) assert.ok(c.status >= 400 && c.status < 500, `status ${c.status}: ${JSON.stringify(c.body)}`);
  });
});
