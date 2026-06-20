// PWT Sales - Service Worker (push notifications + offline app shell)

// Bump CACHE_VERSION on each deploy to invalidate stale cached assets.
const CACHE_VERSION = 'pwt-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon-32.png',
  '/apple-touch-icon.png',
  '/logoo.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      // Drop caches from previous versions.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// Caching strategy:
//  - Navigations: network-first, fall back to cached index.html when offline.
//  - Same-origin GET assets: cache-first with background refresh.
//  - Everything else (API calls, cross-origin, non-GET): passthrough, never cached.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // skip cross-origin (functions, tiles, unpkg)
  if (url.pathname.startsWith('/api/')) return;     // never cache API responses

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('/index.html'))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// Handle incoming push notifications
self.addEventListener('push', (e) => {
  let data = { title: 'PWT Sales', body: 'You have a notification' };
  try {
    if (e.data) data = e.data.json();
  } catch (_) {
    if (e.data) data.body = e.data.text();
  }

  const options = {
    body: data.body || '',
    icon: '/favicon-32.png',
    badge: '/favicon-32.png',
    tag: data.tag || 'pwt-notification',
    data: data.url || '/',
    vibrate: [200, 100, 200],
    requireInteraction: true,
  };

  e.waitUntil(self.registration.showNotification(data.title || 'PWT Sales', options));
});

// Handle notification click — open the app
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if (new URL(c.url).origin === self.location.origin) {
          c.focus();
          c.navigate(url);
          return;
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
