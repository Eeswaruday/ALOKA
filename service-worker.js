const CACHE = 'aloka-static-v10';
const FILES = ['./', './index.html', './css/main.css', './js/app.js', './js/api-config.js', './manifest.json', './privacy.html', './assets/aloka-wordmark.webp', './assets/aloka-wordmark-3x.webp', './assets/aloka-wordmark.png', './assets/aloka-logo.png', './googleff60cb51d01ab7bb.html'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin/')) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && response.type === 'basic' && response.headers.get('Cache-Control') !== 'no-store') {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {});
    }
    return response;
  }).catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html'))));
});


