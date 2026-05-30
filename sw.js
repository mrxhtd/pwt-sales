// PWT Sales — Service Worker
// Handles push notifications + app-shell offline cache so engineers on flaky 4G
// see the UI instead of a white screen.

const CACHE_VERSION = 'pwt-app-shell-v3';
const APP_SHELL = [
  '/',
  '/index.html',
  '/app.css',
  '/app.js',
  '/manifest.json',
  '/favicon.ico',
  '/favicon-32.png',
  '/apple-touch-icon.png',
  '/logoo.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // Each addAll fails atomically — fall back to individual adds so a single
      // 404 doesn't poison the install.
      Promise.allSettled(APP_SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' }))))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// App-shell strategy:
//   - Same-origin GETs: network-first, fall back to cache.
//   - Cross-origin / API calls: network-only (don't cache).
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Never cache the auth/data API; we don't want stale data shown after re-login.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/functions/')) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        // Cache a fresh copy for next time, but only successful, basic responses.
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) =>
          cached || (req.mode === 'navigate' ? caches.match('/index.html') : Response.error())
        )
      )
  );
});

// ─── PUSH NOTIFICATIONS ────────────────────────────────────
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

// Only allow same-origin paths in the notification URL; otherwise a leaked
// VAPID key could be used to send a notification that opens an attacker URL.
function safeNotifUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 500) return '/';
  // Only relative paths or same-origin absolute URLs.
  try {
    const u = new URL(raw, self.location.origin);
    if (u.origin !== self.location.origin) return '/';
    return u.pathname + u.search + u.hash;
  } catch {
    return '/';
  }
}

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = safeNotifUrl(e.notification.data);
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
