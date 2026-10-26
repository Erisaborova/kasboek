/* Kasboek · service worker. Bewaart de app zelf, zodat hij offline opent; de laatst bekende stand
   staat in localStorage. Verzoeken naar de Sheet gaan nooit via deze cache. */
const CACHE = 'kasboek-v2';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'fonts/plex-mono-400.woff2', 'fonts/plex-mono-600.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'Kasboek_herinneringen.ics'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.endsWith('demo.json')) return;

  // Eerst uit de cache (snel en offline), op de achtergrond bijwerken voor de volgende keer.
  e.respondWith(caches.open(CACHE).then(async cache => {
    const key = req.mode === 'navigate' ? 'index.html' : req;
    const cached = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
    const fresh = fetch(req).then(res => {
      if (res.ok && req.mode !== 'navigate') cache.put(req, res.clone());
      if (res.ok && req.mode === 'navigate') cache.put('index.html', res.clone());
      return res;
    }).catch(() => cached);
    return cached || fresh;
  }));
});
