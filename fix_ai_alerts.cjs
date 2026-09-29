const fs = require('fs');
let code = fs.readFileSync('src/components/PriceAlertManager.tsx', 'utf-8');

const t = `  useEffect(() => {
    if (permission !== 'granted') return;`;

const r = `  useEffect(() => {
    if (permission !== 'granted') return;

    // AI Signals Polling for new trades
    const checkAISignals = async () => {
      try {
        const res = await fetch('/api/ai-signals');
        if (res.ok) {
          const data = await res.json();
          if (data.signals && data.signals.length > 0) {
            data.signals.forEach((sig: any) => {
              const alertKey = \`ai_trade_\${sig.id || sig.symbol + sig.entry}\`;
              if (!triggeredAlertsRef.current.has(alertKey)) {
                
                const msg = \`🤖 New AI Scalp: \${sig.symbol} LONG @ \${sig.entry}\`;
                if ('serviceWorker' in navigator) {
                  navigator.serviceWorker.ready.then(reg => {
                    if (reg && reg.showNotification) {
                      reg.showNotification('AI Trade Alert', { body: msg, icon: '/pwa-192x192.png' });
                    } else {
                      new Notification('AI Trade Alert', { body: msg, icon: '/pwa-192x192.png' });
                    }
                  }).catch(() => {
                    new Notification('AI Trade Alert', { body: msg, icon: '/pwa-192x192.png' });
                  });
                } else {
                  new Notification('AI Trade Alert', { body: msg, icon: '/pwa-192x192.png' });
                }
                
                triggeredAlertsRef.current.add(alertKey);
                saveTriggered();
              }
            });
          }
        }
      } catch (e) {}
    };

    // Check once immediately, then every 30 seconds
    checkAISignals();
    const interval = setInterval(checkAISignals, 30000);

    return () => clearInterval(interval);
  }, [permission]);

  useEffect(() => {
    if (permission !== 'granted') return;`;

code = code.replace(t, r);

fs.writeFileSync('src/components/PriceAlertManager.tsx', code);
console.log("Added AI Signals Polling!");
