// Service Worker for Background Web Push Notifications
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => caches.delete(cacheName))
      );
    }).then(() => self.clients.claim())
  );
});

const recentPushTags = new Map();

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : 'Trade Alert' };
  }

  const tag = data.tag || ('trade-alert-' + Date.now());
  const now = Date.now();
  const prev = recentPushTags.get(tag);
  if (prev && (now - prev < 15000)) {
    return;
  }
  recentPushTags.set(tag, now);

  const title = data.title || 'Trade Sizer Alert';
  const options = {
    body: data.body || 'A trade price target or stop loss was reached.',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    vibrate: [200, 100, 200, 100, 200],
    tag: tag,
    renotify: false,
    requireInteraction: true,
    data: {
      url: data.url || '/'
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windowClients) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          await client.focus();
          return;
        }
      }
      if (self.clients.openWindow) {
        const newWindow = await self.clients.openWindow(targetUrl);
        if (newWindow && 'focus' in newWindow) {
          await newWindow.focus();
        }
      }
    })()
  );
});
