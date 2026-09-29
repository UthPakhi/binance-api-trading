const fs = require('fs');
let code = fs.readFileSync('src/components/PriceAlertManager.tsx', 'utf-8');

const t1 = `          new Notification('Trade Alert', {
            body: message,
            icon: '/pwa-192x192.png'
          });
          triggeredAlertsRef.current.add(alertKey);
          saveTriggered();`;

const r1 = `          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.ready.then(reg => {
              if (reg && reg.showNotification) {
                reg.showNotification('Trade Alert', { body: message, icon: '/pwa-192x192.png' });
              } else {
                new Notification('Trade Alert', { body: message, icon: '/pwa-192x192.png' });
              }
            }).catch(() => {
              new Notification('Trade Alert', { body: message, icon: '/pwa-192x192.png' });
            });
          } else {
            new Notification('Trade Alert', { body: message, icon: '/pwa-192x192.png' });
          }
          triggeredAlertsRef.current.add(alertKey);
          saveTriggered();`;

code = code.replace(t1, r1);

const t2 = `        // Test notification
        new Notification('Trade Sizer', {
          body: 'Alerts successfully configured!',
          icon: '/pwa-192x192.png'
        });`;

const r2 = `        // Test notification
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.ready.then(reg => {
            if (reg && reg.showNotification) {
              reg.showNotification('Trade Sizer', { body: 'Alerts successfully configured!', icon: '/pwa-192x192.png' });
            } else {
              new Notification('Trade Sizer', { body: 'Alerts successfully configured!', icon: '/pwa-192x192.png' });
            }
          });
        } else {
          new Notification('Trade Sizer', { body: 'Alerts successfully configured!', icon: '/pwa-192x192.png' });
        }`;

code = code.replace(t2, r2);

fs.writeFileSync('src/components/PriceAlertManager.tsx', code);
console.log("Fixed iOS Notifications!");
