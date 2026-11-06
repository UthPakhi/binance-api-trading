import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  Bell,
  BellRing,
  CheckCircle2,
  ShieldCheck,
  Send,
  X,
  Plus,
  Trash2,
  Repeat,
  RotateCcw,
  TrendingUp,
  TrendingDown,
  Pause,
  Play,
  Search,
  Volume2
} from 'lucide-react';
import { useTradeContext } from '../lib/TradeContext';
import toast from 'react-hot-toast';
import { auth, db } from '../lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import {
  getTradeIsLong,
  isBinanceLinkedTrade,
  isBinanceLimitOrder,
  isBreakoutStopLimitTrade,
  formatPrice,
  getCleanTradingSymbol
} from '../lib/tradeUtils';
import { fetchBinanceSymbols } from '../lib/binance';
import { notifyCustomPriceAlert, playNotificationChime } from '../lib/notificationHelper';

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

function formatSmartTargetPrice(price: number): string {
  if (!price || isNaN(price) || price <= 0) return '';
  if (price >= 1000) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4).replace(/\.?0+$/, '');
  if (price >= 0.01) return price.toFixed(5).replace(/\.?0+$/, '');
  return price.toFixed(7).replace(/\.?0+$/, '');
}

export function PriceAlertManager() {
  const {
    trades,
    livePrices,
    priceAlerts,
    addPriceAlert,
    updatePriceAlert,
    deletePriceAlert,
    clearTriggeredPriceAlerts
  } = useTradeContext();

  const [permission, setPermission] = useState<NotificationPermission>(() => {
    try {
      return 'Notification' in window ? Notification.permission : 'denied';
    } catch (_) {
      return 'denied';
    }
  });

  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'coin_alerts' | 'trade_alerts'>('coin_alerts');
  const [isTestingPush, setIsTestingPush] = useState(false);
  const [isSubscribedToCloud, setIsSubscribedToCloud] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(() => auth.currentUser?.uid || null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUserId(user?.uid || null);
    });
    return () => unsub();
  }, []);

  // New Coin Price Alert Form State
  const [symbolInput, setSymbolInput] = useState('BTCUSDT');
  const [showSymbolDropdown, setShowSymbolDropdown] = useState(false);
  const [exchangeSymbols, setExchangeSymbols] = useState<string[]>([]);
  const [quotedPrice, setQuotedPrice] = useState<number | null>(null);
  const [targetPriceInput, setTargetPriceInput] = useState('');
  const [condition, setCondition] = useState<'above' | 'below'>('above');
  const [manualConditionLock, setManualConditionLock] = useState(false);
  const [recurring, setRecurring] = useState(false);
  const [noteInput, setNoteInput] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const popoverRef = useRef<HTMLDivElement>(null);

  const triggeredAlertsRef = useRef<Set<string>>(
    new Set(JSON.parse(localStorage.getItem('triggered_alerts') || '[]'))
  );

  const saveTriggered = () => {
    try {
      localStorage.setItem('triggered_alerts', JSON.stringify(Array.from(triggeredAlertsRef.current)));
    } catch {}
  };

  // Load exchange symbols on mount for fast autocomplete
  useEffect(() => {
    fetchBinanceSymbols().then((syms) => {
      if (Array.isArray(syms) && syms.length > 0) {
        setExchangeSymbols(syms);
      }
    });
  }, []);

  // Close popover on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowSymbolDropdown(false);
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const normalizedSelectedSymbol = useMemo(() => {
    return getCleanTradingSymbol(symbolInput || 'BTCUSDT');
  }, [symbolInput]);

  // Live price for the currently selected symbol in the form
  const currentSelectedLivePrice = useMemo(() => {
    return livePrices[normalizedSelectedSymbol] || quotedPrice || null;
  }, [livePrices, normalizedSelectedSymbol, quotedPrice]);

  // Fetch instant quote when user types/selects a symbol not yet in livePrices
  useEffect(() => {
    if (!isOpen || !normalizedSelectedSymbol) return;
    if (livePrices[normalizedSelectedSymbol]) {
      setQuotedPrice(livePrices[normalizedSelectedSymbol]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/exchange/ticker?symbols=${encodeURIComponent(normalizedSelectedSymbol)}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const fetched = Number(data?.prices?.[normalizedSelectedSymbol]);
        if (fetched > 0 && !cancelled) {
          setQuotedPrice(fetched);
        }
      } catch {}
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [normalizedSelectedSymbol, isOpen, livePrices]);

  // Auto-infer Above / Below condition when user types a target price (unless manually locked)
  useEffect(() => {
    if (manualConditionLock) return;
    const numTarget = parseFloat(targetPriceInput);
    if (!isNaN(numTarget) && numTarget > 0 && currentSelectedLivePrice && currentSelectedLivePrice > 0) {
      setCondition(numTarget >= currentSelectedLivePrice ? 'above' : 'below');
    }
  }, [targetPriceInput, currentSelectedLivePrice, manualConditionLock]);

  const subscribeToPush = async () => {
    try {
      if (!('serviceWorker' in navigator) || !navigator.serviceWorker) return null;

      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => null);
      if (!reg) return null;
      await navigator.serviceWorker.ready.catch(() => null);

      if (!reg.pushManager) return null;
      let sub = await reg.pushManager.getSubscription().catch(() => null);
      if (!sub) {
        const key = urlBase64ToUint8Array(PUBLIC_VAPID_KEY);
        if (!key || key.length === 0) return null;
        sub = await reg.pushManager
          .subscribe({
            userVisibleOnly: true,
            applicationServerKey: key
          })
          .catch((err) => {
            console.warn('Push registration note:', err);
            return null;
          });
      }
      if (!sub) return null;

      const userId = auth.currentUser?.uid;
      if (!userId) return null;
      const subJson = sub.toJSON();

      try {
        const endpointRaw = subJson.endpoint || '';
        let endpointHash = 'dev';
        try {
          endpointHash = btoa(endpointRaw).slice(-32).replace(/[^a-zA-Z0-9]/g, '');
        } catch (_) {}
        const subDocId = `${userId}_${endpointHash}`;

        await setDoc(
          doc(db, 'push_subscriptions', subDocId),
          {
            userId,
            subscription: subJson,
            updatedAt: Date.now(),
            userAgent: navigator.userAgent,
            deviceType: /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop'
          },
          { merge: true }
        );
      } catch (err) {
        console.warn('Firestore subscription save note:', err);
      }

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

  // Auto-subscribe on load if permission is already granted and user is authenticated
  useEffect(() => {
    if (permission === 'granted' && currentUserId) {
      subscribeToPush();
    }
  }, [permission, currentUserId]);

  const handleBellClick = async () => {
    setIsOpen((prev) => !prev);
    if (permission === 'default' && 'Notification' in window) {
      try {
        const result = await Notification.requestPermission();
        setPermission(result);
        if (result === 'granted') {
          toast.success('OS & Background Price Alerts enabled!');
          await subscribeToPush();
        }
      } catch {}
    }
  };

  const requestSystemPermission = async () => {
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;

    if (isIOS && !isStandalone) {
      toast(
        (t) => (
          <div className="flex flex-col gap-2">
            <span className="font-bold text-sm">📱 iOS Home Screen Required</span>
            <span className="text-xs text-neutral-300">
              Apple requires Web Push notifications to run from an app added to your Home Screen. Tap the{' '}
              <strong>Share</strong> button in Safari and select <strong>"Add to Home Screen"</strong>.
            </span>
            <button
              onClick={() => toast.dismiss(t.id)}
              className="mt-1 px-3 py-1 bg-blue-600 text-white text-xs font-semibold rounded"
            >
              Got it
            </button>
          </div>
        ),
        { duration: 10000 }
      );
      return;
    }

    if (!('Notification' in window)) {
      toast.error('This browser does not support system notifications');
      return;
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === 'granted') {
        toast.success('System & Background Push Alerts enabled!');
        await subscribeToPush();
      } else if (result === 'denied') {
        toast.error('Notifications are blocked in browser permissions.');
      }
    } catch {
      toast.error('Could not request notification permission.');
    }
  };

  const handleTestPush = async () => {
    setIsTestingPush(true);
    try {
      playNotificationChime('alert');
      const userId = auth.currentUser?.uid || 'anonymous';
      const res = await fetch('/api/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        toast.success('Test alert dispatched! Check your system notifications.');
      } else {
        toast.success('In-app audio chime tested! Grant browser permission for background push.');
      }
    } catch {
      toast.error('Failed to trigger test push.');
    } finally {
      setIsTestingPush(false);
    }
  };

  // Sync active trade milestones + custom coin price alerts with server push engine
  useEffect(() => {
    const userId = auth.currentUser?.uid || currentUserId;
    if (permission !== 'granted' || !('serviceWorker' in navigator) || !userId) return;

    const syncServerAlerts = async () => {
      const openTrades = trades.filter(
        (t) =>
          ['ACTIVE', 'PENDING', 'HIT_TP1', 'HIT_TP2', 'PARTIAL_EXIT'].includes(t.status || 'ACTIVE') &&
          !t.closedAt &&
          !['CLOSED_MANUAL', 'HIT_SL', 'HIT_TP3', 'CLOSED_BREAK_EVEN', 'BREAK_EVEN'].includes(t.status || '')
      );

      const alerts: any[] = [];
      const seenSymbolMilestones = new Set<string>();
      const pushUniqueMilestone = (alertObj: any) => {
        const symKey = `${String(alertObj.symbol || '').toUpperCase()}_${alertObj.type}_${alertObj.targetPrice}`;
        if (seenSymbolMilestones.has(symKey)) return;
        seenSymbolMilestones.add(symKey);
        alerts.push(alertObj);
      };

      // 1. Trade milestone alerts
      openTrades.forEach((t) => {
        const isLong = getTradeIsLong(t);
        const notified = new Set<string>(Array.isArray(t.notifiedMilestones) ? t.notifiedMilestones : []);

        const isBinanceTrade = Boolean(
          t.binanceOrderId ||
            t.clientOrderId ||
            t.id?.startsWith('binance_') ||
            isBinanceLinkedTrade(t) ||
            isBinanceLimitOrder(t)
        );

        if (!isBinanceTrade && t.status === 'PENDING' && t.entryPrice > 0 && !notified.has('ENTRY')) {
          const isBreakout = isBreakoutStopLimitTrade(t);
          const cond = isBreakout ? (isLong ? 'above' : 'below') : isLong ? 'below' : 'above';
          pushUniqueMilestone({
            id: `${t.id}_ENTRY`,
            tradeId: t.id,
            type: 'ENTRY',
            symbol: t.symbol,
            targetPrice: t.entryPrice,
            condition: cond,
            message: `⚡ ${t.symbol} Limit Order Filled at $${t.entryPrice}!`
          });
        }
        const isHolding = t.type === 'HOLDING';
        const entry = t.entryPrice || 0;
        const isSyntheticPlan =
          entry > 0 &&
          t.stopLoss &&
          t.stopLoss > 0 &&
          Math.abs(t.stopLoss - entry * 0.915) / entry < 0.01 &&
          t.takeProfit1 &&
          t.takeProfit1 > 0 &&
          Math.abs(t.takeProfit1 - entry * 1.15) / entry < 0.01;

        if (!isHolding && !isSyntheticPlan && ['ACTIVE', 'HIT_TP1', 'HIT_TP2', 'PARTIAL_EXIT'].includes(t.status || '')) {
          if (t.stopLoss && t.stopLoss > 0 && !notified.has('SL') && t.status !== 'HIT_SL') {
            pushUniqueMilestone({
              id: `${t.id}_SL`,
              tradeId: t.id,
              type: 'SL',
              symbol: t.symbol,
              targetPrice: t.stopLoss,
              condition: isLong ? 'below' : 'above',
              message: `🚨 ${t.symbol} Stop Loss reached at $${t.stopLoss}`
            });
          }
          if (
            t.takeProfit1 &&
            t.takeProfit1 > 0 &&
            !notified.has('TP1') &&
            !['HIT_TP1', 'HIT_TP2', 'HIT_TP3'].includes(t.status || '')
          ) {
            pushUniqueMilestone({
              id: `${t.id}_TP1`,
              tradeId: t.id,
              type: 'TP1',
              symbol: t.symbol,
              targetPrice: t.takeProfit1,
              condition: isLong ? 'above' : 'below',
              message: `🎯 ${t.symbol} TP1 reached at $${t.takeProfit1}! Move Stop Loss to Breakeven.`
            });
          }
          if (
            t.takeProfit2 &&
            t.takeProfit2 > 0 &&
            !notified.has('TP2') &&
            !['HIT_TP2', 'HIT_TP3'].includes(t.status || '')
          ) {
            pushUniqueMilestone({
              id: `${t.id}_TP2`,
              tradeId: t.id,
              type: 'TP2',
              symbol: t.symbol,
              targetPrice: t.takeProfit2,
              condition: isLong ? 'above' : 'below',
              message: `🎯 ${t.symbol} TP2 reached at $${t.takeProfit2}`
            });
          }
          if (t.takeProfit3 && t.takeProfit3 > 0 && !notified.has('TP3') && t.status !== 'HIT_TP3') {
            pushUniqueMilestone({
              id: `${t.id}_TP3`,
              tradeId: t.id,
              type: 'TP3',
              symbol: t.symbol,
              targetPrice: t.takeProfit3,
              condition: isLong ? 'above' : 'below',
              message: `🎯 ${t.symbol} TP3 reached at $${t.takeProfit3}`
            });
          }
        }
      });

      // 2. Custom Coin Price Alerts
      priceAlerts
        .filter((pa) => pa.isActive && pa.symbol && pa.targetPrice > 0)
        .forEach((pa) => {
          const dirLabel = pa.condition === 'below' ? 'dropped below' : 'crossed above';
          const noteSuffix = pa.note ? ` — "${pa.note}"` : '';
          alerts.push({
            id: pa.id,
            customAlertId: pa.id,
            isCustomPriceAlert: true,
            recurring: Boolean(pa.recurring),
            lastTriggeredAt: pa.lastTriggeredAt || null,
            triggerCount: pa.triggerCount || 0,
            createdAt: pa.createdAt || 0,
            updatedAt: pa.updatedAt || pa.createdAt || 0,
            type: 'CUSTOM_PRICE',
            symbol: pa.symbol,
            targetPrice: pa.targetPrice,
            condition: pa.condition,
            note: pa.note || '',
            message: `${pa.symbol} ${dirLabel} $${pa.targetPrice}${noteSuffix}`
          });
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
  }, [trades, priceAlerts, permission, currentUserId]);

  // Foreground real-time evaluation for Custom Coin Price Alerts + Open Trade Milestones
  useEffect(() => {
    const now = Date.now();

    // 1. Evaluate Custom Coin Price Alerts in O(1) symbol lookup
    priceAlerts.forEach((alert) => {
      if (!alert.isActive || !alert.symbol || alert.targetPrice <= 0) return;
      const livePrice = livePrices[alert.symbol];
      if (!livePrice || livePrice <= 0) return;

      const isHit =
        (alert.condition === 'above' && livePrice >= alert.targetPrice) ||
        (alert.condition === 'below' && livePrice <= alert.targetPrice);

      if (!isHit) return;

      const createdAt = alert.createdAt || 0;
      const versionKey = `custom_${alert.id}_${alert.targetPrice}_${createdAt}`;
      const activeLockKey = `custom_active_${alert.id}_${createdAt}`;

      if (alert.recurring) {
        // 60-second anti-spam cooldown for recurring alerts
        if (alert.lastTriggeredAt && now - alert.lastTriggeredAt < 60000) {
          return;
        }
        const recurringMinuteKey = `custom_${alert.id}_${alert.targetPrice}_${Math.floor(now / 60000)}`;
        if (triggeredAlertsRef.current.has(recurringMinuteKey)) return;
        triggeredAlertsRef.current.add(recurringMinuteKey);
        saveTriggered();

        updatePriceAlert(alert.id, {
          isActive: true,
          lastTriggeredAt: now,
          lastTriggeredPrice: livePrice,
          triggerCount: (alert.triggerCount || 0) + 1
        });

        notifyCustomPriceAlert({
          alertId: alert.id,
          symbol: alert.symbol,
          targetPrice: alert.targetPrice,
          livePrice,
          condition: alert.condition,
          note: alert.note,
          recurring: true,
          createdAt,
          userId: auth.currentUser?.uid
        });
      } else {
        // One-time trigger: fire once and disarm immediately
        if (
          triggeredAlertsRef.current.has(versionKey) ||
          triggeredAlertsRef.current.has(activeLockKey)
        ) {
          return;
        }
        triggeredAlertsRef.current.add(versionKey);
        triggeredAlertsRef.current.add(activeLockKey);
        saveTriggered();

        updatePriceAlert(alert.id, {
          isActive: false,
          lastTriggeredAt: now,
          lastTriggeredPrice: livePrice,
          triggerCount: (alert.triggerCount || 0) + 1
        });

        notifyCustomPriceAlert({
          alertId: alert.id,
          symbol: alert.symbol,
          targetPrice: alert.targetPrice,
          livePrice,
          condition: alert.condition,
          note: alert.note,
          recurring: false,
          createdAt,
          userId: auth.currentUser?.uid
        });
      }
    });

    // 2. Evaluate Open Trade Milestones when permission is granted
    if (permission !== 'granted') return;
    const openTrades = trades.filter(
      (t) =>
        ['ACTIVE', 'PENDING', 'HIT_TP1', 'HIT_TP2', 'PARTIAL_EXIT'].includes(t.status || 'ACTIVE') &&
        !t.closedAt &&
        !['CLOSED_MANUAL', 'HIT_SL', 'HIT_TP3', 'CLOSED_BREAK_EVEN', 'BREAK_EVEN'].includes(t.status || '')
    );

    openTrades.forEach((trade) => {
      if (!trade.id) return;
      if (isBinanceLinkedTrade(trade) || isBinanceLimitOrder(trade) || trade.binanceOrderId) {
        return;
      }
      const livePrice = livePrices[trade.symbol];
      if (!livePrice) return;
      const isLong = getTradeIsLong(trade);
      const notified = new Set<string>(Array.isArray(trade.notifiedMilestones) ? trade.notifiedMilestones : []);

      const triggerAlert = (type: string, message: string, targetPrice: number) => {
        const alertKey = `${trade.id}_${type}`;
        const fullKey = `${trade.id}_${type}_${targetPrice}`;
        const curBucket = Math.floor(Date.now() / 600000);
        const symBaseKey = `symbol_${trade.symbol}_${type}_${targetPrice}`;
        const symWindowKey = `${symBaseKey}_${curBucket}`;

        if (
          notified.has(type) ||
          triggeredAlertsRef.current.has(alertKey) ||
          triggeredAlertsRef.current.has(fullKey) ||
          triggeredAlertsRef.current.has(symWindowKey)
        ) {
          return;
        }

        triggeredAlertsRef.current.add(alertKey);
        triggeredAlertsRef.current.add(fullKey);
        triggeredAlertsRef.current.add(symWindowKey);
        saveTriggered();

        const showFallback = () => {
          if ('serviceWorker' in navigator && navigator.serviceWorker) {
            navigator.serviceWorker.ready
              .then((reg) => {
                if (reg && reg.showNotification) {
                  reg.showNotification('Trade Sizer Alert', {
                    body: message,
                    icon: '/pwa-192x192.png',
                    tag: symBaseKey
                  });
                } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                  new Notification('Trade Sizer Alert', { body: message, icon: '/pwa-192x192.png', tag: symBaseKey });
                }
              })
              .catch(() => {});
          } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            try {
              new Notification('Trade Sizer Alert', { body: message, icon: '/pwa-192x192.png', tag: symBaseKey });
            } catch (_) {}
          }
        };

        // Coordinate with server /api/push/notify so the 4s background loop is immediately disarmed and never sends a duplicate push
        fetch('/api/push/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: auth.currentUser?.uid || currentUserId || undefined,
            alertId: alertKey,
            lockKey: fullKey,
            tradeId: trade.id,
            type,
            symbol: trade.symbol,
            targetPrice,
            title: 'Trade Sizer Alert',
            body: message,
            tag: symBaseKey,
            url: '/'
          })
        })
          .then((res) => res.json())
          .then((data) => {
            if (!data || (data.sentCount === 0 && data.status !== 'already_sent')) {
              showFallback();
            }
          })
          .catch(() => {
            showFallback();
          });

        if (trade.id) {
          const updatePayload: any = {
            notifiedMilestones: arrayUnion(type)
          };
          if (type === 'ENTRY' && trade.status === 'PENDING') {
            updatePayload.status = 'ACTIVE';
            updatePayload.filledAt = Date.now();
            toast.success(
              `⚡ Limit order filled! ${trade.symbol} hit entry at $${targetPrice}. Moved to Active Trades!`
            );
          }
          updateDoc(doc(db, 'trades', trade.id), updatePayload).catch(() => null);
        }
      };

      if (trade.status === 'PENDING' && trade.entryPrice > 0 && !notified.has('ENTRY')) {
        const isBinanceTrade = isBinanceLinkedTrade(trade) || Boolean(trade.binanceOrderId || trade.clientOrderId);
        if (isBinanceTrade) return;

        const isBreakout = isBreakoutStopLimitTrade(trade, livePrice);
        const entryHit = isBreakout
          ? isLong
            ? livePrice >= trade.entryPrice
            : livePrice <= trade.entryPrice
          : isLong
            ? livePrice <= trade.entryPrice
            : livePrice >= trade.entryPrice;
        if (entryHit) triggerAlert('ENTRY', `${trade.symbol} Entry Hit at $${livePrice}`, trade.entryPrice);
      }
      if (['ACTIVE', 'HIT_TP1', 'HIT_TP2', 'PARTIAL_EXIT'].includes(trade.status || '')) {
        if (
          trade.stopLoss &&
          trade.stopLoss > 0 &&
          !notified.has('SL') &&
          trade.status !== 'HIT_SL' &&
          ((isLong && livePrice <= trade.stopLoss) || (!isLong && livePrice >= trade.stopLoss))
        ) {
          triggerAlert('SL', `🚨 ${trade.symbol} Stop Loss Hit at $${livePrice}`, trade.stopLoss);
        }
        if (
          trade.takeProfit1 &&
          trade.takeProfit1 > 0 &&
          !notified.has('TP1') &&
          !['HIT_TP1', 'HIT_TP2', 'HIT_TP3'].includes(trade.status || '') &&
          ((isLong && livePrice >= trade.takeProfit1) || (!isLong && livePrice <= trade.takeProfit1))
        ) {
          triggerAlert(
            'TP1',
            `🎯 ${trade.symbol} TP1 Hit at $${livePrice}! Capital Protection: Move Stop Loss to Breakeven.`,
            trade.takeProfit1
          );
        }
        if (
          trade.takeProfit2 &&
          trade.takeProfit2 > 0 &&
          !notified.has('TP2') &&
          !['HIT_TP2', 'HIT_TP3'].includes(trade.status || '') &&
          ((isLong && livePrice >= trade.takeProfit2) || (!isLong && livePrice <= trade.takeProfit2))
        ) {
          triggerAlert('TP2', `🎯 ${trade.symbol} TP2 Hit at $${livePrice}`, trade.takeProfit2);
        }
        if (
          trade.takeProfit3 &&
          trade.takeProfit3 > 0 &&
          !notified.has('TP3') &&
          trade.status !== 'HIT_TP3' &&
          ((isLong && livePrice >= trade.takeProfit3) || (!isLong && livePrice <= trade.takeProfit3))
        ) {
          triggerAlert('TP3', `🎯 ${trade.symbol} TP3 Hit at $${livePrice}`, trade.takeProfit3);
        }
      }
    });
  }, [livePrices, trades, priceAlerts, permission, updatePriceAlert]);

  const activeTrades = useMemo(
    () => trades.filter((t) => t.status === 'ACTIVE' || t.status === 'PENDING'),
    [trades]
  );

  const activeCustomAlerts = useMemo(
    () => priceAlerts.filter((a) => a.isActive),
    [priceAlerts]
  );

  const inactiveCustomAlerts = useMemo(
    () => priceAlerts.filter((a) => !a.isActive),
    [priceAlerts]
  );

  // Quick-select symbols from active trades + top liquid coins
  const quickPickSymbols = useMemo(() => {
    const fromTrades = activeTrades.map((t) => getCleanTradingSymbol(t.symbol));
    const defaults = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'TAOUSDT', 'XRPUSDT'];
    return Array.from(new Set([...fromTrades, ...defaults])).slice(0, 6);
  }, [activeTrades]);

  const filteredSymbolSuggestions = useMemo(() => {
    const q = symbolInput.trim().toUpperCase();
    if (!q) return quickPickSymbols;
    return exchangeSymbols.filter((s) => s.includes(q)).slice(0, 8);
  }, [symbolInput, exchangeSymbols, quickPickSymbols]);

  const applyQuickOffset = (pct: number) => {
    if (!currentSelectedLivePrice || currentSelectedLivePrice <= 0) {
      toast.error('Select a coin with a live price first');
      return;
    }
    const computed = currentSelectedLivePrice * (1 + pct / 100);
    setTargetPriceInput(formatSmartTargetPrice(computed));
    setCondition(pct >= 0 ? 'above' : 'below');
    setManualConditionLock(true);
  };

  const handleCreateCoinAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanSym = getCleanTradingSymbol(symbolInput);
    const numTarget = parseFloat(targetPriceInput);
    if (!cleanSym) {
      toast.error('Please enter a valid coin symbol');
      return;
    }
    if (isNaN(numTarget) || numTarget <= 0) {
      toast.error('Please enter a valid target price greater than 0');
      return;
    }

    setIsCreating(true);
    try {
      await addPriceAlert({
        symbol: cleanSym,
        targetPrice: numTarget,
        condition,
        recurring,
        isActive: true,
        note: noteInput.trim()
      });

      playNotificationChime('test');
      toast.success(
        `🔔 Alert armed: ${cleanSym} ${condition === 'above' ? '▲ ≥' : '▼ ≤'} $${formatPrice(numTarget)}${
          recurring ? ' (Recurring)' : ''
        }`
      );
      setTargetPriceInput('');
      setNoteInput('');
      setManualConditionLock(false);

      if (permission === 'default' && 'Notification' in window) {
        requestSystemPermission();
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggleAlertActive = async (alertId: string, currentlyActive: boolean) => {
    if (currentlyActive) {
      await updatePriceAlert(alertId, { isActive: false });
      toast('Alert paused', { icon: '⏸️' });
    } else {
      await updatePriceAlert(alertId, { isActive: true, lastTriggeredAt: null, createdAt: Date.now() });
      toast.success('Alert re-armed!');
    }
  };

  const totalArmedCount = activeCustomAlerts.length + activeTrades.length;

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={handleBellClick}
        className={`relative h-8 px-2.5 rounded-lg flex items-center gap-1.5 justify-center transition-all whitespace-nowrap shrink-0 ${
          permission === 'granted' || activeCustomAlerts.length > 0
            ? 'text-sky-400 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/25'
            : 'text-neutral-400 hover:text-white bg-neutral-900 hover:bg-neutral-800 border border-neutral-800'
        }`}
        title="Coin Price Alerts & Position Notifications"
      >
        {permission === 'granted' || activeCustomAlerts.length > 0 ? (
          <BellRing className="w-4 h-4 text-sky-400" />
        ) : (
          <Bell className="w-4 h-4" />
        )}
        {activeCustomAlerts.length > 0 && (
          <span className="font-mono tabular-nums text-[11px] font-bold text-sky-300">
            {activeCustomAlerts.length}
          </span>
        )}
        {totalArmedCount > 0 && (
          <span className="w-1.5 h-1.5 bg-sky-400 rounded-full"></span>
        )}
      </button>

      {/* Unified Two-Tab Bell Alert Manager Popover */}
      {isOpen && (
        <div className="fixed sm:absolute right-2 sm:right-0 top-14 sm:top-auto sm:mt-2 w-[calc(100vw-1rem)] sm:w-[420px] max-w-[420px] bg-neutral-900 border border-neutral-800 rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800 bg-neutral-950/60">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0" />
              <span className="text-sm font-semibold text-white whitespace-nowrap">
                Price Alert & Notification Center
              </span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-neutral-400 hover:text-white p-1 rounded-md hover:bg-neutral-800 transition-colors"
              aria-label="Close alert manager"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Segmented Tab Switcher */}
          <div className="grid grid-cols-2 gap-1 p-1.5 bg-neutral-950 border-b border-neutral-800/80">
            <button
              type="button"
              onClick={() => setActiveTab('coin_alerts')}
              className={`py-1.5 px-3 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 whitespace-nowrap ${
                activeTab === 'coin_alerts'
                  ? 'bg-neutral-800 text-white shadow-sm'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <span>Coin Price Alerts</span>
              <span className="font-mono tabular-nums text-[11px] text-sky-400">
                ({activeCustomAlerts.length})
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('trade_alerts')}
              className={`py-1.5 px-3 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 whitespace-nowrap ${
                activeTab === 'trade_alerts'
                  ? 'bg-neutral-800 text-white shadow-sm'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <span>Trade Milestones</span>
              <span className="font-mono tabular-nums text-[11px] text-neutral-400">
                ({activeTrades.length})
              </span>
            </button>
          </div>

          {/* Permission Banner if OS notifications are not yet granted */}
          {permission !== 'granted' && (
            <div className="px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between gap-2">
              <span className="text-[11px] text-amber-200 leading-tight">
                Enable OS push notifications to receive alerts when the app is closed.
              </span>
              <button
                type="button"
                onClick={requestSystemPermission}
                className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-semibold text-[11px] rounded-md whitespace-nowrap shrink-0 transition-colors"
              >
                Enable Push
              </button>
            </div>
          )}

          {activeTab === 'coin_alerts' ? (
            <div className="p-4 space-y-4 max-h-[78vh] overflow-y-auto">
              {/* Create Coin Price Alert Form */}
              <form onSubmit={handleCreateCoinAlert} className="space-y-3 bg-neutral-950/70 border border-neutral-800/80 rounded-xl p-3">
                {/* Row 1: Symbol Input + Live Market Price */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <label className="text-neutral-400 font-medium">Coin Symbol</label>
                    {currentSelectedLivePrice ? (
                      <button
                        type="button"
                        onClick={() => {
                          setTargetPriceInput(formatSmartTargetPrice(currentSelectedLivePrice));
                          setManualConditionLock(false);
                        }}
                        className="text-sky-400 hover:text-sky-300 font-mono tabular-nums flex items-center gap-1 transition-colors"
                        title="Click to copy live price into Target Price"
                      >
                        <span>Live: ${formatPrice(currentSelectedLivePrice)}</span>
                      </button>
                    ) : (
                      <span className="text-neutral-500 font-mono tabular-nums">Fetching live price...</span>
                    )}
                  </div>

                  <div className="relative">
                    <div className="relative flex items-center">
                      <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 pointer-events-none" />
                      <input
                        type="text"
                        value={symbolInput}
                        onFocus={() => setShowSymbolDropdown(true)}
                        onChange={(e) => {
                          setSymbolInput(e.target.value.toUpperCase());
                          setShowSymbolDropdown(true);
                        }}
                        placeholder="e.g. BTCUSDT, SOLUSDT, TAOUSDT"
                        className="w-full pl-8 pr-3 py-1.5 bg-neutral-900 border border-neutral-800 focus:border-sky-500/60 rounded-lg text-xs font-semibold text-white font-mono uppercase outline-none transition-colors"
                      />
                    </div>

                    {/* Autocomplete Symbol Dropdown */}
                    {showSymbolDropdown && filteredSymbolSuggestions.length > 0 && (
                      <div className="absolute left-0 right-0 mt-1 bg-neutral-900 border border-neutral-800 rounded-lg shadow-xl z-30 max-h-40 overflow-y-auto divide-y divide-neutral-800/60">
                        {filteredSymbolSuggestions.map((sym) => {
                          const symLive = livePrices[sym];
                          return (
                            <button
                              key={sym}
                              type="button"
                              onClick={() => {
                                setSymbolInput(sym);
                                setShowSymbolDropdown(false);
                                setManualConditionLock(false);
                              }}
                              className="w-full px-3 py-1.5 text-left text-xs hover:bg-neutral-800 flex items-center justify-between transition-colors"
                            >
                              <span className="font-mono font-semibold text-white">{sym}</span>
                              {symLive ? (
                                <span className="font-mono tabular-nums text-[11px] text-sky-400">
                                  ${formatPrice(symLive)}
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Quick Symbol Chips */}
                  <div className="flex items-center gap-1 overflow-x-auto pt-0.5 no-scrollbar">
                    {quickPickSymbols.map((sym) => (
                      <button
                        key={sym}
                        type="button"
                        onClick={() => {
                          setSymbolInput(sym);
                          setShowSymbolDropdown(false);
                          setManualConditionLock(false);
                        }}
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium transition-colors whitespace-nowrap shrink-0 ${
                          normalizedSelectedSymbol === sym
                            ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                            : 'bg-neutral-900 text-neutral-400 hover:text-neutral-200 border border-neutral-800'
                        }`}
                      >
                        {sym.replace(/USDT$/, '')}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Row 2: Target Price Input + Above/Below Condition Selector */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <label className="text-neutral-400 font-medium">Target Price (USDT)</label>
                    {currentSelectedLivePrice && targetPriceInput && !isNaN(parseFloat(targetPriceInput)) && parseFloat(targetPriceInput) > 0 ? (
                      <span className="font-mono tabular-nums text-[11px] text-neutral-400">
                        {(((parseFloat(targetPriceInput) - currentSelectedLivePrice) / currentSelectedLivePrice) * 100 >= 0 ? '+' : '') +
                          (((parseFloat(targetPriceInput) - currentSelectedLivePrice) / currentSelectedLivePrice) * 100).toFixed(2)}
                        % from live
                      </span>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-12 gap-1.5">
                    <div className="col-span-7 relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-mono text-neutral-500">
                        $
                      </span>
                      <input
                        type="number"
                        step="any"
                        value={targetPriceInput}
                        onFocus={() => setShowSymbolDropdown(false)}
                        onChange={(e) => setTargetPriceInput(e.target.value)}
                        placeholder={currentSelectedLivePrice ? formatSmartTargetPrice(currentSelectedLivePrice) : '0.00'}
                        className="w-full pl-6 pr-2.5 py-1.5 bg-neutral-900 border border-neutral-800 focus:border-sky-500/60 rounded-lg text-xs font-mono tabular-nums font-semibold text-white outline-none transition-colors"
                      />
                    </div>

                    {/* Above / Below Segmented Buttons */}
                    <div className="col-span-5 grid grid-cols-2 gap-1 bg-neutral-900 p-0.5 rounded-lg border border-neutral-800">
                      <button
                        type="button"
                        onClick={() => {
                          setCondition('above');
                          setManualConditionLock(true);
                        }}
                        className={`rounded-md text-[11px] font-semibold flex items-center justify-center gap-0.5 transition-colors whitespace-nowrap ${
                          condition === 'above'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'text-neutral-400 hover:text-neutral-200'
                        }`}
                        title="Trigger when price crosses at or above target"
                      >
                        <TrendingUp className="w-3 h-3" />
                        <span>Above</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCondition('below');
                          setManualConditionLock(true);
                        }}
                        className={`rounded-md text-[11px] font-semibold flex items-center justify-center gap-0.5 transition-colors whitespace-nowrap ${
                          condition === 'below'
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            : 'text-neutral-400 hover:text-neutral-200'
                        }`}
                        title="Trigger when price drops at or below target"
                      >
                        <TrendingDown className="w-3 h-3" />
                        <span>Below</span>
                      </button>
                    </div>
                  </div>

                  {/* Quick Percentage Offset Buttons */}
                  {currentSelectedLivePrice && currentSelectedLivePrice > 0 && (
                    <div className="grid grid-cols-6 gap-1 pt-0.5">
                      {[-5, -2, -1, 1, 2, 5].map((pct) => (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => applyQuickOffset(pct)}
                          className={`py-1 rounded text-[10px] font-mono tabular-nums font-medium border transition-colors ${
                            pct < 0
                              ? 'bg-rose-500/5 hover:bg-rose-500/15 text-rose-300 border-rose-500/20'
                              : 'bg-emerald-500/5 hover:bg-emerald-500/15 text-emerald-300 border-emerald-500/20'
                          }`}
                        >
                          {pct > 0 ? `+${pct}%` : `${pct}%`}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Row 3: Note + One-Time vs. Recurring Toggle */}
                <div className="grid grid-cols-12 gap-1.5 items-center">
                  <div className="col-span-7">
                    <input
                      type="text"
                      maxLength={80}
                      value={noteInput}
                      onChange={(e) => setNoteInput(e.target.value)}
                      placeholder="Optional note (e.g. Breakout level)"
                      className="w-full px-2.5 py-1.5 bg-neutral-900 border border-neutral-800 focus:border-sky-500/60 rounded-lg text-[11px] text-white placeholder:text-neutral-500 outline-none"
                    />
                  </div>
                  <div className="col-span-5">
                    <button
                      type="button"
                      onClick={() => setRecurring((prev) => !prev)}
                      className={`w-full py-1.5 px-2.5 rounded-lg border text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
                        recurring
                          ? 'bg-sky-500/15 border-sky-500/35 text-sky-300'
                          : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                      }`}
                      title={
                        recurring
                          ? 'Recurring Alert: Fires every time price hits target (60s cooldown)'
                          : 'One-Time Alert: Fires once and automatically disarms'
                      }
                    >
                      <Repeat className="w-3 h-3 shrink-0" />
                      <span>{recurring ? 'Recurring' : 'One-Time'}</span>
                    </button>
                  </div>
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={isCreating}
                  className="w-full py-2 px-3 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-neutral-950 font-semibold text-xs rounded-lg flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Create Price Alert</span>
                </button>
              </form>

              {/* Active Armed Coin Price Alerts List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-neutral-300">
                    Active Armed Alerts ({activeCustomAlerts.length})
                  </span>
                  <span className="text-[11px] text-neutral-500">24/7 Cloud + Live Stream</span>
                </div>

                {activeCustomAlerts.length === 0 ? (
                  <div className="bg-neutral-950/50 border border-neutral-800/70 rounded-xl p-4 text-center space-y-1">
                    <div className="text-xs font-medium text-neutral-300">No active coin price alerts</div>
                    <div className="text-[11px] text-neutral-500">
                      Set a target price above or below any coin to receive instant push & audio notifications.
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {activeCustomAlerts.map((alert) => {
                      const live = livePrices[alert.symbol];
                      const pctDistance =
                        live && live > 0 ? ((alert.targetPrice - live) / live) * 100 : null;
                      const isAbove = alert.condition === 'above';

                      return (
                        <div
                          key={alert.id}
                          className="bg-neutral-950/90 border border-neutral-800/90 hover:border-neutral-700 rounded-lg p-2.5 flex items-center justify-between gap-2 transition-colors"
                        >
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-bold text-xs text-white">
                                {alert.symbol}
                              </span>
                              <span
                                className={`text-[11px] font-mono tabular-nums font-semibold ${
                                  isAbove ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                {isAbove ? '▲ ≥' : '▼ ≤'} ${formatPrice(alert.targetPrice)}
                              </span>
                              {alert.recurring && (
                                <span
                                  className="text-[10px] text-sky-400 flex items-center gap-0.5"
                                  title="Recurring alert (60s cooldown)"
                                >
                                  · <Repeat className="w-2.5 h-2.5 inline" />
                                  {alert.triggerCount ? ` ${alert.triggerCount}x` : ''}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 text-[11px] text-neutral-400 font-mono tabular-nums">
                              <span>
                                Live: {live ? `$${formatPrice(live)}` : '...'}
                              </span>
                              {pctDistance !== null && (
                                <>
                                  <span>·</span>
                                  <span
                                    className={
                                      Math.abs(pctDistance) <= 0.6
                                        ? 'text-amber-300 font-semibold'
                                        : 'text-neutral-400'
                                    }
                                  >
                                    {pctDistance >= 0 ? `+${pctDistance.toFixed(2)}%` : `${pctDistance.toFixed(2)}%`} away
                                  </span>
                                </>
                              )}
                            </div>

                            {alert.note && (
                              <div className="text-[11px] text-neutral-400 truncate">
                                "{alert.note}"
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleToggleAlertActive(alert.id, true)}
                              className="p-1.5 text-neutral-400 hover:text-amber-300 hover:bg-neutral-800 rounded-md transition-colors"
                              title="Pause alert"
                            >
                              <Pause className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => deletePriceAlert(alert.id)}
                              className="p-1.5 text-neutral-400 hover:text-rose-400 hover:bg-neutral-800 rounded-md transition-colors"
                              title="Delete alert"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Triggered / Paused Alerts History */}
              {inactiveCustomAlerts.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-neutral-800/80">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-neutral-400">
                      Triggered & Paused ({inactiveCustomAlerts.length})
                    </span>
                    <button
                      type="button"
                      onClick={clearTriggeredPriceAlerts}
                      className="text-[11px] text-neutral-400 hover:text-rose-400 transition-colors"
                    >
                      Clear Triggered
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    {inactiveCustomAlerts.slice(0, 6).map((alert) => {
                      const wasTriggered = (alert.triggerCount || 0) > 0;
                      return (
                        <div
                          key={alert.id}
                          className="bg-neutral-950/40 border border-neutral-800/50 rounded-lg p-2 flex items-center justify-between gap-2 opacity-80"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 text-xs font-mono tabular-nums">
                              <span className="font-semibold text-neutral-300">{alert.symbol}</span>
                              <span className="text-neutral-400">
                                {alert.condition === 'above' ? '▲ ≥' : '▼ ≤'} ${formatPrice(alert.targetPrice)}
                              </span>
                              <span className="text-[10px] text-neutral-500">
                                · {wasTriggered ? 'Triggered' : 'Paused'}
                              </span>
                            </div>
                            {alert.note && (
                              <div className="text-[10px] text-neutral-500 truncate">"{alert.note}"</div>
                            )}
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleToggleAlertActive(alert.id, false)}
                              className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-sky-400 rounded text-[11px] font-medium flex items-center gap-1 transition-colors"
                              title="Re-arm alert"
                            >
                              {wasTriggered ? <RotateCcw className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                              <span>Re-arm</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => deletePriceAlert(alert.id)}
                              className="p-1 text-neutral-500 hover:text-rose-400 rounded transition-colors"
                              title="Delete alert"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Tab 2: Active Trade Milestone Monitors */
            <div className="p-4 space-y-3 text-xs max-h-[75vh] overflow-y-auto">
              <div className="bg-sky-500/10 border border-sky-500/20 rounded-lg p-3 flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                <div className="text-neutral-300 leading-relaxed">
                  <span className="font-semibold text-sky-400">24/7 Position Milestones Active.</span> Automatic Entry,
                  Stop Loss, and Take Profit (TP1–TP3) alerts are delivered directly to your device even when the app is
                  closed.
                </div>
              </div>

              <div>
                <div className="text-neutral-400 font-medium mb-1.5 flex items-center justify-between">
                  <span>Monitored Active Positions:</span>
                  <span className="text-white font-mono tabular-nums font-semibold">
                    {activeTrades.length} trade{activeTrades.length === 1 ? '' : 's'}
                  </span>
                </div>
                {activeTrades.length === 0 ? (
                  <div className="text-neutral-500 bg-neutral-950/60 rounded-lg p-3 text-center border border-neutral-800/60">
                    No active or pending trades with SL/TP set.
                  </div>
                ) : (
                  <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                    {activeTrades.map((t) => (
                      <div
                        key={t.id}
                        className="bg-neutral-950/80 border border-neutral-800/80 rounded-lg p-2.5 flex items-center justify-between"
                      >
                        <span className="font-mono font-semibold text-white">{t.symbol}</span>
                        <div className="flex items-center gap-2 text-[11px] text-neutral-400 font-mono tabular-nums">
                          {t.stopLoss ? <span className="text-rose-300">SL: ${formatPrice(t.stopLoss)}</span> : null}
                          {t.takeProfit1 ? (
                            <span className="text-emerald-400">TP1: ${formatPrice(t.takeProfit1)}</span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-neutral-800 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleTestPush}
                  disabled={isTestingPush}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg font-medium text-xs transition-colors disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5 text-sky-400" />
                  <span>{isTestingPush ? 'Sending...' : 'Send Test Notification'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => playNotificationChime('alert')}
                  className="py-2 px-3 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white rounded-lg font-medium text-xs flex items-center gap-1 transition-colors"
                  title="Test audio chime"
                >
                  <Volume2 className="w-3.5 h-3.5 text-sky-400" />
                  <span>Chime</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
