// 旅冊 service worker: app shell offline + font cache. Bump VERSION when icons or the manifest change (pages are network-first).
const VERSION = 'tabisatsu-v10';
const FONTS = 'tabisatsu-fonts';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-64.png',
  './assets/travel-book/style-tokens.css',
  './assets/travel-book/brand/logo-horizontal-clear.webp',
  './assets/travel-book/hero/hero-background-1600x900.webp',
  './assets/travel-book/features/01-plan.webp',
  './assets/travel-book/features/02-booklet.webp',
  './assets/travel-book/features/03-export.webp',
  './assets/travel-book/features/04-share.webp',
  './assets/travel-book/features/05-ontrip.webp',
  './assets/travel-book/empty/01-no-trips.webp',
  './assets/travel-book/empty/02-no-places.webp',
  './assets/travel-book/empty/03-no-photos.webp',
  './assets/travel-book/empty/04-no-companions.webp'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('tabisatsu-') && k !== VERSION && k !== FONTS).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    // pages: network first so new versions arrive, cache as offline fallback
    if (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html')) {
      e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return res; })
        .catch(() => caches.match(req).then(m => m || caches.match('./index.html'))));
      return;
    }
    e.respondWith(caches.match(req).then(m => m || fetch(req).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return res; })));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then(c => c.match(req).then(m => {
      const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => m);
      return m || net;
    })));
  }
});
