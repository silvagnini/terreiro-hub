'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');

before(h.subir);
after(h.descer);
const { TEXTO_NEUTRO } = require('../../src/services/base');

describe('E4 · Mural e avisos', () => {
  let admin, ctx;
  before(async () => { admin = await h.loginAdmin(); ctx = await h.terreiroPronto({ admin }); });

  it('US-16: Aviso para filhos específicos; fixado fica no topo até a validade', async () => {
    const { tid, sac } = ctx;
    const a = await h.filhoComAcesso(sac, tid);
    const b = await h.filhoComAcesso(sac, tid);
    await sac.post(`/api/t/${tid}/avisos`, { titulo: 'Só para a A', publico: { tipo: 'filhos', ids: [a.filho.id] } });
    await sac.post(`/api/t/${tid}/avisos`, { titulo: 'Fixado geral', fixado: true, valido_ate: '2099-12-31' });
    await sac.post(`/api/t/${tid}/avisos`, { titulo: 'Recente geral' });
    await sac.post(`/api/t/${tid}/avisos`, { titulo: 'Já expirou', valido_ate: '2020-01-01' });
    const va = (await a.api.get(`/api/t/${tid}/avisos`)).body.map((x) => x.titulo);
    const vb = (await b.api.get(`/api/t/${tid}/avisos`)).body.map((x) => x.titulo);
    assert.equal(va[0], 'Fixado geral', 'fixado no topo');
    assert.ok(va.includes('Só para a A') && !vb.includes('Só para a A'), 'quem não está no público não vê');
    assert.ok(!va.includes('Já expirou'), 'aviso vencido some para o filho');
    const lido = (await a.api.get(`/api/t/${tid}/avisos`)).body.find((x) => x.titulo === 'Recente geral');
    await a.api.post(`/api/t/${tid}/avisos/${lido.id}/lido`);
    const leituras = (await sac.get(`/api/t/${tid}/avisos/${lido.id}/leituras`)).body;
    assert.equal(leituras.lidos, 1);
    assert.equal(leituras.total, 2);
  });

  it('US-17: Comunicado de gira pela agenda com confirmação de presença em tempo real', async () => {
    const { tid, sac } = ctx;
    const g = await sac.post(`/api/t/${tid}/eventos`, { tipo: 'gira', titulo: 'Gira de Caboclo', inicio: '2099-10-17T19:30:00-03:00' });
    const evento = g.body.eventos[0];
    const com = await sac.post(`/api/t/${tid}/eventos/${evento.id}/comunicar`, { preceitos: ['Roupa branca', 'Chegar às 19h'] });
    assert.equal(com.status, 201);
    assert.equal(com.body.categoria, 'gira');
    assert.deepEqual(com.body.preceitos, ['Roupa branca', 'Chegar às 19h']);
    const f1 = await h.filhoComAcesso(sac, tid);
    const f2 = await h.filhoComAcesso(sac, tid);
    assert.equal((await f1.api.post(`/api/t/${tid}/eventos/${evento.id}/presenca`, { resposta: 'vou' })).status, 200);
    await f2.api.post(`/api/t/${tid}/eventos/${evento.id}/presenca`, { resposta: 'nao_vou' });
    await f2.api.post(`/api/t/${tid}/eventos/${evento.id}/presenca`, { resposta: 'vou' });
    const p = (await sac.get(`/api/t/${tid}/eventos/${evento.id}/presencas`)).body;
    assert.equal(p.vou, 2, 'mudança de resposta conta uma vez');
    assert.equal(p.nao_vou, 0);
    assert.ok(p.sem_resposta >= 2);
  });

  it('US-18: Notificação push tem texto neutro, sem termos religiosos', async () => {
    const { tid, sac } = ctx;
    const f = await h.filhoComAcesso(sac, tid);
    await sac.post(`/api/t/${tid}/avisos`, { titulo: 'Obrigação de Oxum no sábado', publico: { tipo: 'filhos', ids: [f.filho.id] } });
    const notifs = await h.db.many('select titulo, texto from notificacoes where filho_id = $1', [f.filho.id]);
    assert.ok(notifs.length >= 1);
    for (const n of notifs) {
      assert.doesNotMatch(n.titulo + n.texto, /oxum|obriga|gira|orix|santo|terreiro|bori|eb[oó]/i);
    }
    assert.ok(notifs.some((n) => n.texto === TEXTO_NEUTRO.aviso.texto));
  });
});

describe('E5 · Agenda', () => {
  let admin, ctx;
  before(async () => { admin = await h.loginAdmin(); ctx = await h.terreiroPronto({ admin }); });

  it('US-19: Calendário traz giras, trabalhos, búzios e festas com cor por tipo', async () => {
    const { tid, sac } = ctx;
    await sac.post(`/api/t/${tid}/eventos`, { tipo: 'gira', titulo: 'Gira', inicio: '2099-03-06T19:30:00-03:00' });
    await sac.post(`/api/t/${tid}/eventos`, { tipo: 'festa', titulo: 'Festa de Iemanjá', inicio: '2099-03-07T15:00:00-03:00' });
    const f = await h.novoFilho(sac, tid);
    await sac.post(`/api/t/${tid}/trabalhos`, { filho_id: f.id, nome: 'Bori', valor_centavos: 35000, data: '2099-03-08T09:00:00-03:00' });
    const ev = (await sac.get(`/api/t/${tid}/eventos?de=2099-03-01&ate=2099-03-31`)).body;
    assert.deepEqual([...new Set(ev.map((e) => e.tipo))].sort(), ['festa', 'gira', 'trabalho']);
    assert.ok(ev.every((e) => /^#[0-9A-F]{6}$/i.test(e.cor)));
    assert.equal(ev.find((e) => e.tipo === 'trabalho').filho_nome, f.nome_civil);
  });

  it('US-20: Gira recorrente semanal e cancelamento de uma data só', async () => {
    const { tid, sac } = ctx;
    const r = await sac.post(`/api/t/${tid}/eventos`, {
      tipo: 'gira', titulo: 'Gira de sexta', inicio: '2099-05-01T19:30:00-03:00', fim: '2099-05-01T22:30:00-03:00', recorrencia: { freq: 'semanal', ate: '2099-05-29' },
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.quantidade, 5);
    const segunda = r.body.eventos[1];
    assert.equal((await sac.post(`/api/t/${tid}/eventos/${segunda.id}/cancelar`, {})).body.cancelados, 1);
    const lista = (await sac.get(`/api/t/${tid}/eventos?de=2099-05-01&ate=2099-05-31&tipo=gira`)).body;
    assert.equal(lista.filter((e) => !e.cancelado).length, 4);
    const terceira = r.body.eventos[2];
    assert.equal((await sac.post(`/api/t/${tid}/eventos/${terceira.id}/cancelar`, { serie: true })).body.cancelados, 3, 'esta e as próximas');
  });

  it('US-21: Búzios com horários disponíveis, sem dupla marcação e com datas bloqueadas', async () => {
    const { tid, sac } = ctx;
    // 2099-06-01 é segunda-feira (dia 1)
    await sac.post(`/api/t/${tid}/buzios/disponibilidade`, { dia_semana: 1, hora_inicio: '09:00', hora_fim: '12:00', duracao_min: 60, valor_centavos: 15000 });
    const horas = (await sac.get(`/api/t/${tid}/buzios/horarios?data=2099-06-01`)).body;
    assert.equal(horas.length, 3);
    const a = await sac.post(`/api/t/${tid}/buzios/agendar`, { inicio: horas[0].inicio, consulente: { nome: 'Maria Consulente', telefone: '11999990000' } });
    assert.equal(a.status, 201);
    assert.equal(a.body.cobranca.valor_centavos, 15000);
    const dup = await sac.post(`/api/t/${tid}/buzios/agendar`, { inicio: horas[0].inicio, consulente: { nome: 'Outra' } });
    assert.equal(dup.status, 409, 'horário ocupado não aceita segunda marcação');
    assert.equal((await sac.get(`/api/t/${tid}/buzios/horarios?data=2099-06-01`)).body.length, 2);
    await sac.post(`/api/t/${tid}/buzios/bloqueios`, { data: '2099-06-08' });
    assert.equal((await sac.get(`/api/t/${tid}/buzios/horarios?data=2099-06-08`)).body.length, 0);
    const bloq = await sac.post(`/api/t/${tid}/buzios/agendar`, { inicio: '2099-06-08T09:00:00-03:00', consulente: { nome: 'X' } });
    assert.equal(bloq.status, 422);
    const f = await h.filhoComAcesso(sac, tid);
    const pelo = await f.api.post(`/api/t/${tid}/buzios/agendar`, { inicio: horas[1].inicio });
    assert.equal(pelo.status, 201, 'filho agenda para si mesmo');
    assert.equal(pelo.body.evento.filho_id, f.filho.id);
  });
});
