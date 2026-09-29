import React, { useEffect, useState, useRef } from 'react';
import { Bell, BellRing, CheckCircle2, ShieldCheck, Send, ExternalLink, X } from 'lucide-react';
import { useTradeContext } from '../lib/TradeContext';
import toast from 'react-hot-toast';
import { auth, db } from '../lib/firebase';
import { doc, setDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { getTradeIsLong } from '../lib/tradeUtils';

const PUBLIC_VAPID_KEY = 'BAroV9birM9rVdLrSDpuoyalmIBWVuGhJ7GcY0vIr7SZhMABwnGIO0JkBiZdY-QYK46tC6_LAUaex0NKg629CWs';

function urlBase64ToUint8Array(base64String: string) {
  try {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  } catch (e) {
    console.warn('VAPID conversion error:', e);
    return new Uint8Array(0);
  }
}

export function PriceAlertManager() {
  const { trades, livePrices } = useTradeContext();
  const [permission, setPermission] = useState<NotificationPermission>(() => {
    try {
      return ('Notification' in window) ? Notification.permission : 'denied';
    } catch (_) {
      return 'denied';
    }
  });

  const [isOpen, setIsOpen] = useState(false);
  const [isTestingPush, setIsTestingPush] = useState(false);
  const [isSubscribedToCloud, setIsSubscribedToCloud] = useState(false);
  
  const triggeredAlertsRef = useRef<Set<string>>(new Set(
    JSON.parse(localStorage.getItem('triggered_alerts') || '[]')
  ));

  const saveTriggered = () => {
    localStorage.setItem('triggered_alerts', JSON.stringify(Array.from(triggeredAlertsRef.current)));
  };

  const subscribeToPush = async () => {
    try {
      if (!('serviceWorker' in navigator) || !navigator.serviceWorker) return null;
      
      // Register service worker if not already registered
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => null);
      if (!reg) return null;
      await navigator.serviceWorker.ready.catch(() => null);

      if (!reg.pushManager) return null;
      let sub = await reg.pushManager.getSubscription().catch(() => null);
      if (!sub) {
        const key = urlBase64ToUint8Array(PUBLIC_VAPID_KEY);
        if (!key || key.length === 0) return null;
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key
        }).catch(err => {
          console.warn('Push registration note:', err);
          return null;
        });
      }
      if (!sub) return null;

      const userId = auth.currentUser?.uid || 'anonymous';
      const subJson = sub.toJSON();

      // Persist directly to Firestore
      try {
        await setDoc(doc(db, 'push_subscriptions', userId), {
          userId,
          subscription: subJson,
          updatedAt: Date.now(),
          userAgent: navigator.userAgent
        }, { merge: true });
      } catch (err) {
        console.warn('Firestore subscription save note:', err);
      }

      // Persist to Server Engine
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, subscription: subJson })
      }).catch(() => null);

      setIsSubscribedToCloud(true);
      return sub;
    } catch (e) {
      console.warn('Push subscription caught error:', e);
      return null;
    }
  };

  // Auto-subscribe on load if permission is already granted
  useEffect(() => {
    if (permission === 'granted') {
      subscribeToPush();
    }
  }, [permission, auth.currentUser]);

  const requestPermission = async () => {
    if (!('Notification' in window)) {
      toast.error('This browser does not support notifications');
      return;
    }
    
    if (permission === 'granted') {
      setIsOpen(prev => !prev);
      return;
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === 'granted') {
        toast.success('Price alerts enabled!');
        const sub = await subscribeToPush();
        if (sub) {
          toast.success('24/7 Background Alert Engine Connected!');
          setIsOpen(true);
        }
      } else if (result === 'denied') {
        toast.error('Notification permission was blocked in browser settings.');
      }
    } catch (e: any) {
      console.warn('Permission error:', e);
      toast.error('Could not request notifications. If in preview iframe, try opening in a new tab.');
    }
  };

  const handleTestPush = async () => {
    setIsTestingPush(true);
    try {
      const userId = auth.currentUser?.uid || 'anonymous';
      const res = await fetch('/api/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        toast.success('Test alert sent! Check your device notifications.');
      } else {
        toast.error(data.message || 'Could not send test push.');
      }
    } catch (e: any) {
      toast.error('Failed to trigger test push.');
    } finally {
      setIsTestingPush(false);
    }
  };

  // Sync active trades with server push engine whenever trades change
  useEffect(() => {
    if (permission !== 'granted' || !('serviceWorker' in navigator)) return;
    
    const syncServerAlerts = async () => {
       const userId = auth.currentUser?.uid || 'anonymous';
       const openTrades = trades.filter(t => 
         ['ACTIVE', 'PENDING', 'HIT_TP1', 'HIT_TP2', 'PARTIAL_EXIT'].includes(t.status || 'ACTIVE') &&
         !t.closedAt &&
         !['CLOSED_MANUAL', 'HIT_SL', 'HIT_TP3', 'CLOSED_BREAK_EVEN', 'BREAK_EVEN'].includes(t.status || '')
       );
       
       const alerts: any[] = [];
       openTrades.forEach(t => {
         const isLong = getTradeIsLong(t);
         const notified = new Set<string>(Array.isArray(t.notifiedMilestones) ? t.notifiedMilestones : []);

         if (t.status === 'PENDING' && t.entryPrice > 0 && !notified.has('ENTRY')) {
            alerts.push({ id: `${t.id}_ENTRY`, tradeId: t.id, type: 'ENTRY', symbol: t.symbol, targetPrice: t.entryPrice, condition: isLong ? 'below' : 'above', message: `${t.symbol} Entry reached at $${t.entryPrice}` });
         }
         if (['ACTIVE', 'HIT_TP1', 'HIT_TP2', 'PARTIAL_EXIT'].includes(t.status || '')) {
            if (t.stopLoss && t.stopLoss > 0 && !notified.has('SL') && t.status !== 'HIT_SL') {
              alerts.push({ id: `${t.id}_SL`, tradeId: t.id, type: 'SL', symbol: t.symbol, targetPrice: t.stopLoss, condition: isLong ? 'below' : 'above', message: `🚨 ${t.symbol} Stop Loss reached at $${t.stopLoss}` });
            }
            if (t.takeProfit1 && t.takeProfit1 > 0 && !notified.has('TP1') && !['HIT_TP1', 'HIT_TP2', 'HIT_TP3'].includes(t.status || '')) {
              alerts.push({ id: `${t.id}_TP1`, tradeId: t.id, type: 'TP1', symbol: t.symbol, targetPrice: t.takeProfit1, condition: isLong ? 'above' : 'below', message: `🎯 ${t.symbol} TP1 reached at $${t.takeProfit1}! Move Stop Loss to Breakeven to guarantee 0.00R risk.` });
            }
            if (t.takeProfit2 && t.takeProfit2 > 0 && !notified.has('TP2') && !['HIT_TP2', 'HIT_TP3'].includes(t.status || '')) {
              alerts.push({ id: `${t.id}_TP2`, tradeId: t.id, type: 'TP2', symbol: t.symbol, targetPrice: t.takeProfit2, condition: isLong ? 'above' : 'below', message: `🎯 ${t.symbol} TP2 reached at $${t.takeProfit2}` });
            }
            if (t.takeProfit3 && t.takeProfit3 > 0 && !notified.has('TP3') && t.status !== 'HIT_TP3') {
              alerts.push({ id: `${t.id}_TP3`, tradeId: t.id, type: 'TP3', symbol: t.symbol, targetPrice: t.takeProfit3, condition: isLong ? 'above' : 'below', message: `🎯 ${t.symbol} TP3 reached at $${t.takeProfit3}` });
            }
         }
       });

       try {
         const reg = await navigator.serviceWorker.ready.catch(() => null);
         if (!reg || !reg.pushManager) return;
         const sub = await reg.pushManager.getSubscription().catch(() => null);
         if (sub) {
           await fetch('/api/push/subscribe', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ userId, subscription: sub.toJSON(), alerts })
           }).catch(() => null);
           setIsSubscribedToCloud(true);
         }
       } catch (e) {}
    };

    syncServerAlerts();
  }, [trades, permission]);

  // Keep local checking for instant UI notification popups when app is open in foreground
  useEffect(() => {
    if (permission !== 'granted') return;
    const openTrades = trades.filter(t => 
      ['ACTIVE', 'PENDING', 'HIT_TP1', 'HIT_TP2', 'PARTIAL_EXIT'].includes(t.status || 'ACTIVE') &&
      !t.closedAt &&
      !['CLOSED_MANUAL', 'HIT_SL', 'HIT_TP3', 'CLOSED_BREAK_EVEN', 'BREAK_EVEN'].includes(t.status || '')
    );
    
    // Only purge alert deduplication memory if trade was permanently deleted from DB
    const allTradeIds = new Set(trades.map(t => t.id));
    let cleaned = false;
    for (const key of triggeredAlertsRef.current) {
      const tradeId = key.split('_')[0];
      if (!allTradeIds.has(tradeId)) {
        triggeredAlertsRef.current.delete(key);
        cleaned = true;
      }
    }
    if (cleaned) saveTriggered();

    openTrades.forEach(trade => {
      if (!trade.id) return;
      const livePrice = livePrices[trade.symbol];
      if (!livePrice) return;
      const isLong = getTradeIsLong(trade);
      const notified = new Set<string>(Array.isArray(trade.notifiedMilestones) ? trade.notifiedMilestones : []);

      const triggerAlert = (type: string, message: string, targetPrice: number) => {
        const alertKey = `${trade.id}_${type}`;
        const fullKey = `${trade.id}_${type}_${targetPrice}`;

        // Ensure this milestone triggers only once per trade level
        if (notified.has(type) || triggeredAlertsRef.current.has(alertKey) || triggeredAlertsRef.current.has(fullKey)) {
          return;
        }

        const showFallback = () => {
          try {
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
              new Notification('Trade Alert', { body: message, icon: '/pwa-192x192.png' });
            }
          } catch (_) {}
        };

        if ('serviceWorker' in navigator && navigator.serviceWorker) {
          navigator.serviceWorker.ready.then(reg => {
            if (reg && reg.showNotification) {
              reg.showNotification('Trade Alert', { body: message, icon: '/pwa-192x192.png', tag: alertKey });
            } else {
              showFallback();
            }
          }).catch(() => {
            showFallback();
          });
        } else {
          showFallback();
        }
        triggeredAlertsRef.current.add(alertKey);
        triggeredAlertsRef.current.add(fullKey);
        saveTriggered();

        // Persist to trade document so it is never re-notified across sessions/devices
        if (trade.id) {
          const updatePayload: any = {
            notifiedMilestones: arrayUnion(type)
          };
          if (type === 'ENTRY' && trade.status === 'PENDING') {
            updatePayload.status = 'ACTIVE';
            updatePayload.filledAt = Date.now();
            toast.success(`⚡ Limit order filled! ${trade.symbol} hit entry at $${targetPrice}. Moved to Active Trades!`);
          }
          updateDoc(doc(db, 'trades', trade.id), updatePayload).catch(() => null);
        }
      };

      if (trade.status === 'PENDING' && trade.entryPrice > 0 && !notified.has('ENTRY')) {
        if ((isLong && livePrice <= trade.entryPrice) || (!isLong && livePrice >= trade.entryPrice)) triggerAlert('ENTRY', `${trade.symbol} Entry Hit at $${livePrice}`, trade.entryPrice);
      }
      if (['ACTIVE', 'HIT_TP1', 'HIT_TP2', 'PARTIAL_EXIT'].includes(trade.status || '')) {
        if (trade.stopLoss && trade.stopLoss > 0 && !notified.has('SL') && trade.status !== 'HIT_SL' && ((isLong && livePrice <= trade.stopLoss) || (!isLong && livePrice >= trade.stopLoss))) {
          triggerAlert('SL', `🚨 ${trade.symbol} Stop Loss Hit at $${livePrice}`, trade.stopLoss);
        }
        if (trade.takeProfit1 && trade.takeProfit1 > 0 && !notified.has('TP1') && !['HIT_TP1', 'HIT_TP2', 'HIT_TP3'].includes(trade.status || '') && ((isLong && livePrice >= trade.takeProfit1) || (!isLong && livePrice <= trade.takeProfit1))) {
          triggerAlert('TP1', `🎯 ${trade.symbol} TP1 Hit at $${livePrice}! Capital Protection: Move Stop Loss to Breakeven.`, trade.takeProfit1);
        }
        if (trade.takeProfit2 && trade.takeProfit2 > 0 && !notified.has('TP2') && !['HIT_TP2', 'HIT_TP3'].includes(trade.status || '') && ((isLong && livePrice >= trade.takeProfit2) || (!isLong && livePrice <= trade.takeProfit2))) {
          triggerAlert('TP2', `🎯 ${trade.symbol} TP2 Hit at $${livePrice}`, trade.takeProfit2);
        }
        if (trade.takeProfit3 && trade.takeProfit3 > 0 && !notified.has('TP3') && trade.status !== 'HIT_TP3' && ((isLong && livePrice >= trade.takeProfit3) || (!isLong && livePrice <= trade.takeProfit3))) {
          triggerAlert('TP3', `🎯 ${trade.symbol} TP3 Hit at $${livePrice}`, trade.takeProfit3);
        }
      }
    });
  }, [livePrices, trades, permission]);

  const activeTrades = trades.filter(t => t.status === 'ACTIVE' || t.status === 'PENDING');

  return (
    <div className="relative">
      <button 
        onClick={requestPermission}
        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
          permission === 'granted' 
            ? 'text-sky-400 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20' 
            : 'text-neutral-400 hover:text-white bg-neutral-900 hover:bg-neutral-800 border border-neutral-800'
        }`}
        title={permission === 'granted' ? 'Background Alerts Active (Click for details)' : 'Enable Background Push Alerts'}
      >
        {permission === 'granted' ? (
          <div className="relative">
            <BellRing className="w-4 h-4 text-sky-400" />
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-sky-400 rounded-full animate-ping"></span>
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-sky-400 rounded-full"></span>
          </div>
        ) : (
          <Bell className="w-4 h-4" />
        )}
      </button>

      {/* Popover Settings / Status Modal */}
      {isOpen && permission === 'granted' && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-neutral-900 border border-neutral-800 rounded-xl shadow-2xl p-4 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-sky-400" />
              <span className="text-sm font-semibold text-white">24/7 Cloud Background Engine</span>
            </div>
            <button 
              onClick={() => setIsOpen(false)}
              className="text-neutral-400 hover:text-white p-1 rounded-md hover:bg-neutral-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="py-3 space-y-3 text-xs">
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
              <div className="text-neutral-300 leading-relaxed">
                <span className="font-semibold text-sky-400">Push Notifications Active.</span> Alerts arrive directly to your operating system even when this browser tab or app is closed.
              </div>
            </div>

            <div>
              <div className="text-neutral-400 font-medium mb-1.5 flex items-center justify-between">
                <span>Monitored Active Positions:</span>
                <span className="text-white font-semibold">{activeTrades.length} trade{activeTrades.length === 1 ? '' : 's'}</span>
              </div>
              {activeTrades.length === 0 ? (
                <div className="text-neutral-500 bg-neutral-950/60 rounded-lg p-2.5 text-center border border-neutral-800/60">
                  No active or pending trades with SL/TP set.
                </div>
              ) : (
                <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                  {activeTrades.map(t => (
                    <div key={t.id} className="bg-neutral-950/80 border border-neutral-800/80 rounded-lg p-2 flex items-center justify-between">
                      <span className="font-semibold text-white">{t.symbol}</span>
                      <div className="flex items-center gap-2 text-[11px] text-neutral-400">
                        {t.stopLoss ? <span className="text-slate-300 font-mono">SL: ${t.stopLoss}</span> : null}
                        {t.takeProfit1 ? <span className="text-sky-400 font-mono">TP: ${t.takeProfit1}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-neutral-800 flex items-center gap-2">
              <button
                onClick={handleTestPush}
                disabled={isTestingPush}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg font-medium text-xs transition-colors disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5 text-sky-400" />
                {isTestingPush ? 'Sending...' : 'Send Test Notification'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
