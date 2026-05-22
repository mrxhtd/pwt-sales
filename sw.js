// PWT Sales - Service Worker for Push Notifications

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
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
