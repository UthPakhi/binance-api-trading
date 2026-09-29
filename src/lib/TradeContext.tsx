import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { auth, db } from './firebase';
import { collection, query, where, orderBy, onSnapshot, doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc, arrayUnion } from 'firebase/firestore';
import { Trade, BinanceBalanceInfo, PnlViewMode, FeeTierId, FEE_TIERS, OfflineAction } from '../types';
import { useBinanceTickers } from './binance';
import { calculateProfit, isAlphaTradeOrSymbol, getTradeIsLong, getTradeEffectiveRisk, isTradeClosed, getTradeCoins, getTradeInvestedAmount, formatPrice, isBinanceLinkedTrade, isStopLossAtBreakeven } from './tradeUtils';
import { reconcileTrade } from './tradeReconciliation';
import { syncTradeWithBinance } from './binanceOrderSync';
import toast from 'react-hot-toast';

interface TradeContextType {
  trades: Trade[];
  livePrices: Record<string, number>;
  baseCapital: number;
  setBaseCapital: (val: number) => Promise<void>;
  pkrRate: number;
  binancePkrRate: number | null;
  isCustomPkrRate: boolean;
  setPkrRate: (val: number) => Promise<void>;
  resetPkrRateToBinance: () => Promise<void>;
  fetchBinancePkrRate: () => Promise<number | null>;
  loading: boolean;
  refreshTrades: () => Promise<void>;
  isRefreshing: boolean;
  reconcileAll: () => Promise<void>;
  binanceBalance: BinanceBalanceInfo | null;
  fetchBinanceBalance: () => Promise<BinanceBalanceInfo | null>;
  syncTradeWithBinance: (trade: Trade, preloadedOrders?: any[]) => Promise<{ updated: boolean; summary: string }>;
  viewMode: PnlViewMode;
  setViewMode: (mode: PnlViewMode) => Promise<void>;
  // Custom Fee Tier Profiles
  feeTier: FeeTierId;
  customFeeRate: number;
  setFeeTier: (tier: FeeTierId, customRate?: number) => Promise<void>;
  effectiveFeeRate: number;
  // Paper / Demo Account Mode
  isDemoMode: boolean;
  setIsDemoMode: (val: boolean) => void;
  demoBaseCapital: number;
  setDemoBaseCapital: (val: number) => void;
  resetDemoAccount: () => void;
  // Offline-First Synchronization & Optimistic UI
  isOnline: boolean;
  offlineQueueCount: number;
  saveTradeOptimistic: (trade: Trade) => Promise<string>;
  updateTradeOptimistic: (tradeId: string, updates: Partial<Trade>) => Promise<void>;
  deleteTradeOptimistic: (tradeId: string) => Promise<void>;
}

export const TradeContext = createContext<TradeContextType>({} as any);
export const useTradeContext = () => useContext(TradeContext);

const getInitialTrades = (): Trade[] => {
  try {
    const saved = localStorage.getItem('trade_sizer_cached_trades');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {}
  return [];
};

const getInitialBaseCapital = (): number => {
  try {
    const saved = localStorage.getItem('trade_sizer_cached_base_capital');
    if (saved) {
      const parsed = parseFloat(saved);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  } catch {}
  return 2595;
};

const getInitialBalance = (): BinanceBalanceInfo | null => {
  try {
    const saved = localStorage.getItem('trade_sizer_cached_binance_balance');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed.totalEquity === 'number') return parsed;
    }
  } catch {}
  return null;
};

const getInitialViewMode = (): PnlViewMode => {
  try {
    const saved = localStorage.getItem('trade_sizer_view_mode') as PnlViewMode;
    if (saved && ['DOLLAR', 'R_MULTIPLE', 'PERCENT', 'ZEN'].includes(saved)) {
      return saved;
    }
  } catch {}
  return 'DOLLAR';
};

export const TradeProvider: React.FC<{children: React.ReactNode}> = ({ children }) => {
  const initialTrades = useMemo(() => getInitialTrades(), []);
  const [trades, setTrades] = useState<Trade[]>(initialTrades);
  const [baseCapital, setBaseCapitalState] = useState<number>(() => getInitialBaseCapital());
  const [viewMode, setViewModeState] = useState<PnlViewMode>(() => getInitialViewMode());
  const [pkrRate, setPkrRateState] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('trade_sizer_custom_pkr_rate');
      if (saved) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed > 0) return parsed;
      }
    } catch {}
    return 283.89;
  });
  const [binancePkrRate, setBinancePkrRate] = useState<number | null>(null);
  const [isCustomPkrRate, setIsCustomPkrRate] = useState<boolean>(() => {
    try {
      return localStorage.getItem('trade_sizer_custom_pkr_rate') !== null;
    } catch {
      return false;
    }
  });
  // Fast mobile initialization: If cached trades are already available, never block the UI!
  const [loading, setLoading] = useState(() => initialTrades.length === 0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [wsTrigger, setWsTrigger] = useState(0);
  const [binanceBalance, setBinanceBalance] = useState<BinanceBalanceInfo | null>(() => getInitialBalance());

  const tradesRef = useRef<Trade[]>([]);
  tradesRef.current = trades;
  const tradesLoadedRef = useRef(false);

  const isReconcilingRef = useRef(false);
  const notifiedToastsRef = useRef<Set<string>>(new Set());

  // Fetch live PKR rate from Binance P2P
  const fetchBinancePkrRate = useCallback(async (): Promise<number | null> => {
    try {
      const res = await fetch('/api/exchange/pkr-rate');
      if (!res.ok) return null;
      const data = await res.json();
      if (data.status === 'success' && typeof data.rate === 'number' && data.rate > 0) {
        setBinancePkrRate(data.rate);
        // If user hasn't explicitly set a custom override, update active rate
        if (!localStorage.getItem('trade_sizer_custom_pkr_rate')) {
          setPkrRateState(data.rate);
        }
        return data.rate;
      }
    } catch (e) {
      console.error("Failed to fetch PKR rate from Binance:", e);
    }
    return null;
  }, []);

  // Fetch settings & PKR rate on mount
  useEffect(() => {
    fetchBinancePkrRate();
    // Safety watchdog: ensure loading never hangs past 2 seconds on weak mobile network
    const watchdog = setTimeout(() => {
      setLoading(false);
    }, 2000);
    return () => clearTimeout(watchdog);
  }, [fetchBinancePkrRate]);

  // Fetch settings
  useEffect(() => {
    if (!auth.currentUser) return;
    const fetchSettings = async () => {
      try {
        const d = await getDoc(doc(db, 'users', auth.currentUser!.uid));
        if (d.exists()) {
          const userData = d.data();
          if (userData.baseCapital !== undefined) {
            setBaseCapitalState(userData.baseCapital);
            try {
              localStorage.setItem('trade_sizer_cached_base_capital', String(userData.baseCapital));
            } catch {}
          } else {
            await setDoc(doc(db, 'users', auth.currentUser!.uid), { baseCapital: 2595 }, { merge: true });
          }

          if (userData.viewMode && ['DOLLAR', 'R_MULTIPLE', 'PERCENT', 'ZEN'].includes(userData.viewMode)) {
            setViewModeState(userData.viewMode);
            try {
              localStorage.setItem('trade_sizer_view_mode', userData.viewMode);
            } catch {}
          }

          if (userData.customPkrRate !== undefined && userData.customPkrRate !== null) {
            const parsed = parseFloat(userData.customPkrRate);
            if (!isNaN(parsed) && parsed > 0) {
              setPkrRateState(parsed);
              setIsCustomPkrRate(true);
              try {
                localStorage.setItem('trade_sizer_custom_pkr_rate', parsed.toString());
              } catch {}
            }
          }

          if (userData.feeTier && FEE_TIERS[userData.feeTier as FeeTierId]) {
            setFeeTierState(userData.feeTier as FeeTierId);
            try {
              localStorage.setItem('trade_sizer_fee_tier', userData.feeTier);
            } catch {}
          }
          if (userData.customFeeRate !== undefined && typeof userData.customFeeRate === 'number') {
            setCustomFeeRateState(userData.customFeeRate);
            try {
              localStorage.setItem('trade_sizer_custom_fee_rate', String(userData.customFeeRate));
            } catch {}
          }
        } else {
          await setDoc(doc(db, 'users', auth.currentUser!.uid), { baseCapital: 2595 }, { merge: true });
        }
      } catch (e) {
        console.error("Error fetching settings:", e);
      }
    };
    fetchSettings();
  }, [auth.currentUser]);

  // Fee Tier Profiles
  const [feeTier, setFeeTierState] = useState<FeeTierId>(() => {
    try {
      const saved = localStorage.getItem('trade_sizer_fee_tier') as FeeTierId;
      if (saved && FEE_TIERS[saved]) return saved;
    } catch {}
    return 'BINANCE_STANDARD';
  });

  const [customFeeRate, setCustomFeeRateState] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('trade_sizer_custom_fee_rate');
      if (saved) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed >= 0) return parsed;
      }
    } catch {}
    return 0.001;
  });

  const effectiveFeeRate = useMemo(() => {
    if (feeTier === 'CUSTOM') return customFeeRate;
    return FEE_TIERS[feeTier]?.takerFeeRate ?? 0.001;
  }, [feeTier, customFeeRate]);

  const setFeeTier = async (tier: FeeTierId, customRate?: number) => {
    setFeeTierState(tier);
    try {
      localStorage.setItem('trade_sizer_fee_tier', tier);
    } catch {}
    if (customRate !== undefined) {
      setCustomFeeRateState(customRate);
      try {
        localStorage.setItem('trade_sizer_custom_fee_rate', String(customRate));
      } catch {}
    }
    if (auth.currentUser) {
      try {
        await setDoc(doc(db, 'users', auth.currentUser.uid), {
          feeTier: tier,
          ...(customRate !== undefined ? { customFeeRate: customRate } : {})
        }, { merge: true });
      } catch (e) {
        console.warn("Could not save feeTier to cloud:", e);
      }
    }
    toast.success(`Fee tier: ${FEE_TIERS[tier]?.name || tier}`);
  };

  // Demo / Paper Trading Mode
  const [isDemoMode, setIsDemoModeState] = useState<boolean>(() => {
    try {
      return localStorage.getItem('trade_sizer_demo_mode') === 'true';
    } catch {
      return false;
    }
  });

  const [demoBaseCapital, setDemoBaseCapitalState] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('trade_sizer_demo_base_capital');
      if (saved) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed > 0) return parsed;
      }
    } catch {}
    return 10000;
  });

  const [demoTrades, setDemoTrades] = useState<Trade[]>(() => {
    try {
      const saved = localStorage.getItem('trade_sizer_demo_trades');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  const setIsDemoMode = (val: boolean) => {
    setIsDemoModeState(val);
    try {
      localStorage.setItem('trade_sizer_demo_mode', String(val));
    } catch {}
    toast(val ? "🧪 Switched to Paper Demo Account ($10,000 Sim)" : "⚡ Switched to Real Live Account", {
      icon: val ? "🧪" : "⚡"
    });
  };

  const setDemoBaseCapital = (val: number) => {
    setDemoBaseCapitalState(val);
    try {
      localStorage.setItem('trade_sizer_demo_base_capital', String(val));
    } catch {}
  };

  const resetDemoAccount = () => {
    setDemoTrades([]);
    setDemoBaseCapitalState(10000);
    try {
      localStorage.removeItem('trade_sizer_demo_trades');
      localStorage.setItem('trade_sizer_demo_base_capital', '10000');
    } catch {}
    toast.success("Demo account reset to $10,000 cash balance.");
  };

  // Offline-First Synchronization & Optimistic UI
  const [isOnline, setIsOnline] = useState<boolean>(() => typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [offlineQueue, setOfflineQueue] = useState<OfflineAction[]>(() => {
    try {
      const saved = localStorage.getItem('trade_sizer_offline_queue');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  const flushOfflineQueue = async () => {
    try {
      const raw = localStorage.getItem('trade_sizer_offline_queue');
      if (!raw) return;
      const queue: OfflineAction[] = JSON.parse(raw);
      if (!queue || queue.length === 0) return;

      let syncedCount = 0;
      for (const action of queue) {
        try {
          if (action.type === 'CREATE_TRADE') {
            await addDoc(collection(db, 'trades'), action.data);
            syncedCount++;
          } else if (action.type === 'UPDATE_TRADE' && action.tradeId) {
            await updateDoc(doc(db, 'trades', action.tradeId), action.data);
            syncedCount++;
          } else if (action.type === 'DELETE_TRADE' && action.tradeId) {
            await deleteDoc(doc(db, 'trades', action.tradeId));
            syncedCount++;
          }
        } catch (err) {
          console.warn("Failed to flush action:", action, err);
        }
      }

      setOfflineQueue([]);
      localStorage.removeItem('trade_sizer_offline_queue');
      if (syncedCount > 0) {
        toast.success(`Synced ${syncedCount} offline change${syncedCount > 1 ? 's' : ''} to cloud!`, { icon: "☁️" });
      }
    } catch (e) {
      console.error("Flush queue error:", e);
    }
  };

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      toast.success("Network connection restored", { icon: "🟢" });
      flushOfflineQueue();
    };
    const handleOffline = () => {
      setIsOnline(false);
      toast("Offline mode active. Changes will auto-sync when reconnected.", { icon: "📡" });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const saveTradeOptimistic = async (tradeData: Trade): Promise<string> => {
    const optimisticId = `local_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const tradeWithId: Trade = { ...tradeData, id: optimisticId, isDemo: isDemoMode };

    if (isDemoMode) {
      const updated = [tradeWithId, ...demoTrades];
      setDemoTrades(updated);
      try {
        localStorage.setItem('trade_sizer_demo_trades', JSON.stringify(updated));
      } catch {}
      return optimisticId;
    }

    const updatedTrades = [tradeWithId, ...trades];
    setTrades(updatedTrades);
    tradesRef.current = updatedTrades;
    try {
      localStorage.setItem('trade_sizer_cached_trades', JSON.stringify(updatedTrades.slice(0, 150)));
    } catch {}

    if (!navigator.onLine || !auth.currentUser) {
      const action: OfflineAction = {
        id: optimisticId,
        type: 'CREATE_TRADE',
        data: tradeWithId,
        timestamp: Date.now()
      };
      const newQueue = [...offlineQueue, action];
      setOfflineQueue(newQueue);
      try {
        localStorage.setItem('trade_sizer_offline_queue', JSON.stringify(newQueue));
      } catch {}
      return optimisticId;
    }

    try {
      const docRef = await addDoc(collection(db, 'trades'), tradeData);
      setTrades(prev => prev.map(t => t.id === optimisticId ? { ...t, id: docRef.id } : t));
      return docRef.id;
    } catch (e) {
      console.warn("Save failed, queued offline:", e);
      const action: OfflineAction = {
        id: optimisticId,
        type: 'CREATE_TRADE',
        data: tradeWithId,
        timestamp: Date.now()
      };
      const newQueue = [...offlineQueue, action];
      setOfflineQueue(newQueue);
      try {
        localStorage.setItem('trade_sizer_offline_queue', JSON.stringify(newQueue));
      } catch {}
      return optimisticId;
    }
  };

  const updateTradeOptimistic = async (tradeId: string, updates: Partial<Trade>) => {
    if (isDemoMode) {
      const updated = demoTrades.map(t => t.id === tradeId ? { ...t, ...updates } : t);
      setDemoTrades(updated);
      try {
        localStorage.setItem('trade_sizer_demo_trades', JSON.stringify(updated));
      } catch {}
      return;
    }

    const updated = trades.map(t => t.id === tradeId ? { ...t, ...updates } : t);
    setTrades(updated);
    tradesRef.current = updated;
    try {
      localStorage.setItem('trade_sizer_cached_trades', JSON.stringify(updated.slice(0, 150)));
    } catch {}

    if (!navigator.onLine || !auth.currentUser || tradeId.startsWith('local_')) {
      const action: OfflineAction = {
        id: `action_${Date.now()}`,
        type: 'UPDATE_TRADE',
        tradeId,
        data: updates,
        timestamp: Date.now()
      };
      const newQueue = [...offlineQueue, action];
      setOfflineQueue(newQueue);
      try {
        localStorage.setItem('trade_sizer_offline_queue', JSON.stringify(newQueue));
      } catch {}
      return;
    }

    try {
      await updateDoc(doc(db, 'trades', tradeId), updates);
    } catch (e) {
      console.warn("Update failed, queued offline:", e);
      const action: OfflineAction = {
        id: `action_${Date.now()}`,
        type: 'UPDATE_TRADE',
        tradeId,
        data: updates,
        timestamp: Date.now()
      };
      const newQueue = [...offlineQueue, action];
      setOfflineQueue(newQueue);
      try {
        localStorage.setItem('trade_sizer_offline_queue', JSON.stringify(newQueue));
      } catch {}
    }
  };

  const deleteTradeOptimistic = async (tradeId: string) => {
    if (isDemoMode) {
      const updated = demoTrades.filter(t => t.id !== tradeId);
      setDemoTrades(updated);
      try {
        localStorage.setItem('trade_sizer_demo_trades', JSON.stringify(updated));
      } catch {}
      return;
    }

    const updated = trades.filter(t => t.id !== tradeId);
    setTrades(updated);
    tradesRef.current = updated;
    try {
      localStorage.setItem('trade_sizer_cached_trades', JSON.stringify(updated.slice(0, 150)));
    } catch {}

    if (!navigator.onLine || !auth.currentUser || tradeId.startsWith('local_')) {
      const action: OfflineAction = {
        id: `action_${Date.now()}`,
        type: 'DELETE_TRADE',
        tradeId,
        timestamp: Date.now()
      };
      const newQueue = [...offlineQueue, action];
      setOfflineQueue(newQueue);
      try {
        localStorage.setItem('trade_sizer_offline_queue', JSON.stringify(newQueue));
      } catch {}
      return;
    }

    try {
      await deleteDoc(doc(db, 'trades', tradeId));
    } catch (e) {
      console.warn("Delete failed, queued offline:", e);
      const action: OfflineAction = {
        id: `action_${Date.now()}`,
        type: 'DELETE_TRADE',
        tradeId,
        timestamp: Date.now()
      };
      const newQueue = [...offlineQueue, action];
      setOfflineQueue(newQueue);
      try {
        localStorage.setItem('trade_sizer_offline_queue', JSON.stringify(newQueue));
      } catch {}
    }
  };

  const setViewMode = async (mode: PnlViewMode) => {
    setViewModeState(mode);
    try {
      localStorage.setItem('trade_sizer_view_mode', mode);
    } catch {}
    if (auth.currentUser) {
      try {
        await setDoc(doc(db, 'users', auth.currentUser.uid), { viewMode: mode }, { merge: true });
      } catch (e) {
        console.warn("Could not sync viewMode to cloud:", e);
      }
    }
  };

  const setBaseCapital = async (val: number) => {
    setBaseCapitalState(val);
    try {
      localStorage.setItem('trade_sizer_cached_base_capital', String(val));
    } catch {}
    if (auth.currentUser) {
      try {
        await setDoc(doc(db, 'users', auth.currentUser.uid), { baseCapital: val }, { merge: true });
      } catch (e) {
        console.error("Error saving base capital:", e);
      }
    }
  };

  const setPkrRate = async (val: number) => {
    if (isNaN(val) || val <= 0) return;
    setPkrRateState(val);
    setIsCustomPkrRate(true);
    try {
      localStorage.setItem('trade_sizer_custom_pkr_rate', val.toString());
    } catch {}
    if (auth.currentUser) {
      try {
        await setDoc(doc(db, 'users', auth.currentUser.uid), { customPkrRate: val }, { merge: true });
      } catch (e) {
        console.error("Error saving custom PKR rate:", e);
      }
    }
    toast.success(`PKR rate set to ₨${val.toFixed(2)} per USDT`);
  };

  const resetPkrRateToBinance = async () => {
    try {
      localStorage.removeItem('trade_sizer_custom_pkr_rate');
    } catch {}
    setIsCustomPkrRate(false);
    const activeBinanceRate = binancePkrRate || 283.89;
    setPkrRateState(activeBinanceRate);
    if (auth.currentUser) {
      try {
        await setDoc(doc(db, 'users', auth.currentUser.uid), { customPkrRate: null }, { merge: true });
      } catch (e) {
        console.error("Error resetting custom PKR rate:", e);
      }
    }
    toast.success(`Reset PKR rate to Binance default (₨${activeBinanceRate.toFixed(2)})`);
    fetchBinancePkrRate();
  };

  // Reconcile trades with historical market candles (covers times when app was closed/offline)
  const reconcileAll = useCallback(async () => {
    if (isReconcilingRef.current) return;
    isReconcilingRef.current = true;

    try {
      const pendingOrActive = tradesRef.current.filter(t => 
        !['CLOSED_MANUAL', 'HIT_SL', 'HIT_TP3', 'CLOSED_BREAK_EVEN', 'BREAK_EVEN'].includes(t.status || 'ACTIVE')
      );

      for (const trade of pendingOrActive) {
        if (!trade.id) continue;
        const update = await reconcileTrade(trade);
        if (update) {
          const docData: any = {
            status: update.status,
            realizedProfitUsd: update.realizedProfitUsd,
          };
          if (update.filledAt) docData.filledAt = update.filledAt;
          if (update.closedAt) docData.closedAt = update.closedAt;

          if (update.status === 'ACTIVE' && trade.status === 'PENDING') {
            docData.type = trade.type === 'HOLDING' ? 'HOLDING' : 'TRADE';
          }
          docData.notifiedMilestones = arrayUnion(update.status);

          await updateDoc(doc(db, 'trades', update.tradeId), docData);

          // Update in-memory reference to prevent race conditions during the same render cycle
          const idx = tradesRef.current.findIndex(t => t.id === update.tradeId);
          if (idx !== -1) {
            tradesRef.current[idx] = { ...tradesRef.current[idx], ...docData };
          }

          // Strict deduplication: only toast once per trade milestone, and only if fresh (< 2 mins)
          const toastKey = `${update.tradeId}_${update.status}`;
          const isAlreadyNotified = notifiedToastsRef.current.has(toastKey) || 
            (Array.isArray(trade.notifiedMilestones) && trade.notifiedMilestones.includes(update.status));

          if (!isAlreadyNotified) {
            notifiedToastsRef.current.add(toastKey);
            const eventTime = update.closedAt || update.filledAt || Date.now();
            const isFresh = Math.abs(Date.now() - eventTime) < 2 * 60 * 1000;

            if (isFresh) {
              if (update.status === 'ACTIVE' && trade.status === 'PENDING') {
                const destName = trade.type === 'HOLDING' ? 'Investments' : 'Active Trades';
                toast.success(`⚡ Limit order filled! ${update.symbol} is now in ${destName}!`, { icon: '⚡' });
              } else if (update.status === 'HIT_SL') {
                toast.error(`${update.symbol} Hit Stop Loss!`, { icon: '🛑' });
              } else if (update.status === 'CLOSED_BREAK_EVEN') {
                toast.success(`🛡️ ${update.symbol} closed at Breakeven`, { icon: '🛡️' });
              } else if (update.status.startsWith('HIT_TP')) {
                toast.success(`Target reached: ${update.symbol} reached ${update.status.replace('_', ' ')}.`, { icon: '🎯' });
              }
            }
          }
        }
      }
    } catch (e) {
      console.error("Reconciliation error:", e);
    } finally {
      isReconcilingRef.current = false;
    }
  }, []);


  const syncBinanceSpotPositions = useCallback(async () => {
    if (!auth.currentUser || !tradesLoadedRef.current) return;
    try {
      const res = await fetch('/api/exchange/positions');
      if (!res.ok) return;
      const data = await res.json();
      if (data.status !== 'success' || !Array.isArray(data.positions)) return;

      const binancePositions = data.positions; // [{ symbol, positionAmt, entryPrice, currentPrice, usdValue, isPendingOrder }]
      const openOrdersSuccess = data.openOrdersSuccess !== false; // Treat undefined as true for backwards compatibility
      const allOpenOrders = Array.isArray(data.allOpenOrders) ? data.allOpenOrders : [];
      const activeOrPendingLocal = tradesRef.current.filter(t => !['CLOSED_MANUAL', 'HIT_SL', 'HIT_TP3'].includes(t.status || 'ACTIVE'));
      
      let promises: Promise<any>[] = [];

      // 1. Sync existing local trades
      for (const trade of activeOrPendingLocal) {
        if (!trade.id) continue;
        
        // CRITICAL CHECK: Binance Alpha section trades & non-spot trades
        const isAlpha = isAlphaTradeOrSymbol(trade);
        
        if (trade.status === 'PENDING') {
            if (isAlpha) {
               continue; // Alpha limit orders are not in standard Binance Spot
            }
            const bpLimit = binancePositions.find((p: any) => {
                if (!p.isPendingOrder) return false;
                if (trade.binanceOrderId && p.binanceOrderId && String(trade.binanceOrderId) === String(p.binanceOrderId)) return true;
                return p.symbol === trade.symbol && Math.abs(p.entryPrice - trade.entryPrice) <= (trade.entryPrice * 0.001 || 0.001);
            });

            if (!bpLimit) {
                if (!openOrdersSuccess) continue; // Do not assume filled or canceled if openOrders API failed
                
                // If the limit order is gone from Binance open orders, check if it filled into a spot holding!
                const spotHolding = binancePositions.find((p: any) => p.symbol === trade.symbol && !p.isPendingOrder);
                if (spotHolding && spotHolding.positionAmt > 0) {
                    const targetCategory = trade.type === 'HOLDING' ? 'HOLDING' : 'TRADE';
                    const orderCoins = trade.positionSizeCoins || (trade.entryPrice > 0 ? (trade.totalBuyUsd || 0) / trade.entryPrice : 0) || spotHolding.positionAmt;
                    const orderPrice = trade.entryPrice || spotHolding.entryPrice || 0;
                    const orderCost = trade.totalBuyUsd || (orderCoins * orderPrice);

                    // Check if there is an existing running active trade or portfolio holding for this specific ticker
                    let existingRunningTrade = tradesRef.current.find(t => 
                        t.id !== trade.id && 
                        t.symbol === trade.symbol && 
                        !isTradeClosed(t) && 
                        t.status !== 'PENDING' && 
                        (targetCategory === 'HOLDING' ? t.type === 'HOLDING' : t.type !== 'HOLDING')
                    );

                    // Fallback: check any running trade of that symbol regardless of category
                    if (!existingRunningTrade) {
                        existingRunningTrade = tradesRef.current.find(t => 
                            t.id !== trade.id && 
                            t.symbol === trade.symbol && 
                            !isTradeClosed(t) && 
                            t.status !== 'PENDING'
                        );
                    }

                    if (existingRunningTrade && existingRunningTrade.id) {
                        const existingCoins = getTradeCoins(existingRunningTrade);
                        const existingCost = getTradeInvestedAmount(existingRunningTrade);
                        const newCoins = existingCoins + orderCoins;
                        const newCost = existingCost + orderCost;
                        const newAveragePrice = newCoins > 0 ? newCost / newCoins : orderPrice;

                        // Synchronously update in-memory reference to prevent race conditions within same sync cycle
                        existingRunningTrade.positionSizeCoins = newCoins;
                        existingRunningTrade.totalBuyUsd = newCost;
                        existingRunningTrade.entryPrice = newAveragePrice;

                        const fillNote = `🎯 Merged Binance Limit Order Fill: +${orderCoins.toFixed(4)} ${trade.symbol} @ $${formatPrice(orderPrice)} (New Avg Entry: $${formatPrice(newAveragePrice)})`;

                        promises.push(
                            updateDoc(doc(db, 'trades', existingRunningTrade.id), {
                                entryPrice: newAveragePrice,
                                positionSizeCoins: newCoins,
                                totalBuyUsd: newCost,
                                positionSize: newCost,
                                updatedAt: Date.now(),
                                notes: existingRunningTrade.notes ? `${existingRunningTrade.notes}\n${fillNote}` : fillNote
                            }).then(async () => {
                                await deleteDoc(doc(db, 'trades', trade.id));
                                const toastKey = `merged_${trade.id}`;
                                if (!notifiedToastsRef.current.has(toastKey)) {
                                  notifiedToastsRef.current.add(toastKey);
                                  toast.success(`🎯 ${trade.symbol} Limit Order filled on Binance & merged! New Avg Entry: $${formatPrice(newAveragePrice)}`, { duration: 6000, icon: '🎯' });
                                }
                            })
                        );
                    } else {
                        // No existing running trade - activate as its own trade under chosen targetCategory
                        promises.push(
                            updateDoc(doc(db, 'trades', trade.id), {
                                status: 'ACTIVE',
                                type: targetCategory,
                                filledAt: Date.now(),
                                positionSizeCoins: orderCoins,
                                totalBuyUsd: orderCost,
                                positionSize: orderCost,
                                notifiedMilestones: arrayUnion('ENTRY')
                            }).then(() => {
                              const toastKey = `filled_${trade.id}`;
                              if (!notifiedToastsRef.current.has(toastKey)) {
                                notifiedToastsRef.current.add(toastKey);
                                toast.success(`⚡ Limit order filled on Binance! ${trade.symbol} is now active under ${targetCategory === 'HOLDING' ? 'Portfolio Holdings' : 'Active Trades'}!`, { icon: '⚡' });
                              }
                            })
                        );
                    }
                } else {
                    // USER REQUIREMENT: When order is removed/canceled on Binance, auto-remove from app!
                    const isBinanceOrder = Boolean(
                      trade.binanceOrderId || 
                      trade.clientOrderId || 
                      trade.notes?.includes('Binance') || 
                      trade.market === 'SPOT'
                    );

                    if (isBinanceOrder) {
                      promises.push(deleteDoc(doc(db, 'trades', trade.id)).then(() => {
                        const toastKey = `removed_${trade.id}`;
                        if (!notifiedToastsRef.current.has(toastKey)) {
                          notifiedToastsRef.current.add(toastKey);
                          toast(`🗑️ Limit order for ${trade.symbol} removed (order removed on Binance).`, { icon: '🗑️' });
                        }
                      }));
                    }
                }
            } else {
                const needsSizeUpdate = Math.abs(bpLimit.positionAmt - (trade.positionSizeCoins || 0)) > (trade.positionSizeCoins || 1) * 0.01;
                const needsOrderIdUpdate = bpLimit.binanceOrderId && !trade.binanceOrderId;
                if (needsSizeUpdate || needsOrderIdUpdate) {
                    promises.push(updateDoc(doc(db, 'trades', trade.id), {
                        ...(needsSizeUpdate ? {
                            positionSizeCoins: bpLimit.positionAmt,
                            positionSize: bpLimit.positionAmt * trade.entryPrice
                        } : {}),
                        ...(needsOrderIdUpdate ? { binanceOrderId: String(bpLimit.binanceOrderId) } : {})
                    }));
                }
            }
        } else if (trade.status === 'ACTIVE' || trade.status === 'HIT_TP1' || trade.status === 'HIT_TP2' || trade.status === 'PARTIAL_EXIT') {
            // NEVER auto-close Alpha section trades or long-term HOLDINGS!
            if (trade.type === 'HOLDING' || isAlpha) {
               continue;
            }

            const rawSym = trade.symbol.trim().toUpperCase();
            const cleanSymbol = rawSym.endsWith('USDT') ? rawSym : `${rawSym}USDT`;
            const bpSpot = binancePositions.find((p: any) => (p.symbol === cleanSymbol || p.symbol === rawSym) && !p.isPendingOrder);
            const tradeOpenOrders = allOpenOrders.filter((o: any) => o.symbol === cleanSymbol || o.symbol === rawSym);

            const isLong = getTradeIsLong(trade);
            const exitSide = isLong ? 'SELL' : 'BUY';
            // Open exit orders are limit TPs or stop-loss orders on the exit side (SELL for Long)
            const tradeExitOrders = tradeOpenOrders.filter((o: any) => o.side === exitSide);

            const isImportedSpotTrade = Boolean(
              trade.notes?.includes('Imported from Binance Spot') || 
              trade.notes?.includes('synced from Binance Spot') || 
              trade.notes?.includes('Updated & synced from Binance Spot') ||
              trade.binanceOrderId ||
              trade.market === 'SPOT' ||
              bpSpot ||
              tradeOpenOrders.length > 0 ||
              (!trade.isAlpha && trade.market !== 'ALPHA')
            );

            // Revert any erroneously auto-restored trade if user holds no spot coins (< $2) on Binance
            if (trade.notes?.includes('Auto-restored: Position active on Binance') && (!bpSpot || bpSpot.usdValue < 2)) {
              promises.push(updateDoc(doc(db, 'trades', trade.id), {
                status: 'CLOSED_MANUAL',
                closedAt: trade.filledAt || trade.createdAt,
                notes: (trade.notes || '').replace(/\n?Auto-restored: Position active on Binance[^\n]*/g, '').trim()
              }));
              continue;
            }

            // Position has fully exited on Binance: zero coins held (< $2) AND no open exit orders (SELL orders) remaining
            const isExitedOnBinance = isImportedSpotTrade && openOrdersSuccess && (!bpSpot || bpSpot.usdValue < 2) && tradeExitOrders.length === 0;

            if (isExitedOnBinance) {
                // Fetch actual exit details from Binance and mark closed with authentic exit time
                promises.push((async () => {
                  try {
                    const syncRes = await syncTradeWithBinance(trade, tradeOpenOrders);
                    if (syncRes.updated) {
                      const toastKey = `autoclosed_${trade.id}`;
                      if (!notifiedToastsRef.current.has(toastKey)) {
                        notifiedToastsRef.current.add(toastKey);
                        toast.success(`${trade.symbol} Auto-Closed via Binance Spot sync.`);
                      }
                    } else {
                      // Fallback close if not updated by sync
                      await updateDoc(doc(db, 'trades', trade.id), {
                        status: 'CLOSED_MANUAL',
                        closedAt: trade.filledAt || trade.createdAt,
                        notes: (trade.notes ? trade.notes + '\n' : '') + 'Auto-synced: Position fully closed on Binance Spot'
                      });
                    }
                  } catch (err) {
                    console.warn(`Auto-close sync error for ${trade.symbol}`, err);
                  }
                })());
            } else if (isImportedSpotTrade || bpSpot || tradeOpenOrders.length > 0) {
                // Active or partially exited position: auto-sync TPs, SLs, and partial fills from Binance!
                promises.push((async () => {
                  try {
                    const syncRes = await syncTradeWithBinance(trade, tradeOpenOrders);
                    if (syncRes.updated) {
                      const toastKey = `synced_orders_${trade.id}_${syncRes.summary}`;
                      if (!notifiedToastsRef.current.has(toastKey)) {
                        notifiedToastsRef.current.add(toastKey);
                        toast.success(`⚡ ${trade.symbol}: ${syncRes.summary}`, { duration: 5000, icon: '🎯' });
                      }
                    }
                  } catch (err) {
                    console.warn(`Auto sync failed for ${trade.symbol}`, err);
                  }
                })());
            }
        }
      }

      await Promise.all(promises);
    } catch (e) {
      console.warn("Auto-sync error:", e);
    }
  }, []);

  // Fetch trades
  const fetchTrades = () => {
    if (!auth.currentUser) return null;
    const q = query(
      collection(db, 'trades'),
      where('userId', '==', auth.currentUser.uid),
      orderBy('createdAt', 'desc')
    );
    return onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Trade));
      
      // Valid trades loaded safely without destructive auto-deletion
      const validTrades = data;

      // Auto-heal past closed trades whose closedAt was mistakenly stamped with today's Date.now()
      for (const t of validTrades) {
        if (t.id && isTradeClosed(t) && t.closedAt && t.closedAt > 1790600000000 && (t.createdAt || 0) < 1790200000000) {
          const rawSym = (t.symbol || '').trim().toUpperCase();
          const correctedClosedAt = rawSym.includes('SOL') ? 1789886765281 : (t.filledAt || t.createdAt);
          updateDoc(doc(db, 'trades', t.id), { closedAt: correctedClosedAt }).catch(() => {});
        }
      }

      // Valid trades loaded
      setTrades(validTrades);
      tradesRef.current = validTrades;
      tradesLoadedRef.current = true;
      setLoading(false);
      setIsRefreshing(false);
      try {
        localStorage.setItem('trade_sizer_cached_trades', JSON.stringify(validTrades.slice(0, 150)));
      } catch {}

      // Run reconciliation and spot sync in background without blocking initial UI paint
      setTimeout(() => {
        reconcileAll();
        syncBinanceSpotPositions();
      }, 1200);
    }, (error) => {
      console.error("Error fetching trades with compound query, using fallback:", error);
      try {
        const fallbackQ = query(collection(db, 'trades'), where('userId', '==', auth.currentUser!.uid));
        onSnapshot(fallbackQ, (snapshot) => {
          const fallbackData = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Trade));
          fallbackData.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          setTrades(fallbackData);
          tradesRef.current = fallbackData;
          tradesLoadedRef.current = true;
          setLoading(false);
          try {
            localStorage.setItem('trade_sizer_cached_trades', JSON.stringify(fallbackData.slice(0, 150)));
          } catch {}
        }, () => {
          setLoading(false);
        });
      } catch {
        setLoading(false);
      }
      setIsRefreshing(false);
    });
  };

  useEffect(() => {
    const unsubscribe = fetchTrades();
    return () => unsubscribe && unsubscribe();
  }, [auth.currentUser]);

  const fetchBinanceBalance = useCallback(async () => {
    try {
      const res = await fetch('/api/exchange/balance');
      if (!res.ok) return null;
      const data = await res.json();
      if (data.status === 'success' && data.totalEquity !== undefined) {
        const info: BinanceBalanceInfo = {
          totalEquity: data.totalEquity,
          usdtTotal: data.usdtTotal ?? data.balance,
          usdtFree: data.usdtFree ?? data.balance,
          usdtLocked: data.usdtLocked ?? 0,
          futTotal: data.futTotal ?? 0,
          fundingTotal: data.fundingTotal ?? 0,
          assets: data.assets ?? [],
          lastUpdated: Date.now()
        };
        setBinanceBalance(info);
        try {
          localStorage.setItem('trade_sizer_cached_binance_balance', JSON.stringify(info));
        } catch {}
        return info;
      }
    } catch (e) {
      console.warn("Error fetching Binance balance:", e);
    }
    return null;
  }, []);

  // Reconcile on tab regain focus or visibility change (e.g. user unlocked phone / opened tab)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        reconcileAll();
        if (tradesLoadedRef.current) {
          syncBinanceSpotPositions();
        }
        fetchBinanceBalance();
        setWsTrigger(prev => prev + 1);
      }
    };
    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);

    // Periodic check every 15 seconds for real-time spot auto-sync & balance
    const interval = setInterval(() => {
      if (tradesLoadedRef.current) {
        syncBinanceSpotPositions();
      }
      fetchBinanceBalance();
      
      const hasActiveOrPending = tradesRef.current.some(t => 
        !['CLOSED_MANUAL', 'HIT_SL', 'HIT_TP3'].includes(t.status || 'ACTIVE')
      );
      if (hasActiveOrPending) {
        reconcileAll();
      }
    }, 15000);
    
    // Initial balance fetch on mount
    fetchBinanceBalance();

    return () => {
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
      clearInterval(interval);
    };
  }, [reconcileAll, fetchBinanceBalance, syncBinanceSpotPositions]);

  const refreshTrades = async () => {
    setIsRefreshing(true);
    setWsTrigger(prev => prev + 1);
    await Promise.all([reconcileAll(), fetchBinanceBalance()]);
    setTimeout(() => setIsRefreshing(false), 500);
  };

  // Live prices & auto close
  const activeSymbolsKey = useMemo(() => {
    return Array.from(new Set(
      trades.filter(t => !['CLOSED_MANUAL', 'HIT_SL', 'HIT_TP3'].includes(t.status || 'ACTIVE'))
            .map(t => t.symbol?.trim()?.toUpperCase())
    )).filter(Boolean).sort().join(',');
  }, [trades]);

  const activeSymbols = useMemo(() => {
    return activeSymbolsKey ? activeSymbolsKey.split(',') : [];
  }, [activeSymbolsKey]);

  const livePrices = useBinanceTickers(activeSymbols, wsTrigger);

  useEffect(() => {
    if (trades.length === 0 || Object.keys(livePrices).length === 0) return;

    const checkAutoClose = async () => {
      for (const trade of trades) {
        if (!trade.id) continue;
        const currentStatus = trade.status || 'ACTIVE';
        if (['CLOSED_MANUAL', 'HIT_SL', 'HIT_TP3', 'CLOSED_BREAK_EVEN', 'BREAK_EVEN'].includes(currentStatus)) continue;
        
        const livePrice = livePrices[trade.symbol];
        if (!livePrice) continue;

        const isLong = getTradeIsLong(trade);
        let newStatus = currentStatus;
        let newRealized = trade.realizedProfitUsd || 0;
        let filledAt = trade.filledAt;
        let closedAt = trade.closedAt;

        // 1. LIMIT ORDERS (PENDING): Check if live market price hits entry!
        // When a limit order hits entry, it MUST transition to ACTIVE automatically.
        if (currentStatus === 'PENDING') {
          const entryHit = isLong ? (livePrice <= trade.entryPrice) : (livePrice >= trade.entryPrice);
          if (entryHit && trade.entryPrice > 0) {
            newStatus = 'ACTIVE';
            filledAt = Date.now();
          }
        } else {
          // CRITICAL: For trades running on Binance Spot, Binance exchange order books and trade history
          // are the absolute source of truth. NEVER auto-close an active Binance trade via client-side live ticks!
          if (isBinanceLinkedTrade(trade)) {
            continue;
          }

          // If the user removed/cleared take profits, revert HIT_TP status back to ACTIVE
          if (!trade.takeProfit1 && !trade.takeProfit2 && !trade.takeProfit3 && (currentStatus === 'HIT_TP1' || currentStatus === 'HIT_TP2' || currentStatus === 'HIT_TP3')) {
            newStatus = 'ACTIVE';
            newRealized = 0;
          } else if (isLong) {
             if (trade.stopLoss && livePrice <= trade.stopLoss) {
               const isAtBreakeven = isStopLossAtBreakeven(trade);
               const isRecentUpdate = (Date.now() - (trade.slUpdatedAt || trade.updatedAt || 0)) < 120000;
               // If stop loss is at breakeven, do not close on a tiny spread touch right at entry; require adverse deviation
               if (!isRecentUpdate && (!isAtBreakeven || livePrice < trade.stopLoss * 0.998)) {
                 newStatus = isAtBreakeven ? 'CLOSED_BREAK_EVEN' : 'HIT_SL';
                 newRealized = isAtBreakeven ? (trade.realizedProfitUsd || 0) : -(getTradeEffectiveRisk(trade));
                 closedAt = Date.now();
               }
             } else {
               if (trade.takeProfit3 && livePrice >= trade.takeProfit3 && newStatus !== 'HIT_TP3') {
                  newStatus = 'HIT_TP3';
                  newRealized = trade.totalProfitUsd || 0;
                  closedAt = Date.now();
               } else if (trade.takeProfit2 && livePrice >= trade.takeProfit2 && !['HIT_TP3', 'HIT_TP2'].includes(newStatus)) {
                  newStatus = 'HIT_TP2';
                  newRealized = (trade.tp1Profit || 0) + calculateProfit(trade, trade.takeProfit2, trade.tp2Percent || 0);
               } else if (trade.takeProfit1 && livePrice >= trade.takeProfit1 && !['HIT_TP3', 'HIT_TP2', 'HIT_TP1'].includes(newStatus)) {
                  newStatus = 'HIT_TP1';
                  newRealized = trade.tp1Profit || 0;
               }
             }
          } else {
             if (trade.stopLoss && livePrice >= trade.stopLoss) {
               const isAtBreakeven = isStopLossAtBreakeven(trade);
               const isRecentUpdate = (Date.now() - (trade.slUpdatedAt || trade.updatedAt || 0)) < 120000;
               // If stop loss is at breakeven, do not close on a tiny spread touch right at entry; require adverse deviation
               if (!isRecentUpdate && (!isAtBreakeven || livePrice > trade.stopLoss * 1.002)) {
                 newStatus = isAtBreakeven ? 'CLOSED_BREAK_EVEN' : 'HIT_SL';
                 newRealized = isAtBreakeven ? (trade.realizedProfitUsd || 0) : -(getTradeEffectiveRisk(trade));
                 closedAt = Date.now();
               }
             } else {
               if (trade.takeProfit3 && livePrice <= trade.takeProfit3 && newStatus !== 'HIT_TP3') {
                  newStatus = 'HIT_TP3';
                  newRealized = trade.totalProfitUsd || 0;
                  closedAt = Date.now();
               } else if (trade.takeProfit2 && livePrice <= trade.takeProfit2 && !['HIT_TP3', 'HIT_TP2'].includes(newStatus)) {
                  newStatus = 'HIT_TP2';
                  newRealized = (trade.tp1Profit || 0) + calculateProfit(trade, trade.takeProfit2, trade.tp2Percent || 0);
               } else if (trade.takeProfit1 && livePrice <= trade.takeProfit1 && !['HIT_TP3', 'HIT_TP2', 'HIT_TP1'].includes(newStatus)) {
                  newStatus = 'HIT_TP1';
                  newRealized = trade.tp1Profit || 0;
               }
             }
          }
        }

        if (newStatus !== currentStatus) {
           console.log(`Auto-closing trade ${trade.symbol} from ${currentStatus} to ${newStatus} at price ${livePrice}`);
           try {
             const updatePayload: any = {
               status: newStatus,
               realizedProfitUsd: newRealized
             };
             if (filledAt) updatePayload.filledAt = filledAt;
             if (closedAt) updatePayload.closedAt = closedAt;
             if (newStatus === 'ACTIVE' && currentStatus === 'PENDING') {
               updatePayload.notifiedMilestones = arrayUnion('ENTRY');
             } else {
               updatePayload.notifiedMilestones = arrayUnion(newStatus);
             }

             await updateDoc(doc(db, 'trades', trade.id), updatePayload);

             const toastKey = `${trade.id}_${newStatus}`;
             if (!notifiedToastsRef.current.has(toastKey) && !trade.notifiedMilestones?.includes(newStatus)) {
               notifiedToastsRef.current.add(toastKey);
               if (newStatus === 'HIT_SL') {
                 toast.error(`${trade.symbol} Hit Stop Loss!`, { icon: '🛑' });
               } else if (newStatus === 'CLOSED_BREAK_EVEN') {
                 toast.success(`🛡️ ${trade.symbol} closed at Breakeven (0.00R loss)`, { icon: '🛡️' });
               } else if (newStatus === 'ACTIVE' && currentStatus === 'PENDING') {
                 toast.success(`⚡ Limit order filled! ${trade.symbol} hit entry at $${livePrice}. Moved to Active Trades!`, { icon: '⚡' });
               } else if (newStatus !== 'ACTIVE') {
                 toast.success(`Target reached: ${trade.symbol} ${newStatus.replace('_', ' ')}.`, { icon: '🎯' });
               }
             }
           } catch (e) {
             console.error("Error auto-updating trade", e);
           }
        }
      }
    };
    checkAutoClose();
  }, [livePrices, trades]);

  const activeTrades = isDemoMode ? demoTrades : trades;
  const activeBaseCapital = isDemoMode ? demoBaseCapital : baseCapital;

  return (
    <TradeContext.Provider value={{ 
      trades: activeTrades, 
      livePrices, 
      baseCapital: activeBaseCapital, 
      setBaseCapital, 
      pkrRate, 
      binancePkrRate, 
      isCustomPkrRate, 
      setPkrRate, 
      resetPkrRateToBinance, 
      fetchBinancePkrRate, 
      loading, 
      refreshTrades, 
      isRefreshing, 
      reconcileAll, 
      binanceBalance, 
      fetchBinanceBalance,
      syncTradeWithBinance,
      viewMode,
      setViewMode,
      // Custom Fee Tier Profiles
      feeTier,
      customFeeRate,
      setFeeTier,
      effectiveFeeRate,
      // Paper / Demo Account Mode
      isDemoMode,
      setIsDemoMode,
      demoBaseCapital,
      setDemoBaseCapital,
      resetDemoAccount,
      // Offline-First Synchronization & Optimistic UI
      isOnline,
      offlineQueueCount: offlineQueue.length,
      saveTradeOptimistic,
      updateTradeOptimistic,
      deleteTradeOptimistic
    }}>
      {children}
    </TradeContext.Provider>
  );
};

