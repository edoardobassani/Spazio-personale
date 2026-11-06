// Service worker: rende l'app disponibile anche senza connessione.
// Strategia "prima la rete": se sei online scarichi sempre l'ultima versione,
// se sei offline usi la copia salvata. Così un aggiornamento non resta bloccato in cache.
const VERSION = '2.2.0';
const CACHE = `spazio-${VERSION}`;
const CORE = [
  './', './index.html', `./styles.css?v=${VERSION}`, './manifest.webmanifest', './icon.svg', './icon-192.png',
  ...['app', 'store', 'dates', 'parse', 'ui', 'views', 'ai/assistant', 'ai/gemini', 'ai/tools'].map(f => `./js/${f}.js?v=${VERSION}`),
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const res = await Promise.race([fetch(req, { cache: 'no-cache' }), timeout(5000)]);
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return caches.match('./index.html');
      throw err;
    }
  })());
});
