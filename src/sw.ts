import { precacheAndRoute } from 'workbox-precaching';

declare let self: any;

precacheAndRoute(self.__WB_MANIFEST);

const recentPushTags = new Map<string, number>();

self.addEventListener('push', (event) => {
  let data: any = {};
  try {
    data = event.data?.json() ?? {};
  } catch (e) {
    data = { body: event.data?.text() };
  }

  const tag = data.tag || 'trade-sizer-alert';
  const now = Date.now();
  const prev = recentPushTags.get(tag);
  if (prev && now - prev < 15000) {
    return;
  }
  recentPushTags.set(tag, now);

  const title = data.title || 'Trade Alert';
  const options = {
    body: data.body || 'Alert triggered!',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag,
    renotify: false,
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
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    (async () => {
      const clientsArr = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const windowClient of clientsArr) {
        if (windowClient.url.includes(targetUrl) && 'focus' in windowClient) {
          await windowClient.focus();
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
