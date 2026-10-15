'use strict';
// Testes de interface: roda o app real (public/app.js) num DOM simulado contra a API de teste.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const h = require('../helpers');

const APP = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8').replace(/<script[^>]*app\.js[^>]*><\/script>/, '');

function abrir(hash, token, tid) {
  const dom = new JSDOM(INDEX, { url: `${h.base}/${hash}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const erros = [];
  w.fetch = (u, o) => fetch(new URL(u, h.base), o);
  w.scrollTo = () => {};
  w.open = () => null;
  w.addEventListener('error', (e) => erros.push(e.message));
  if (token) w.localStorage.setItem('th_token', token);
  if (tid) w.localStorage.setItem('th_tid', tid);
  w.eval(APP);
  return { w, doc: w.document, erros, fechar: () => w.close() };
}

async function esperar(cond, ms = 4000) {
  const ini = Date.now();
  while (Date.now() - ini < ms) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

async function irPara(tela, hash) {
  tela.w.location.hash = hash;
  await new Promise((r) => setTimeout(r, 30));
  const ok = await esperar(() => {
    const t = tela.doc.querySelector('#app').textContent;
    return t && !t.includes('Carregando');
  });
  assert.ok(ok, `tela ${hash} não terminou de carregar`);
  const txt = tela.doc.querySelector('#app').textContent;
  assert.ok(!txt.includes('Algo deu errado'), `erro na tela ${hash}: ${txt.slice(0, 200)}`);
  assert.deepEqual(tela.erros, [], `erros de script em ${hash}`);
  return txt;
}

async function enviar(tela, form, campos) {
  for (const [nome, v] of Object.entries(campos)) {
    const el = form.querySelector(`[name="${nome}"]`);
    if (el.type === 'checkbox') el.checked = v; else el.value = v;
    el.dispatchEvent(new tela.w.Event('input', { bubbles: true }));
  }
  form.dispatchEvent(new tela.w.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 400));
}

describe('Interface (PWA) · telas renderizam e fluxos principais funcionam', () => {
  let ctx, filho, admin;
  before(async () => {
    await h.subir();
    admin = await h.loginAdmin();
    ctx = await h.terreiroPronto({ admin, mensalidade: { ativa: true, valor_centavos: 5000, gerar_agora: true } });
    filho = await h.filhoComAcesso(ctx.sac, ctx.tid, { nome_civil: 'Ana <b>Souza</b>' });
    await ctx.sac.post(`/api/t/${ctx.tid}/cobrancas`, { filho_id: filho.filho.id, descricao: 'Bori', valor_centavos: 35000, vencimento: '2099-01-10' });
    const g = await ctx.sac.post(`/api/t/${ctx.tid}/eventos`, { tipo: 'gira', titulo: 'Gira de Caboclo', inicio: new Date(Date.now() + 3 * 864e5).toISOString() });
    await ctx.sac.post(`/api/t/${ctx.tid}/eventos/${g.body.eventos[0].id}/comunicar`, { preceitos: ['Roupa branca'] });
    await ctx.sac.post(`/api/t/${ctx.tid}/despesas`, { categoria: 'velas', valor_centavos: 3000 });
    ctx.gira = g.body.eventos[0].id;
  });
  after(h.descer);

  it('UI-01: Login pelo formulário leva ao início do sacerdote', async () => {
    const t = abrir('#/entrar');
    await esperar(() => t.doc.querySelector('#f'));
    await enviar(t, t.doc.querySelector('#f'), { identificador: ctx.email, senha: 'senha-forte-1' });
    const ok = await esperar(() => t.doc.querySelector('#app').textContent.includes('Saldo do mês'));
    assert.ok(ok, 'dashboard aparece após login');
    t.fechar();
  });

  it('UI-02: Todas as telas do sacerdote abrem sem erro', async () => {
    const t = abrir('#/', ctx.sac.token, ctx.tid);
    const rotas = ['#/', '#/filhos', '#/filhos/novo', `#/filhos/${filho.filho.id}`, '#/financeiro', '#/financeiro?aba=lotes', '#/financeiro?aba=despesas',
      '#/cobranca/nova', '#/cobranca/nova?modo=individual', '#/mensalidade', '#/trabalho/novo', '#/agenda', '#/agenda/novo', `#/gira/${ctx.gira}`,
      '#/buzios', '#/mural', '#/mural/novo', '#/config', '#/config/conta', '#/config/assinatura'];
    for (const r of rotas) await irPara(t, r);
    t.fechar();
  });

  it('UI-03: Texto digitado pelo usuário é exibido como texto (sem injeção de HTML)', async () => {
    const t = abrir('#/', ctx.sac.token, ctx.tid);
    await irPara(t, '#/filhos');
    assert.ok(t.doc.querySelector('#app').textContent.includes('Ana <b>Souza</b>'));
    assert.equal(t.doc.querySelector('#app b'), null, 'nenhuma tag <b> foi criada a partir do nome');
    t.fechar();
  });

  it('UI-04: Publicar aviso pelo formulário', async () => {
    const t = abrir('#/', ctx.sac.token, ctx.tid);
    await irPara(t, '#/mural/novo');
    await enviar(t, t.doc.querySelector('#f'), { titulo: 'Mutirão sábado', texto: 'Tragam vassoura' });
    await esperar(() => t.w.location.hash === '#/mural');
    const txt = await irPara(t, '#/mural');
    assert.ok(txt.includes('Mutirão sábado'));
    t.fechar();
  });

  it('UI-05: Cadastrar filho pelo formulário', async () => {
    const t = abrir('#/', ctx.sac.token, ctx.tid);
    await irPara(t, '#/filhos/novo');
    await enviar(t, t.doc.querySelector('#f'), { nome_civil: 'Carlos Pereira', telefone: '11977776666' });
    await esperar(() => /#\/filhos\/[0-9a-f-]{36}$/.test(t.w.location.hash), 4000);
    const txt = await irPara(t, t.w.location.hash);
    assert.ok(txt.includes('Carlos Pereira'));
    t.fechar();
  });

  it('UI-06: Telas do filho abrem e mostram só os dados dele', async () => {
    const t = abrir('#/', filho.api.token, ctx.tid);
    const ini = await irPara(t, '#/');
    assert.ok(ini.includes('pagamento') && ini.includes('Gira de Caboclo'));
    for (const r of ['#/mural', '#/agenda', '#/pagamentos', '#/perfil', '#/buzios']) await irPara(t, r);
    const cob = (await filho.api.get(`/api/t/${ctx.tid}/meu/cobrancas`)).body.find((c) => c.descricao === 'Bori');
    const pagar = await irPara(t, `#/pagar/${cob.id}`);
    assert.ok(pagar.includes('Pix copia e cola'));
    await irPara(t, '#/filhos');
    assert.equal(t.w.location.hash, '#/', 'filho é redirecionado para fora das telas do sacerdote');
    t.fechar();
  });

  it('UI-07: Painel do admin e convite abrem sem erro', async () => {
    const t = abrir('#/admin', admin.token);
    const txt = await irPara(t, '#/admin');
    assert.ok(txt.includes('Terreiros') && txt.includes('MRR'));
    t.fechar();
    const f = await h.novoFilho(ctx.sac, ctx.tid);
    const c = await ctx.sac.post(`/api/t/${ctx.tid}/filhos/${f.id}/convite`);
    const t2 = abrir(`#/convite/${h.tokenDoLink(c.body.link)}`);
    await esperar(() => t2.doc.querySelector('#f'));
    assert.ok(t2.doc.querySelector('[name=consentimento]'), 'termo de consentimento aparece');
    await enviar(t2, t2.doc.querySelector('#f'), { senha: 'senha-nova-12', senha2: 'senha-nova-12', consentimento: true });
    assert.ok(await esperar(() => t2.doc.querySelector('#app').textContent.includes('Próximo compromisso') || t2.doc.querySelector('#app').textContent.includes('Avisos novos')), 'filho entra após aceitar');
    t2.fechar();
  });
  it('UI-08: Esqueci a senha e link de nova senha levam o filho de volta ao app', async () => {
    const t = abrir('#/esqueci');
    await esperar(() => t.doc.querySelector('#f'));
    await enviar(t, t.doc.querySelector('#f'), { identificador: 'ninguem@teste.dev' });
    assert.ok(await esperar(() => t.doc.querySelector('#app').textContent.includes('Voltar para o login')), 'mensagem genérica aparece');
    t.fechar();
    const l = await ctx.sac.post(`/api/t/${ctx.tid}/filhos/${filho.filho.id}/link-senha`);
    assert.equal(l.status, 200);
    const t2 = abrir(`#/redefinir/${l.body.link.split('/redefinir/')[1]}`);
    await esperar(() => t2.doc.querySelector('#f'));
    await enviar(t2, t2.doc.querySelector('#f'), { senha: 'senha-trocada-9', senha2: 'senha-trocada-9' });
    assert.ok(await esperar(() => /Próximo compromisso|Avisos novos/.test(t2.doc.querySelector('#app').textContent)), 'filho entra após redefinir');
    const txt = await irPara(t2, '#/perfil');
    assert.ok(txt.includes('Conta e notificações') && txt.includes('Trocar senha'));
    t2.fechar();
    const t3 = abrir('#/redefinir/token-invalido');
    assert.ok(await esperar(() => t3.doc.querySelector('#app').textContent.includes('Link indisponível')));
    t3.fechar();
  });

  it('UI-09: Admin vê as integrações e o sacerdote vê a conta nas configurações', async () => {
    const t = abrir('#/admin', admin.token);
    const txt = await irPara(t, '#/admin');
    assert.ok(txt.includes('Integrações') && txt.includes('simulado'));
    t.fechar();
    const t2 = abrir('#/config', ctx.sac.token, ctx.tid);
    const c = await irPara(t2, '#/config');
    assert.ok(c.includes('Conta e notificações'));
    t2.fechar();
  });
});
