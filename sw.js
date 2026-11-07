// 旅冊 service worker: app shell offline + font cache. Bump VERSION when icons or the manifest change (pages are network-first).
const VERSION = 'tabisatsu-v15';
const FONTS = 'tabisatsu-fonts';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-64.png',
  './assets/travel-book/style-tokens.css',
  './assets/travel-book/brand/logo-horizontal-clear.webp',
  './assets/travel-book/hero/hero-background-1600x900.webp',
  './assets/travel-book/hero/hero-mobile-portrait.webp',
  './assets/travel-book/showcase/cover.webp',
  './assets/travel-book/showcase/day.webp',
  './assets/travel-book/showcase/place.webp',
  './assets/booklet/cat-beach.webp',
  './assets/booklet/cat-cafe.webp',
  './assets/booklet/cat-city.webp',
  './assets/booklet/cat-food.webp',
  './assets/booklet/cat-hotel.webp',
  './assets/booklet/cat-museum.webp',
  './assets/booklet/cat-nature.webp',
  './assets/booklet/cat-plane.webp',
  './assets/booklet/cat-shop.webp',
  './assets/booklet/cat-shrine.webp',
  './assets/booklet/cat-temple.webp',
  './assets/booklet/cat-train.webp',
  './assets/booklet/cover-a.webp',
  './assets/booklet/cover-b.webp',
  './assets/booklet/cover-c.webp',
  './assets/booklet/paper-tile.webp',
  './assets/booklet/season-maple-bit1.webp',
  './assets/booklet/season-maple-bit2.webp',
  './assets/booklet/season-maple-bit3.webp',
  './assets/booklet/season-maple-corner.webp',
  './assets/booklet/season-sakura-bit1.webp',
  './assets/booklet/season-sakura-bit2.webp',
  './assets/booklet/season-sakura-bit3.webp',
  './assets/booklet/season-sakura-bit4.webp',
  './assets/booklet/season-sakura-bit5.webp',
  './assets/booklet/season-sakura-corner.webp',
  './assets/booklet/season-snow-bit1.webp',
  './assets/booklet/season-snow-bit2.webp',
  './assets/booklet/season-snow-bit3.webp',
  './assets/booklet/season-snow-bit4.webp',
  './assets/booklet/season-snow-corner.webp',
  './assets/booklet/season-summer-bit1.webp',
  './assets/booklet/season-summer-bit2.webp',
  './assets/booklet/season-summer-bit3.webp',
  './assets/booklet/season-summer-corner.webp',
  './assets/booklet/sec-budget.webp',
  './assets/booklet/sec-emergency.webp',
  './assets/booklet/sec-info.webp',
  './assets/booklet/sec-notes.webp',
  './assets/booklet/sec-overview.webp',
  './assets/booklet/sec-pack.webp',
  './assets/booklet/sec-phrase.webp',
  './assets/booklet/sec-reserve.webp',
  './assets/booklet/sec-route.webp',
  './assets/booklet/sec-shop.webp',
  './assets/booklet/sec-stay.webp',
  './assets/booklet/sec-taxi.webp',
  './assets/travel-book/features/01-plan-crop.webp',
  './assets/travel-book/features/02-booklet-crop.webp',
  './assets/travel-book/features/03-export-crop.webp',
  './assets/travel-book/features/04-share-crop.webp',
  './assets/travel-book/features/05-ontrip-crop.webp',
  './assets/travel-book/empty/01-no-trips.webp',
  './assets/travel-book/empty/02-no-places.webp',
  './assets/travel-book/empty/03-no-photos.webp',
  './assets/travel-book/empty/04-no-companions.webp'];

self.addEventListener('install', e => {
  // core files must all succeed; artwork is cached one by one so a single missing image can't block the update
  const CORE = SHELL.filter(u => !u.includes('/assets/')), ART = SHELL.filter(u => u.includes('/assets/'));
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE).then(() => Promise.allSettled(ART.map(u => c.add(u))))).then(() => self.skipWaiting()));
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
