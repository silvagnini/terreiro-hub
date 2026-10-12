'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');

before(h.subir);
after(h.descer);

describe('E6 · Cobranças', () => {
  let admin;
  before(async () => { admin = await h.loginAdmin(); });

  it('US-22: Mensalidade configurada uma vez é gerada todo mês, sem duplicar, com entrada proporcional', async () => {
    h.relogio.fixar('2026-04-01');
    const { tid, sac } = await h.terreiroPronto({ admin });
    const a = await h.novoFilho(sac, tid, { data_entrada: '2026-01-10' });
    const b = await h.novoFilho(sac, tid, { data_entrada: '2026-03-15' });
    await sac.put(`/api/t/${tid}/mensalidade`, { ativa: true, valor_centavos: 6000, dia_geracao: 1, dia_vencimento: 10, entrada: 'proporcional' });
    const r1 = await admin.post('/api/admin/rotinas/rodar', {});
    assert.ok(r1.body.mensalidades.geradas >= 2);
    const r2 = await admin.post('/api/admin/rotinas/rodar', {});
    assert.equal(r2.body.mensalidades.geradas, 0, 'idempotente no mesmo mês');
    const ca = (await sac.get(`/api/t/${tid}/cobrancas?filho_id=${a.id}&origem=mensalidade`)).body.itens;
    assert.equal(ca.length, 1);
    assert.equal(ca[0].vencimento, '2026-04-10');
    assert.equal(ca[0].valor_centavos, 6000);
    // entra no meio do mês: proporcional aos dias restantes
    h.relogio.fixar('2026-05-01');
    const c = await h.novoFilho(sac, tid, { data_entrada: '2026-05-16' });
    h.relogio.fixar('2026-05-20');
    await admin.post('/api/admin/rotinas/rodar', {});
    const cc = (await sac.get(`/api/t/${tid}/cobrancas?filho_id=${c.id}&origem=mensalidade`)).body.itens;
    assert.equal(cc.length, 1);
    assert.equal(cc[0].valor_centavos, Math.round((6000 * 16) / 31), 'maio tem 31 dias, entra dia 16 → 16 dias');
    assert.equal(cc[0].vencimento, '2026-05-20', 'vencimento não fica no passado');
    assert.ok(b.id);
    h.relogio.limpar();
  });

  it('US-23: Lote com prévia; cada filho recebe cobrança independente', async () => {
    const { tid, sac } = await h.terreiroPronto({ admin });
    const fs = [];
    for (let i = 0; i < 4; i++) fs.push(await h.novoFilho(sac, tid));
    await sac.patch(`/api/t/${tid}/filhos/${fs[3].id}/financeiro`, { isento: true });
    const prev = await sac.post(`/api/t/${tid}/lotes/previa`, { valor_centavos: 4000 });
    assert.equal(prev.body.quantidade, 3);
    assert.equal(prev.body.total_centavos, 12000);
    assert.equal(prev.body.isentos_excluidos, 1);
    const lote = await sac.post(`/api/t/${tid}/lotes`, { descricao: 'Festa de Iemanjá', valor_centavos: 4000, vencimento: '2099-11-30' });
    assert.equal(lote.status, 201);
    assert.equal(lote.body.quantidade, 3);
    const cobs = (await sac.get(`/api/t/${tid}/cobrancas?lote_id=${lote.body.id}`)).body.itens;
    assert.equal(cobs.length, 3);
    await sac.post(`/api/t/${tid}/cobrancas/${cobs[0].id}/cancelar`, { motivo: 'Erro' });
    const depois = (await sac.get(`/api/t/${tid}/cobrancas?lote_id=${lote.body.id}`)).body.itens;
    assert.equal(depois.filter((c) => c.status === 'aberta').length, 2, 'cancelar uma não afeta as outras');
    assert.equal((await sac.post(`/api/t/${tid}/lotes`, { descricao: 'x', valor_centavos: 100, vencimento: '2020-01-01' })).status, 400);
  });

  it('US-24: Trabalho individual cria evento, cobrança e aviso ligados; cancelar pergunta pela cobrança', async () => {
    const { tid, sac } = await h.terreiroPronto({ admin });
    const f = await h.filhoComAcesso(sac, tid);
    const r = await sac.post(`/api/t/${tid}/trabalhos`, { filho_id: f.filho.id, nome: 'Bori', valor_centavos: 35000, data: '2099-10-18T09:00:00-03:00', preceitos: 'Resguardo de 3 dias. Trazer roupa branca.' });
    assert.equal(r.status, 201);
    assert.equal(r.body.evento.tipo, 'trabalho');
    assert.equal(r.body.cobrancas[0].trabalho_id, r.body.trabalho.id);
    assert.equal(r.body.cobrancas[0].vencimento, '2099-10-17');
    assert.equal(r.body.trabalho.evento_id, r.body.evento.id);
    const avisosFilho = (await f.api.get(`/api/t/${tid}/avisos`)).body;
    const privado = avisosFilho.find((a) => a.id === r.body.aviso.id);
    assert.ok(privado, 'aviso privado chegou ao filho');
    assert.deepEqual(privado.preceitos, ['Resguardo de 3 dias', 'Trazer roupa branca']);
    const outro = await h.filhoComAcesso(sac, tid);
    assert.ok(!(await outro.api.get(`/api/t/${tid}/avisos`)).body.some((a) => a.id === r.body.aviso.id), 'outro filho não vê');
    assert.ok(!(await sac.get(`/api/t/${tid}/avisos`)).body.some((a) => a.id === r.body.aviso.id), 'aviso privado não polui o mural');
    assert.equal((await sac.post(`/api/t/${tid}/trabalhos/${r.body.trabalho.id}/cancelar`, {})).status, 400);
    const c = await sac.post(`/api/t/${tid}/trabalhos/${r.body.trabalho.id}/cancelar`, { cancelar_cobranca: true });
    assert.equal(c.body.cobrancas_canceladas, 1);
    const parc = await sac.post(`/api/t/${tid}/trabalhos`, { filho_id: f.filho.id, nome: 'Feitura', valor_centavos: 300000, parcelas: 6, data: '2099-12-01T08:00:00-03:00' });
    assert.equal(parc.body.cobrancas.length, 6, 'parcelamento em 6x');
    assert.equal(parc.body.cobrancas.reduce((s, x) => s + x.valor_centavos, 0), 300000);
  });

  it('US-25: Baixa manual em dinheiro, registrada na auditoria', async () => {
    const { tid, sac } = await h.terreiroPronto({ admin });
    const f = await h.novoFilho(sac, tid);
    const c = await sac.post(`/api/t/${tid}/cobrancas`, { filho_id: f.id, descricao: 'Mensalidade', valor_centavos: 5000, vencimento: '2099-01-10' });
    const b = await sac.post(`/api/t/${tid}/cobrancas/${c.body.id}/baixa`, { data: '2026-10-05', forma: 'dinheiro', comprovante_url: 'https://exemplo.dev/foto.jpg' });
    assert.equal(b.status, 200);
    assert.equal(b.body.status, 'paga');
    assert.equal(b.body.forma_pagamento, 'dinheiro');
    assert.ok(b.body.recibo_numero > 0);
    const aud = (await sac.get(`/api/t/${tid}/auditoria`)).body;
    assert.ok(aud.some((a) => a.acao === 'baixa_manual' && a.entidade_id === c.body.id));
    assert.equal((await sac.post(`/api/t/${tid}/cobrancas/${c.body.id}/baixa`, {})).status, 422, 'não dá baixa duas vezes');
  });

  it('US-26: Cancelamento exige motivo; paga só pode ser estornada', async () => {
    const { tid, sac } = await h.terreiroPronto({ admin });
    const f = await h.novoFilho(sac, tid);
    const c = await sac.post(`/api/t/${tid}/cobrancas`, { filho_id: f.id, descricao: 'Ebó', valor_centavos: 9000, vencimento: '2099-01-10' });
    assert.equal((await sac.post(`/api/t/${tid}/cobrancas/${c.body.id}/cancelar`, {})).status, 400);
    await h.pagarNoSimulador(c.body.gateway_id);
    const canc = await sac.post(`/api/t/${tid}/cobrancas/${c.body.id}/cancelar`, { motivo: 'erro' });
    assert.equal(canc.status, 422);
    const est = await sac.post(`/api/t/${tid}/cobrancas/${c.body.id}/estornar`, { motivo: 'Trabalho não realizado' });
    assert.equal(est.body.status, 'estornada');
    await assert.rejects(h.db.query('delete from auditoria'), /somente inserção/, 'auditoria é imutável');
  });

  it('US-27: Isenção e desconto aplicados na mensalidade', async () => {
    h.relogio.fixar('2026-06-02');
    const { tid, sac } = await h.terreiroPronto({ admin });
    const isento = await h.novoFilho(sac, tid, { data_entrada: '2026-01-01' });
    const comDesconto = await h.novoFilho(sac, tid, { data_entrada: '2026-01-01' });
    await sac.patch(`/api/t/${tid}/filhos/${isento.id}/financeiro`, { isento: true });
    const d = await sac.patch(`/api/t/${tid}/filhos/${comDesconto.id}/financeiro`, { desconto: { tipo: 'percentual', valor: 10 } });
    assert.deepEqual(d.body.desconto, { tipo: 'percentual', valor: 10 });
    assert.equal((await sac.patch(`/api/t/${tid}/filhos/${isento.id}/financeiro`, { desconto: { tipo: 'percentual', valor: 150 } })).status, 400);
    await sac.put(`/api/t/${tid}/mensalidade`, { ativa: true, valor_centavos: 5000, gerar_agora: true });
    const ci = (await sac.get(`/api/t/${tid}/cobrancas?filho_id=${isento.id}`)).body.itens;
    const cd = (await sac.get(`/api/t/${tid}/cobrancas?filho_id=${comDesconto.id}`)).body.itens;
    assert.equal(ci.length, 0, 'isento não recebe mensalidade');
    assert.equal(cd[0].desconto_centavos, 500);
    assert.equal(cd[0].valor_final_centavos, 4500);
    h.relogio.limpar();
  });
});

describe('E7–E9 · Pagamento, dashboard e área do filho', () => {
  let admin;
  before(async () => { admin = await h.loginAdmin(); });

  it('US-28: Filho paga por Pix; webhook dá baixa, emite recibo e não duplica', async () => {
    const { tid, sac } = await h.terreiroPronto({ admin });
    const f = await h.filhoComAcesso(sac, tid);
    const c = await sac.post(`/api/t/${tid}/cobrancas`, { filho_id: f.filho.id, descricao: 'Bori', valor_centavos: 35000, vencimento: '2099-01-10' });
    const minha = (await f.api.get(`/api/t/${tid}/meu/cobrancas/${c.body.id}`)).body;
    assert.match(minha.pix_copia_cola, /^000201.*6304[0-9A-F]{4}$/);
    assert.ok(minha.boleto_linha);
    const t0 = Date.now();
    const pg = await h.pagarNoSimulador(c.body.gateway_id);
    assert.equal(pg.status, 200);
    const depois = (await f.api.get(`/api/t/${tid}/meu/cobrancas/${c.body.id}`)).body;
    assert.equal(depois.status, 'paga');
    assert.ok(Date.now() - t0 < 60000, 'baixa em menos de 1 minuto');
    const recibo = await f.api.get(`/api/t/${tid}/meu/cobrancas/${c.body.id}/recibo`);
    assert.equal(recibo.status, 200);
    assert.equal(recibo.body.valor_centavos, 35000);
    const repetido = await h.req('POST', '/api/webhooks/gateway', { corpo: pg.body.evento, headers: { 'asaas-access-token': 'token-webhook-teste' } });
    assert.equal(repetido.body.duplicado, true, 'webhook repetido não duplica');
    const final = (await f.api.get(`/api/t/${tid}/meu/cobrancas/${c.body.id}`)).body;
    assert.equal(final.recibo_numero, depois.recibo_numero);
    const semToken = await h.req('POST', '/api/webhooks/gateway', { corpo: pg.body.evento });
    assert.equal(semToken.status, 401, 'webhook sem token é recusado');
  });

  it('US-29: Dashboard bate com a soma de cobranças e despesas do mês', async () => {
    const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const comp = hoje.slice(0, 7);
    const { tid, sac } = await h.terreiroPronto({ admin });
    const f1 = await h.novoFilho(sac, tid);
    const f2 = await h.novoFilho(sac, tid);
    const pagas = [10000, 2500];
    for (const v of pagas) {
      const c = await sac.post(`/api/t/${tid}/cobrancas`, { filho_id: f1.id, descricao: 'x', valor_centavos: v, vencimento: '2099-01-01' });
      await h.pagarNoSimulador(c.body.gateway_id);
    }
    await sac.post(`/api/t/${tid}/cobrancas`, { filho_id: f2.id, descricao: 'atrasada', valor_centavos: 7000, vencimento: '2020-01-01' });
    await sac.post(`/api/t/${tid}/despesas`, { categoria: 'velas', valor_centavos: 3000 });
    await sac.post(`/api/t/${tid}/despesas`, { categoria: 'luz', valor_centavos: 1500 });
    const d = (await sac.get(`/api/t/${tid}/dashboard?competencia=${comp}`)).body;
    assert.equal(d.recebido_centavos, 12500);
    assert.equal(d.em_atraso_centavos, 7000);
    assert.equal(d.filhos_em_atraso, 1);
    assert.equal(d.despesas_centavos, 4500);
    assert.equal(d.saldo_centavos, 8000);
    assert.equal(d.serie.length, 12);
    assert.equal(d.inadimplentes[0].id, f2.id);
    const csv = await h.req('GET', `/api/t/${tid}/relatorios/cobrancas.csv?de=2020-01-01&ate=2099-12-31`, { token: sac.token });
    assert.equal(csv.status, 200);
    assert.equal(String(csv.body).trim().split('\n').length, 4, 'cabeçalho + 3 cobranças');
  });

  it('US-30: Início do filho mostra só os dados dele, com vencidas em destaque', async () => {
    const { tid, sac } = await h.terreiroPronto({ admin });
    const a = await h.filhoComAcesso(sac, tid);
    const b = await h.filhoComAcesso(sac, tid);
    await sac.post(`/api/t/${tid}/cobrancas`, { filho_id: a.filho.id, descricao: 'Vencida', valor_centavos: 5000, vencimento: '2020-01-10' });
    await sac.post(`/api/t/${tid}/cobrancas`, { filho_id: a.filho.id, descricao: 'A vencer', valor_centavos: 3000, vencimento: '2099-01-10' });
    const cb = await sac.post(`/api/t/${tid}/cobrancas`, { filho_id: b.filho.id, descricao: 'Do B', valor_centavos: 1000, vencimento: '2099-01-10' });
    await sac.post(`/api/t/${tid}/eventos`, { tipo: 'gira', titulo: 'Próxima gira', inicio: '2099-01-02T19:30:00-03:00' });
    const ini = (await a.api.get(`/api/t/${tid}/meu/inicio`)).body;
    assert.equal(ini.pendencias.quantidade, 2);
    assert.equal(ini.pendencias.vencidas, 1);
    assert.equal(ini.pendencias.total_centavos, 8000);
    assert.equal(ini.proximo_compromisso.titulo, 'Próxima gira');
    assert.equal((await a.api.get(`/api/t/${tid}/meu/cobrancas/${cb.body.id}`)).status, 404, 'não vê cobrança de outro filho');
    assert.equal((await a.api.get(`/api/t/${tid}/filhos`)).status, 403, 'filho não lista a corrente');
    assert.equal((await a.api.get(`/api/t/${tid}/cobrancas`)).status, 403);
  });
});
