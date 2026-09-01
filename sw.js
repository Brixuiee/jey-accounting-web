// JEY Accounting — Service Worker (offline-first cache)
const CACHE = 'jey-accounting-v22';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './css/style.css',
  './js/supabase-auth.js',
  './js/supabase-db.js',
  './js/app.js',
  './js/ap.js',
  './js/ar.js',
  './js/assets.js',
  './js/bank-statement.js',
  './js/director-claim.js',
  './js/searchable-select.js',
  './js/closing.js',
  './js/cloud-backup.js',
  './js/forex.js',
  './js/i18n.js',
  './js/import.js',
  './js/payroll.js',
  './js/quick-entry.js',
  './js/ratios.js',
  './js/sst.js',
  './js/tax.js',
  './js/users.js',
  './js/wht.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Cache-first for same-origin GET; network fallback for everything else
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(resp => {
        // Cache successful responses for future offline use
        if (resp.ok && resp.type === 'basic') {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(req, clone));
        }
        return resp;
      }).catch(() => cached);
    })
  );
});
