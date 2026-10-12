// Service worker: app instalável e mural/agenda consultáveis sem internet (RNF-11)
const VERSAO = 'th-v1';
const SHELL = ['/', '/index.html', '/app.css', '/app.js', '/manifest.webmanifest', '/icons/icon-192.png'];
const OFFLINE_API = [/\/api\/t\/[^/]+\/avisos/, /\/api\/t\/[^/]+\/eventos\?/, /\/api\/t\/[^/]+\/meu\/inicio/];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO && k !== 'th-api').map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('message', (e) => {
  if (e.data === 'limpar-cache-api') caches.delete('th-api');
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    if (!OFFLINE_API.some((r) => r.test(url.pathname + url.search))) return;
    e.respondWith(
      fetch(req).then((resp) => {
        if (resp.ok) { const copia = resp.clone(); caches.open('th-api').then((c) => c.put(req, copia)); }
        return resp;
      }).catch(() => caches.open('th-api').then((c) => c.match(req)).then((r) => r || new Response(JSON.stringify({ erro: { codigo: 'offline', mensagem: 'Sem internet' } }), { status: 503, headers: { 'content-type': 'application/json' } })))
    );
    return;
  }
  e.respondWith(
    fetch(req).then((resp) => {
      if (resp.ok && SHELL.includes(url.pathname)) { const copia = resp.clone(); caches.open(VERSAO).then((c) => c.put(req, copia)); }
      return resp;
    }).catch(() => caches.match(req).then((r) => r || caches.match('/index.html')))
  );
});
