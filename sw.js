/**
 * Service worker: network-first.
 *
 * Осознанный выбор на день хакатона. Классический cache-first быстрее,
 * но намертво залипает на старой версии: ты деплоишь, а на телефоне
 * открывается вчерашний билд, и ты полчаса ищешь несуществующий баг.
 * Network-first отдаёт кэш только когда сети реально нет.
 */

const CACHE = 'medtimeline-v5';
const SHELL = [
  './', './index.html',
  './app.js', './db.js', './auth.js', './extract.js',
  './theme.css', './app.css', './runner.js',
  './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();               // новая версия активируется сразу
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;              // POST не кэшируем никогда

  e.respondWith(
    fetch(req)
      .then((res) => {
        // Кладём в кэш копию — пригодится офлайн. Ответы других origin не трогаем.
        if (res.ok && new URL(req.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
