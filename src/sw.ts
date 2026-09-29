import { precacheAndRoute } from 'workbox-precaching';

declare let self: any;

precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('push', (event) => {
  let data: any = {};
  try {
    data = event.data?.json() ?? {};
  } catch (e) {
    data = { body: event.data?.text() };
  }
  
  const title = data.title || 'Trade Alert';
  const options = {
    body: data.body || 'Alert triggered!',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
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
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientsArr) => {
      const url = event.notification.data?.url || '/';
      const hadWindowToFocus = clientsArr.some((windowClient) => windowClient.url.includes(url) ? (windowClient.focus(), true) : false);
      if (!hadWindowToFocus) {
        self.clients.openWindow(url).then((windowClient) => windowClient ? windowClient.focus() : null);
      }
    })
  );
});
