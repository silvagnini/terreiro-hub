'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');

before(h.subir);
after(h.descer);

describe('E2 · Configuração do terreiro', () => {
  let admin;
  before(async () => { admin = await h.loginAdmin(); });

  it('US-06: Assistente de primeiro acesso com 4 etapas que podem ser puladas', async () => {
    const { tid, sac } = await h.terreiroPronto({ admin, aprovarConta: false });
    const t = (await sac.get(`/api/t/${tid}`)).body;
    assert.deepEqual(t.onboarding.etapas, ['dados_casa', 'tradicao', 'mensalidade', 'conta_recebimento']);
    const pulou = await sac.post(`/api/t/${tid}/onboarding`, { etapa: 'tradicao', situacao: 'pulada' });
    assert.equal(pulou.body.tradicao, 'pulada');
    assert.equal(pulou.body.concluido, false);
    await sac.patch(`/api/t/${tid}`, { nome: 'Tenda Nova', tradicao: 'Umbanda', cor: '#6B4FA0' });
    for (const e of ['dados_casa', 'tradicao']) await sac.post(`/api/t/${tid}/onboarding`, { etapa: e, situacao: 'feita' });
    await sac.put(`/api/t/${tid}/mensalidade`, { ativa: true, valor_centavos: 5000 });
    const fim = await sac.post(`/api/t/${tid}/onboarding`, { etapa: 'conta_recebimento', situacao: 'feita' });
    assert.equal(fim.body.concluido, true);
  });

  it('US-07: Sem conta aprovada a cobrança fica aguardando; ao aprovar ela é enviada', async () => {
    const { tid, sac, n } = await h.terreiroPronto({ admin, aprovarConta: false });
    const f = await h.novoFilho(sac, tid);
    const c = await sac.post(`/api/t/${tid}/cobrancas`, { filho_id: f.id, descricao: 'Amaci', valor_centavos: 8000, vencimento: '2099-01-10' });
    assert.equal(c.status, 201);
    assert.equal(c.body.status, 'aguardando_conta');
    assert.equal(c.body.pix_copia_cola, null, 'nada é enviado antes da aprovação');
    const conta = await sac.post(`/api/t/${tid}/conta-recebimento`, { nome: 'Tenda', documento: h.gerarCpf(n), email: 'x@teste.dev' });
    assert.equal(conta.body.gateway_conta_status, 'pendente');
    const ap = await h.req('POST', `/api/simulador/aprovar-conta/${conta.body.gateway_conta_id}`, { corpo: {} });
    assert.equal(ap.body.resposta.liberadas, 1);
    const depois = (await sac.get(`/api/t/${tid}/cobrancas/${c.body.id}`)).body;
    assert.equal(depois.status, 'aberta');
    assert.match(depois.pix_copia_cola, /^000201/);
  });

  it('US-08: Catálogo de serviços preenche o valor sugerido, que pode ser alterado', async () => {
    const { tid, sac } = await h.terreiroPronto({ admin });
    const s = await sac.post(`/api/t/${tid}/servicos`, { nome: 'Bori especial', preco_sugerido_centavos: 35000 });
    assert.equal(s.status, 201);
    const f = await h.novoFilho(sac, tid);
    const sugerido = await sac.post(`/api/t/${tid}/trabalhos`, { filho_id: f.id, servico_id: s.body.id, data: '2099-05-10T09:00:00-03:00' });
    assert.equal(sugerido.body.cobrancas[0].valor_centavos, 35000);
    const alterado = await sac.post(`/api/t/${tid}/trabalhos`, { filho_id: f.id, servico_id: s.body.id, valor_centavos: 30000, data: '2099-05-11T09:00:00-03:00' });
    assert.equal(alterado.body.cobrancas[0].valor_centavos, 30000);
  });

  it('US-09: Orixás e entidades editáveis só afetam a própria casa', async () => {
    const a = await h.terreiroPronto({ admin });
    const b = await h.terreiroPronto({ admin });
    const lista = (await a.sac.get(`/api/t/${a.tid}/entidades`)).body;
    const oxum = lista.find((e) => e.nome === 'Oxum');
    assert.ok(oxum);
    await a.sac.patch(`/api/t/${a.tid}/entidades/${oxum.id}`, { oculto: true });
    const nova = await a.sac.post(`/api/t/${a.tid}/entidades`, { tipo: 'entidade', nome: 'Zé Pelintra' });
    assert.equal(nova.status, 201);
    const depoisA = (await a.sac.get(`/api/t/${a.tid}/entidades`)).body.map((e) => e.nome);
    assert.ok(!depoisA.includes('Oxum') && depoisA.includes('Zé Pelintra'));
    const depoisB = (await b.sac.get(`/api/t/${b.tid}/entidades`)).body.map((e) => e.nome);
    assert.ok(depoisB.includes('Oxum') && !depoisB.includes('Zé Pelintra'), 'outra casa não muda');
  });
});

describe('E3 · Filhos de santo', () => {
  let admin;
  before(async () => { admin = await h.loginAdmin(); });

  it('US-10: Cadastro exige nome e telefone e recusa telefone repetido na casa', async () => {
    const { tid, sac } = await h.terreiroPronto({ admin });
    assert.equal((await sac.post(`/api/t/${tid}/filhos`, { telefone: h.telefone() })).status, 400);
    assert.equal((await sac.post(`/api/t/${tid}/filhos`, { nome_civil: 'Sem telefone' })).status, 400);
    const tel = h.telefone();
    const ok = await sac.post(`/api/t/${tid}/filhos`, { nome_civil: 'Ana Souza', telefone: tel, pai_cabeca: 'Oxóssi', mae_cabeca: 'Oxum' });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.pai_cabeca, 'Oxóssi');
    const dup = await sac.post(`/api/t/${tid}/filhos`, { nome_civil: 'Outra', telefone: tel });
    assert.equal(dup.status, 409);
  });

  it('US-11: Convite por WhatsApp com link válido por 7 dias e status visível', async () => {
    const { tid, sac } = await h.terreiroPronto({ admin });
    const f = await h.novoFilho(sac, tid);
    const c = await sac.post(`/api/t/${tid}/filhos/${f.id}/convite`);
    assert.equal(c.status, 200);
    assert.match(c.body.whatsapp, /^https:\/\/wa\.me\/55\d+\?text=/);
    assert.equal(c.body.expira_em_dias, 7);
    assert.equal((await sac.get(`/api/t/${tid}/filhos/${f.id}`)).body.convite_status, 'convidado');
    await h.db.query(`update vinculos set convite_expira = now() - interval '1 minute' where filho_id = $1`, [f.id]);
    const exp = await h.req('GET', `/api/convites/${h.tokenDoLink(c.body.link)}`);
    assert.equal(exp.status, 422);
    assert.equal((await sac.get(`/api/t/${tid}/filhos/${f.id}`)).body.convite_status, 'expirado');
  });

  it('US-12: Filho só entra aceitando o termo; aceite gravado com data, hora e versão', async () => {
    const { tid, sac } = await h.terreiroPronto({ admin });
    const f = await h.novoFilho(sac, tid);
    const c = await sac.post(`/api/t/${tid}/filhos/${f.id}/convite`);
    const token = h.tokenDoLink(c.body.link);
    const info = await h.req('GET', `/api/convites/${token}`);
    assert.equal(info.body.exige_consentimento, true);
    const sem = await h.req('POST', '/api/convites/aceitar', { corpo: { token, senha: 'senha-filho-1' } });
    assert.equal(sem.status, 400);
    const curta = await h.req('POST', '/api/convites/aceitar', { corpo: { token, senha: '123', consentimento: true } });
    assert.equal(curta.status, 400, 'senha fraca recusada');
    const com = await h.req('POST', '/api/convites/aceitar', { corpo: { token, senha: 'senha-filho-1', consentimento: true } });
    assert.equal(com.status, 201);
    const reg = await h.db.one('select consentimento_em, consentimento_versao, consentimento_religioso, convite_status from filhos where id = $1', [f.id]);
    assert.ok(reg.consentimento_em);
    assert.equal(reg.consentimento_versao, '1.0');
    assert.equal(reg.convite_status, 'ativo');
  });

  it('US-13: Bloqueio suspende acesso e novas mensalidades, mantém as pendências', async () => {
    const { tid, sac } = await h.terreiroPronto({ admin });
    const { filho, api } = await h.filhoComAcesso(sac, tid);
    const c = await sac.post(`/api/t/${tid}/cobrancas`, { filho_id: filho.id, descricao: 'Ebó', valor_centavos: 9000, vencimento: '2099-01-01' });
    assert.equal((await sac.post(`/api/t/${tid}/filhos/${filho.id}/bloquear`, { motivo: 'teste' })).status, 200);
    const acesso = await api.get(`/api/t/${tid}/meu/inicio`);
    assert.ok([401, 403].includes(acesso.status), 'filho bloqueado não acessa');
    await sac.put(`/api/t/${tid}/mensalidade`, { ativa: true, valor_centavos: 5000, dia_geracao: 1, gerar_agora: true });
    const cobs = (await sac.get(`/api/t/${tid}/cobrancas?filho_id=${filho.id}`)).body.itens;
    assert.equal(cobs.filter((x) => x.origem === 'mensalidade').length, 0, 'sem mensalidade nova');
    assert.equal(cobs.find((x) => x.id === c.body.id).status, 'aberta', 'pendência continua');
    assert.equal((await sac.post(`/api/t/${tid}/filhos/${filho.id}/desbloquear`)).status, 200);
  });

  it('US-14: Desligar preserva histórico; exclusão só a pedido do titular, com anonimização', async () => {
    const { tid, sac } = await h.terreiroPronto({ admin });
    const f = await h.novoFilho(sac, tid);
    const c = await sac.post(`/api/t/${tid}/cobrancas`, { filho_id: f.id, descricao: 'Velas', valor_centavos: 1500, vencimento: '2099-01-01' });
    await sac.post(`/api/t/${tid}/cobrancas/${c.body.id}/baixa`, { forma: 'dinheiro' });
    assert.equal((await sac.post(`/api/t/${tid}/filhos/${f.id}/desligar`)).body.status, 'desligado');
    const ativos = (await sac.get(`/api/t/${tid}/filhos?status=ativo`)).body.itens.map((x) => x.id);
    assert.ok(!ativos.includes(f.id));
    assert.equal((await sac.post(`/api/t/${tid}/filhos/${f.id}/reativar`)).body.status, 'ativo');
    assert.equal((await sac.del(`/api/t/${tid}/filhos/${f.id}`, {})).status, 422, 'sem pedido do titular');
    assert.equal((await sac.del(`/api/t/${tid}/filhos/${f.id}`, { pedido_do_titular: true })).status, 204);
    const anon = await h.db.one('select nome_civil, telefone, anonimizado from filhos where id = $1', [f.id]);
    assert.equal(anon.anonimizado, true);
    assert.equal(anon.telefone, null);
    const pago = await h.db.one('select status, valor_centavos from cobrancas where id = $1', [c.body.id]);
    assert.equal(pago.status, 'paga', 'financeiro preservado');
  });

  it('US-15: Grupos direcionam avisos e cobranças', async () => {
    const { tid, sac } = await h.terreiroPronto({ admin });
    const grupos = (await sac.get(`/api/t/${tid}/grupos`)).body;
    const ogas = grupos.find((g) => g.nome === 'Ogãs');
    const corrente = grupos.find((g) => g.nome === 'Corrente');
    const a = await h.filhoComAcesso(sac, tid, { grupos: [ogas.id, corrente.id] });
    const b = await h.filhoComAcesso(sac, tid, { grupos: [corrente.id] });
    const det = (await sac.get(`/api/t/${tid}/filhos/${a.filho.id}`)).body;
    assert.equal(det.grupos.length, 2, 'um filho em vários grupos');
    await sac.post(`/api/t/${tid}/avisos`, { titulo: 'Reunião dos ogãs', publico: { tipo: 'grupos', ids: [ogas.id] } });
    const va = (await a.api.get(`/api/t/${tid}/avisos`)).body.map((x) => x.titulo);
    const vb = (await b.api.get(`/api/t/${tid}/avisos`)).body.map((x) => x.titulo);
    assert.ok(va.includes('Reunião dos ogãs'));
    assert.ok(!vb.includes('Reunião dos ogãs'));
    const prev = await sac.post(`/api/t/${tid}/lotes/previa`, { valor_centavos: 2000, publico: { tipo: 'grupos', ids: [ogas.id] } });
    assert.equal(prev.body.quantidade, 1);
  });
});
