const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const engineCode = `
// --- BACKGROUND PRICE ENGINE ---
setInterval(async () => {
  if (activeAlerts.size === 0) return;
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/price');
    if (!res.ok) return;
    const data = await res.json();
    const prices = new Map();
    for (const item of data) prices.set(item.symbol, parseFloat(item.price));

    for (const [userId, alerts] of activeAlerts.entries()) {
      const sub = activePushSubs.get(userId);
      if (!sub) continue;

      const remainingAlerts = [];
      let triggeredAny = false;

      for (const alert of alerts) {
        const live = prices.get(alert.symbol);
        if (!live) {
          remainingAlerts.push(alert);
          continue;
        }

        let isTriggered = false;
        if (alert.condition === 'above' && live >= alert.targetPrice) isTriggered = true;
        if (alert.condition === 'below' && live <= alert.targetPrice) isTriggered = true;

        if (isTriggered) {
          triggeredAny = true;
          try {
            await webpush.sendNotification(sub, JSON.stringify({
              title: 'Trade Sizer Alert',
              body: alert.message || \`\${alert.symbol} crossed \${alert.targetPrice}\`,
              url: '/'
            }));
          } catch(e) {
            console.warn('Push failed:', e);
            if (e.statusCode === 410) {
               // Subscription expired
               activePushSubs.delete(userId);
               activeAlerts.delete(userId);
               return; // Exit this user's loop
            }
          }
        } else {
          remainingAlerts.push(alert);
        }
      }

      if (triggeredAny) {
        activeAlerts.set(userId, remainingAlerts);
      }
    }
  } catch (e) {
    // Ignore fetch errors
  }
}, 5000);
// -------------------------------
`;

code = code.replace(`app.get("/api/health"`, `${engineCode}\n  app.get("/api/health"`);
fs.writeFileSync('server.ts', code);
