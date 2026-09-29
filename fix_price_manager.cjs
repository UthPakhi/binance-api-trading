const fs = require('fs');
let code = fs.readFileSync('src/components/PriceAlertManager.tsx', 'utf-8');

const replacement = `import React, { useEffect, useState, useRef } from 'react';
import { Bell, BellRing } from 'lucide-react';
import { useTradeContext } from '../lib/TradeContext';
import toast from 'react-hot-toast';
import { auth } from '../lib/firebase';

const PUBLIC_VAPID_KEY = 'BAroV9birM9rVdLrSDpuoyalmIBWVuGhJ7GcY0vIr7SZhMABwnGIO0JkBiZdY-QYK46tC6_LAUaex0NKg629CWs';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function PriceAlertManager() {
  const { trades, livePrices } = useTradeContext();
  const [permission, setPermission] = useState<NotificationPermission>(
    'Notification' in window ? Notification.permission : 'denied'
  );
  
  const triggeredAlertsRef = useRef<Set<string>>(new Set(
    JSON.parse(localStorage.getItem('triggered_alerts') || '[]')
  ));

  const saveTriggered = () => {
    localStorage.setItem('triggered_alerts', JSON.stringify(Array.from(triggeredAlertsRef.current)));
  };

  const subscribeToPush = async () => {
    try {
      const userId = auth.currentUser?.uid || 'anonymous';
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY)
        });
      }

      await fetch('/api/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, subscription: sub })
      });
      return sub;
    } catch (e) {
      console.error('Push subscription failed:', e);
      return null;
    }
  };

  const requestPermission = async () => {
    if (!('Notification' in window)) {
      toast.error('This browser does not support notifications');
      return;
    }
    
    if (permission === 'granted') {
      toast.success('Alerts already enabled!');
      return;
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === 'granted') {
        toast.success('Price alerts enabled!');
        if ('serviceWorker' in navigator) {
          const sub = await subscribeToPush();
          if (sub) toast.success('Background Engine Connected!');
        }
      }
    } catch (e) {
      toast.error('Could not request notification permission.');
    }
  };

  useEffect(() => {
    if (permission !== 'granted' || !('serviceWorker' in navigator)) return;
    
    const syncServerAlerts = async () => {
       const userId = auth.currentUser?.uid || 'anonymous';
       const activeTrades = trades.filter(t => t.status === 'ACTIVE' || t.status === 'PENDING');
       
       const alerts: any[] = [];
       activeTrades.forEach(t => {
         const isLong = t.entryPrice > t.stopLoss;
         if (t.status === 'PENDING') {
            alerts.push({ symbol: t.symbol, targetPrice: t.entryPrice, condition: isLong ? 'below' : 'above', message: \`\${t.symbol} Entry Hit at $\${t.entryPrice}\` });
         }
         if (t.status === 'ACTIVE') {
            alerts.push({ symbol: t.symbol, targetPrice: t.stopLoss, condition: isLong ? 'below' : 'above', message: \`🚨 \${t.symbol} Stop Loss Hit at $\${t.stopLoss}\` });
            if (t.takeProfit1) alerts.push({ symbol: t.symbol, targetPrice: t.takeProfit1, condition: isLong ? 'above' : 'below', message: \`🎯 \${t.symbol} TP1 Hit at $\${t.takeProfit1}\` });
            if (t.takeProfit2) alerts.push({ symbol: t.symbol, targetPrice: t.takeProfit2, condition: isLong ? 'above' : 'below', message: \`🎯 \${t.symbol} TP2 Hit at $\${t.takeProfit2}\` });
            if (t.takeProfit3) alerts.push({ symbol: t.symbol, targetPrice: t.takeProfit3, condition: isLong ? 'above' : 'below', message: \`🎯 \${t.symbol} TP3 Hit at $\${t.takeProfit3}\` });
         }
       });

       try {
         const reg = await navigator.serviceWorker.ready;
         const sub = await reg.pushManager.getSubscription();
         if (sub) {
           await fetch('/api/push/subscribe', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ userId, subscription: sub, alerts })
           });
         }
       } catch (e) {}
    };

    syncServerAlerts();
  }, [trades, permission]);

  // Keep local checking for fast UI updates when app is open
  useEffect(() => {
    if (permission !== 'granted') return;
    const activeTrades = trades.filter(t => t.status === 'ACTIVE' || t.status === 'PENDING');
    
    const activeTradeIds = new Set(activeTrades.map(t => t.id));
    let cleaned = false;
    for (const key of triggeredAlertsRef.current) {
      const tradeId = key.split('_')[0];
      if (!activeTradeIds.has(tradeId)) {
        triggeredAlertsRef.current.delete(key);
        cleaned = true;
      }
    }
    if (cleaned) saveTriggered();

    activeTrades.forEach(trade => {
      if (!trade.id) return;
      const livePrice = livePrices[trade.symbol];
      if (!livePrice) return;
      const isLong = trade.entryPrice > trade.stopLoss;

      const triggerAlert = (type: string, message: string) => {
        const alertKey = \`\${trade.id}_\${type}\`;
        if (!triggeredAlertsRef.current.has(alertKey)) {
          if ('serviceWorker' in navigator) {
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
          saveTriggered();
        }
      };

      if (trade.status === 'PENDING') {
        if ((isLong && livePrice <= trade.entryPrice) || (!isLong && livePrice >= trade.entryPrice)) triggerAlert('ENTRY', \`\${trade.symbol} Entry Hit at $\${livePrice}\`);
      }
      if (trade.status === 'ACTIVE') {
        if ((isLong && livePrice <= trade.stopLoss) || (!isLong && livePrice >= trade.stopLoss)) triggerAlert('SL', \`🚨 \${trade.symbol} Stop Loss Hit at $\${livePrice}\`);
        if (trade.takeProfit1 && ((isLong && livePrice >= trade.takeProfit1) || (!isLong && livePrice <= trade.takeProfit1))) triggerAlert('TP1', \`🎯 \${trade.symbol} TP1 Hit at $\${livePrice}\`);
        if (trade.takeProfit2 && ((isLong && livePrice >= trade.takeProfit2) || (!isLong && livePrice <= trade.takeProfit2))) triggerAlert('TP2', \`🎯 \${trade.symbol} TP2 Hit at $\${livePrice}\`);
        if (trade.takeProfit3 && ((isLong && livePrice >= trade.takeProfit3) || (!isLong && livePrice <= trade.takeProfit3))) triggerAlert('TP3', \`🎯 \${trade.symbol} TP3 Hit at $\${livePrice}\`);
      }
    });
  }, [livePrices, trades, permission]);

  if (!('Notification' in window)) return null;

  return (
    <button 
      onClick={requestPermission}
      className="w-8 h-8 flex items-center justify-center text-neutral-400 hover:text-emerald-400 transition-colors relative"
      title={permission === 'granted' ? 'Alerts Enabled (Background Ready)' : 'Enable Alerts'}
    >
      {permission === 'granted' ? (
        <>
          <BellRing className="w-4 h-4 text-emerald-400" />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
        </>
      ) : (
        <Bell className="w-4 h-4" />
      )}
    </button>
  );
}`;

fs.writeFileSync('src/components/PriceAlertManager.tsx', replacement);
