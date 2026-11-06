/**
 * High-reliability Notification Engine for Trade Sizer
 * Delivers OS-level System Notifications, Audio Chimes, and In-App Banners
 * for Limit Order Fulfillments, Stop Losses, and Take Profits.
 */

import { toast } from 'react-hot-toast';
import { formatPrice } from './tradeUtils';

// Web Audio API Chime synthesizer: works natively in all modern browsers without external audio files
export function playNotificationChime(type: 'fill' | 'tp' | 'sl' | 'alert' | 'test' = 'fill') {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'fill') {
      // Upbeat two-tone ascending chord for Limit Order Fill
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880.00, now + 0.12); // A5
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
      osc.start(now);
      osc.stop(now + 0.55);
    } else if (type === 'tp') {
      // Bright triumphal three-tone chime for TP
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.setValueAtTime(659.25, now + 0.1); // E5
      osc.frequency.setValueAtTime(1046.50, now + 0.22); // C6
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
      osc.start(now);
      osc.stop(now + 0.7);
    } else if (type === 'sl') {
      // Lower warning tone for Stop Loss
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(329.63, now); // E4
      osc.frequency.setValueAtTime(261.63, now + 0.15); // C4
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc.start(now);
      osc.stop(now + 0.6);
    } else if (type === 'alert') {
      // Crisp high-clarity bell pulse for Custom Coin Price Alerts
      osc.type = 'sine';
      osc.frequency.setValueAtTime(783.99, now); // G5
      osc.frequency.setValueAtTime(1174.66, now + 0.11); // D6
      osc.frequency.setValueAtTime(1567.98, now + 0.22); // G6
      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
      osc.start(now);
      osc.stop(now + 0.65);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(880, now + 0.1);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.start(now);
      osc.stop(now + 0.4);
    }
  } catch (err) {
    // Audio context may fail if user hasn't interacted with page yet
  }
}

/**
 * Triggers OS-level Notification banner (Desktop / Android PWA / Background)
 */
export async function showSystemNotification(
  title: string,
  options: NotificationOptions & { url?: string } = {}
): Promise<boolean> {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return false;
    }

    let perm = Notification.permission;
    if (perm === 'default') {
      perm = await Notification.requestPermission();
    }
    if (perm !== 'granted') {
      return false;
    }

    const mergedOptions: any = {
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      vibrate: [200, 100, 200],
      ...options
    };

    // Priority 1: Service Worker Registration (can display even when app tab is minimized / locked)
    if ('serviceWorker' in navigator && navigator.serviceWorker) {
      try {
        const reg = await navigator.serviceWorker.ready;
        if (reg && reg.showNotification) {
          await reg.showNotification(title, mergedOptions);
          return true;
        }
      } catch (_) {}
    }

    // Priority 2: Direct Window Notification fallback
    new Notification(title, mergedOptions);
    return true;
  } catch (err) {
    console.warn('System notification error:', err);
    return false;
  }
}

// Permanent set to prevent duplicate notifications across the session
const getNotifiedKeys = (): Set<string> => {
  try {
    const raw = sessionStorage.getItem('ts_notified_keys');
    if (raw) return new Set(JSON.parse(raw));
  } catch (_) {}
  return new Set();
};

const notifiedKeys = getNotifiedKeys();

const recordNotifiedKey = (key: string) => {
  notifiedKeys.add(key);
  try {
    sessionStorage.setItem('ts_notified_keys', JSON.stringify(Array.from(notifiedKeys)));
  } catch (_) {}
};

/**
 * Comprehensive Limit Order Fulfillment Notification
 * Dispatches System Notification, Audible Chime, and In-App Toast
 */
export function notifyLimitOrderFilled(params: {
  symbol: string;
  price: number;
  coins?: number;
  orderId?: string;
  destination?: string;
  source?: string;
  userId?: string;
}) {
  const { symbol, price, coins, orderId, destination = 'Active Trades', source = 'Binance', userId } = params;
  const key = `fill_${symbol}_${orderId || Math.round(price * 100)}`;
  if (notifiedKeys.has(key)) return;
  recordNotifiedKey(key);

  // 1. Play audio chime
  playNotificationChime('fill');

  // 2. Dispatch OS System Banner
  const title = `⚡ Limit Order Filled: ${symbol}`;
  const coinsStr = coins && coins > 0 ? ` (${coins.toLocaleString()} coins)` : '';
  const body = `Your ${symbol} limit order executed at $${formatPrice(price)}${coinsStr} on ${source}! Moved to ${destination}.`;
  
  // 2. Prominent In-App Toast
  toast.success(body, {
    duration: 8000,
    icon: '⚡',
    style: {
      background: '#09090b',
      color: '#f4f4f5',
      border: '1px solid rgba(59, 130, 246, 0.4)',
      fontWeight: '600',
      fontSize: '13px'
    }
  });

  // 3. Dispatch Cloud Web Push (or fallback to local OS notification if no push subscription active)
  const tag = `fill_${symbol}_${orderId || Math.round(price * 100)}`;
  fetch('/api/push/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: userId || undefined,
      title,
      body,
      tag,
      lockKey: tag,
      url: '/'
    })
  })
    .then((res) => res.json())
    .then((data) => {
      if (!data || (data.sentCount === 0 && data.status !== 'already_sent')) {
        showSystemNotification(title, { body, tag, data: { url: '/' } });
      }
    })
    .catch(() => {
      showSystemNotification(title, { body, tag, data: { url: '/' } });
    });
}

/**
 * Comprehensive Target Reached / Stop Loss Notification
 */
export function notifyMilestoneHit(params: {
  symbol: string;
  type: 'TP1' | 'TP2' | 'TP3' | 'SL' | 'BREAKEVEN';
  price: number;
  message?: string;
  tradeId?: string;
  userId?: string;
}) {
  const { symbol, type, price, message, tradeId, userId } = params;
  const key = `${type}_${symbol}_${Math.round(price * 100)}`;
  if (notifiedKeys.has(key)) return;
  recordNotifiedKey(key);

  const isTp = type.startsWith('TP');
  const isSl = type === 'SL';
  playNotificationChime(isTp ? 'tp' : isSl ? 'sl' : 'fill');

  const title = isTp 
    ? `🎯 Target Hit: ${symbol} ${type}` 
    : isSl 
      ? `🛑 Stop Loss Hit: ${symbol}` 
      : `🛡️ Breakeven: ${symbol}`;

  const body = message || `${symbol} reached $${formatPrice(price)} (${type})`;

  if (isTp) {
    toast.success(body, { duration: 7000, icon: '🎯' });
  } else if (isSl) {
    toast.error(body, { duration: 7000, icon: '🛑' });
  } else {
    toast(body, { duration: 6000, icon: '🛡️' });
  }

  const tag = `symbol_${symbol}_${type}_${price}`;
  fetch('/api/push/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: userId || undefined,
      tradeId: tradeId || undefined,
      type,
      symbol,
      targetPrice: price,
      title,
      body,
      tag,
      lockKey: key,
      url: '/'
    })
  })
    .then((res) => res.json())
    .then((data) => {
      if (!data || (data.sentCount === 0 && data.status !== 'already_sent')) {
        showSystemNotification(title, { body, tag, data: { url: '/' } });
      }
    })
    .catch(() => {
      showSystemNotification(title, { body, tag, data: { url: '/' } });
    });
}

/**
 * Custom Coin Price Alert Notification
 * Dispatches Audio Chime, In-App Banner, and exactly ONE OS Notification (via Web Push or local fallback)
 */
export function notifyCustomPriceAlert(params: {
  alertId: string;
  symbol: string;
  targetPrice: number;
  livePrice: number;
  condition: 'above' | 'below';
  note?: string;
  recurring?: boolean;
  createdAt?: number;
  userId?: string;
}) {
  const { alertId, symbol, targetPrice, livePrice, condition, note, recurring, createdAt = 0, userId } = params;
  const minuteBucket = Math.floor(Date.now() / 60000);
  const lockKey = recurring
    ? `custom_${alertId}_${targetPrice}_${minuteBucket}`
    : `custom_${alertId}_${targetPrice}_${createdAt}`;
  const activeLockKey = `custom_active_${alertId}_${createdAt}`;

  if (notifiedKeys.has(lockKey) || (!recurring && notifiedKeys.has(activeLockKey))) return;
  recordNotifiedKey(lockKey);
  if (!recurring) {
    recordNotifiedKey(activeLockKey);
  }

  playNotificationChime('alert');

  const dirSymbol = condition === 'above' ? '▲' : '▼';
  const dirLabel = condition === 'above' ? 'crossed above' : 'dropped below';
  const title = `🔔 ${symbol} Price Alert (${dirSymbol} $${formatPrice(targetPrice)})`;
  const noteSuffix = note ? ` — "${note}"` : '';
  const body = `${symbol} ${dirLabel} $${formatPrice(targetPrice)} (Live: $${formatPrice(livePrice)})${noteSuffix}`;
  const tag = recurring ? `custom_alert_${alertId}_${minuteBucket}` : `custom_alert_${alertId}`;

  toast.success(body, {
    duration: 8000,
    icon: condition === 'above' ? '📈' : '📉',
    style: {
      background: '#09090b',
      color: '#f4f4f5',
      border: condition === 'above' ? '1px solid rgba(16, 185, 129, 0.45)' : '1px solid rgba(244, 63, 94, 0.45)',
      fontWeight: '600',
      fontSize: '13px'
    }
  });

  fetch('/api/push/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: userId || undefined,
      alertId,
      lockKey,
      activeLockKey,
      recurring: Boolean(recurring),
      title,
      body,
      tag,
      url: '/'
    })
  })
    .then((res) => res.json())
    .then((data) => {
      // Only show local system notification if Web Push has 0 active subscriptions AND wasn't already sent by server loop
      if (!data || (data.sentCount === 0 && data.status !== 'already_sent')) {
        showSystemNotification(title, {
          body,
          tag,
          data: { url: '/' }
        });
      }
    })
    .catch(() => {
      showSystemNotification(title, {
        body,
        tag,
        data: { url: '/' }
      });
    });
}


