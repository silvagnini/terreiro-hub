/* Terreiro Hub — PWA (sem framework). Todo texto vindo da API passa por escape (função html). */
(() => {
  'use strict';

  // ---------------- utilidades ----------------
  const MAPA = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => MAPA[c]);
  class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
  const raw = (s) => new Raw(s);
  const val = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(val).join('') : v === false || v == null ? '' : esc(v));
  const html = (str, ...vals) => raw(str.reduce((acc, s, i) => acc + s + (i < vals.length ? val(vals[i]) : ''), ''));

  const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const brlCurto = (c) => 'R$ ' + Math.round(Number(c || 0) / 100).toLocaleString('pt-BR');
  const lerBRL = (s) => {
    const t = String(s || '').replace(/[^\d,.]/g, '');
    if (!t) return NaN;
    const n = t.includes(',') ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t);
    return Math.round(n * 100);
  };
  const paraCampoBRL = (c) => (c ? (c / 100).toFixed(2).replace('.', ',') : '');
  const TZ = 'America/Sao_Paulo';
  const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
  const somarDias = (iso, d) => { const x = new Date(iso + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
  const dataBR = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
  const diaMes = (iso) => dataBR(iso).slice(0, 5);
  const quando = (ts) => {
    const d = new Date(ts);
    const dia = d.toLocaleDateString('pt-BR', { timeZone: TZ, weekday: 'short' }).replace('.', '');
    const dm = d.toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' });
    const h = d.toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).replace(':00', 'h').replace(':', 'h');
    return `${dia.charAt(0).toUpperCase() + dia.slice(1)} ${dm} · ${h}`;
  };
  const isoLocal = (dataHora) => (dataHora ? `${dataHora}:00-03:00` : null); // input datetime-local → ISO com fuso de Brasília
  const iniciais = (n) => String(n || '?').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const competenciaAtual = () => hoje().slice(0, 7);
  const nomeMes = (comp) => new Date(comp + '-15T12:00:00Z').toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '').replace(' de ', ' ');
  const $ = (sel, raiz = document) => raiz.querySelector(sel);
  const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

  const IC = {
    voltar: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    sino: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
    engrenagem: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    inicio: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
    filhos: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6"/><path d="M17 4a4 4 0 0 1 0 8M22 21c0-3-2-5-4-6"/></svg>',
    agenda: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    dinheiro: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="2" y="6" width="20" height="13" rx="2"/><circle cx="12" cy="12.5" r="2.5"/></svg>',
    mural: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 4h16v12H8l-4 4z"/></svg>',
    perfil: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
    mais: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  };

  // ---------------- estado e API ----------------
  const S = {
    token: localStorage.getItem('th_token'),
    usuario: null, vinculos: [], tid: localStorage.getItem('th_tid'), terreiro: null,
    get vinculo() { return this.vinculos.find((v) => v.terreiro_id === this.tid) || null; },
    get papel() { return this.vinculo?.papel || null; },
  };

  class ErroApi extends Error { constructor(status, corpo) { super(corpo?.erro?.mensagem || 'Erro de comunicação'); this.status = status; this.corpo = corpo; } }
  // Leitura iniciada por uma tela que já foi trocada é descartada, para a tela antiga não sobrescrever a nova
  class Cancelado extends Error {}

  async function api(metodo, caminho, corpo) {
    const geracao = S.geracao;
    const r = await fetch(caminho, {
      method: metodo,
      headers: { 'content-type': 'application/json', ...(S.token ? { authorization: `Bearer ${S.token}` } : {}) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    let json = null;
    if (r.status !== 204) { try { json = await r.json(); } catch { json = null; } }
    if (metodo === 'GET' && geracao !== S.geracao) throw new Cancelado();
    if (r.status === 401 && S.token && !caminho.startsWith('/api/auth/login')) { sair(false); throw new ErroApi(401, json); }
    if (!r.ok) throw new ErroApi(r.status, json);
    return json;
  }
  const T = (c = '') => `/api/t/${S.tid}${c}`;
  const get = (c) => api('GET', c);
  const post = (c, b = {}) => api('POST', c, b);

  function aviso(msg, erro = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'vis' + (erro ? ' erro' : '');
    clearTimeout(aviso.tm);
    aviso.tm = setTimeout(() => (t.className = ''), 3200);
  }

  function sair(navegar = true) {
    if (S.token) fetch('/api/auth/logout', { method: 'POST', headers: { authorization: `Bearer ${S.token}` } }).catch(() => {});
    S.token = null; S.usuario = null; S.vinculos = []; S.tid = null; S.terreiro = null;
    localStorage.removeItem('th_token'); localStorage.removeItem('th_tid');
    navigator.serviceWorker?.controller?.postMessage('limpar-cache-api');
    if (navegar) location.hash = '#/entrar';
  }

  function entrouCom(dados) {
    S.token = dados.token; S.usuario = dados.usuario; S.vinculos = dados.vinculos || [];
    localStorage.setItem('th_token', S.token);
    if (S.vinculos.length === 1) escolherTerreiro(S.vinculos[0].terreiro_id);
    else if (!S.vinculos.find((v) => v.terreiro_id === S.tid)) { S.tid = null; localStorage.removeItem('th_tid'); }
    location.hash = S.tid ? '#/' : S.vinculos.length ? '#/escolher' : S.usuario?.is_admin ? '#/admin' : '#/entrar';
  }

  function escolherTerreiro(tid) { S.tid = tid; S.terreiro = null; localStorage.setItem('th_tid', tid); }

  // ---------------- layout ----------------
  const app = () => $('#app');

  function navSacerdote(ativo) {
    const perm = S.terreiro?.permissoes;
    const itens = [
      ['inicio', '#/', 'Início', IC.inicio, true],
      ['filhos', '#/filhos', 'Filhos', IC.filhos, !perm || perm.filhos],
      ['agenda', '#/agenda', 'Agenda', IC.agenda, !perm || perm.agenda],
      ['financeiro', '#/financeiro', 'Financeiro', IC.dinheiro, !perm || perm.financeiro],
      ['mural', '#/mural', 'Mural', IC.mural, !perm || perm.mural],
      ['pagamentos', '#/pagamentos', 'Eu', IC.perfil, Boolean(S.terreiro?.filho_id)],
    ].filter((i) => i[4]);
    return html`<nav class="inferior" aria-label="Menu principal">${itens.map(([k, href, rot, ic]) => html`<a href="${href}" ${raw(k === ativo ? 'aria-current="page"' : '')}>${raw(ic)}${rot}</a>`)}</nav>`;
  }
  function navFilho(ativo) {
    const itens = [['inicio', '#/', 'Início', IC.inicio], ['mural', '#/mural', 'Mural', IC.mural], ['agenda', '#/agenda', 'Agenda', IC.agenda], ['pagamentos', '#/pagamentos', 'Pagamentos', IC.dinheiro], ['perfil', '#/perfil', 'Meu perfil', IC.perfil]];
    return html`<nav class="inferior" aria-label="Menu principal">${itens.map(([k, href, rot, ic]) => html`<a href="${href}" ${raw(k === ativo ? 'aria-current="page"' : '')}>${raw(ic)}${rot}</a>`)}</nav>`;
  }

  function telaNav(ativo, conteudo) {
    document.body.classList.add('com-nav');
    app().innerHTML = html`${offlineFaixa()}${conteudo}${S.papel === 'filho' ? navFilho(ativo) : navSacerdote(ativo)}`;
  }
  function telaBarra(titulo, conteudo, { voltar = 'history', rodape = '' } = {}) {
    document.body.classList.remove('com-nav');
    app().innerHTML = html`${offlineFaixa()}<header class="barra"><button class="icone-btn" aria-label="Voltar" data-voltar="${voltar}">${raw(IC.voltar)}</button><h1>${titulo}</h1></header>
      <main class="conteudo">${conteudo}</main>${rodape ? html`<div class="rodape-acao">${rodape}</div>` : ''}`;
    $('[data-voltar]').onclick = (e) => { const v = e.currentTarget.dataset.voltar; if (v === 'history' && history.length > 1) history.back(); else location.hash = v === 'history' ? '#/' : v; };
  }
  const offlineFaixa = () => (navigator.onLine ? '' : html`<div class="offline">Sem internet — mostrando o que foi salvo</div>`);
  const carregando = () => { app().innerHTML = '<div class="carregando">Carregando…</div>'; };

  function topo(titulo, extra = '') {
    return html`<header class="topo"><div class="casa">${S.terreiro?.nome || ''}</div><div class="linha"><h1>${titulo}</h1>${extra}</div></header>`;
  }

  function folha(conteudo, aoMontar) {
    const veu = document.createElement('div');
    veu.className = 'veu';
    veu.innerHTML = html`<div class="folha" role="dialog" aria-modal="true">${conteudo}</div>`;
    const fechar = () => veu.remove();
    veu.addEventListener('click', (e) => { if (e.target === veu || e.target.closest('[data-fechar]')) fechar(); });
    document.body.appendChild(veu);
    aoMontar && aoMontar(veu.firstElementChild, fechar);
    $('input,button,select,textarea', veu)?.focus();
    return fechar;
  }

  function confirmar(texto, { ok = 'Confirmar', perigo = false, motivo = false } = {}) {
    return new Promise((resolve) => {
      folha(html`<h2>${texto}</h2>${motivo ? html`<div class="campo"><label for="mot">Motivo</label><input id="mot" type="text" required></div>` : ''}
        <div class="grade2"><button class="btn sec" data-fechar>Voltar</button><button class="btn ${perigo ? 'perigo' : ''}" data-ok>${ok}</button></div>`,
      (el, fechar) => {
        $('[data-ok]', el).onclick = () => {
          const m = motivo ? $('#mot', el).value.trim() : true;
          if (motivo && !m) { $('#mot', el).focus(); return; }
          fechar(); resolve(m);
        };
        $('[data-fechar]', el).addEventListener('click', () => resolve(false));
      });
    });
  }

  // Envia formulário com estado de carregamento e mensagem de erro amigável
  function aoEnviar(form, fn) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btns = $$('button[type=submit], .rodape-acao .btn[form]', document);
      btns.forEach((b) => (b.disabled = true));
      $$('.erro-campo', form).forEach((x) => x.remove());
      try { await fn(new FormData(form)); } catch (err) {
        if (err instanceof Cancelado) return;
        const campo = err.corpo?.erro?.detalhes?.campo;
        const alvo = campo && form.querySelector(`[name="${campo}"]`);
        if (alvo) alvo.insertAdjacentHTML('afterend', html`<span class="erro-campo">${err.message}</span>`.s);
        aviso(err.message, true);
      } finally { btns.forEach((b) => (b.disabled = false)); }
    });
  }

  const seloSituacao = (s) => ({
    vencida: html`<span class="selo ambar">Vencida</span>`, aberta: html`<span class="selo cinza">Em aberto</span>`, paga: html`<span class="selo verde">Paga</span>`,
    cancelada: html`<span class="selo cinza">Cancelada</span>`, estornada: html`<span class="selo vermelho">Estornada</span>`, aguardando_conta: html`<span class="selo roxo">Aguardando conta</span>`,
  }[s] || '');
  const ORIGEM = { mensalidade: 'Mensalidade', lote: 'Lote', trabalho: 'Trabalho', avulsa: 'Avulsa', buzios: 'Búzios' };
  const TIPOS = { gira: 'Gira', obrigacao: 'Obrigação', trabalho: 'Trabalho', buzios: 'Búzios', festa: 'Festa', outro: 'Outro' };

  // ---------------- autenticação ----------------
  async function telaEntrar() {
    document.body.classList.remove('com-nav');
    app().innerHTML = html`<div class="entrar">
      <div class="marca"><img src="/icons/icon-192.png" alt=""><div class="empilha"><h1>Terreiro Hub</h1><span class="sutil">Gestão da sua casa</span></div></div>
      <form class="form" id="f">
        <div class="campo"><label for="id">E-mail ou telefone</label><input id="id" name="identificador" type="text" autocomplete="username" required></div>
        <div class="campo"><label for="senha">Senha</label><input id="senha" name="senha" type="password" autocomplete="current-password" required></div>
        <button class="btn bloco" type="submit">Entrar</button>
        <a href="#/esqueci" style="text-align:center">Esqueci minha senha</a>
        <p class="sutil">Recebeu um convite? Abra o link que chegou no seu WhatsApp ou e-mail.</p>
      </form></div>`;
    aoEnviar($('#f'), async (fd) => entrouCom(await post('/api/auth/login', Object.fromEntries(fd))));
  }

  function telaEsqueci() {
    document.body.classList.remove('com-nav');
    app().innerHTML = html`<div class="entrar">
      <div class="marca"><img src="/icons/icon-192.png" alt=""><div class="empilha"><h1>Nova senha</h1><span class="sutil">Enviamos um link para você criar outra</span></div></div>
      <form class="form" id="f">
        <div class="campo"><label for="id">E-mail ou telefone cadastrado</label><input id="id" name="identificador" type="text" autocomplete="username" required></div>
        <button class="btn bloco" type="submit">Enviar link</button>
        <p class="sutil">Pelo e-mail, o link chega por e-mail. Pelo telefone, chega no WhatsApp. Ele vale por 1 hora.</p>
        <p class="sutil">Não recebeu? Peça ao sacerdote da sua casa um link de nova senha.</p>
        <a href="#/entrar" style="text-align:center">Voltar para o login</a>
      </form></div>`;
    aoEnviar($('#f'), async (fd) => {
      const r = await post('/api/auth/esqueci', Object.fromEntries(fd));
      $('#f').innerHTML = html`<div class="cartao info">${r.mensagem}</div><a class="btn sec" href="#/entrar">Voltar para o login</a>`.s;
    });
  }

  async function telaRedefinir({ token }) {
    document.body.classList.remove('com-nav');
    let info;
    try { info = await get(`/api/auth/redefinir/${encodeURIComponent(token)}`); } catch (e) {
      app().innerHTML = html`<div class="entrar"><h1>Link indisponível</h1><div class="cartao erro">${e.message}</div><a class="btn" href="#/esqueci">Pedir outro link</a><a class="btn sec" href="#/entrar">Ir para o login</a></div>`;
      return;
    }
    app().innerHTML = html`<div class="entrar">
      <div class="marca"><img src="/icons/icon-192.png" alt=""><div class="empilha"><span class="sutil">Olá, ${info.nome}</span><h1>Crie uma nova senha</h1></div></div>
      <form class="form" id="f">
        <div class="campo"><label for="s1">Nova senha</label><input id="s1" name="senha" type="password" minlength="8" autocomplete="new-password" required><span class="ajuda">Pelo menos 8 caracteres</span></div>
        <div class="campo"><label for="s2">Repita a senha</label><input id="s2" name="senha2" type="password" autocomplete="new-password" required></div>
        <button class="btn bloco" type="submit">Salvar e entrar</button>
        <p class="sutil">Por segurança, você sai de todos os outros aparelhos.</p>
      </form></div>`;
    aoEnviar($('#f'), async (fd) => {
      if (fd.get('senha') !== fd.get('senha2')) throw new ErroApi(400, { erro: { mensagem: 'As senhas não conferem', detalhes: { campo: 'senha2' } } });
      const r = await post('/api/auth/redefinir', { token, senha: fd.get('senha') });
      aviso('Senha alterada');
      entrouCom(r);
    });
  }

  // Seção "Conta e notificações" usada no perfil do filho, nas configurações e no painel do admin
  const pushSuportado = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const iosSemInstalar = () => /iphone|ipad/i.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches;
  function b64ParaBytes(b64) {
    const p = '='.repeat((4 - (b64.length % 4)) % 4);
    const bin = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }
  async function inscricaoAtual() {
    if (!pushSuportado()) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }
  async function ativarPush() {
    if (iosSemInstalar()) throw new ErroApi(400, { erro: { mensagem: 'No iPhone, primeiro instale o app: toque em Compartilhar › Adicionar à Tela de Início, e abra por lá.' } });
    if (!pushSuportado()) throw new ErroApi(400, { erro: { mensagem: 'Este navegador não aceita notificações.' } });
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new ErroApi(400, { erro: { mensagem: 'Notificações bloqueadas. Libere nas configurações do navegador.' } });
    const { chave_publica: chave } = await get('/api/push/chave');
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ParaBytes(chave) }));
    await post('/api/push/inscricao', { inscricao: sub.toJSON() });
  }
  async function desativarPush() {
    const sub = await inscricaoAtual();
    if (sub) { await api('DELETE', '/api/push/inscricao', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
  }

  async function secaoConta() {
    const [prefs, sub] = await Promise.all([get('/api/auth/preferencias').catch(() => ({})), inscricaoAtual().catch(() => null)]);
    return html`<section class="secao" id="sec-conta"><h2>Conta e notificações</h2>
      <div class="cartao empilha" style="gap:10px">
        <div class="lado"><span class="empilha"><strong>Notificações neste aparelho</strong><span class="sutil">${sub ? 'Ativadas' : pushSuportado() ? 'Desativadas' : 'Não disponíveis neste navegador'}</span></span>
          ${pushSuportado() || iosSemInstalar() ? html`<button class="btn ${sub ? 'sec' : ''} peq" id="push">${sub ? 'Desativar' : 'Ativar'}</button>` : ''}</div>
        <label class="alternar" style="padding:0"><span>Receber pelo WhatsApp</span><input type="checkbox" data-pref="whatsapp" ${raw(prefs.whatsapp !== false ? 'checked' : '')}></label>
        <label class="alternar" style="padding:0"><span>Receber por e-mail</span><input type="checkbox" data-pref="email" ${raw(prefs.email !== false ? 'checked' : '')}></label>
        <span class="sutil">As mensagens dizem só "você tem um novo aviso", sem o conteúdo.</span>
      </div>
      <button class="btn sec" id="trocar-senha">Trocar senha</button></section>`;
  }
  function ligarSecaoConta() {
    $('#push')?.addEventListener('click', async (e) => {
      try {
        if (e.target.textContent === 'Desativar') { await desativarPush(); aviso('Notificações desativadas'); } else { await ativarPush(); aviso('Notificações ativadas neste aparelho'); }
        render(true);
      } catch (err) { aviso(err.message, true); }
    });
    $$('[data-pref]').forEach((c) => c.addEventListener('change', async () => {
      try { await api('PATCH', '/api/auth/preferencias', { [c.dataset.pref]: c.checked }); aviso('Preferência salva'); } catch (err) { aviso(err.message, true); c.checked = !c.checked; }
    }));
    $('#trocar-senha')?.addEventListener('click', () => folha(html`<h2>Trocar senha</h2><form class="form" id="fs">
        <div class="campo"><label for="sa">Senha atual</label><input id="sa" name="senha_atual" type="password" autocomplete="current-password" required></div>
        <div class="campo"><label for="sn">Nova senha</label><input id="sn" name="nova_senha" type="password" minlength="8" autocomplete="new-password" required><span class="ajuda">Pelo menos 8 caracteres</span></div>
        <div class="campo"><label for="sc">Repita a nova senha</label><input id="sc" name="confirma" type="password" autocomplete="new-password" required></div>
        <button class="btn" type="submit">Salvar nova senha</button><button class="btn sec" type="button" data-fechar>Cancelar</button></form>`, (el, fechar) => aoEnviar($('#fs', el), async (fd) => {
      if (fd.get('nova_senha') !== fd.get('confirma')) throw new ErroApi(400, { erro: { mensagem: 'As senhas não conferem', detalhes: { campo: 'confirma' } } });
      const r = await post('/api/auth/senha', { senha_atual: fd.get('senha_atual'), nova_senha: fd.get('nova_senha') });
      fechar(); aviso(r.mensagem);
    })));
  }

  async function telaConvite({ token }) {
    carregando();
    let info;
    try { info = await get(`/api/convites/${encodeURIComponent(token)}`); } catch (e) {
      document.body.classList.remove('com-nav');
      app().innerHTML = html`<div class="entrar"><h1>Convite indisponível</h1><div class="cartao erro">${e.message}</div><a class="btn" href="#/entrar">Ir para o login</a></div>`;
      return;
    }
    const filho = info.papel === 'filho';
    document.body.classList.remove('com-nav');
    app().innerHTML = html`<div class="entrar">
      <div class="marca"><img src="/icons/icon-192.png" alt=""><div class="empilha"><span class="sutil">Convite de</span><h1>${info.terreiro}</h1></div></div>
      <form class="form" id="f">
        ${!info.nome ? html`<div class="campo"><label for="nome">Seu nome</label><input id="nome" name="nome" type="text" autocomplete="name"></div>` : html`<p>Olá, <strong>${info.nome.split(' ')[0]}</strong>! Crie sua senha para entrar.</p>`}
        <div class="campo"><label for="s1">Crie uma senha</label><input id="s1" name="senha" type="password" minlength="8" autocomplete="new-password" required><span class="ajuda">Pelo menos 8 caracteres</span></div>
        <div class="campo"><label for="s2">Repita a senha</label><input id="s2" name="senha2" type="password" autocomplete="new-password" required></div>
        ${filho ? html`<details class="cartao"><summary><strong>Como usamos seus dados (termo v${info.termo_versao})</strong></summary>
            <p class="sutil" style="margin-top:8px">O terreiro ${info.terreiro} é responsável pelos seus dados. Usamos seu nome, contato e pagamentos para organizar sua participação, enviar avisos e gerar cobranças. Dados religiosos (orixás, guias, obrigações) só com sua autorização abaixo. Ninguém da corrente vê seus dados. Você pode baixar, corrigir ou pedir a exclusão a qualquer momento em "Meu perfil".</p></details>
          <label class="alternar"><span>Li e aceito o uso dos meus dados para participar da casa</span><input type="checkbox" name="consentimento" required></label>
          <label class="alternar"><span>Autorizo o uso dos meus dados religiosos (orixás, guias e obrigações)</span><input type="checkbox" name="consentimento_religioso"></label>` : ''}
        <button class="btn bloco" type="submit">Criar acesso</button>
      </form></div>`;
    aoEnviar($('#f'), async (fd) => {
      if (fd.get('senha') !== fd.get('senha2')) throw new ErroApi(400, { erro: { mensagem: 'As senhas não conferem', detalhes: { campo: 'senha2' } } });
      const r = await post('/api/convites/aceitar', {
        token, senha: fd.get('senha'), nome: fd.get('nome') || undefined, consentimento: fd.get('consentimento') === 'on', consentimento_religioso: fd.get('consentimento_religioso') === 'on',
      });
      aviso('Acesso criado. Bem-vindo!');
      entrouCom(r);
    });
  }

  function telaEscolher() {
    document.body.classList.remove('com-nav');
    app().innerHTML = html`<div class="entrar"><h1>Escolha a casa</h1><div class="lista">
      ${S.vinculos.map((v) => html`<button class="item" data-tid="${v.terreiro_id}"><span class="faixa" style="background:${v.cor || '#0F5C4D'}"></span><span class="corpo"><strong>${v.terreiro_nome}</strong><span class="sutil">${{ sacerdote: 'Sacerdote', auxiliar: 'Auxiliar', filho: 'Filho de santo' }[v.papel]}</span></span>›</button>`)}
      ${S.usuario?.is_admin ? html`<a class="item" href="#/admin"><span class="corpo"><strong>Painel da plataforma</strong><span class="sutil">Administrador</span></span>›</a>` : ''}
      </div><button class="btn sec" id="sair">Sair</button></div>`;
    $$('[data-tid]').forEach((b) => (b.onclick = () => { escolherTerreiro(b.dataset.tid); location.hash = '#/'; }));
    $('#sair').onclick = () => sair();
  }

  // ---------------- sacerdote: início (US-29) ----------------
  async function telaInicioSacerdote() {
    const t = S.terreiro;
    const podeDash = !t.permissoes || t.permissoes.dashboard;
    const comp = sessionStorage.getItem('th_comp') || competenciaAtual();
    const [d, ev] = await Promise.all([
      podeDash ? get(T(`/dashboard?competencia=${comp}`)) : null,
      get(T(`/eventos?de=${hoje()}&ate=${somarDias(hoje(), 14)}`)).catch(() => []),
    ]);
    const meses = Array.from({ length: 12 }, (_, i) => { const x = new Date(competenciaAtual() + '-15T12:00:00Z'); x.setUTCMonth(x.getUTCMonth() - i); return x.toISOString().slice(0, 7); });
    const onb = t.onboarding;
    const onbFaltam = onb ? onb.etapas.filter((e) => onb[e] !== 'feita').length : 0;
    const pct = d && d.mensalidades.total ? Math.round((d.mensalidades.pagas * 100) / d.mensalidades.total) : 0;
    telaNav('inicio', html`
      ${topo(`Olá, ${(S.usuario?.nome || '').split(' ')[0]}`, html`<a class="icone-btn contorno" href="#/config" aria-label="Configurações">${raw(IC.engrenagem)}</a>`)}
      <main class="conteudo">
        ${t.inadimplencia ? html`<div class="cartao alerta"><strong>Assinatura em atraso há ${t.inadimplencia.dias} dias.</strong> <a href="#/config/assinatura">Pagar agora</a>. ${t.status === 'somente_leitura' ? 'O painel está em modo somente leitura.' : ''}</div>` : ''}
        ${t.uso?.alerta_limite ? html`<div class="cartao alerta">Você usa ${t.uso.filhos_ativos} de ${t.uso.limite} filhos do plano ${t.plano?.nome}. Fale conosco para fazer upgrade.</div>` : ''}
        ${S.papel === 'sacerdote' && onbFaltam ? html`<a class="cartao info" href="#/config" style="text-decoration:none">Faltam ${onbFaltam} passos para deixar a casa pronta. Toque para continuar.</a>` : ''}
        ${t.gateway_conta_status && t.gateway_conta_status !== 'aprovada' && S.papel === 'sacerdote' ? html`<a class="cartao alerta" href="#/config/conta" style="text-decoration:none">${t.gateway_conta_status === 'pendente' ? 'Sua conta de recebimento está em análise. As cobranças serão enviadas assim que for aprovada.' : 'Conecte sua conta de recebimento para enviar Pix e boleto aos filhos.'}</a>` : ''}
        ${d ? html`
          <div class="heroi">
            <div class="lado" style="font-size:14px"><span>Saldo do mês</span><select id="comp" aria-label="Mês">${meses.map((m) => html`<option value="${m}" ${raw(m === comp ? 'selected' : '')}>${nomeMes(m)}</option>`)}</select></div>
            <div class="valor">${brl(d.saldo_centavos)}</div>
            <div style="font-size:14px">Mensalidades: ${d.mensalidades.pagas} de ${d.mensalidades.total} pagas</div>
            <div class="progresso" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div style="width:${pct}%"></div></div>
          </div>
          <div class="grade2">
            <div class="kpi"><span>Recebido</span><span>${brlCurto(d.recebido_centavos)}</span></div>
            <div class="kpi"><span>A receber</span><span>${brlCurto(d.a_receber_centavos)}</span></div>
            <a class="kpi ${d.em_atraso_centavos ? 'alerta' : ''}" href="#/financeiro?situacao=vencida"><span>Em atraso · ${d.filhos_em_atraso} filhos</span><span>${brlCurto(d.em_atraso_centavos)} ›</span></a>
            <div class="kpi"><span>Despesas</span><span>${brlCurto(d.despesas_centavos)}</span></div>
          </div>` : ''}
        <div class="grade3">
          <a class="btn-acao" href="#/cobranca/nova">+ Cobrança</a><a class="btn-acao" href="#/trabalho/novo">+ Trabalho</a><a class="btn-acao" href="#/mural/novo">+ Aviso</a>
        </div>
        ${d ? graficoSerie(d.serie) : ''}
        <section class="secao"><div class="secao-topo"><h2>Próximos compromissos</h2><a href="#/agenda">Ver agenda</a></div>
          <div class="lista">${ev.filter((e) => !e.cancelado).slice(0, 5).map(itemEvento)}${ev.length ? '' : html`<div class="cartao sutil">Nada marcado nas próximas duas semanas.</div>`}</div></section>
        ${d && d.receita_por_origem.length ? html`<section class="secao"><h2>Receita do mês por tipo</h2><div class="cartao lista">${d.receita_por_origem.map((o) => html`<div class="lado"><span>${ORIGEM[o.origem] || o.origem}</span><strong>${brl(o.valor_centavos)}</strong></div>`)}</div></section>` : ''}
        ${d && d.inadimplentes.length ? html`<section class="secao"><h2>Quem está em atraso</h2><div class="lista">${d.inadimplentes.slice(0, 8).map((i) => html`<a class="item" href="#/filhos/${i.id}"><span class="avatar">${iniciais(i.nome_civil)}</span><span class="corpo"><strong>${i.nome_civil}</strong><span class="sutil">${i.cobrancas} cobrança(s) desde ${dataBR(i.desde)}</span></span><strong style="color:var(--ambar-texto)">${brl(i.valor)}</strong></a>`)}</div></section>` : ''}
      </main>`);
    $('#comp')?.addEventListener('change', (e) => { sessionStorage.setItem('th_comp', e.target.value); render(); });
  }

  function graficoSerie(serie) {
    const max = Math.max(1, ...serie.map((s) => Math.max(s.receita_centavos, s.despesa_centavos)));
    return html`<section class="secao cartao g"><div class="lado"><h2>Receita x despesa</h2><div class="legenda"><span><i style="background:var(--verde)"></i>Receita</span><span><i style="background:var(--ambar)"></i>Despesa</span></div></div>
      <div class="grafico" role="img" aria-label="Receita e despesa dos últimos 12 meses">${serie.map((s) => html`<div class="col" title="${nomeMes(s.competencia)}: receita ${brl(s.receita_centavos)}, despesa ${brl(s.despesa_centavos)}"><div style="height:${(s.receita_centavos / max) * 100}%;background:var(--verde)"></div><div style="height:${(s.despesa_centavos / max) * 100}%;background:var(--ambar)"></div></div>`)}</div>
      <div class="grafico-rotulos" aria-hidden="true">${serie.map((s) => html`<span>${nomeMes(s.competencia).slice(0, 3)}</span>`)}</div></section>`;
  }

  function itemEvento(e) {
    const extra = e.tipo === 'gira' ? `${e.confirmados} confirmados` : e.filho_nome || (e.consulente?.nome ?? '');
    return html`<button class="item" data-evento="${e.id}" ${raw(e.cancelado ? 'style="opacity:.55"' : '')}><span class="faixa" style="background:${e.cor}"></span><span class="corpo"><strong>${e.titulo}</strong><span class="sutil">${quando(e.inicio)}${extra ? ' · ' + extra : ''}${e.cancelado ? ' · cancelado' : ''}</span></span></button>`;
  }

  // ---------------- filhos (US-10 a US-15) ----------------
  async function telaFilhos() {
    const st = new URLSearchParams(location.hash.split('?')[1] || '').get('status') || 'ativo';
    const busca = sessionStorage.getItem('th_busca') || '';
    const r = await get(T(`/filhos?status=${st}&limite=200${busca ? '&busca=' + encodeURIComponent(busca) : ''}`));
    const conv = { nao_enviado: html`<span class="selo cinza">Sem acesso</span>`, convidado: html`<span class="selo roxo">Convidado</span>`, expirado: html`<span class="selo ambar">Convite expirou</span>`, ativo: '' };
    telaNav('filhos', html`${topo('Filhos de santo', html`<a class="btn peq" href="#/filhos/novo">+ Novo</a>`)}
      <main class="conteudo">
        <input type="text" id="busca" placeholder="Buscar por nome ou telefone" value="${busca}" aria-label="Buscar">
        <div class="segmento" role="tablist">${[['ativo', 'Ativos'], ['afastado', 'Afastados'], ['bloqueado', 'Bloqueados'], ['desligado', 'Desligados']].map(([k, l]) => html`<button role="tab" aria-selected="${k === st}" data-st="${k}">${l}</button>`)}</div>
        <p class="sutil">${r.total} ${r.total === 1 ? 'filho' : 'filhos'}</p>
        <div class="lista">${r.itens.map((f) => html`<a class="item" href="#/filhos/${f.id}"><span class="avatar">${iniciais(f.nome_civil)}</span><span class="corpo"><strong>${f.nome_civil}</strong><span class="sutil">${[f.nome_santo, [f.pai_cabeca, f.mae_cabeca].filter(Boolean).join(' e ')].filter(Boolean).join(' · ') || f.telefone}</span></span>${f.em_atraso ? html`<span class="selo ambar">${f.em_atraso} em atraso</span>` : conv[f.convite_status]}</a>`)}
        ${r.itens.length ? '' : html`<div class="vazio">Nenhum filho aqui.</div>`}</div>
      </main>`);
    $$('[data-st]').forEach((b) => (b.onclick = () => (location.hash = `#/filhos?status=${b.dataset.st}`)));
    let tm;
    $('#busca').addEventListener('input', (e) => { clearTimeout(tm); tm = setTimeout(() => { sessionStorage.setItem('th_busca', e.target.value); render(true); }, 350); });
  }

  async function telaNovoFilho() {
    const [entidades, grupos] = await Promise.all([get(T('/entidades')), get(T('/grupos'))]);
    const orixas = entidades.filter((e) => e.tipo === 'orixa');
    const sac = S.papel === 'sacerdote';
    telaBarra('Novo filho de santo', html`<form class="form" id="f">
      <div class="campo"><label for="n">Nome civil *</label><input id="n" name="nome_civil" type="text" required autocomplete="off"></div>
      <div class="campo"><label for="ns">Nome de santo</label><input id="ns" name="nome_santo" type="text" placeholder="Opcional"></div>
      <div class="campo"><label for="tel">WhatsApp *</label><input id="tel" name="telefone" type="tel" inputmode="tel" placeholder="(11) 9 8765-4321" required></div>
      ${sac ? html`<div class="grade2">
        <div class="campo"><label for="pai">Pai de cabeça</label><select id="pai" name="pai_cabeca"><option value="">—</option>${orixas.map((o) => html`<option>${o.nome}</option>`)}</select></div>
        <div class="campo"><label for="mae">Mãe de cabeça</label><select id="mae" name="mae_cabeca"><option value="">—</option>${orixas.map((o) => html`<option>${o.nome}</option>`)}</select></div></div>` : ''}
      <fieldset class="campo"><legend>Grupos</legend><div class="chips">${grupos.map((g) => html`<button type="button" class="chip" aria-pressed="${g.nome === 'Corrente'}" data-grupo="${g.id}">${g.nome}</button>`)}</div></fieldset>
      <div class="campo"><label for="ent">Data de entrada</label><input id="ent" name="data_entrada" type="date" value="${hoje()}"></div>
      <label class="alternar"><span class="empilha"><strong>Isento de mensalidade</strong><span class="sutil">Não entra na cobrança mensal</span></span><input type="checkbox" name="isento"></label>
      <div class="cartao info">Depois de salvar você envia o convite pelo WhatsApp. O filho cria a senha e aceita o termo de privacidade. Orixás e guias podem ser completados depois.</div>
    </form>`, { rodape: html`<button class="btn" type="submit" form="f">Salvar e enviar convite</button>` });
    $$('[data-grupo]').forEach((b) => (b.onclick = () => b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true')));
    aoEnviar($('#f'), async (fd) => {
      const corpo = Object.fromEntries([...fd].filter(([, v]) => v !== ''));
      corpo.isento = fd.get('isento') === 'on';
      corpo.grupos = $$('[data-grupo][aria-pressed=true]').map((b) => b.dataset.grupo);
      const f = await post(T('/filhos'), corpo);
      const c = await post(T(`/filhos/${f.id}/convite`));
      aviso('Filho cadastrado');
      window.open(c.whatsapp, '_blank', 'noopener');
      location.hash = `#/filhos/${f.id}`;
    });
  }

  async function telaFilho({ id }) {
    const [f, cobs, grupos] = await Promise.all([
      get(T(`/filhos/${id}`)),
      (!S.terreiro.permissoes || S.terreiro.permissoes.financeiro) ? get(T(`/cobrancas?filho_id=${id}&limite=50`)).catch(() => ({ itens: [] })) : { itens: [] },
      get(T('/grupos')),
    ]);
    const sac = S.papel === 'sacerdote';
    const STATUS = { ativo: html`<span class="selo verde">Ativo</span>`, afastado: html`<span class="selo ambar">Afastado</span>`, bloqueado: html`<span class="selo vermelho">Bloqueado</span>`, desligado: html`<span class="selo cinza">Desligado</span>` };
    const acoes = [];
    if (f.status === 'ativo' && f.convite_status !== 'ativo') acoes.push(['convite', f.convite_status === 'nao_enviado' ? 'Enviar convite' : 'Reenviar convite', 'contorno']);
    if (f.status === 'ativo') acoes.push(['trabalho', 'Novo trabalho', 'sec'], ['afastar', 'Afastar', 'sec']);
    if (sac && ['ativo', 'afastado'].includes(f.status)) acoes.push(['bloquear', 'Bloquear', 'perigo']);
    if (sac && f.status === 'bloqueado') acoes.push(['desbloquear', 'Desbloquear', 'contorno']);
    if (sac && ['afastado', 'desligado'].includes(f.status)) acoes.push(['reativar', 'Reativar', 'contorno']);
    if (sac && f.status !== 'desligado') acoes.push(['desligar', 'Desligar da casa', 'perigo']);
    if (sac && f.convite_status === 'ativo' && ['ativo', 'afastado'].includes(f.status)) acoes.push(['link-senha', 'Gerar link de nova senha', 'sec']);
    if (sac && f.status === 'ativo' && !f.auxiliar) acoes.push(['auxiliar', 'Tornar auxiliar (Pai/Mãe Pequeno, Ogã…)', 'contorno']);
    if (sac && f.auxiliar) acoes.push(['remover-aux', 'Tirar permissões de auxiliar', 'sec']);
    if (sac) acoes.push(['excluir', 'Excluir a pedido do titular', 'perigo']);
    telaBarra(f.nome_civil, html`
      <div class="cartao g empilha" style="gap:10px">
        <div class="lado"><div class="empilha"><strong style="font-size:18px">${f.nome_civil}</strong><span class="sutil">${f.nome_santo || 'Sem nome de santo'}</span></div>${STATUS[f.status]}</div>
        <div class="sutil">WhatsApp: ${f.telefone || '—'} · Entrada: ${dataBR(f.data_entrada)}</div>
        ${'pai_cabeca' in f ? html`<div class="lado"><span>Pai de cabeça: <strong>${f.pai_cabeca || '—'}</strong></span><span>Mãe: <strong>${f.mae_cabeca || '—'}</strong></span></div>` : ''}
        ${f.auxiliar ? html`<div><span class="selo roxo">Auxiliar da casa</span></div>` : ''}
        <div class="sutil">Acesso ao app: ${{ nao_enviado: 'convite não enviado', convidado: 'convidado, aguardando', expirado: 'convite expirou', ativo: 'ativo' }[f.convite_status]}</div>
      </div>
      <fieldset class="campo"><legend>Grupos</legend><div class="chips">${grupos.map((g) => html`<button type="button" class="chip" data-grupo="${g.id}" aria-pressed="${f.grupos.some((x) => x.id === g.id)}">${g.nome}</button>`)}</div></fieldset>
      <section class="secao"><h2>Financeiro</h2>
        <div class="grade2"><div class="kpi"><span>Em aberto</span><span>${brl(f.financeiro.total_aberto_centavos)}</span></div><div class="kpi ${f.financeiro.em_atraso ? 'alerta' : ''}"><span>Em atraso</span><span>${f.financeiro.em_atraso}</span></div></div>
        ${(!S.terreiro.permissoes || S.terreiro.permissoes.financeiro) ? html`<label class="alternar"><span class="empilha"><strong>Isento de mensalidade</strong></span><input type="checkbox" id="isento" ${raw(f.isento ? 'checked' : '')}></label>
        <div class="grade2"><div class="campo"><label for="dt">Desconto na mensalidade</label><select id="dt"><option value="">Sem desconto</option><option value="percentual" ${raw(f.desconto?.tipo === 'percentual' ? 'selected' : '')}>Percentual (%)</option><option value="valor" ${raw(f.desconto?.tipo === 'valor' ? 'selected' : '')}>Valor (R$)</option></select></div>
        <div class="campo"><label for="dv">Quanto</label><input id="dv" type="text" inputmode="decimal" value="${f.desconto ? (f.desconto.tipo === 'valor' ? paraCampoBRL(f.desconto.valor) : f.desconto.valor) : ''}"></div></div>
        <button class="btn sec peq" id="salvarFin">Salvar condições</button>` : ''}
        <div class="lista">${cobs.itens.map(itemCobranca)}${cobs.itens.length ? '' : html`<div class="cartao sutil">Nenhuma cobrança.</div>`}</div>
      </section>
      ${'pai_cabeca' in f ? html`<section class="secao"><div class="secao-topo"><h2>Obrigações</h2>${sac ? html`<button class="btn sec peq" id="novaObr">+ Registrar</button>` : ''}</div>
        <div class="lista">${f.obrigacoes.map((o) => html`<div class="item"><span class="corpo"><strong>${o.tipo}</strong><span class="sutil">${dataBR(o.data)}${o.observacao ? ' · ' + o.observacao : ''}</span></span></div>`)}${f.obrigacoes.length ? '' : html`<div class="cartao sutil">Nenhuma obrigação registrada.</div>`}</div></section>` : ''}
      <section class="secao"><h2>Ações</h2><div class="lista">${acoes.map(([k, l, c]) => html`<button class="btn ${c} bloco" data-acao="${k}">${l}</button>`)}</div></section>`, { voltar: '#/filhos' });

    $$('[data-grupo]').forEach((b) => (b.onclick = async () => {
      b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true');
      await api('PUT', T(`/filhos/${id}/grupos`), { ids: $$('[data-grupo][aria-pressed=true]').map((x) => x.dataset.grupo) });
      aviso('Grupos atualizados');
    }));
    $$('[data-cobranca]').forEach((b) => (b.onclick = () => folhaCobranca(b.dataset.cobranca)));
    $('#salvarFin')?.addEventListener('click', async () => {
      const tipo = $('#dt').value;
      const desconto = tipo ? { tipo, valor: tipo === 'valor' ? lerBRL($('#dv').value) : Number($('#dv').value.replace(',', '.')) } : null;
      try { await api('PATCH', T(`/filhos/${id}/financeiro`), { isento: $('#isento').checked, desconto }); aviso('Condições salvas'); } catch (e) { aviso(e.message, true); }
    });
    $('#novaObr')?.addEventListener('click', () => folha(html`<h2>Registrar obrigação</h2><form class="form" id="fo">
        <div class="campo"><label for="ot">Tipo</label><input id="ot" name="tipo" type="text" placeholder="Ex.: Obrigação de 1 ano" required></div>
        <div class="campo"><label for="od">Data</label><input id="od" name="data" type="date" value="${hoje()}" required></div>
        <div class="campo"><label for="oo">Observação</label><input id="oo" name="observacao" type="text"></div>
        <button class="btn" type="submit">Salvar</button></form>`, (el, fechar) => aoEnviar($('#fo', el), async (fd) => { await post(T(`/filhos/${id}/obrigacoes`), Object.fromEntries(fd)); fechar(); render(true); })));
    $$('[data-acao]').forEach((b) => (b.onclick = async () => {
      const a = b.dataset.acao;
      try {
        if (a === 'convite') { const c = await post(T(`/filhos/${id}/convite`)); window.open(c.whatsapp, '_blank', 'noopener'); aviso('Convite gerado (vale 7 dias)'); return render(true); }
        if (a === 'trabalho') { location.hash = `#/trabalho/novo?filho=${id}`; return; }
        if (a === 'auxiliar') {
          const PERMS = [['filhos', 'Filhos'], ['mural', 'Mural'], ['agenda', 'Agenda'], ['financeiro', 'Financeiro'], ['despesas', 'Despesas'], ['dashboard', 'Painel']];
          folha(html`<h2>Tornar ${f.nome_civil.split(' ')[0]} auxiliar</h2>
            <p>Continua sendo filho da casa, com as mensalidades e o perfil dele, e passa a ajudar no painel com o mesmo login.</p>
            <fieldset class="campo"><legend>O que pode fazer</legend><div class="chips">${PERMS.map(([k, l]) => html`<button type="button" class="chip" data-p="${k}" aria-pressed="${['filhos', 'mural', 'agenda'].includes(k)}">${l}</button>`)}</div></fieldset>
            ${f.convite_status !== 'ativo' ? html`<p class="sutil">Ele ainda não ativou o acesso ao app. As permissões valem assim que aceitar o convite.</p>` : ''}
            <button class="btn" data-ok>Confirmar</button><button class="btn sec" data-fechar>Cancelar</button>`, (el, fechar) => {
            $$('[data-p]', el).forEach((c) => (c.onclick = () => c.setAttribute('aria-pressed', c.getAttribute('aria-pressed') !== 'true')));
            $('[data-ok]', el).onclick = async () => {
              try {
                await post(T(`/filhos/${id}/auxiliar`), { permissoes: Object.fromEntries($$('[data-p]', el).map((c) => [c.dataset.p, c.getAttribute('aria-pressed') === 'true'])) });
                fechar(); aviso('Agora é auxiliar da casa'); render(true);
              } catch (e) { aviso(e.message, true); }
            };
          });
          return;
        }
        if (a === 'remover-aux') {
          if (!(await confirmar('Tirar as permissões de auxiliar? Ele continua como filho da casa.', { ok: 'Tirar permissões' }))) return;
          await api('PATCH', T(`/auxiliares/${f.auxiliar.vinculo_id}`), { ativo: false });
          aviso('Voltou a ser só filho'); render(true);
          return;
        }
        if (a === 'link-senha') {
          const l = await post(T(`/filhos/${id}/link-senha`));
          folha(html`<h2>Link de nova senha</h2><p>Vale por ${l.expira_em_horas} horas e só pode ser usado uma vez.</p><div class="pix">${l.link}</div>
            ${l.whatsapp ? html`<a class="btn" href="${l.whatsapp}" target="_blank" rel="noopener">Enviar pelo WhatsApp</a>` : ''}<button class="btn sec" data-cp>Copiar link</button><button class="btn sec" data-fechar>Fechar</button>`,
          (el) => $('[data-cp]', el).addEventListener('click', () => navigator.clipboard.writeText(l.link).then(() => aviso('Link copiado'))));
          return;
        }
        if (a === 'excluir') {
          if (!(await confirmar('Excluir só se o próprio filho pediu (LGPD). Os dados pessoais serão apagados e o histórico financeiro mantido sem identificação.', { ok: 'Excluir definitivamente', perigo: true }))) return;
          await api('DELETE', T(`/filhos/${id}`), { pedido_do_titular: true }); aviso('Dados anonimizados'); location.hash = '#/filhos'; return;
        }
        const textos = { bloquear: 'Bloquear o acesso? As pendências continuam.', desligar: 'Desligar da casa? O histórico fica guardado e dá para reativar depois.', afastar: 'Marcar como afastado? Ele deixa de receber mensalidade.' };
        if (textos[a]) { const m = await confirmar(textos[a], { ok: 'Confirmar', perigo: a !== 'afastar', motivo: a === 'bloquear' }); if (!m) return; await post(T(`/filhos/${id}/${a}`), { motivo: typeof m === 'string' ? m : undefined }); }
        else await post(T(`/filhos/${id}/${a}`));
        aviso('Feito'); render(true);
      } catch (e) { aviso(e.message, true); }
    }));
  }

  // ---------------- financeiro (US-22 a US-27) ----------------
  function itemCobranca(c) {
    return html`<button class="item" data-cobranca="${c.id}"><span class="corpo"><strong>${c.descricao}</strong><span class="sutil">${c.filho_nome || c.consulente?.nome || ''}${c.filho_nome || c.consulente ? ' · ' : ''}vence ${dataBR(c.vencimento)} · ${ORIGEM[c.origem]}</span></span><span class="empilha" style="align-items:flex-end"><strong>${brl(c.valor_final_centavos)}</strong>${seloSituacao(c.situacao)}</span></button>`;
  }

  async function folhaCobranca(id) {
    let c;
    try { c = await get(T(`/cobrancas/${id}`)); } catch (e) { return aviso(e.message, true); }
    const sac = S.papel === 'sacerdote';
    folha(html`<div class="lado"><h2>${c.descricao}</h2>${seloSituacao(c.situacao)}</div>
      <div class="cartao empilha" style="gap:6px">
        <div class="lado"><span>Pagador</span><strong>${c.filho_nome || c.consulente?.nome || '—'}</strong></div>
        <div class="lado"><span>Valor</span><strong>${brl(c.valor_centavos)}</strong></div>
        ${c.desconto_centavos ? html`<div class="lado"><span>Desconto</span><strong>− ${brl(c.desconto_centavos)}</strong></div>` : ''}
        <div class="lado"><span>Vencimento</span><strong>${dataBR(c.vencimento)}</strong></div>
        ${c.pago_em ? html`<div class="lado"><span>Pago em</span><strong>${dataBR(c.pago_em)} · ${c.forma_pagamento}</strong></div>` : ''}
        ${c.motivo ? html`<div class="lado"><span>Motivo</span><strong>${c.motivo}</strong></div>` : ''}
      </div>
      ${c.pix_copia_cola && c.status === 'aberta' ? html`<div class="campo"><span class="rotulo">Pix copia e cola</span><div class="pix">${c.pix_copia_cola}</div><button class="btn sec peq" data-copiar>Copiar Pix</button></div>` : ''}
      <div class="lista">
        ${['aberta', 'aguardando_conta'].includes(c.status) ? html`<button class="btn bloco" data-baixa>Recebi em dinheiro</button><button class="btn perigo bloco" data-cancelar>Cancelar cobrança</button>` : ''}
        ${c.status === 'paga' && sac ? html`<button class="btn perigo bloco" data-estornar>Estornar</button>` : ''}
        <button class="btn sec bloco" data-fechar>Fechar</button>
      </div>`, (el, fechar) => {
      $('[data-copiar]', el)?.addEventListener('click', () => navigator.clipboard.writeText(c.pix_copia_cola).then(() => aviso('Pix copiado')));
      const acao = async (fn, msg) => { try { await fn(); fechar(); aviso(msg); render(true); } catch (e) { aviso(e.message, true); } };
      $('[data-baixa]', el)?.addEventListener('click', () => acao(() => post(T(`/cobrancas/${id}/baixa`), { forma: 'dinheiro', data: hoje() }), 'Baixa registrada'));
      $('[data-cancelar]', el)?.addEventListener('click', async () => { fechar(); const m = await confirmar('Cancelar esta cobrança?', { motivo: true, perigo: true, ok: 'Cancelar cobrança' }); if (m) acao(() => post(T(`/cobrancas/${id}/cancelar`), { motivo: m }), 'Cobrança cancelada'); });
      $('[data-estornar]', el)?.addEventListener('click', async () => { fechar(); const m = await confirmar('Estornar o pagamento?', { motivo: true, perigo: true, ok: 'Estornar' }); if (m) acao(() => post(T(`/cobrancas/${id}/estornar`), { motivo: m }), 'Estorno registrado'); });
    });
  }

  async function telaFinanceiro() {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const aba = q.get('aba') || 'cobrancas';
    const sit = q.get('situacao') || 'vencida';
    const podeDesp = !S.terreiro.permissoes || S.terreiro.permissoes.despesas;
    let corpo = '';
    if (aba === 'cobrancas') {
      const r = await get(T(`/cobrancas?limite=100${sit !== 'todas' ? '&situacao=' + sit : ''}`));
      corpo = html`<div class="chips">${[['vencida', 'Vencidas'], ['a_vencer', 'A vencer'], ['paga', 'Pagas'], ['aguardando_conta', 'Aguardando conta'], ['todas', 'Todas']].map(([k, l]) => html`<button class="chip" aria-pressed="${k === sit}" data-sit="${k}">${l}</button>`)}</div>
        <p class="sutil">${r.total} cobrança(s)</p><div class="lista">${r.itens.map(itemCobranca)}${r.itens.length ? '' : html`<div class="vazio">Nada por aqui.</div>`}</div>`;
    } else if (aba === 'lotes') {
      const l = await get(T('/lotes'));
      corpo = html`<div class="lista">${l.map((x) => html`<a class="item" href="#/financeiro?aba=cobrancas&situacao=todas"><span class="corpo"><strong>${x.descricao}</strong><span class="sutil">${x.quantidade} filhos · vence ${dataBR(x.vencimento)}</span></span><span class="empilha" style="align-items:flex-end"><strong>${brl(x.total_centavos)}</strong><span class="sutil">${x.pagas}/${x.quantidade} pagas</span></span></a>`)}${l.length ? '' : html`<div class="vazio">Nenhum lote ainda.</div>`}</div>`;
    } else {
      const comp = q.get('comp') || competenciaAtual();
      const d = await get(T(`/despesas?competencia=${comp}`));
      const total = d.reduce((s, x) => s + x.valor_centavos, 0);
      corpo = html`<div class="lado"><input type="month" id="mes" value="${comp}" aria-label="Mês" style="max-width:200px"><strong>${brl(total)}</strong></div>
        <form class="cartao form" id="fd"><div class="grade2"><div class="campo"><label for="cat">Categoria</label><select id="cat" name="categoria">${['velas', 'ervas', 'animais', 'aluguel', 'luz', 'agua', 'obras', 'festas', 'materiais', 'outros'].map((c) => html`<option value="${c}">${c[0].toUpperCase() + c.slice(1)}</option>`)}</select></div>
          <div class="campo"><label for="vd">Valor</label><input id="vd" name="valor" type="text" inputmode="decimal" placeholder="0,00" required></div></div>
          <div class="grade2"><div class="campo"><label for="dd">Data</label><input id="dd" name="data" type="date" value="${hoje()}"></div><div class="campo"><label for="ds">Descrição</label><input id="ds" name="descricao" type="text"></div></div>
          <button class="btn peq" type="submit">Lançar despesa</button></form>
        <div class="lista">${d.map((x) => html`<div class="item"><span class="corpo"><strong>${x.categoria[0].toUpperCase() + x.categoria.slice(1)}</strong><span class="sutil">${dataBR(x.data)}${x.descricao ? ' · ' + x.descricao : ''}</span></span><strong>${brl(x.valor_centavos)}</strong>${S.papel === 'sacerdote' ? html`<button class="icone-btn" aria-label="Excluir despesa" data-del="${x.id}">✕</button>` : ''}</div>`)}</div>`;
    }
    telaNav('financeiro', html`${topo('Financeiro', html`<a class="btn peq" href="#/cobranca/nova">+ Cobrança</a>`)}
      <main class="conteudo"><div class="segmento" role="tablist">${[['cobrancas', 'Cobranças'], ['lotes', 'Lotes'], ...(podeDesp ? [['despesas', 'Despesas']] : [])].map(([k, l]) => html`<button role="tab" aria-selected="${k === aba}" data-aba="${k}">${l}</button>`)}</div>
      ${S.papel === 'sacerdote' ? html`<a class="item" href="#/mensalidade"><span class="corpo"><strong>Mensalidade automática</strong><span class="sutil">${S.terreiro.mensalidade?.ativa ? `${brl(S.terreiro.mensalidade.valor_centavos)} · vence dia ${S.terreiro.mensalidade.dia_vencimento}` : 'Desligada — toque para configurar'}</span></span>›</a>` : ''}
      ${corpo}</main>`);
    $$('[data-aba]').forEach((b) => (b.onclick = () => (location.hash = `#/financeiro?aba=${b.dataset.aba}`)));
    $$('[data-sit]').forEach((b) => (b.onclick = () => (location.hash = `#/financeiro?aba=cobrancas&situacao=${b.dataset.sit}`)));
    $$('[data-cobranca]').forEach((b) => (b.onclick = () => folhaCobranca(b.dataset.cobranca)));
    $('#mes')?.addEventListener('change', (e) => (location.hash = `#/financeiro?aba=despesas&comp=${e.target.value}`));
    $$('[data-del]').forEach((b) => (b.onclick = async () => { if (await confirmar('Excluir esta despesa?', { perigo: true, ok: 'Excluir' })) { await api('DELETE', T(`/despesas/${b.dataset.del}`)); render(true); } }));
    if ($('#fd')) aoEnviar($('#fd'), async (fd) => {
      const v = lerBRL(fd.get('valor'));
      if (!(v > 0)) throw new ErroApi(400, { erro: { mensagem: 'Informe o valor', detalhes: { campo: 'valor' } } });
      await post(T('/despesas'), { categoria: fd.get('categoria'), valor_centavos: v, data: fd.get('data'), descricao: fd.get('descricao') || undefined });
      aviso('Despesa lançada'); render(true);
    });
  }

  async function telaMensalidade() {
    const m = S.terreiro.mensalidade || {};
    telaBarra('Mensalidade automática', html`<form class="form" id="f">
      <label class="alternar"><span class="empilha"><strong>Gerar mensalidade todo mês</strong><span class="sutil">Uma cobrança por filho ativo e não isento</span></span><input type="checkbox" name="ativa" ${raw(m.ativa !== false ? 'checked' : '')}></label>
      <div class="campo"><label for="v">Valor</label><input id="v" name="valor" type="text" inputmode="decimal" value="${paraCampoBRL(m.valor_centavos) || ''}" placeholder="50,00" required></div>
      <div class="grade2"><div class="campo"><label for="g">Dia de gerar</label><input id="g" name="dia_geracao" type="number" min="1" max="28" value="${m.dia_geracao || 1}"></div>
        <div class="campo"><label for="ve">Dia de vencer</label><input id="ve" name="dia_vencimento" type="number" min="1" max="28" value="${m.dia_vencimento || 10}"></div></div>
      <fieldset class="campo"><legend>Quem entra no meio do mês paga</legend>
        <label class="opcao"><input type="radio" name="entrada" value="integral" ${raw(m.entrada !== 'proporcional' ? 'checked' : '')}><span>O mês inteiro</span></label>
        <label class="opcao"><input type="radio" name="entrada" value="proporcional" ${raw(m.entrada === 'proporcional' ? 'checked' : '')}><span>Só os dias restantes</span></label></fieldset>
      <label class="alternar"><span>Gerar a deste mês agora</span><input type="checkbox" name="gerar_agora"></label>
    </form>`, { voltar: '#/financeiro', rodape: html`<button class="btn" type="submit" form="f">Salvar</button>` });
    aoEnviar($('#f'), async (fd) => {
      const r = await api('PUT', T('/mensalidade'), {
        ativa: fd.get('ativa') === 'on', valor_centavos: lerBRL(fd.get('valor')), dia_geracao: Number(fd.get('dia_geracao')), dia_vencimento: Number(fd.get('dia_vencimento')),
        entrada: fd.get('entrada'), gerar_agora: fd.get('gerar_agora') === 'on',
      });
      S.terreiro = null;
      aviso(r.geracao ? `Salvo · ${r.geracao.geradas} cobranças geradas` : 'Mensalidade salva');
      location.hash = '#/financeiro';
    });
  }

  async function telaNovaCobranca() {
    const modo = new URLSearchParams(location.hash.split('?')[1] || '').get('modo') || 'lote';
    const [grupos, filhos] = await Promise.all([get(T('/grupos')), get(T('/filhos?status=ativo&limite=200'))]);
    telaBarra('Nova cobrança', html`<form class="form" id="f">
      <div class="segmento" role="tablist"><button type="button" role="tab" aria-selected="${modo === 'lote'}" data-modo="lote">Em lote</button><button type="button" role="tab" aria-selected="${modo === 'individual'}" data-modo="individual">Individual</button><button type="button" role="tab" aria-selected="false" data-modo="mensalidade">Mensalidade</button></div>
      <div class="campo"><label for="d">Descrição</label><input id="d" name="descricao" type="text" placeholder="${modo === 'lote' ? 'Festa de Iemanjá · contribuição' : 'Velas e ervas'}" required></div>
      <div class="grade2"><div class="campo"><label for="v">${modo === 'lote' ? 'Valor por filho' : 'Valor'}</label><input id="v" name="valor" type="text" inputmode="decimal" placeholder="40,00" required></div>
        <div class="campo"><label for="ve">Vencimento</label><input id="ve" name="vencimento" type="date" value="${somarDias(hoje(), 10)}" min="${hoje()}" required></div></div>
      ${modo === 'lote' ? html`<fieldset class="campo"><legend>Quem paga</legend>
          <label class="opcao"><input type="radio" name="pub" value="todos" checked><span style="flex:1">Todos os filhos ativos</span><span class="sutil">${filhos.total}</span></label>
          <label class="opcao"><input type="radio" name="pub" value="grupos"><span style="flex:1">Um ou mais grupos</span></label>
          <div class="chips" id="gr" hidden>${grupos.map((g) => html`<button type="button" class="chip" aria-pressed="false" data-g="${g.id}">${g.nome} · ${g.filhos}</button>`)}</div></fieldset>
        <label class="alternar"><span>Avisar também por WhatsApp</span><input type="checkbox" name="whatsapp" checked></label>
        <div class="cartao" style="border:1px dashed #8F9790" id="previa"><span class="rotulo">Prévia</span><div class="sutil">Preencha o valor para ver o total.</div></div>`
        : html`<div class="campo"><label for="fi">Filho</label><select id="fi" name="filho_id" required><option value="">Escolha</option>${filhos.itens.map((f) => html`<option value="${f.id}">${f.nome_civil}</option>`)}</select></div>`}
    </form>`, { rodape: html`<button class="btn" type="submit" form="f" id="enviar">${modo === 'lote' ? 'Gerar cobranças' : 'Criar cobrança'}</button>` });
    $$('[data-modo]').forEach((b) => (b.onclick = () => (location.hash = b.dataset.modo === 'mensalidade' ? '#/mensalidade' : `#/cobranca/nova?modo=${b.dataset.modo}`)));
    if (modo === 'lote') {
      const publico = () => {
        const tipo = $('input[name=pub]:checked').value;
        return tipo === 'todos' ? { tipo } : { tipo, ids: $$('[data-g][aria-pressed=true]').map((b) => b.dataset.g) };
      };
      const atualizar = async () => {
        $('#gr').hidden = $('input[name=pub]:checked').value !== 'grupos';
        const v = lerBRL($('#v').value);
        const p = publico();
        if (!(v > 0) || (p.tipo === 'grupos' && !p.ids.length)) return;
        try {
          const r = await post(T('/lotes/previa'), { valor_centavos: v, publico: p });
          $('#previa').innerHTML = html`<span class="rotulo">Prévia</span><div>${r.quantidade} filhos × ${brl(v)}</div><div class="grande">${brl(r.total_centavos)}</div><div class="sutil">${r.isentos_excluidos ? `${r.isentos_excluidos} isento(s) não serão cobrados · ` : ''}cada filho recebe sua própria cobrança com Pix e boleto</div>`.s;
          $('#enviar').textContent = `Gerar ${r.quantidade} cobranças`;
        } catch { /* prévia é opcional */ }
      };
      $('#v').addEventListener('input', atualizar);
      $$('input[name=pub]').forEach((r) => r.addEventListener('change', atualizar));
      $$('[data-g]').forEach((b) => (b.onclick = () => { b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true'); atualizar(); }));
    }
    aoEnviar($('#f'), async (fd) => {
      const v = lerBRL(fd.get('valor'));
      if (!(v >= 100)) throw new ErroApi(400, { erro: { mensagem: 'Valor mínimo R$ 1,00', detalhes: { campo: 'valor' } } });
      if (modo === 'lote') {
        const tipo = fd.get('pub');
        const p = tipo === 'todos' ? { tipo } : { tipo, ids: $$('[data-g][aria-pressed=true]').map((b) => b.dataset.g) };
        const r = await post(T('/lotes'), { descricao: fd.get('descricao'), valor_centavos: v, vencimento: fd.get('vencimento'), publico: p, canais: fd.get('whatsapp') ? ['push', 'whatsapp'] : ['push'] });
        aviso(`${r.quantidade} cobranças geradas`);
      } else {
        await post(T('/cobrancas'), { filho_id: fd.get('filho_id'), descricao: fd.get('descricao'), valor_centavos: v, vencimento: fd.get('vencimento') });
        aviso('Cobrança criada');
      }
      location.hash = '#/financeiro?aba=cobrancas&situacao=a_vencer';
    });
  }

  // ---------------- trabalho individual (US-24) ----------------
  async function telaNovoTrabalho() {
    const pre = new URLSearchParams(location.hash.split('?')[1] || '').get('filho');
    const [servicos, filhos] = await Promise.all([get(T('/servicos')), get(T('/filhos?status=ativo&limite=200'))]);
    const ativos = servicos.filter((s) => s.ativo);
    telaBarra('Novo trabalho', html`<form class="form" id="f">
      <div class="campo"><label for="fi">Filho</label><select id="fi" name="filho_id" required><option value="">Escolha</option>${filhos.itens.map((f) => html`<option value="${f.id}" ${raw(f.id === pre ? 'selected' : '')}>${f.nome_civil}${f.nome_santo ? ' · ' + f.nome_santo : ''}</option>`)}</select></div>
      <fieldset class="campo"><legend>Serviço</legend><div class="chips">${ativos.map((s, i) => html`<button type="button" class="chip" aria-pressed="${i === 0}" data-s="${s.id}" data-preco="${s.preco_sugerido_centavos}" data-nome="${s.nome}">${s.nome}</button>`)}</div></fieldset>
      <div class="grade2"><div class="campo"><label for="v">Valor</label><input id="v" name="valor" type="text" inputmode="decimal" value="${paraCampoBRL(ativos[0]?.preco_sugerido_centavos)}" placeholder="0,00"><span class="ajuda">Sugerido no catálogo</span></div>
        <div class="campo"><label for="dt">Data e hora</label><input id="dt" name="data" type="datetime-local" value="${somarDias(hoje(), 7)}T09:00" required></div></div>
      <div class="campo"><label for="p">Preceitos para o filho</label><textarea id="p" name="preceitos" rows="3" placeholder="Ex.: Resguardo de 3 dias. Trazer roupa branca."></textarea></div>
      <div class="campo"><label for="pa">Pagamento</label><select id="pa" name="parcelas">${[1, 2, 3, 4, 5, 6, 10, 12].map((n) => html`<option value="${n}">${n === 1 ? 'À vista' : `${n}x`}</option>`)}</select></div>
      <div class="cartao empilha" style="gap:10px" id="resumo"></div>
    </form>`, { rodape: html`<button class="btn" type="submit" form="f">Salvar trabalho</button>` });
    const resumo = () => {
      const dt = $('#dt').value; const v = lerBRL($('#v').value) || 0; const n = Number($('#pa').value);
      const nome = $('#fi').selectedOptions[0]?.textContent.split(' · ')[0] || 'o filho';
      $('#resumo').innerHTML = html`<span class="rotulo">Ao salvar, o app cria</span>
        <div>✓ Evento na agenda · ${dt ? quando(isoLocal(dt)) : '—'}</div>
        <div>✓ ${v ? (n > 1 ? `${n} cobranças de ${brl(Math.floor(v / n))}` : `Cobrança de ${brl(v)}`) : 'Sem cobrança (valor zero)'}</div>
        <div>✓ Aviso privado para ${nome} com os preceitos</div>`.s;
    };
    $$('[data-s]').forEach((b) => (b.onclick = () => { $$('[data-s]').forEach((x) => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); $('#v').value = paraCampoBRL(Number(b.dataset.preco)); resumo(); }));
    ['#dt', '#v', '#pa', '#fi'].forEach((s) => $(s).addEventListener('input', resumo));
    resumo();
    aoEnviar($('#f'), async (fd) => {
      const s = $('[data-s][aria-pressed=true]');
      if (!s) throw new ErroApi(400, { erro: { mensagem: 'Escolha o serviço' } });
      const r = await post(T('/trabalhos'), {
        filho_id: fd.get('filho_id'), servico_id: s.dataset.s, valor_centavos: lerBRL(fd.get('valor')) || 0, data: isoLocal(fd.get('data')),
        preceitos: fd.get('preceitos') || undefined, parcelas: Number(fd.get('parcelas')),
      });
      aviso('Trabalho salvo: agenda, cobrança e aviso criados');
      location.hash = `#/filhos/${r.trabalho.filho_id}`;
    });
  }

  // ---------------- agenda (US-19 a US-21) ----------------
  async function telaAgenda() {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const de = q.get('de') || hoje();
    const ate = somarDias(de, 27);
    const ev = await get(T(`/eventos?de=${de}&ate=${ate}`));
    const porDia = {};
    ev.forEach((e) => { const d = new Date(e.inicio).toLocaleDateString('sv-SE', { timeZone: TZ }); (porDia[d] = porDia[d] || []).push(e); });
    const filho = S.papel === 'filho';
    const titulo = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
    telaNav('agenda', html`${topo('Agenda', filho ? html`<a class="btn peq" href="#/buzios">Búzios</a>` : html`<a class="btn peq" href="#/agenda/novo">+ Evento</a>`)}
      <main class="conteudo">
        <div class="lado"><a class="btn sec peq" href="#/agenda?de=${somarDias(de, -28)}">‹ Anterior</a><span class="sutil">${dataBR(de)} a ${dataBR(ate)}</span><a class="btn sec peq" href="#/agenda?de=${somarDias(de, 28)}">Próximo ›</a></div>
        ${filho ? '' : html`<a class="item" href="#/buzios"><span class="faixa" style="background:#B7791F"></span><span class="corpo"><strong>Jogo de búzios</strong><span class="sutil">Horários, bloqueios e agendamentos</span></span>›</a>`}
        ${Object.keys(porDia).sort().map((d) => html`<section class="secao"><h3 style="text-transform:capitalize">${titulo(d)}</h3><div class="lista">${porDia[d].map(itemEvento)}</div></section>`)}
        ${ev.length ? '' : html`<div class="vazio">Nenhum compromisso neste período.</div>`}
      </main>`);
    $$('[data-evento]').forEach((b) => (b.onclick = () => folhaEvento(ev.find((e) => e.id === b.dataset.evento))));
  }

  function folhaEvento(e) {
    const staff = S.papel !== 'filho';
    folha(html`<div class="lado"><h2>${e.titulo}</h2><span class="selo cinza">${TIPOS[e.tipo]}</span></div>
      <div class="cartao empilha" style="gap:6px"><div>${quando(e.inicio)}${e.fim ? ' até ' + new Date(e.fim).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : ''}</div>
      ${e.descricao ? html`<p class="sutil">${e.descricao}</p>` : ''}${e.filho_nome ? html`<div>Filho: <strong>${e.filho_nome}</strong></div>` : ''}${e.consulente ? html`<div>Consulente: <strong>${e.consulente.nome}</strong></div>` : ''}
      ${e.cancelado ? html`<span class="selo vermelho">Cancelado</span>` : ''}</div>
      <div class="lista">
        ${staff && !e.cancelado && ['gira', 'festa', 'outro'].includes(e.tipo) ? html`<a class="btn bloco" href="#/gira/${e.id}">Comunicar e ver presença</a>` : ''}
        ${!e.cancelado && (staff || e.tipo === 'buzios') ? html`<button class="btn perigo bloco" data-c="1">Cancelar esta data</button>${e.serie_id && staff ? html`<button class="btn perigo bloco" data-c="serie">Cancelar esta e as próximas</button>` : ''}` : ''}
        <button class="btn sec bloco" data-fechar>Fechar</button></div>`, (el, fechar) => {
      $$('[data-c]', el).forEach((b) => (b.onclick = async () => {
        try { const r = await post(T(`/eventos/${e.id}/cancelar`), { serie: b.dataset.c === 'serie' }); fechar(); aviso(`${r.cancelados} data(s) cancelada(s)`); render(true); } catch (err) { aviso(err.message, true); }
      }));
    });
  }

  async function telaNovoEvento() {
    telaBarra('Novo evento', html`<form class="form" id="f">
      <fieldset class="campo"><legend>Tipo</legend><div class="chips">${['gira', 'festa', 'obrigacao', 'outro'].map((t, i) => html`<button type="button" class="chip" aria-pressed="${i === 0}" data-t="${t}">${TIPOS[t]}</button>`)}</div></fieldset>
      <div class="campo"><label for="ti">Título</label><input id="ti" name="titulo" type="text" placeholder="Gira de Caboclo" required></div>
      <div class="grade2"><div class="campo"><label for="ini">Início</label><input id="ini" name="inicio" type="datetime-local" value="${somarDias(hoje(), 1)}T19:30" required></div>
        <div class="campo"><label for="fim">Fim</label><input id="fim" name="fim" type="datetime-local"></div></div>
      <div class="campo"><label for="de">Descrição</label><textarea id="de" name="descricao" rows="2"></textarea></div>
      <label class="alternar"><span class="empilha"><strong>Repetir toda semana</strong><span class="sutil">Ex.: gira toda sexta</span></span><input type="checkbox" name="repetir" id="rep"></label>
      <div class="campo" id="ateC" hidden><label for="ate">Repetir até</label><input id="ate" name="ate" type="date" value="${somarDias(hoje(), 90)}"></div>
    </form>`, { rodape: html`<button class="btn" type="submit" form="f">Salvar</button>` });
    $$('[data-t]').forEach((b) => (b.onclick = () => { $$('[data-t]').forEach((x) => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); }));
    $('#rep').onchange = (e) => ($('#ateC').hidden = !e.target.checked);
    aoEnviar($('#f'), async (fd) => {
      const r = await post(T('/eventos'), {
        tipo: $('[data-t][aria-pressed=true]').dataset.t, titulo: fd.get('titulo'), inicio: isoLocal(fd.get('inicio')), fim: fd.get('fim') ? isoLocal(fd.get('fim')) : undefined,
        descricao: fd.get('descricao') || undefined, recorrencia: fd.get('repetir') ? { freq: 'semanal', ate: fd.get('ate') } : undefined,
      });
      aviso(r.quantidade > 1 ? `${r.quantidade} datas criadas` : 'Evento criado');
      location.hash = '#/agenda';
    });
  }

  async function telaGira({ id }) {
    const ev = (await get(T(`/eventos?de=${somarDias(hoje(), -1)}&ate=${somarDias(hoje(), 400)}`))).find((e) => e.id === id);
    const [p, avisos] = await Promise.all([get(T(`/eventos/${id}/presencas`)), get(T('/avisos?limite=200'))]);
    const comunicado = avisos.find((a) => a.evento_id === id);
    const tot = Math.max(1, p.vou + p.nao_vou + p.sem_resposta);
    telaBarra(ev ? ev.titulo : 'Gira', html`
      ${ev ? html`<div class="sutil">${quando(ev.inicio)}</div>` : ''}
      ${comunicado ? html`<div class="cartao info">Comunicado publicado no mural · lido por ${comunicado.lidos} de ${comunicado.destinatarios}</div>` : html`<form class="cartao form" id="fc"><h2>Comunicar a corrente</h2>
          <div class="campo"><label for="pr">Preceitos (um por linha)</label><textarea id="pr" name="preceitos" rows="3" placeholder="Roupa branca completa&#10;Chegar até 19h"></textarea></div>
          <label class="alternar"><span>Avisar também por WhatsApp</span><input type="checkbox" name="whatsapp" checked></label>
          <button class="btn" type="submit">Publicar no mural</button></form>`}
      <div class="cartao empilha" style="gap:8px"><div class="barra-tripla"><div style="width:${(p.vou / tot) * 100}%;background:var(--verde)"></div><div style="width:${(p.nao_vou / tot) * 100}%;background:var(--ambar)"></div></div>
        <div class="lado" style="font-size:14px"><span><b>${p.vou}</b> vão</span><span><b>${p.nao_vou}</b> não vão</span><span><b>${p.sem_resposta}</b> sem resposta</span><span><b>${p.checkins}</b> chegaram</span></div></div>
      <div class="lista">${p.itens.map((f) => html`<div class="item"><span class="corpo"><strong>${f.nome_civil}</strong><span class="sutil">${f.resposta === 'vou' ? 'Vai' : f.resposta === 'nao_vou' ? 'Não vai' : 'Sem resposta'}</span></span>${f.checkin_em ? html`<span class="selo verde">Chegou</span>` : html`<button class="btn sec peq" data-ck="${f.id}">Chegou</button>`}</div>`)}</div>`, { voltar: '#/agenda' });
    if ($('#fc')) aoEnviar($('#fc'), async (fd) => {
      await post(T(`/eventos/${id}/comunicar`), { preceitos: String(fd.get('preceitos') || '').split('\n').map((s) => s.trim()).filter(Boolean), canais: fd.get('whatsapp') ? ['push', 'whatsapp'] : ['push'] });
      aviso('Comunicado publicado'); render(true);
    });
    $$('[data-ck]').forEach((b) => (b.onclick = async () => { await post(T(`/eventos/${id}/checkin`), { filho_id: b.dataset.ck }); render(true); }));
  }

  async function telaBuzios() {
    const filho = S.papel === 'filho';
    const data = new URLSearchParams(location.hash.split('?')[1] || '').get('data') || hoje();
    const [disp, horas, filhos] = await Promise.all([get(T('/buzios/disponibilidade')), get(T(`/buzios/horarios?data=${data}`)), filho ? null : get(T('/filhos?status=ativo&limite=200'))]);
    const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    telaBarra('Jogo de búzios', html`
      <div class="campo"><label for="dia">Dia</label><input id="dia" type="date" value="${data}" min="${hoje()}"></div>
      <section class="secao"><h2>Horários livres</h2><div class="chips">${horas.map((h) => html`<button class="chip" data-h="${h.inicio}" data-v="${h.valor_centavos}">${new Date(h.inicio).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })}</button>`)}</div>
        ${horas.length ? html`<span class="sutil">Valor: ${brl(horas[0].valor_centavos)}</span>` : html`<div class="cartao sutil">Sem horários livres neste dia.</div>`}</section>
      ${filho ? '' : html`<section class="secao"><h2>Horários de atendimento</h2><div class="lista">${disp.horarios.map((h) => html`<div class="item"><span class="corpo"><strong>${DIAS[h.dia_semana]}</strong><span class="sutil">${h.hora_inicio.slice(0, 5)}–${h.hora_fim.slice(0, 5)} · ${h.duracao_min} min · ${brl(h.valor_centavos)}</span></span><button class="icone-btn" aria-label="Remover" data-rm="${h.id}">✕</button></div>`)}</div>
        <form class="cartao form" id="fd"><div class="grade2"><div class="campo"><label for="ds">Dia</label><select id="ds" name="dia_semana">${DIAS.map((d, i) => html`<option value="${i}">${d}</option>`)}</select></div><div class="campo"><label for="du">Duração (min)</label><input id="du" name="duracao_min" type="number" value="60" min="10"></div></div>
          <div class="grade2"><div class="campo"><label for="hi">Das</label><input id="hi" name="hora_inicio" type="time" value="09:00"></div><div class="campo"><label for="hf">Até</label><input id="hf" name="hora_fim" type="time" value="12:00"></div></div>
          <div class="campo"><label for="vb">Valor</label><input id="vb" name="valor" type="text" inputmode="decimal" placeholder="150,00"></div><button class="btn peq" type="submit">Adicionar horário</button></form>
        <div class="lado"><span>Bloquear este dia</span><button class="btn sec peq" id="bloq">${disp.bloqueios.includes(data) ? 'Desbloquear' : 'Bloquear'} ${dataBR(data)}</button></div></section>`}`, { voltar: '#/agenda' });
    $('#dia').onchange = (e) => (location.hash = `#/buzios?data=${e.target.value}`);
    $$('[data-h]').forEach((b) => (b.onclick = () => folha(html`<h2>Agendar ${quando(b.dataset.h)}</h2><form class="form" id="fa">
        ${filho ? html`<p>Valor: <strong>${brl(Number(b.dataset.v))}</strong>. A cobrança aparece em Pagamentos.</p>` : html`<fieldset class="campo"><legend>Para quem</legend><label class="opcao"><input type="radio" name="quem" value="filho" checked><span>Filho da casa</span></label><label class="opcao"><input type="radio" name="quem" value="consulente"><span>Consulente</span></label></fieldset>
          <div class="campo" id="cf"><label for="fl">Filho</label><select id="fl" name="filho_id">${filhos.itens.map((f) => html`<option value="${f.id}">${f.nome_civil}</option>`)}</select></div>
          <div class="campo" id="cc" hidden><label for="cn">Nome do consulente</label><input id="cn" name="nome" type="text"><label for="ct">Telefone</label><input id="ct" name="telefone" type="tel"></div>`}
        <button class="btn" type="submit">Confirmar</button></form>`, (el, fechar) => {
      $$('input[name=quem]', el).forEach((r) => (r.onchange = () => { const c = $('input[name=quem]:checked', el).value === 'consulente'; $('#cc', el).hidden = !c; $('#cf', el).hidden = c; }));
      aoEnviar($('#fa', el), async (fd) => {
        const corpo = { inicio: b.dataset.h };
        if (!filho) { if (fd.get('quem') === 'consulente') corpo.consulente = { nome: fd.get('nome'), telefone: fd.get('telefone') || undefined }; else corpo.filho_id = fd.get('filho_id'); }
        await post(T('/buzios/agendar'), corpo); fechar(); aviso('Agendado'); render(true);
      });
    })));
    if (!filho) {
      $$('[data-rm]').forEach((b) => (b.onclick = async () => { await api('DELETE', T(`/buzios/disponibilidade/${b.dataset.rm}`)); render(true); }));
      $('#bloq').onclick = async () => { if (disp.bloqueios.includes(data)) await api('DELETE', T(`/buzios/bloqueios/${data}`)); else await post(T('/buzios/bloqueios'), { data }); render(true); };
      aoEnviar($('#fd'), async (fd) => { await post(T('/buzios/disponibilidade'), { dia_semana: Number(fd.get('dia_semana')), hora_inicio: fd.get('hora_inicio'), hora_fim: fd.get('hora_fim'), duracao_min: Number(fd.get('duracao_min')), valor_centavos: lerBRL(fd.get('valor')) || 0 }); aviso('Horário adicionado'); render(true); });
    }
  }

  // ---------------- mural (US-16 a US-18) ----------------
  async function telaMural() {
    const avisos = await get(T('/avisos?limite=100'));
    const filho = S.papel === 'filho';
    telaNav('mural', html`${topo('Mural', filho ? '' : html`<a class="btn peq" href="#/mural/novo">+ Novo aviso</a>`)}
      <main class="conteudo">${avisos.map((a) => cartaoAviso(a, filho))}${avisos.length ? '' : html`<div class="vazio">Nenhum aviso.</div>`}</main>`);
    if (filho) {
      $$('[data-ler]').forEach((el) => post(T(`/avisos/${el.dataset.ler}/lido`)).catch(() => {}));
      $$('[data-pres]').forEach((b) => (b.onclick = async () => { try { await post(T(`/eventos/${b.dataset.ev}/presenca`), { resposta: b.dataset.pres }); aviso('Resposta enviada'); render(true); } catch (e) { aviso(e.message, true); } }));
    } else {
      $$('[data-leituras]').forEach((b) => (b.onclick = async () => {
        const r = await get(T(`/avisos/${b.dataset.leituras}/leituras`));
        folha(html`<h2>Leituras · ${r.lidos} de ${r.total}</h2><div class="lista">${r.itens.map((i) => html`<div class="item"><span class="corpo"><strong>${i.nome_civil}</strong></span>${i.lido_em ? html`<span class="selo verde">Leu</span>` : html`<span class="selo cinza">Não leu</span>`}</div>`)}</div><button class="btn sec" data-fechar>Fechar</button>`);
      }));
      $$('[data-excluir]').forEach((b) => (b.onclick = async () => { if (await confirmar('Excluir este aviso?', { perigo: true, ok: 'Excluir' })) { await api('DELETE', T(`/avisos/${b.dataset.excluir}`)); render(true); } }));
    }
  }

  function cartaoAviso(a, filho) {
    const gira = a.categoria === 'gira';
    const tot = Math.max(1, a.destinatarios || 1);
    return html`<article class="cartao g empilha ${a.fixado && !a.expirado ? 'destaque' : ''}" style="gap:10px" ${raw(filho && !a.lido ? `data-ler="${esc(a.id)}"` : '')}>
      <div class="lado"><span class="selo ${gira ? 'verde' : a.categoria === 'privado' ? 'roxo' : 'cinza'}">${a.fixado ? 'FIXADO · ' : ''}${gira ? 'GIRA' : a.categoria === 'privado' ? 'SÓ PARA VOCÊ' : 'AVISO'}</span><span class="sutil">${new Date(a.created_at).toLocaleDateString('pt-BR', { timeZone: TZ })}</span></div>
      <h2>${a.titulo}</h2>${a.texto ? html`<p style="white-space:pre-line">${a.texto}</p>` : ''}
      ${a.preceitos?.length ? html`<ul style="margin:0;padding-left:18px;line-height:1.5">${a.preceitos.map((p) => html`<li>${p}</li>`)}</ul>` : ''}
      ${a.imagem_url ? html`<img src="${a.imagem_url}" alt="" style="width:100%;border-radius:10px">` : ''}
      ${filho && gira && a.evento_id ? html`<div class="grade2"><button class="btn ${a.minha_presenca === 'vou' ? '' : 'contorno'} peq" data-pres="vou" data-ev="${a.evento_id}">${a.minha_presenca === 'vou' ? '✓ ' : ''}Vou</button><button class="btn ${a.minha_presenca === 'nao_vou' ? '' : 'sec'} peq" data-pres="nao_vou" data-ev="${a.evento_id}">Não vou</button></div>` : ''}
      ${!filho ? html`<div class="lado" style="border-top:1px solid var(--linha);padding-top:10px"><button class="btn sec peq" data-leituras="${a.id}">Lido por ${a.lidos} de ${a.destinatarios}</button>
        ${gira && a.evento_id ? html`<a href="#/gira/${a.evento_id}">Presença ›</a>` : html`<button class="icone-btn" aria-label="Excluir aviso" data-excluir="${a.id}">✕</button>`}</div>` : ''}
      ${!filho && gira ? html`<div class="barra-tripla" aria-hidden="true"><div style="width:${(a.lidos / tot) * 100}%;background:var(--verde)"></div></div>` : ''}
    </article>`;
  }

  async function telaNovoAviso() {
    const [grupos, filhos] = await Promise.all([get(T('/grupos')), get(T('/filhos?status=ativo&limite=200'))]);
    telaBarra('Novo aviso', html`<form class="form" id="f">
      <div class="campo"><label for="t">Título</label><input id="t" name="titulo" type="text" required maxlength="140"></div>
      <div class="campo"><label for="x">Mensagem</label><textarea id="x" name="texto" rows="4"></textarea></div>
      <fieldset class="campo"><legend>Para quem</legend>
        <label class="opcao"><input type="radio" name="pub" value="todos" checked><span>Todos</span></label>
        <label class="opcao"><input type="radio" name="pub" value="grupos"><span>Grupos</span></label>
        <div class="chips" id="pg" hidden>${grupos.map((g) => html`<button type="button" class="chip" aria-pressed="false" data-id="${g.id}">${g.nome}</button>`)}</div>
        <label class="opcao"><input type="radio" name="pub" value="filhos"><span>Filhos específicos</span></label>
        <div class="chips" id="pf" hidden>${filhos.itens.map((f) => html`<button type="button" class="chip" aria-pressed="false" data-id="${f.id}">${f.nome_civil}</button>`)}</div></fieldset>
      <label class="alternar"><span>Fixar no topo</span><input type="checkbox" name="fixado"></label>
      <div class="campo"><label for="va">Válido até</label><input id="va" name="valido_ate" type="date" min="${hoje()}"></div>
      <label class="alternar"><span>Avisar também por WhatsApp</span><input type="checkbox" name="whatsapp"></label>
      <div class="cartao info">A notificação no celular diz só "Você tem um novo aviso", sem o conteúdo, para proteger a privacidade de cada um.</div>
    </form>`, { rodape: html`<button class="btn" type="submit" form="f">Publicar</button>` });
    $$('input[name=pub]').forEach((r) => (r.onchange = () => { const v = $('input[name=pub]:checked').value; $('#pg').hidden = v !== 'grupos'; $('#pf').hidden = v !== 'filhos'; }));
    $$('[data-id]').forEach((b) => (b.onclick = () => b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true')));
    aoEnviar($('#f'), async (fd) => {
      const tipo = fd.get('pub');
      const publico = tipo === 'todos' ? { tipo } : { tipo, ids: $$(`#${tipo === 'grupos' ? 'pg' : 'pf'} [aria-pressed=true]`).map((b) => b.dataset.id) };
      const r = await post(T('/avisos'), { titulo: fd.get('titulo'), texto: fd.get('texto') || undefined, publico, fixado: fd.get('fixado') === 'on', valido_ate: fd.get('valido_ate') || undefined, canais: fd.get('whatsapp') ? ['push', 'whatsapp'] : ['push'] });
      aviso(`Publicado para ${r.destinatarios} filho(s)`);
      location.hash = '#/mural';
    });
  }

  // ---------------- configurações ----------------
  async function telaConfig({ sec }) {
    const t = S.terreiro;
    const sac = S.papel === 'sacerdote';
    if (sec === 'assinatura') {
      const f = await get(T('/assinatura'));
      telaBarra('Assinatura', html`<div class="cartao">Plano <strong>${t.plano?.nome || '—'}</strong> · ${brl(t.plano?.preco_centavos)}/mês</div>
        <div class="lista">${f.map((x) => html`<div class="cartao empilha" style="gap:8px"><div class="lado"><strong>${x.competencia}</strong>${x.status === 'paga' ? html`<span class="selo verde">Paga</span>` : x.vencimento < hoje() ? html`<span class="selo ambar">Vencida</span>` : html`<span class="selo cinza">Em aberto</span>`}</div>
          <div class="lado"><span>${brl(x.valor_centavos)}</span><span class="sutil">vence ${dataBR(x.vencimento)}</span></div>
          ${x.status === 'aberta' && x.pix_copia_cola ? html`<div class="pix">${x.pix_copia_cola}</div><button class="btn sec peq" data-pix="${x.pix_copia_cola}">Copiar Pix</button>` : ''}</div>`)}${f.length ? '' : html`<div class="vazio">Nenhuma fatura ainda${t.teste_ate ? ` — teste grátis até ${dataBR(t.teste_ate)}` : ''}.</div>`}</div>`, { voltar: '#/config' });
      $$('[data-pix]').forEach((b) => (b.onclick = () => navigator.clipboard.writeText(b.dataset.pix).then(() => aviso('Pix copiado'))));
      return;
    }
    if (sec === 'conta') {
      telaBarra('Conta de recebimento', html`
        <div class="cartao ${t.gateway_conta_status === 'aprovada' ? 'info' : 'alerta'}">Situação: <strong>${{ nao_conectada: 'não conectada', pendente: 'em análise', aprovada: 'aprovada', recusada: 'recusada' }[t.gateway_conta_status]}</strong></div>
        <p class="sutil">O dinheiro das mensalidades e trabalhos cai direto nesta conta, em nome da casa. A plataforma não toca no valor.</p>
        ${t.gateway_conta_status !== 'aprovada' && t.gateway_conta_status !== 'pendente' ? html`<form class="form" id="f">
          <div class="campo"><label for="n">Nome do titular</label><input id="n" name="nome" type="text" value="${t.responsavel_nome}" required></div>
          <div class="campo"><label for="d">CPF ou CNPJ</label><input id="d" name="documento" type="text" inputmode="numeric" value="${t.documento}" required></div>
          <div class="campo"><label for="e">E-mail</label><input id="e" name="email" type="email" value="${t.email}" required></div>
          <div class="campo"><label for="tel">Celular</label><input id="tel" name="telefone" type="tel" value="${t.telefone || ''}" required></div>
          <div class="campo" id="c-nasc"><label for="nasc">Data de nascimento do titular</label><input id="nasc" name="nascimento" type="date"></div>
          <div class="campo" id="c-tipo" hidden><label for="tipo">Tipo de empresa</label><select id="tipo" name="tipo_empresa"><option value="ASSOCIATION">Associação / entidade religiosa</option><option value="MEI">MEI</option><option value="LIMITED">Limitada (Ltda)</option><option value="INDIVIDUAL">Empresário individual</option></select></div>
          <div class="grade2"><div class="campo"><label for="cep">CEP</label><input id="cep" name="cep" type="text" inputmode="numeric" required></div><div class="campo"><label for="num">Número</label><input id="num" name="numero" type="text" required></div></div>
          <div class="campo"><label for="end">Endereço</label><input id="end" name="endereco" type="text" value="${t.endereco || ''}" required></div>
          <div class="campo"><label for="bai">Bairro</label><input id="bai" name="bairro" type="text" required></div>
          <p class="sutil">Esses dados vão para o banco parceiro abrir a conta, que passa por análise.</p>
          <button class="btn" type="submit">Enviar para análise</button></form>` : ''}`, { voltar: '#/config' });
      if ($('#f')) {
        const tipoDoc = () => { const cnpj = $('#d').value.replace(/\D/g, '').length === 14; $('#c-nasc').hidden = cnpj; $('#c-tipo').hidden = !cnpj; };
        $('#d').addEventListener('input', tipoDoc); tipoDoc();
        aoEnviar($('#f'), async (fd) => { await post(T('/conta-recebimento'), Object.fromEntries([...fd].filter(([, v]) => v))); S.terreiro = null; aviso('Enviado para análise'); render(true); });
      }
      return;
    }
    const [servicos, grupos, auxiliares, entidades] = await Promise.all([
      get(T('/servicos')), get(T('/grupos')), sac ? get(T('/auxiliares')) : [], sac ? get(T('/entidades?todos=true')) : [],
    ]);
    const onb = t.onboarding || { etapas: [] };
    const ETAPA = { dados_casa: 'Dados da casa', tradicao: 'Tradição', mensalidade: 'Valor da mensalidade', conta_recebimento: 'Conta de recebimento' };
    telaBarra('Configurações', html`
      ${sac ? html`<section class="secao"><h2>Primeiros passos</h2><div class="lista">${onb.etapas.map((e) => html`<div class="item"><span class="corpo"><strong>${ETAPA[e]}</strong><span class="sutil">${onb[e] === 'feita' ? 'Feito' : onb[e] === 'pulada' ? 'Pulado — dá para voltar' : 'Pendente'}</span></span>${onb[e] === 'feita' ? html`<span class="selo verde">✓</span>` : html`<button class="btn sec peq" data-pular="${e}">${onb[e] === 'pulada' ? 'Marcar feito' : 'Pular'}</button>`}</div>`)}</div></section>` : ''}
      ${sac ? html`<form class="cartao form" id="fc"><h2>Dados da casa</h2>
        <div class="campo"><label for="n">Nome</label><input id="n" name="nome" type="text" value="${t.nome}"></div>
        <div class="grade2"><div class="campo"><label for="tr">Tradição</label><select id="tr" name="tradicao">${['Umbanda', 'Candomblé', 'Quimbanda', 'Umbandomblé', 'Outra'].map((x) => html`<option ${raw(t.tradicao === x ? 'selected' : '')}>${x}</option>`)}</select></div>
          <div class="campo"><label for="cor">Cor</label><input id="cor" name="cor" type="color" value="${t.cor || '#0F5C4D'}" style="height:48px;padding:4px"></div></div>
        <div class="grade2"><div class="campo"><label for="ng">Como chamam a gira</label><input id="ng" name="gira" type="text" value="${t.nomenclatura?.gira || 'Gira'}"></div>
          <div class="campo"><label for="np">Como chamam o pai de cabeça</label><input id="np" name="pai_cabeca" type="text" value="${t.nomenclatura?.pai_cabeca || 'Pai de cabeça'}"></div></div>
        <button class="btn peq" type="submit">Salvar</button></form>` : ''}
      <div class="lista">
        ${sac ? html`<a class="item" href="#/config/conta"><span class="corpo"><strong>Conta de recebimento</strong><span class="sutil">${{ nao_conectada: 'Não conectada', pendente: 'Em análise', aprovada: 'Aprovada', recusada: 'Recusada' }[t.gateway_conta_status]}</span></span>›</a>
          <a class="item" href="#/mensalidade"><span class="corpo"><strong>Mensalidade</strong><span class="sutil">${t.mensalidade?.ativa ? brl(t.mensalidade.valor_centavos) : 'Desligada'}</span></span>›</a>
          <a class="item" href="#/config/assinatura"><span class="corpo"><strong>Assinatura</strong><span class="sutil">Plano ${t.plano?.nome || ''}${t.status === 'teste' ? ` · teste até ${dataBR(t.teste_ate)}` : ''}</span></span>›</a>` : ''}
      </div>
      <section class="secao"><h2>Catálogo de trabalhos</h2><div class="lista">${servicos.map((s) => html`<div class="item"><span class="corpo"><strong>${s.nome}</strong><span class="sutil">Preço sugerido</span></span>${sac ? html`<input type="text" inputmode="decimal" style="width:110px;height:44px" value="${paraCampoBRL(s.preco_sugerido_centavos)}" data-preco="${s.id}" aria-label="Preço de ${s.nome}">` : html`<strong>${brl(s.preco_sugerido_centavos)}</strong>`}</div>`)}</div>
        ${sac ? html`<form class="lado" id="fs"><input name="nome" type="text" placeholder="Novo trabalho" required><input name="preco" type="text" inputmode="decimal" placeholder="0,00" style="width:110px"><button class="btn peq" type="submit">+</button></form>` : ''}</section>
      <section class="secao"><h2>Grupos</h2><div class="chips">${grupos.map((g) => html`<span class="chip">${g.nome} · ${g.filhos}</span>`)}</div>
        <form class="lado" id="fg"><input name="nome" type="text" placeholder="Novo grupo" required><button class="btn peq" type="submit">+</button></form></section>
      ${sac ? html`<section class="secao"><h2>Orixás e entidades da casa</h2><p class="sutil">Toque para mostrar ou esconder nas listas.</p><div class="chips">${entidades.map((e) => html`<button class="chip" aria-pressed="${!e.oculto}" data-ent="${e.id}">${e.nome}</button>`)}</div>
          <form class="lado" id="fe"><select name="tipo" style="width:130px"><option value="orixa">Orixá</option><option value="entidade">Entidade</option></select><input name="nome" type="text" placeholder="Nome" required><button class="btn peq" type="submit">+</button></form></section>
        <section class="secao"><h2>Auxiliares</h2><p class="sutil">Pai/Mãe Pequeno, Ogã, tesoureiro. Escolha o que cada um pode fazer. Se a pessoa já é filho da casa, use o mesmo e-mail dela (ou "Tornar auxiliar" na ficha do filho) — ela continua vendo as próprias mensalidades.</p>
          <div class="lista">${auxiliares.map((a) => html`<div class="cartao empilha" style="gap:8px"><div class="lado"><span class="empilha"><strong>${a.nome || a.email || a.telefone}</strong>${a.filho_id ? html`<span class="sutil">Também é filho da casa</span>` : ''}</span><span class="lado" style="gap:6px">${a.convite_pendente ? html`<span class="selo roxo">Convidado</span>` : ''}<button class="icone-btn" aria-label="Remover auxiliar" data-rmaux="${a.id}" data-filho="${a.filho_id ? 1 : ''}">✕</button></span></div>
            <div class="chips">${[['filhos', 'Filhos'], ['mural', 'Mural'], ['agenda', 'Agenda'], ['financeiro', 'Financeiro'], ['despesas', 'Despesas'], ['dashboard', 'Painel']].map(([k, l]) => html`<button class="chip" aria-pressed="${a.permissoes[k] !== false && (a.permissoes[k] || ['filhos', 'mural', 'agenda'].includes(k))}" data-aux="${a.id}" data-perm="${k}">${l}</button>`)}</div></div>`)}</div>
          <form class="cartao form" id="fa"><div class="campo"><label for="an">Nome</label><input id="an" name="nome" type="text" required></div><div class="campo"><label for="ae">E-mail</label><input id="ae" name="email" type="email" required></div><button class="btn peq" type="submit">Convidar auxiliar</button></form></section>
        <section class="secao"><h2>Suporte</h2><button class="btn sec" id="suporte">Liberar acesso do suporte por 24h</button></section>` : ''}
      ${await secaoConta()}
      <button class="btn perigo" id="sair">Sair</button>`, { voltar: '#/' });
    $$('[data-pular]').forEach((b) => (b.onclick = async () => { await post(T('/onboarding'), { etapa: b.dataset.pular, situacao: b.textContent.includes('feito') ? 'feita' : 'pulada' }); S.terreiro = null; render(true); }));
    if ($('#fc')) aoEnviar($('#fc'), async (fd) => {
      await api('PATCH', T(''), { nome: fd.get('nome'), tradicao: fd.get('tradicao'), cor: fd.get('cor'), nomenclatura: { gira: fd.get('gira'), pai_cabeca: fd.get('pai_cabeca') } });
      for (const e of ['dados_casa', 'tradicao']) await post(T('/onboarding'), { etapa: e, situacao: 'feita' });
      S.terreiro = null; aviso('Dados salvos'); render(true);
    });
    $$('[data-preco]').forEach((i) => i.addEventListener('change', async () => { await api('PATCH', T(`/servicos/${i.dataset.preco}`), { preco_sugerido_centavos: lerBRL(i.value) || 0 }); aviso('Preço salvo'); }));
    if ($('#fs')) aoEnviar($('#fs'), async (fd) => { await post(T('/servicos'), { nome: fd.get('nome'), preco_sugerido_centavos: lerBRL(fd.get('preco')) || 0 }); render(true); });
    aoEnviar($('#fg'), async (fd) => { await post(T('/grupos'), { nome: fd.get('nome') }); render(true); });
    $$('[data-ent]').forEach((b) => (b.onclick = async () => { const visivel = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', visivel); await api('PATCH', T(`/entidades/${b.dataset.ent}`), { oculto: !visivel }); }));
    if ($('#fe')) aoEnviar($('#fe'), async (fd) => { await post(T('/entidades'), Object.fromEntries(fd)); render(true); });
    $$('[data-aux]').forEach((b) => (b.onclick = async () => { const v = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', v); await api('PATCH', T(`/auxiliares/${b.dataset.aux}`), { permissoes: Object.fromEntries($$(`[data-aux="${b.dataset.aux}"]`).map((x) => [x.dataset.perm, x.getAttribute('aria-pressed') === 'true'])) }); aviso('Permissões salvas'); }));
    $$('[data-rmaux]').forEach((b) => (b.onclick = async () => {
      const filho = b.dataset.filho;
      if (!(await confirmar(filho ? 'Tirar as permissões de auxiliar? Ele continua como filho da casa.' : 'Remover o acesso deste auxiliar?', { ok: 'Remover', perigo: !filho }))) return;
      await api('PATCH', T(`/auxiliares/${b.dataset.rmaux}`), { ativo: false }); aviso('Auxiliar removido'); render(true);
    }));
    if ($('#fa')) aoEnviar($('#fa'), async (fd) => {
      const r = await post(T('/auxiliares'), Object.fromEntries(fd));
      if (r.convite) folha(html`<h2>Convite criado</h2><p>Envie este link para ${r.nome}. Ele vale 7 dias.</p><div class="pix">${r.convite.link}</div><button class="btn" data-cp>Copiar link</button><button class="btn sec" data-fechar>Fechar</button>`, (el) => $('[data-cp]', el).onclick = () => navigator.clipboard.writeText(r.convite.link).then(() => aviso('Link copiado')));
      else aviso(r.filho_id ? 'Filho agora também é auxiliar' : 'Auxiliar adicionado');
      render(true);
    });
    $('#suporte')?.addEventListener('click', async () => { await post(T('/assinatura/consentir-suporte'), { horas: 24 }); aviso('Suporte liberado por 24 horas'); });
    ligarSecaoConta();
    $('#sair').onclick = () => sair();
  }

  // ---------------- área do filho (US-28, US-30) ----------------
  async function telaInicioFilho() {
    const d = await get(T('/meu/inicio'));
    const p = d.pendencias;
    const prox = d.proximo_compromisso;
    telaNav('inicio', html`${topo(`Olá, ${d.filho.nome_civil.split(' ')[0]}`)}
      <main class="conteudo">
        ${p.quantidade ? html`<section class="cartao g alerta empilha" style="gap:12px" aria-label="Pagamentos em aberto"><strong>${p.quantidade} pagamento${p.quantidade > 1 ? 's' : ''} em aberto${p.vencidas ? ` · ${p.vencidas} vencido${p.vencidas > 1 ? 's' : ''}` : ''}</strong>
          ${p.itens.slice(0, 3).map((c) => html`<div class="lado" style="align-items:flex-end"><div class="empilha"><span style="font-size:17px;font-weight:600;color:var(--texto)">${c.descricao}</span><span style="font-size:14px">${c.situacao === 'vencida' ? 'Venceu' : 'Vence'} ${dataBR(c.vencimento)}</span></div><span class="grande" style="color:var(--texto)">${brl(c.valor_final_centavos)}</span></div>`)}
          <a class="btn" href="#/pagar/${p.itens[0].id}">Pagar com Pix</a></section>` : ''}
        ${prox ? html`<section class="cartao g empilha" style="gap:10px"><span class="rotulo">Próximo compromisso</span><div class="empilha"><span style="font-size:18px;font-weight:700">${prox.titulo}</span><span class="sutil">${quando(prox.inicio)}</span></div>
          ${prox.preceitos?.length ? html`<ul style="margin:0;padding-left:18px">${prox.preceitos.map((x) => html`<li>${x}</li>`)}</ul>` : ''}
          ${prox.tipo === 'gira' ? html`<div class="grade2"><button class="btn ${prox.minha_presenca === 'vou' ? '' : 'contorno'}" data-pres="vou">${prox.minha_presenca === 'vou' ? '✓ ' : ''}Vou</button><button class="btn ${prox.minha_presenca === 'nao_vou' ? '' : 'sec'}" data-pres="nao_vou">Não vou</button></div>` : ''}</section>` : ''}
        <section class="secao"><div class="secao-topo"><h2>Avisos novos</h2><a href="#/mural">Ver mural</a></div>
          <div class="lista">${d.avisos_nao_lidos.itens.map((a) => html`<a class="item" href="#/mural"><span class="ponto"></span><span class="corpo"><strong>${a.titulo}</strong><span class="sutil">${a.categoria === 'privado' ? 'Só para você' : new Date(a.created_at).toLocaleDateString('pt-BR', { timeZone: TZ })}</span></span>›</a>`)}${d.avisos_nao_lidos.quantidade ? '' : html`<div class="cartao sutil">Nenhum aviso novo.</div>`}</div></section>
        ${d.mensalidade_do_mes ? html`<div class="cartao lado"><span>Mensalidade deste mês</span>${d.mensalidade_do_mes.status === 'paga' ? html`<strong style="color:var(--verde)">✓ Paga</strong>` : html`<span class="selo ambar">Em aberto</span>`}</div>` : ''}
      </main>`);
    $$('[data-pres]').forEach((b) => (b.onclick = async () => { try { await post(T(`/eventos/${prox.id}/presenca`), { resposta: b.dataset.pres }); aviso('Resposta enviada'); render(true); } catch (e) { aviso(e.message, true); } }));
  }

  async function telaPagamentos() {
    const c = await get(T('/meu/cobrancas'));
    telaNav('pagamentos', html`${topo(S.papel === 'filho' ? 'Pagamentos' : 'Meus pagamentos')}<main class="conteudo">${S.papel !== 'filho' ? html`<a class="item" href="#/perfil"><span class="corpo"><strong>Meu perfil de filho</strong><span class="sutil">Dados, notificações e senha</span></span>›</a>` : ''}<div class="lista">${c.map((x) => html`<a class="item" href="#/pagar/${x.id}"><span class="corpo"><strong>${x.descricao}</strong><span class="sutil">${x.status === 'paga' ? 'Pago em ' + dataBR(x.pago_em) : 'Vence ' + dataBR(x.vencimento)}</span></span><span class="empilha" style="align-items:flex-end"><strong>${brl(x.valor_final_centavos)}</strong>${seloSituacao(x.situacao)}</span></a>`)}${c.length ? '' : html`<div class="vazio">Nenhum pagamento.</div>`}</div></main>`);
  }

  async function telaPagar({ id }) {
    const c = await get(T(`/meu/cobrancas/${id}`));
    const recibo = c.status === 'paga' ? await get(T(`/meu/cobrancas/${id}/recibo`)) : null;
    telaBarra(c.descricao, html`
      <div class="cartao g empilha" style="gap:6px"><div class="lado"><span>Valor</span><span class="grande">${brl(c.valor_final_centavos)}</span></div>${c.desconto_centavos ? html`<div class="sutil">Desconto de ${brl(c.desconto_centavos)} já aplicado</div>` : ''}<div class="lado"><span>Vencimento</span><strong>${dataBR(c.vencimento)}</strong></div><div>${seloSituacao(c.situacao)}</div></div>
      ${['aberta'].includes(c.status) && c.pix_copia_cola ? html`<section class="secao"><h2>Pix copia e cola</h2><p class="sutil">Abra o app do seu banco, escolha Pix › Copia e cola e cole o código.</p><div class="pix" id="pix">${c.pix_copia_cola}</div><button class="btn bloco" id="copiar">Copiar código Pix</button></section>
        ${c.boleto_linha ? html`<section class="secao"><h2>Boleto</h2><div class="pix">${c.boleto_linha}</div><button class="btn sec bloco" id="copiarB">Copiar linha do boleto</button></section>` : ''}
        ${c.link_pagamento ? html`<a class="btn sec bloco" href="${c.link_pagamento}" target="_blank" rel="noopener">Pagar com cartão ou ver o boleto</a>` : ''}
        <p class="sutil">Assim que o banco confirmar, o pagamento aparece aqui como pago e você recebe o recibo.</p>` : ''}
      ${c.status === 'aberta' && c.pix_pendente ? html`<div class="cartao alerta">O Pix desta cobrança ainda está sendo gerado. Tente de novo em alguns minutos.</div>` : ''}
      ${recibo ? html`<section class="cartao g empilha" style="gap:6px"><span class="rotulo">Recibo nº ${recibo.numero}</span><div>${recibo.terreiro}</div><div>Recebemos de <strong>${recibo.pagador}</strong> o valor de <strong>${brl(recibo.valor_centavos)}</strong> referente a ${recibo.descricao}.</div><div class="sutil">Pago em ${new Date(recibo.pago_em).toLocaleString('pt-BR', { timeZone: TZ })} · ${recibo.forma_pagamento}</div><button class="btn sec peq" onclick="window.print()">Imprimir ou salvar</button></section>` : ''}`, { voltar: '#/pagamentos' });
    $('#copiar')?.addEventListener('click', () => navigator.clipboard.writeText(c.pix_copia_cola).then(() => aviso('Código Pix copiado')));
    $('#copiarB')?.addEventListener('click', () => navigator.clipboard.writeText(c.boleto_linha).then(() => aviso('Linha copiada')));
  }

  async function telaPerfil() {
    const p = await get(T('/meu/perfil'));
    telaNav('perfil', html`${topo('Meu perfil')}<main class="conteudo">
      <form class="cartao form" id="f"><div class="campo"><label for="ns">Nome de santo</label><input id="ns" name="nome_santo" type="text" value="${p.nome_santo || ''}"></div>
        <div class="campo"><label for="em">E-mail</label><input id="em" name="email" type="email" value="${p.email || ''}"></div>
        <div class="campo"><label for="te">WhatsApp</label><input id="te" name="telefone" type="tel" value="${p.telefone || ''}"></div><button class="btn peq" type="submit">Salvar</button></form>
      ${p.consentimento_religioso ? html`<section class="cartao empilha" style="gap:6px"><span class="rotulo">Perfil espiritual</span><div>Pai de cabeça: <strong>${p.pai_cabeca || '—'}</strong></div><div>Mãe de cabeça: <strong>${p.mae_cabeca || '—'}</strong></div>
        ${p.obrigacoes.map((o) => html`<div class="sutil">${dataBR(o.data)} · ${o.tipo}</div>`)}<span class="sutil">Para corrigir, fale com o sacerdote.</span></section>` : ''}
      <section class="secao"><h2>Meus dados (LGPD)</h2>
        <button class="btn sec" id="baixar">Baixar meus dados</button>
        <label class="alternar"><span class="empilha"><strong>Usar meus dados religiosos</strong><span class="sutil">Desligar apaga orixás, guias e obrigações</span></span><input type="checkbox" id="rel" ${raw(p.consentimento_religioso ? 'checked' : '')}></label>
        <button class="btn perigo" id="excluir">Pedir exclusão dos meus dados</button>
        <span class="sutil">Termo aceito em ${p.consentimento_em ? new Date(p.consentimento_em).toLocaleDateString('pt-BR') : '—'} (versão ${p.consentimento_versao || '—'})</span></section>
      ${await secaoConta()}
      ${S.vinculos.length > 1 ? html`<a class="btn sec" href="#/escolher">Trocar de casa</a>` : ''}
      <button class="btn perigo" id="sair">Sair</button></main>`);
    ligarSecaoConta();
    aoEnviar($('#f'), async (fd) => { await api('PATCH', T('/meu/perfil'), Object.fromEntries([...fd].map(([k, v]) => [k, v || null]))); aviso('Perfil salvo'); });
    $('#baixar').onclick = async () => {
      const d = await get(T('/meu/dados'));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
      a.download = 'meus-dados.json'; a.click();
    };
    $('#rel').onchange = async (e) => {
      if (!e.target.checked && !(await confirmar('Apagar seus dados religiosos?', { perigo: true, ok: 'Apagar' }))) { e.target.checked = true; return; }
      await post(T('/meu/consentimento'), { religioso: e.target.checked }); aviso('Preferência salva'); render(true);
    };
    $('#excluir').onclick = async () => { const m = await confirmar('Pedir a exclusão dos seus dados ao terreiro?', { motivo: true, perigo: true, ok: 'Enviar pedido' }); if (m) { const r = await post(T('/meu/pedido-exclusao'), { motivo: m }); aviso(r.mensagem); } };
    $('#sair').onclick = () => sair();
  }

  // ---------------- admin da plataforma (US-01 a US-05) ----------------
  async function telaAdmin() {
    const busca = sessionStorage.getItem('th_abusca') || '';
    const [m, t, planos, integ] = await Promise.all([get('/api/admin/metricas'), get(`/api/admin/terreiros?limite=100${busca ? '&busca=' + encodeURIComponent(busca) : ''}`), get('/api/admin/planos'), get('/api/admin/integracoes')]);
    const ST = { teste: 'roxo', ativo: 'verde', aviso: 'ambar', somente_leitura: 'ambar', bloqueado: 'vermelho', encerrado: 'cinza' };
    document.body.classList.remove('com-nav');
    app().innerHTML = html`<header class="topo"><div class="casa">Painel da plataforma</div><div class="linha"><h1>Terreiros</h1><button class="btn peq" id="novo">+ Terreiro</button></div></header>
      <main class="conteudo">
        <div class="grade2"><div class="kpi"><span>Ativos</span><span>${m.terreiros_ativos}</span></div><div class="kpi"><span>Em teste</span><span>${m.terreiros_teste}</span></div>
          <div class="kpi"><span>MRR</span><span>${brl(m.mrr_centavos)}</span></div><div class="kpi ${m.inadimplencia_centavos ? 'alerta' : ''}"><span>Inadimplência</span><span>${brl(m.inadimplencia_centavos)}</span></div>
          <div class="kpi"><span>Filhos ativos</span><span>${m.filhos_ativos.toLocaleString('pt-BR')}</span></div><div class="kpi"><span>Cancelados 30d</span><span>${m.churn_30d}</span></div></div>
        <input type="text" id="busca" placeholder="Buscar nome ou CPF/CNPJ" value="${busca}" aria-label="Buscar terreiro">
        <div class="lista">${t.itens.map((x) => html`<button class="item" data-t="${x.id}"><span class="corpo"><strong>${x.nome}</strong><span class="sutil">${x.plano || '—'} · ${x.filhos_ativos} filhos · ${x.responsavel_nome}</span></span><span class="selo ${ST[x.status]}">${x.status.replace('_', ' ')}</span></button>`)}</div>
        <section class="secao"><h2>Planos</h2><div class="lista">${planos.map((p) => html`<div class="item"><span class="corpo"><strong>${p.nome}</strong><span class="sutil">${p.limite_filhos ? `até ${p.limite_filhos} filhos` : 'ilimitado'}</span></span><strong>${brl(p.preco_centavos)}</strong></div>`)}</div></section>
        <section class="secao"><h2>Integrações</h2><div class="lista">
          <div class="item"><span class="corpo"><strong>Pagamentos · ${integ.gateway.nome === 'asaas' ? 'Asaas' : 'simulado'}</strong><span class="sutil">${integ.gateway.base || 'nenhuma cobrança real'}</span></span><button class="btn sec peq" data-testar="gateway">Testar</button></div>
          ${['whatsapp', 'email', 'push'].map((k) => html`<div class="item"><span class="corpo"><strong>${{ whatsapp: 'WhatsApp', email: 'E-mail', push: 'Notificação no aparelho' }[k]}</strong><span class="sutil">${integ.canais[k].ativo ? '' : 'Desligado · '}${integ.canais[k].observacao}</span></span>${integ.canais[k].ativo ? html`<button class="btn sec peq" data-testar="${k}">Testar</button>` : html`<span class="selo cinza">Configurar</span>`}</div>`)}
        </div>
        ${integ.ultimas_falhas.length ? html`<details class="cartao"><summary>Últimas falhas de envio (${integ.ultimas_falhas.length})</summary>${integ.ultimas_falhas.map((f) => html`<div class="sutil" style="margin-top:6px">${f.canal} · ${new Date(f.created_at).toLocaleString('pt-BR', { timeZone: TZ })} · ${f.erro}</div>`)}</details>` : ''}</section>
        ${await secaoConta()}
        <button class="btn sec" id="rotinas">Rodar rotinas agora</button>
        ${S.vinculos.length ? html`<a class="btn sec" href="#/escolher">Ir para um terreiro</a>` : ''}
        <button class="btn perigo" id="sair">Sair</button>
      </main>`;
    let tm;
    $('#busca').addEventListener('input', (e) => { clearTimeout(tm); tm = setTimeout(() => { sessionStorage.setItem('th_abusca', e.target.value); render(true); }, 350); });
    $('#sair').onclick = () => sair();
    ligarSecaoConta();
    $$('[data-testar]').forEach((b) => (b.onclick = async () => {
      const canal = b.dataset.testar;
      let extra = {};
      if (canal === 'whatsapp') { const tel = prompt('Número para o teste (com DDD):', S.usuario.telefone || ''); if (!tel) return; extra = { telefone: tel }; }
      if (canal === 'push' && !(await inscricaoAtual())) { try { await ativarPush(); } catch (e) { return aviso(e.message, true); } }
      b.disabled = true; b.textContent = 'Testando…';
      try {
        const r = await post('/api/admin/integracoes/testar', { canal, ...extra });
        folha(html`<h2>Teste · ${canal}</h2><div class="cartao ${r.ok ? 'info' : 'erro'}">${r.ok ? 'Funcionou.' : 'Falhou: ' + (r.motivo || 'veja os passos abaixo')}</div>
          ${r.passos ? html`<div class="lista">${r.passos.map((p) => html`<div class="item"><span class="corpo"><strong>${p.ok ? '✓' : '✕'} ${p.passo}</strong><span class="sutil">${typeof p.detalhe === 'string' ? p.detalhe : JSON.stringify(p.detalhe)}</span></span></div>`)}</div>` : ''}
          ${r.destino ? html`<p class="sutil">Enviado para ${r.destino}.</p>` : ''}<button class="btn sec" data-fechar>Fechar</button>`);
      } catch (e) { aviso(e.message, true); }
      b.disabled = false; b.textContent = 'Testar';
    }));
    $('#rotinas').onclick = async () => { const r = await post('/api/admin/rotinas/rodar'); aviso(`Faturas: ${r.faturas.geradas} · Mensalidades: ${r.mensalidades.geradas} · Mudanças de status: ${r.regua.mudancas.length}`); render(true); };
    $('#novo').onclick = () => folha(html`<h2>Novo terreiro</h2><form class="form" id="fn">
      <div class="campo"><label for="tn">Nome do terreiro</label><input id="tn" name="nome" type="text" required></div>
      <div class="campo"><label for="td">CPF ou CNPJ</label><input id="td" name="documento" type="text" inputmode="numeric" required></div>
      <div class="campo"><label for="tr">Responsável</label><input id="tr" name="responsavel_nome" type="text" required></div>
      <div class="campo"><label for="te">E-mail do responsável</label><input id="te" name="email" type="email" required></div>
      <div class="campo"><label for="tt">Telefone</label><input id="tt" name="telefone" type="tel"></div>
      <div class="campo"><label for="tp">Plano</label><select id="tp" name="plano_id">${planos.map((p) => html`<option value="${p.id}">${p.nome} · ${brl(p.preco_centavos)}</option>`)}</select></div>
      <button class="btn" type="submit">Criar e gerar convite</button></form>`, (el, fechar) => aoEnviar($('#fn', el), async (fd) => {
      const r = await post('/api/admin/terreiros', Object.fromEntries([...fd].filter(([, v]) => v)));
      fechar();
      folha(html`<h2>Terreiro criado</h2><p>Teste grátis até ${dataBR(r.terreiro.teste_ate)}. Envie o convite ao responsável:</p>${r.convite ? html`<div class="pix">${r.convite.link}</div><button class="btn" data-cp>Copiar link</button>` : html`<p>O responsável já tem conta e pode entrar direto.</p>`}<button class="btn sec" data-fechar>Fechar</button>`,
        (el2) => $('[data-cp]', el2)?.addEventListener('click', () => navigator.clipboard.writeText(r.convite.link).then(() => aviso('Link copiado'))));
      render(true);
    }));
    $$('[data-t]').forEach((b) => (b.onclick = async () => {
      const x = await get(`/api/admin/terreiros/${b.dataset.t}`);
      folha(html`<div class="lado"><h2>${x.nome}</h2><span class="selo ${ST[x.status]}">${x.status.replace('_', ' ')}</span></div>
        <div class="cartao empilha" style="gap:4px"><div>${x.responsavel_nome} · ${x.email}</div><div class="sutil">Documento ${x.documento} · criado em ${new Date(x.created_at).toLocaleDateString('pt-BR')}</div>${x.motivo_bloqueio ? html`<div class="sutil">Motivo: ${x.motivo_bloqueio}</div>` : ''}</div>
        <h3>Faturas</h3><div class="lista">${x.faturas.map((f) => html`<div class="lado"><span>${f.competencia} · ${brl(f.valor_centavos)}</span><span class="selo ${f.status === 'paga' ? 'verde' : f.vencimento < hoje() ? 'ambar' : 'cinza'}">${f.status}</span></div>`)}${x.faturas.length ? '' : html`<span class="sutil">Nenhuma fatura.</span>`}</div>
        <div class="lista">${['bloqueado', 'encerrado'].includes(x.status) ? html`<button class="btn contorno" data-a="desbloquear">Desbloquear</button>` : html`<button class="btn perigo" data-a="bloquear">Bloquear</button>`}
          ${x.status !== 'encerrado' ? html`<button class="btn perigo" data-a="encerrar">Encerrar</button>` : ''}<button class="btn sec" data-a="exportar">Exportar dados</button><button class="btn sec" data-a="link-senha">Link de nova senha do sacerdote</button><button class="btn sec" data-fechar>Fechar</button></div>`, (el, fechar) => {
        $$('[data-a]', el).forEach((a) => (a.onclick = async () => {
          const ac = a.dataset.a;
          if (ac === 'link-senha') {
            try {
              const l = await post(`/api/admin/terreiros/${x.id}/link-senha`);
              fechar();
              folha(html`<h2>Link para ${l.nome}</h2><p>Vale por ${l.expira_em_horas} horas, uso único.</p><div class="pix">${l.link}</div><button class="btn" data-cp>Copiar link</button><button class="btn sec" data-fechar>Fechar</button>`,
                (el2) => $('[data-cp]', el2).addEventListener('click', () => navigator.clipboard.writeText(l.link).then(() => aviso('Link copiado'))));
            } catch (e) { aviso(e.message, true); }
            return;
          }
          if (ac === 'exportar') { const d = await get(`/api/admin/terreiros/${x.id}/exportacao`); const l = document.createElement('a'); l.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })); l.download = `terreiro-${x.id}.json`; l.click(); return; }
          fechar();
          const m = ac === 'desbloquear' ? true : await confirmar(ac === 'bloquear' ? 'Bloquear este terreiro?' : 'Encerrar este terreiro? A exportação fica disponível por 90 dias.', { motivo: ac === 'bloquear', perigo: true, ok: ac === 'bloquear' ? 'Bloquear' : 'Encerrar' });
          if (!m) return;
          await post(`/api/admin/terreiros/${x.id}/${ac}`, { motivo: typeof m === 'string' ? m : undefined }); aviso('Feito'); render(true);
        }));
      });
    }));
  }

  // ---------------- roteador ----------------
  const ROTAS = [
    ['/entrar', telaEntrar, 'publico'], ['/convite/:token', telaConvite, 'publico'], ['/esqueci', telaEsqueci, 'publico'], ['/redefinir/:token', telaRedefinir, 'publico'], ['/escolher', telaEscolher, 'logado'], ['/admin', telaAdmin, 'admin'],
    ['/', { staff: telaInicioSacerdote, filho: telaInicioFilho }], ['/filhos', telaFilhos, 'staff'], ['/filhos/novo', telaNovoFilho, 'staff'], ['/filhos/:id', telaFilho, 'staff'],
    ['/financeiro', telaFinanceiro, 'staff'], ['/cobranca/nova', telaNovaCobranca, 'staff'], ['/mensalidade', telaMensalidade, 'staff'], ['/trabalho/novo', telaNovoTrabalho, 'staff'],
    ['/agenda', telaAgenda], ['/agenda/novo', telaNovoEvento, 'staff'], ['/gira/:id', telaGira, 'staff'], ['/buzios', telaBuzios],
    ['/mural', telaMural], ['/mural/novo', telaNovoAviso, 'staff'], ['/config', telaConfig, 'staff'], ['/config/:sec', telaConfig, 'staff'],
    ['/pagamentos', telaPagamentos, 'filho'], ['/pagar/:id', telaPagar, 'filho'], ['/perfil', telaPerfil, 'filho'],
  ];

  function casar(caminho) {
    for (const [padrao, fn, acesso] of ROTAS) {
      const a = padrao.split('/'); const b = caminho.split('/');
      if (a.length !== b.length) continue;
      const params = {};
      if (a.every((p, i) => (p.startsWith(':') ? ((params[p.slice(1)] = decodeURIComponent(b[i])), true) : p === b[i]))) return { fn, acesso, params };
    }
    return null;
  }

  let renderizando = 0;
  async function render(manterRolagem = false) {
    const id = ++renderizando;
    S.geracao = id;
    const caminho = (location.hash.slice(1) || '/').split('?')[0] || '/';
    const rota = casar(caminho);
    const y = window.scrollY;
    try {
      if (!rota) { location.hash = '#/'; return; }
      if (rota.acesso === 'publico') return await rota.fn(rota.params);
      if (!S.token) { location.hash = '#/entrar'; return; }
      if (!S.usuario) { const eu = await get('/api/auth/eu'); S.usuario = eu.usuario; S.vinculos = eu.vinculos; }
      if (rota.acesso === 'logado') return rota.fn(rota.params);
      if (rota.acesso === 'admin') { if (!S.usuario.is_admin) { location.hash = '#/'; return; } return await rota.fn(rota.params); }
      if (!S.vinculo) {
        if (S.vinculos.length === 1) escolherTerreiro(S.vinculos[0].terreiro_id);
        else { location.hash = S.vinculos.length ? '#/escolher' : S.usuario.is_admin ? '#/admin' : '#/entrar'; return; }
      }
      if (!manterRolagem) carregando();
      if (!S.terreiro) S.terreiro = await get(T(''));
      const filho = S.papel === 'filho';
      if ((rota.acesso === 'staff' && filho) || (rota.acesso === 'filho' && !filho && !S.terreiro?.filho_id)) { location.hash = '#/'; return; }
      const fn = typeof rota.fn === 'object' ? rota.fn[filho ? 'filho' : 'staff'] : rota.fn;
      await fn(rota.params);
      if (id === renderizando) window.scrollTo(0, manterRolagem ? y : 0);
    } catch (e) {
      if (id !== renderizando || e instanceof Cancelado) return;
      if (e.status === 401) return;
      document.body.classList.remove('com-nav');
      const bloqueado = e.status === 423;
      app().innerHTML = html`<div class="entrar"><h1>${bloqueado ? 'Acesso suspenso' : e.status === 503 ? 'Sem internet' : 'Algo deu errado'}</h1><div class="cartao ${bloqueado ? 'alerta' : 'erro'}">${e.message}</div>
        <button class="btn" id="tentar">Tentar de novo</button>${S.vinculos.length > 1 ? html`<a class="btn sec" href="#/escolher">Trocar de casa</a>` : ''}<button class="btn sec" id="sair">Sair</button></div>`;
      $('#tentar').onclick = () => { S.terreiro = null; render(); };
      $('#sair').onclick = () => sair();
    }
  }

  window.addEventListener('hashchange', () => render());
  window.addEventListener('online', () => render(true));
  window.addEventListener('offline', () => render(true));
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  render();
})();
