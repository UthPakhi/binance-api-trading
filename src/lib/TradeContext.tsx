import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { auth, db, getEffectiveUid } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, query, where, orderBy, onSnapshot, doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc, arrayUnion } from 'firebase/firestore';
import { Trade, BinanceBalanceInfo, PnlViewMode, FeeTierId, FEE_TIERS, OfflineAction, PriceAlert } from '../types';
import { useBinanceTickers } from './binance';
import { calculateProfit, isAlphaTradeOrSymbol, getTradeIsLong, getTradeEffectiveRisk, isTradeClosed, getTradeCoins, getTradeInvestedAmount, formatPrice, isBinanceLinkedTrade, isBinanceLimitOrder, isBreakoutStopLimitTrade, isStopLossAtBreakeven, deduplicateTrades, getCleanSymbol, isSameSymbol, generateSolidSellPlan, getCleanTradingSymbol, CostBasisMethod } from './tradeUtils';
import { reconcileTrade } from './tradeReconciliation';
import { syncTradeWithBinance, parseBinanceOpenOrdersForTrade } from './binanceOrderSync';
import { notifyLimitOrderFilled } from './notificationHelper';
import {
  loadPortfolioSnapshotFromIDB,
  savePortfolioSnapshotToIDB,
  loadOfflineQueueFromIDB,
  saveOfflineQueueToIDB,
} from './offlineStorage';
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
  costBasisMethod: CostBasisMethod;
  setCostBasisMethod: (method: CostBasisMethod) => Promise<void>;
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
  syncClosedTradesFromBinance: (silent?: boolean) => Promise<number>;
  historyTimeHorizon: string;
  setHistoryTimeHorizon: (horizon: string) => Promise<void>;
  // Custom Coin Price Alerts
  priceAlerts: PriceAlert[];
  addPriceAlert: (alert: Omit<PriceAlert, 'id' | 'userId' | 'createdAt'>) => Promise<PriceAlert>;
  updatePriceAlert: (alertId: string, updates: Partial<PriceAlert>) => Promise<void>;
  deletePriceAlert: (alertId: string) => Promise<void>;
  clearTriggeredPriceAlerts: () => Promise<void>;
}

export const TradeContext = createContext<TradeContextType>({} as any);
export const useTradeContext = () => useContext(TradeContext);

const REMOVED_TRADE_IDS = new Set([
  'bk9hdH0mwE6Sp0mpj9T2', 'fdjdL0MLf7Z5iyal7kZQ', 'o0L4HU8odk6rwIwE0t9v',
  'BhkxvZRejRsOTaxlvS5g', 'i7aP30ZdQrp6cgyrbjVu', '96DfpRpnL6PXqEFNKkKH',
  'Mnnk79j6MpXyMYUqYpih', 'ITKUHZDLxoiB0MJH7sLN', 'P1g4zRJZNoqLtzwDWt2d',
  'CmzZfBGe3YH1oRMfTbzH', 'EKd4kM7gu7ATc52HjhV0',
  // Hardcoded fake fallback trades & duplicates
  'zYV5PZgwu2MMpFiQg87i', '3oEMFwhuQ8C6BHkV8OLV', 'Ko1UHusuid8qrmF5ddyZ',
  'fHX9gtiJWXTxsgVJuMPb', 'kULTBJ3odE1Fl7P2QPTd', 'cjxng6hxyJ68qWdYFxK0',
  '3RIAYfxvP9UiqAEueLj8', 'n70dV2IkdOxkUXufhGty', 'gBGFyQ6q7EtLUIXESqDq',
  'cfx_closed_trade_1', 'binance_holding_ZKPUSDT', '66Zq6UneFi7WuIIkqk6w',
  // Orphan partial-sell fragments & duplicate order records
  'binance_closed_223686660', 'binance_closed_224220724', 'binance_closed_227840423',
  's5aHl7K15OVM5RO4MwtP', 'binance_closed_3703209884', 'binance_closed_1018808426',
  'binance_closed_99059142', 'binance_closed_cfx_master_unified', 'binance_closed_2098533796',
  'binance_closed_722168594', 'binance_closed_2089501326', 'binance_closed_2090308638',
  'binance_closed_2089501658', 'binance_closed_2090696044', 'binance_closed_2091361694',
  'binance_closed_859449056', 'uZKH6Hy42Z0ZUZiIYIZj', 'binance_closed_5544674100',
  'binance_closed_10625590894', 'gTp3OMzT326f4PBvWteK', 'binance_closed_17733149',
  '0miUsMXov8emntNeE7Xu', 'in3pbhzWUTrkubEgSs1K', 'binance_closed_179908249',
  'binance_closed_91084224', 'binance_closed_332965195', 'binance_closed_2135942359',
  'binance_closed_9472582355', 'binance_closed_17835448119', 'binance_closed_17835472536',
  'iaishynUvKcWb53OHTIo', '2jXkNLk09b56Y8vKPGg8', 'binance_closed_6136483131',
  // Orphan duplicates and legacy pre-3-month (pre-Aug 2026) trades
  'binance_closed_17829214046', 'binance_closed_17829254762',
  'cmPrkfETvs8eDpNYrojK', 'Srky99WobHqpv4l9m72l', 'binance_closed_500098516',
  'nrbvE2npTPFzRbO6aixb', 'o7AaBQUg0DPPlfy49Dem', 'ITjse3aSINrBYNtS9sOU',
  'AugT8JCnY88VutDraKXb', 'B5oB1HIbroPHLfNLP2ja', 'IfEp1ZWi3S0nWPzfFpRW', 'wlm6dIQuh2W22Hf7ga9v',
  'fRMLV25GJ7y6KhWJF8Ri', '8IZaoXyBAWRb3Pwjhb9j', 'TqSHMm9akZhLlr12o2be',
  'J1jZvWiV9CDYdf3UWsuy', 'rIFxnlyEe4oA8p7qI8XW', '6w1OHYN8WqDyXghUSAwX',
  'qw2eFa9wupB0zpgHUQij', 'uy9r4khVp9krouQ16QfU', 'ZWg4wySZrnFgpZ3fJKiw',
  'binance_closed_3676451497', 'binance_holding_SUPERUSDT', 'binance_closed_142076130',
  'binance_holding_WINUSDT'
]);

const stripUnsetStopLossAndTp = (t: Trade): Trade => {
  if (!t || isTradeClosed(t)) return t;
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

  if ((isHolding && ((t.stopLoss || 0) > 0 || (t.takeProfit1 || 0) > 0)) || isSyntheticPlan) {
    return {
      ...t,
      stopLoss: 0,
      takeProfit1: 0,
      tp1Percent: 0,
      takeProfit2: undefined,
      tp2Percent: undefined,
      takeProfit3: undefined,
      tp3Percent: undefined,
      riskAmount: 0
    };
  }
  return t;
};

const normalizeAndConsolidateTrades = (rawTrades: Trade[], uid: string, baseCap: number): Trade[] => {
  let deletedIds: string[] = [];
  try {
    deletedIds = JSON.parse(localStorage.getItem('trade_sizer_deleted_trade_ids') || '[]');
  } catch {}

  const THREE_MONTHS_START = 1787000000000;
  const cleaned = rawTrades
    .filter(t => t && (!t.id || (!REMOVED_TRADE_IDS.has(t.id) && !deletedIds.includes(t.id))))
    .map(t => {
      let next = stripUnsetStopLossAndTp({
        ...t,
        symbol: getCleanTradingSymbol(t.symbol)
      });
      // Self-heal stale browser cache (localStorage/IndexedDB) if binance_holding_IOUSDT has pre-fix half-lot cost or duplicate idempotencyKey
      if (next.id === 'binance_holding_IOUSDT' && (next.realizedProfitUsd && next.realizedProfitUsd > 100 || next.idempotencyKey === 'IO_ORD1152681247_TRD57766773')) {
        next = {
          ...next,
          status: 'CLOSED_MANUAL',
          entryPrice: 0.15250002,
          exitPrice: 0.15000209,
          positionSizeCoins: 3390.13,
          soldCoins: 3386.74,
          totalBuyUsd: 516.99489,
          totalSellUsd: 508.02,
          realizedProfitUsd: -9.48,
          feeUsd: 1.02501296,
          binanceOrderId: '1152681674',
          idempotencyKey: 'IO_ORD1152681674_TRD57768551',
          notes: 'Bought 1,695.13 IO for $259.35 @ $0.1530 · Oct 28 at 5:12 PM\nBought 1,695 IO for $257.64 @ $0.1520 · Oct 28 at 5:30 PM\n✂️ Sold 1,711.05 IO for $257.00 @ $0.1502 · Oct 28 at 7:00 PM (Loss Cut: -$5.29 · -1.5%)\n✂️ Sold 1,675.69 IO for $251.02 @ $0.1498 · Oct 28 at 7:01 PM (Loss Cut: -$4.19 · -1.8%)'
        };
      }
      return next;
    });

  const validTrades = deduplicateTrades(cleaned);

  const historyFilteredTrades = validTrades.filter(t => {
    if (!t.id || REMOVED_TRADE_IDS.has(t.id) || deletedIds.includes(t.id)) return false;
    if (!isTradeClosed(t)) return true;
    const tradeTime = t.closedAt || t.filledAt || t.createdAt || 0;
    return tradeTime >= THREE_MONTHS_START;
  });

  // CFX Master Consolidation (consolidate legacy closed CFX trades <= 1791800000000 while preserving any open or newer CFX trades)
  const isLegacyClosedCfx = (t: Trade) =>
    (t.symbol || '').toUpperCase().includes('CFX') &&
    isTradeClosed(t) &&
    (t.closedAt || t.filledAt || t.createdAt || 0) <= 1791800000000;

  const masterDoc: Trade = {
    id: 'cfx_master_unified',
    userId: uid || 'local_user',
    symbol: 'CFXUSDT',
    status: 'CLOSED_MANUAL',
    market: 'SPOT',
    type: 'TRADE',
    entryPrice: 0.05370,
    exitPrice: 0.06492,
    positionSizeCoins: 4094,
    soldCoins: 4091,
    totalBuyUsd: 219.84,
    totalSellUsd: 265.58,
    realizedProfitUsd: 45.41,
    feeUsd: 0.49,
    buyFeeUsd: 0.22,
    sellFeeUsd: 0.27,
    totalFeesUsd: 0.49,
    portfolioSize: baseCap || 2595,
    riskPercent: 1,
    riskAmount: 0,
    createdAt: 1789992765000,
    filledAt: 1789992765000,
    closedAt: 1791738805000,
    stopLoss: 0.047,
    takeProfit1: 0.065,
    notes: 'Consolidated CFX trading history: 4,094 CFX bought ($219.84), 4,091 CFX sold ($265.58). Net profit +$45.41. Run duration: 20d 5h.'
  };

  const remainingTrades = historyFilteredTrades.filter(t => !isLegacyClosedCfx(t));
  return deduplicateTrades([masterDoc, ...remainingTrades]);
};

const getInitialTrades = (): Trade[] => {
  try {
    const saved = localStorage.getItem('trade_sizer_cached_trades');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return normalizeAndConsolidateTrades(parsed, getEffectiveUid() || 'local_user', 2595);
      }
    }
  } catch {}
  return normalizeAndConsolidateTrades([], getEffectiveUid() || 'local_user', 2595);
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
      const saved = localStorage.getItem('trade_sizer_custom_pkr_rate') || localStorage.getItem('trade_sizer_cached_pkr_rate');
      if (saved) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed > 0) return parsed;
      }
    } catch {}
    return 277.29;
  });
  const [binancePkrRate, setBinancePkrRate] = useState<number | null>(null);
  const [historyTimeHorizon, setHistoryTimeHorizonState] = useState<string>(() => {
    try {
      return localStorage.getItem('trade_sizer_history_time_horizon') || '3M';
    } catch {
      return '3M';
    }
  });

  const setHistoryTimeHorizon = async (horizon: string) => {
    setHistoryTimeHorizonState(horizon);
    try {
      localStorage.setItem('trade_sizer_history_time_horizon', horizon);
    } catch {}
    if (auth.currentUser) {
      try {
        await setDoc(doc(db, 'users', auth.currentUser.uid), { historyTimeHorizon: horizon }, { merge: true });
      } catch {}
    }
    toast.success(`History time horizon set to ${horizon === 'ALL' ? 'All Time' : horizon}`);
  };
  const [isCustomPkrRate, setIsCustomPkrRate] = useState<boolean>(() => {
    try {
      return localStorage.getItem('trade_sizer_custom_pkr_rate') !== null;
    } catch {
      return false;
    }
  });
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [wsTrigger, setWsTrigger] = useState(0);
  const [binanceBalance, setBinanceBalance] = useState<BinanceBalanceInfo | null>(() => getInitialBalance());
  const [currentUserId, setCurrentUserId] = useState<string | null>(() => getEffectiveUid());

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setCurrentUserId(user?.uid || getEffectiveUid());
    });
    return () => unsubAuth();
  }, []);

  const tradesRef = useRef<Trade[]>([]);
  tradesRef.current = trades;
  const tradesLoadedRef = useRef(initialTrades.length > 0);

  const isReconcilingRef = useRef(false);
  const isSyncingPositionsRef = useRef(false);
  const isSyncingClosedRef = useRef(false);
  const lastSyncPositionsTimeRef = useRef(0);
  const notifiedToastsRef = useRef<Set<string>>((() => {
    const initial = new Set<string>([
      'synced_orders_binance_limit_740212841_Synced TP1: $0.000074 (100%) | SL: $0.00006',
      'synced_orders_binance_limit_740212841_Synced TP1: $0.000074 (100%)',
      'synced_orders_binance_limit_740212841_SL: $0.00006'
    ]);
    try {
      const saved = localStorage.getItem('trade_sizer_notified_toasts');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) parsed.forEach((k: string) => initial.add(k));
      }
    } catch {}
    return initial;
  })());
  const inFlightLimitOrderIdsRef = useRef<Set<string>>(new Set());
  const spotPositionsRef = useRef<any[]>([]);

  // Hydrate full authenticated portfolio state & spot positions from IndexedDB on startup
  useEffect(() => {
    let active = true;
    loadPortfolioSnapshotFromIDB().then((snapshot) => {
      if (!active || !snapshot) return;
      if (Array.isArray(snapshot.trades) && snapshot.trades.length > 0 && !tradesLoadedRef.current) {
        const hydrated = normalizeAndConsolidateTrades(
          snapshot.trades,
          getEffectiveUid() || 'local_user',
          snapshot.baseCapital || 2595
        );
        if (hydrated.length > 0) {
          tradesRef.current = hydrated;
          setTrades(hydrated);
        }
      }
      if (snapshot.binanceBalance && !binanceBalance) {
        setBinanceBalance(snapshot.binanceBalance);
      }
      if (Array.isArray(snapshot.spotPositions) && snapshot.spotPositions.length > 0 && spotPositionsRef.current.length === 0) {
        spotPositionsRef.current = snapshot.spotPositions;
      }
      if (typeof snapshot.baseCapital === 'number' && snapshot.baseCapital > 0) {
        setBaseCapitalState(snapshot.baseCapital);
      }
      if (typeof snapshot.pkrRate === 'number' && snapshot.pkrRate > 0) {
        setPkrRateState(snapshot.pkrRate);
      }
      if (typeof snapshot.binancePkrRate === 'number' && snapshot.binancePkrRate > 0) {
        setBinancePkrRate(snapshot.binancePkrRate);
      }
      if (snapshot.viewMode && ['DOLLAR', 'R_MULTIPLE', 'PERCENT', 'ZEN'].includes(snapshot.viewMode)) {
        setViewModeState(snapshot.viewMode);
      }
      if (snapshot.historyTimeHorizon) {
        setHistoryTimeHorizonState(snapshot.historyTimeHorizon);
      }
      if (snapshot.feeTier && FEE_TIERS[snapshot.feeTier as FeeTierId]) {
        setFeeTierState(snapshot.feeTier as FeeTierId);
      }
      if (typeof snapshot.customFeeRate === 'number' && snapshot.customFeeRate >= 0) {
        setCustomFeeRateState(snapshot.customFeeRate);
      }
      setLoading(false);
    });
    loadOfflineQueueFromIDB().then((idbQueue) => {
      if (!active || !Array.isArray(idbQueue) || idbQueue.length === 0) return;
      setOfflineQueue((prev) => (prev.length > 0 ? prev : idbQueue));
    });
    return () => {
      active = false;
    };
  }, []);

  // Fetch live PKR rate from Binance P2P
  const fetchBinancePkrRate = useCallback(async (): Promise<number | null> => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
    try {
      const res = await fetch('/api/exchange/pkr-rate');
      if (!res.ok) return null;
      const data = await res.json();
      if (data.status === 'success' && typeof data.rate === 'number' && data.rate > 0) {
        setBinancePkrRate(data.rate);
        try {
          localStorage.setItem('trade_sizer_cached_pkr_rate', String(data.rate));
        } catch {}
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
  }, [fetchBinancePkrRate]);

  // Fetch settings
  useEffect(() => {
    const uid = getEffectiveUid();
    if (!uid) return;
    const fetchSettings = async () => {
      try {
        const d = await getDoc(doc(db, 'users', uid));
        if (d.exists()) {
          const userData = d.data();
          if (userData.baseCapital !== undefined) {
            setBaseCapitalState(userData.baseCapital);
            try {
              localStorage.setItem('trade_sizer_cached_base_capital', String(userData.baseCapital));
            } catch {}
          } else {
            await setDoc(doc(db, 'users', uid), { baseCapital: 2595 }, { merge: true });
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
          if (userData.historyTimeHorizon) {
            setHistoryTimeHorizonState(userData.historyTimeHorizon);
            try {
              localStorage.setItem('trade_sizer_history_time_horizon', userData.historyTimeHorizon);
            } catch {}
          }
        } else {
          await setDoc(doc(db, 'users', uid), { baseCapital: 2595 }, { merge: true });
        }
      } catch (e) {
        console.error("Error fetching settings:", e);
      }
    };
    fetchSettings();
  }, [currentUserId]);

  // Authoritative Backend Cost-Basis Accounting Engine: WAC (Weighted Average Cost)
  const [costBasisMethod, setCostBasisMethodState] = useState<CostBasisMethod>('WAC');
  const setCostBasisMethod = async (_method: CostBasisMethod): Promise<void> => {
    setCostBasisMethodState('WAC');
  };

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

  // Keep IndexedDB portfolio snapshot continuously updated whenever core portfolio state changes
  useEffect(() => {
    if (trades.length === 0 && !binanceBalance) return;
    savePortfolioSnapshotToIDB({
      uid: auth.currentUser?.uid,
      trades,
      binanceBalance,
      spotPositions: spotPositionsRef.current,
      baseCapital,
      pkrRate,
      binancePkrRate,
      viewMode,
      historyTimeHorizon,
      feeTier,
      customFeeRate,
    });
  }, [trades, binanceBalance, baseCapital, pkrRate, binancePkrRate, viewMode, historyTimeHorizon, feeTier, customFeeRate]);

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

      const localIdMap = new Map<string, string>();
      let syncedCount = 0;
      for (const action of queue) {
        try {
          if (action.type === 'CREATE_TRADE') {
            const payload = { ...action.data };
            const tempId = payload.id || action.id;
            delete payload.id;
            const docRef = await addDoc(collection(db, 'trades'), payload);
            if (tempId) {
              localIdMap.set(tempId, docRef.id);
              setTrades(prev => deduplicateTrades(prev.map(t => t.id === tempId ? { ...t, id: docRef.id } : t)));
            }
            syncedCount++;
          } else if (action.type === 'UPDATE_TRADE' && action.tradeId) {
            const resolvedId = localIdMap.get(action.tradeId) || action.tradeId;
            if (!resolvedId.startsWith('local_')) {
              await updateDoc(doc(db, 'trades', resolvedId), action.data);
              syncedCount++;
            }
          } else if (action.type === 'DELETE_TRADE' && action.tradeId) {
            const resolvedId = localIdMap.get(action.tradeId) || action.tradeId;
            if (!resolvedId.startsWith('local_')) {
              await deleteDoc(doc(db, 'trades', resolvedId));
              syncedCount++;
            }
          }
        } catch (err) {
          console.warn("Failed to flush action:", action, err);
        }
      }

      setOfflineQueue([]);
      localStorage.removeItem('trade_sizer_offline_queue');
      saveOfflineQueueToIDB([]);
      if (syncedCount > 0) {
        toast.success(`Synced ${syncedCount} offline change${syncedCount > 1 ? 's' : ''} to cloud!`, { icon: "☁️" });
      }
    } catch (e) {
      console.error("Flush queue error:", e);
    }
  };

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

    const updatedTrades = deduplicateTrades([tradeWithId, ...trades]);
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
      saveOfflineQueueToIDB(newQueue);
      try {
        localStorage.setItem('trade_sizer_offline_queue', JSON.stringify(newQueue));
      } catch {}
      return optimisticId;
    }

    try {
      const docRef = await addDoc(collection(db, 'trades'), tradeData);
      setTrades(prev => deduplicateTrades(prev.map(t => t.id === optimisticId ? { ...t, id: docRef.id } : t)));
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
      saveOfflineQueueToIDB(newQueue);
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
      saveOfflineQueueToIDB(newQueue);
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
      saveOfflineQueueToIDB(newQueue);
      try {
        localStorage.setItem('trade_sizer_offline_queue', JSON.stringify(newQueue));
      } catch {}
    }
  };

  const deleteTradeOptimistic = async (tradeId: string) => {
    try {
      const deletedIds = JSON.parse(localStorage.getItem('trade_sizer_deleted_trade_ids') || '[]');
      if (!deletedIds.includes(tradeId)) {
        deletedIds.push(tradeId);
        localStorage.setItem('trade_sizer_deleted_trade_ids', JSON.stringify(deletedIds));
      }
    } catch {}

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
      saveOfflineQueueToIDB(newQueue);
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
      saveOfflineQueueToIDB(newQueue);
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

          // Strict deduplication: only toast once per trade milestone
          const toastKey = `${update.tradeId}_${update.status}`;
          const isAlreadyNotified = notifiedToastsRef.current.has(toastKey) || 
            (Array.isArray(trade.notifiedMilestones) && trade.notifiedMilestones.includes(update.status));

          if (!isAlreadyNotified) {
            notifiedToastsRef.current.add(toastKey);
            if (update.status === 'ACTIVE' && trade.status === 'PENDING') {
              const destName = trade.type === 'HOLDING' ? 'Investments' : 'Active Trades';
              notifyLimitOrderFilled({
                symbol: update.symbol,
                price: trade.entryPrice,
                coins: trade.positionSizeCoins,
                orderId: trade.binanceOrderId ? String(trade.binanceOrderId) : undefined,
                destination: destName,
                source: 'Price Target'
              });
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
    } catch (e) {
      console.error("Reconciliation error:", e);
    } finally {
      isReconcilingRef.current = false;
    }
  }, []);


  const syncBinanceSpotPositions = useCallback(async (forceFresh = false) => {
    const uid = getEffectiveUid();
    if (!uid || !tradesLoadedRef.current) return;
    if (isSyncingPositionsRef.current) return;
    const now = Date.now();
    if (!forceFresh && now - lastSyncPositionsTimeRef.current < 8000) return; // Minimum 8-second throttle unless forced fresh
    isSyncingPositionsRef.current = true;
    lastSyncPositionsTimeRef.current = now;

    try {
      const res = await fetch(`/api/exchange/positions${forceFresh ? '?fresh=true' : ''}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.status !== 'success' || !Array.isArray(data.positions)) return;

      const binancePositions = data.positions; // [{ symbol, positionAmt, entryPrice, currentPrice, usdValue, isPendingOrder }]
      spotPositionsRef.current = binancePositions;
      savePortfolioSnapshotToIDB({ spotPositions: binancePositions });
      const openOrdersSuccess = data.openOrdersSuccess !== false; // Treat undefined as true for backwards compatibility
      const allOpenOrders = Array.isArray(data.allOpenOrders) ? data.allOpenOrders : [];
      
      let promises: Promise<any>[] = [];
      let hadConsolidation = false;

      // 0. Ensure every active Binance Spot holding has an active trade in the app with a solid sell plan
      for (const bp of binancePositions) {
        if (bp.isPendingOrder || (bp.usdValue || 0) < 2) continue;
        const cleanSym = getCleanSymbol(bp.symbol);
        if (!cleanSym) continue;

        const matchingActive = tradesRef.current.filter(t => 
          !isTradeClosed(t) && 
          t.status !== 'PENDING' && 
          isSameSymbol(t.symbol, cleanSym) &&
          !isAlphaTradeOrSymbol(t)
        );

        const matchingPending = tradesRef.current.filter(t => 
          !isTradeClosed(t) && 
          t.status === 'PENDING' && 
          isSameSymbol(t.symbol, cleanSym) &&
          !isAlphaTradeOrSymbol(t)
        );

        if (matchingActive.length === 0) {
          if (uid) {
            const baseHoldingDocId = `binance_holding_${cleanSym}`;
            const existingHolding = tradesRef.current.find(t =>
              !isTradeClosed(t) &&
              (t.id === baseHoldingDocId || (t.type === 'HOLDING' && isSameSymbol(t.symbol, cleanSym)))
            );

            if (existingHolding && existingHolding.id) {
              const newCoins = bp.positionAmt;
              const newEntry = bp.entryPrice > 0 ? bp.entryPrice : (existingHolding.entryPrice || 0);
              const newCost = newCoins * newEntry;
              const diffCoins = Math.abs(newCoins - (existingHolding.positionSizeCoins || 0));
              const needsNotesUpdate = Boolean(bp.executionNotes && existingHolding.notes !== bp.executionNotes);
              if (diffCoins > Math.max(existingHolding.positionSizeCoins || 1, 0.0001) * 0.02 || needsNotesUpdate) {
                const updatePayload: any = {
                  positionSizeCoins: newCoins,
                  entryPrice: newEntry,
                  totalBuyUsd: newCost,
                  positionSize: newCost,
                  ...(bp.executionNotes ? { notes: bp.executionNotes } : {}),
                  updatedAt: Date.now()
                };
                Object.assign(existingHolding, updatePayload);
                promises.push(updateDoc(doc(db, 'trades', existingHolding.id), updatePayload));
              }
            } else {
              // Auto-ingest the active holding as long-term investment (no artificial stop loss or TPs)
              const bpLots = Array.isArray(bp.recentFills) ? bp.recentFills : [];
              const earliestLotTime = bpLots.length > 0
                ? Math.min(...bpLots.map((l: any) => l.time || l.timestamp || Date.now()))
                : Date.now();
              // Do not overwrite an already-closed trade that used baseHoldingDocId
              const isBaseDocClosed = tradesRef.current.some(t => t.id === baseHoldingDocId && isTradeClosed(t));
              const holdingDocId = isBaseDocClosed
                ? `binance_holding_${cleanSym}_${bp.binanceOrderId || earliestLotTime}`
                : baseHoldingDocId;
              const newTradeDoc: any = {
                id: holdingDocId,
                userId: uid,
                symbol: cleanSym,
                portfolioSize: baseCapital || 10000,
                riskPercent: 1,
                entryPrice: bp.entryPrice,
                stopLoss: 0,
                takeProfit1: 0,
                tp1Percent: 0,
                takeProfit2: 0,
                tp2Percent: 0,
                takeProfit3: 0,
                tp3Percent: 0,
                riskAmount: 0,
                positionSizeCoins: bp.positionAmt,
                totalBuyUsd: bp.positionAmt * bp.entryPrice,
                positionSize: bp.positionAmt * bp.entryPrice,
                soldCoins: 0,
                totalSellUsd: 0,
                exitPrice: null,
                realizedProfitUsd: 0,
                closedAt: null,
                ledgerMatches: [],
                wacExits: [],
                fifoSummary: null,
                wacSummary: null,
                notifiedMilestones: [],
                openBuyLots: bpLots,
                status: 'ACTIVE',
                market: 'SPOT',
                type: 'HOLDING',
                createdAt: earliestLotTime,
                filledAt: earliestLotTime,
                notes: bp.executionNotes || 'Auto-synced from Binance Spot holding',
                binanceOrderId: bp.binanceOrderId || undefined,
                idempotencyKey: bp.idempotencyKey || (bp.binanceOrderId ? `${cleanSym}_ORD${bp.binanceOrderId}` : null)
              };
              tradesRef.current = deduplicateTrades([newTradeDoc, ...tradesRef.current]);
              promises.push(setDoc(doc(db, 'trades', holdingDocId), newTradeDoc, { merge: true }));
            }
          }
        } else if (matchingActive.length === 1) {
          const trade = matchingActive[0];
          if (trade.id) {
            const currentCoins = trade.positionSizeCoins || 0;
            const currentEntry = trade.entryPrice || 0;
            const newCoins = bp.positionAmt;
            const newEntry = bp.entryPrice > 0 ? bp.entryPrice : currentEntry;
            const newCost = newCoins * newEntry;

            const diffCoins = Math.abs(newCoins - currentCoins);
            const diffEntry = Math.abs(newEntry - currentEntry);
            const bpLots = Array.isArray(bp.recentFills) ? bp.recentFills : [];
            const existingBoughtCount = ((trade.notes || '').match(/Bought\s+/gi) || []).length;
            const bpBoughtCount = ((bp.executionNotes || '').match(/Bought\s+/gi) || []).length;
            const needsExecNotes = Boolean(
              (bp.executionNotes && (existingBoughtCount === 0 || bpBoughtCount > existingBoughtCount)) ||
              (bpLots.length > 1 && (!Array.isArray(trade.openBuyLots) || trade.openBuyLots.length < bpLots.length))
            );

            const isHolding = trade.type === 'HOLDING';
            const isBalanceIncrease = newCoins > currentCoins + 0.0005;
            const hasOtherActiveTrade = matchingActive.some(t => t.id !== trade.id && t.type !== 'HOLDING');
            const hasPartialExit = Boolean(
              (trade.soldCoins && trade.soldCoins > 0) ||
              trade.status === 'PARTIAL_EXIT' ||
              trade.status === 'HIT_TP1' ||
              trade.status === 'HIT_TP2'
            );

            // Do NOT overwrite initial positionSizeCoins with smaller remaining wallet balance when a trade is partially exited!
            if (isHolding && isBalanceIncrease && hasOtherActiveTrade) {
              // Preserve holding's dedicated allocation; unassigned coins are available to open as a new trade
            } else if (!isHolding && hasPartialExit && newCoins < currentCoins) {
              // Preserve initial positionSizeCoins so Step 1 (syncTradeWithBinance) accurately tracks soldCoins vs initial size
            } else if (diffCoins > Math.max(currentCoins, 0.0001) * 0.02 || diffEntry > Math.max(currentEntry, 0.0001) * 0.02 || needsExecNotes) {
              const totalLotQty = bpLots.reduce((s: number, l: any) => s + (l.qty || l.remainingQty || 0), 0);
              const totalLotCost = bpLots.reduce((s: number, l: any) => s + (l.usdValue || l.costUsd || ((l.qty || 0) * (l.price || 0))), 0);
              const effectiveCoins = (!hasPartialExit && totalLotQty > 0 && Math.abs(totalLotQty - newCoins) / Math.max(totalLotQty, 1) < 0.02)
                ? totalLotQty
                : newCoins;
              const effectiveCost = (!hasPartialExit && totalLotCost > 0 && Math.abs(totalLotQty - newCoins) / Math.max(totalLotQty, 1) < 0.02)
                ? totalLotCost
                : newCost;
              const updatePayload: any = {
                positionSizeCoins: effectiveCoins,
                entryPrice: newEntry,
                totalBuyUsd: effectiveCost,
                positionSize: effectiveCost,
                ...(bpLots.length > 0 ? { openBuyLots: bpLots } : {}),
                ...(needsExecNotes && bp.executionNotes ? { notes: bp.executionNotes } : {}),
                updatedAt: Date.now()
              };
              Object.assign(trade, updatePayload);
              promises.push(updateDoc(doc(db, 'trades', trade.id), updatePayload));
            }
          }
        } else if (matchingActive.length > 1) {
          // If an active TRADE and an auto-generated binance_holding_SYM both exist for the same symbol, remove the redundant auto-holding
          const activeTradesOnly = matchingActive.filter(t => t.type !== 'HOLDING');
          const autoHoldings = matchingActive.filter(t => t.type === 'HOLDING' && t.id?.startsWith('binance_holding_'));
          if (activeTradesOnly.length >= 1 && autoHoldings.length >= 1) {
            for (const ah of autoHoldings) {
              if (ah.id) {
                tradesRef.current = tradesRef.current.filter(t => t.id !== ah.id);
                promises.push(deleteDoc(doc(db, 'trades', ah.id)).catch(() => {}));
              }
            }
          }

          // If multiple HOLDING documents exist for the same symbol (e.g. a custom doc ID and binance_holding_SYM),
          // deduplicate them so the user never sees duplicate or out-of-sync holdings!
          const activeHoldings = matchingActive.filter(t => t.type === 'HOLDING');
          if (activeHoldings.length > 1) {
            const primaryHolding = activeHoldings.find(t => !t.id?.startsWith('binance_holding_')) || activeHoldings[0];
            for (const dup of activeHoldings) {
              if (dup.id && dup.id !== primaryHolding.id) {
                tradesRef.current = tradesRef.current.filter(t => t.id !== dup.id);
                promises.push(deleteDoc(doc(db, 'trades', dup.id)).catch(() => {}));
              }
            }
            if (primaryHolding.id) {
              const newCoins = bp.positionAmt;
              const newEntry = bp.entryPrice > 0 ? bp.entryPrice : (primaryHolding.entryPrice || 0);
              const newCost = newCoins * newEntry;
              const bpLots = Array.isArray(bp.recentFills) ? bp.recentFills : [];
              const updatePayload: any = {
                positionSizeCoins: newCoins,
                entryPrice: newEntry,
                totalBuyUsd: newCost,
                positionSize: newCost,
                ...(bpLots.length > 0 ? { openBuyLots: bpLots } : {}),
                ...(bp.executionNotes ? { notes: bp.executionNotes } : {}),
                updatedAt: Date.now()
              };
              Object.assign(primaryHolding, updatePayload);
              promises.push(updateDoc(doc(db, 'trades', primaryHolding.id), updatePayload));
            }
          }
          if (bp.positionAmt <= 0.00001) {
            // Position closed on Binance (only auto-close non-holding trades)
            for (const t of matchingActive) {
              if (t.id && t.type !== 'HOLDING' && t.status !== 'CLOSED_MANUAL') {
                const closePayload: any = {
                  status: 'CLOSED_MANUAL',
                  closedAt: Date.now(),
                  exitPrice: bp.currentPrice || t.entryPrice,
                  updatedAt: Date.now()
                };
                Object.assign(t, closePayload);
                promises.push(updateDoc(doc(db, 'trades', t.id), closePayload));
              }
            }
          }
        }
      }

      // Track open Binance limit orders (e.g. SOL, BTC, ZKP) as PENDING trades
      for (const bp of binancePositions) {
        if (!bp.isPendingOrder) continue;
        const cleanSym = getCleanSymbol(bp.symbol);
        if (!cleanSym) continue;

        const bpOrderId = bp.binanceOrderId ? String(bp.binanceOrderId) : '';
        if (!bpOrderId) continue;

        const existingPending = tradesRef.current.find(t => 
          t.status === 'PENDING' && 
          (
            (t.binanceOrderId && String(t.binanceOrderId) === bpOrderId) ||
            (isSameSymbol(t.symbol, cleanSym) && Math.abs((t.entryPrice || 0) - bp.entryPrice) <= (bp.entryPrice * 0.001 || 0.001))
          )
        );

        if (existingPending && existingPending.id) {
          const expectedCost = bp.positionAmt * bp.entryPrice;
          const priceDiff = Math.abs((existingPending.entryPrice || 0) - bp.entryPrice);
          const coinsDiff = Math.abs((existingPending.positionSizeCoins || 0) - bp.positionAmt);
          const costDiff = Math.abs((existingPending.totalBuyUsd || 0) - expectedCost);
          if (priceDiff > 0.000001 || coinsDiff > 0.001 || costDiff > 0.05) {
            const updatePayload: any = {
              entryPrice: bp.entryPrice,
              positionSizeCoins: bp.positionAmt,
              totalBuyUsd: expectedCost,
              positionSize: expectedCost,
              binanceOrderId: bpOrderId,
              notes: `Open Limit Buy Order on Binance (Order #${bpOrderId})`,
              updatedAt: Date.now()
            };
            Object.assign(existingPending, updatePayload);
            promises.push(updateDoc(doc(db, 'trades', existingPending.id), updatePayload));
          }
        } else if (!existingPending && uid) {
          const docId = `binance_limit_${bpOrderId}`;
          const newOrderDoc: any = {
            id: docId,
            userId: uid,
            symbol: cleanSym,
            portfolioSize: baseCapital || 10000,
            riskPercent: 1,
            entryPrice: bp.entryPrice,
            stopLoss: 0,
            takeProfit1: 0,
            riskAmount: 0,
            positionSizeCoins: bp.positionAmt,
            totalBuyUsd: bp.positionAmt * bp.entryPrice,
            positionSize: bp.positionAmt * bp.entryPrice,
            status: 'PENDING',
            market: 'SPOT',
            type: 'TRADE',
            createdAt: bp.orderTime || Date.now(),
            notes: `Open Limit Buy Order on Binance (Order #${bpOrderId})`,
            binanceOrderId: bpOrderId
          };

          tradesRef.current = deduplicateTrades([newOrderDoc, ...tradesRef.current]);
          promises.push(setDoc(doc(db, 'trades', docId), newOrderDoc, { merge: true }));
        }
      }

      // 1. Sync existing local trades
      const activeOrPendingLocal = tradesRef.current.filter(t => !isTradeClosed(t));
      for (const trade of activeOrPendingLocal) {
        if (!trade.id) continue;
        
        // CRITICAL CHECK: Binance Alpha section trades & non-spot trades
        const isAlpha = isAlphaTradeOrSymbol(trade);
        
        if (trade.status === 'PENDING') {
            if (isAlpha) {
               continue; // Alpha limit orders are not in standard Binance Spot
            }

            const isTrackedBinanceOrder = Boolean(trade.binanceOrderId || trade.clientOrderId);
            if (!isTrackedBinanceOrder) {
               continue;
            }

            const inAllOpen = allOpenOrders.some((o: any) => trade.binanceOrderId && String(o.orderId) === String(trade.binanceOrderId));
            if (inAllOpen) {
               // Limit order is actively open on Binance exchange! Keep PENDING.
               continue;
            }

            const bpLimit = binancePositions.find((p: any) => {
                if (!p.isPendingOrder) return false;
                if (trade.binanceOrderId && p.binanceOrderId && String(trade.binanceOrderId) === String(p.binanceOrderId)) return true;
                return isSameSymbol(p.symbol, trade.symbol) && Math.abs(p.entryPrice - trade.entryPrice) <= (trade.entryPrice * 0.001 || 0.001);
            });

            if (!bpLimit) {
                if (!openOrdersSuccess) continue; // Do not assume filled or canceled if openOrders API failed
                
                // If the limit order is gone from Binance open orders, verify if it was explicitly confirmed filled
                const isConfirmedFill = Boolean(
                  trade.notes?.includes('Executed on Binance')
                );

                if (isConfirmedFill) {
                    const targetCategory = trade.type === 'HOLDING' ? 'HOLDING' : 'TRADE';
                    const spotHolding = binancePositions.find((p: any) => isSameSymbol(p.symbol, trade.symbol) && !p.isPendingOrder);
                    const orderCoins = trade.positionSizeCoins || (trade.entryPrice > 0 ? (trade.totalBuyUsd || 0) / trade.entryPrice : 0) || (spotHolding ? spotHolding.positionAmt : 0);
                    const orderPrice = trade.entryPrice || (spotHolding ? spotHolding.entryPrice : 0) || 0;
                    const orderCost = trade.totalBuyUsd || (orderCoins * orderPrice);

                    promises.push(
                        updateDoc(doc(db, 'trades', trade.id), {
                            status: 'ACTIVE',
                            type: targetCategory,
                            filledAt: trade.filledAt || Date.now(),
                            positionSizeCoins: orderCoins,
                            totalBuyUsd: orderCost,
                            positionSize: orderCost,
                            entryPrice: orderPrice,
                            notifiedMilestones: arrayUnion('ENTRY'),
                            notes: (trade.notes ? `${trade.notes}\n` : '') + `Executed on Binance (Order #${trade.binanceOrderId || ''})`
                        }).then(() => {
                          trade.status = 'ACTIVE';
                          trade.positionSizeCoins = orderCoins;
                          trade.totalBuyUsd = orderCost;
                          (trade as any).positionSize = orderCost;
                          const toastKey = `filled_${trade.id}`;
                          if (!notifiedToastsRef.current.has(toastKey)) {
                            notifiedToastsRef.current.add(toastKey);
                            notifyLimitOrderFilled({
                              symbol: trade.symbol,
                              price: orderPrice,
                              coins: orderCoins,
                              orderId: trade.binanceOrderId ? String(trade.binanceOrderId) : undefined,
                              destination: targetCategory === 'HOLDING' ? 'Portfolio Holdings' : 'Active Trades',
                              source: 'Binance'
                            });
                          }
                        })
                    );
                } else {
                    // Limit order was canceled or removed on Binance without execution
                    // Delete the unexecuted limit order document so it never shows as a closed trade!
                    promises.push(
                        deleteDoc(doc(db, 'trades', trade.id)).then(() => {
                          tradesRef.current = tradesRef.current.filter(t => t.id !== trade.id);
                        }).catch(() => {
                          updateDoc(doc(db, 'trades', trade.id), { status: 'CANCELED' });
                        })
                    );
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
            // NEVER auto-close Alpha section trades, long-term HOLDINGS, or manually reopened trades!
            if (trade.type === 'HOLDING' || isAlpha || trade.notes?.includes('reopened') || trade.notes?.includes('Reopened')) {
               continue;
            }

            const rawSym = trade.symbol.trim().toUpperCase();
            const cleanSymbol = getCleanSymbol(rawSym);
            const bpSpot = binancePositions.find((p: any) => isSameSymbol(p.symbol, cleanSymbol) && !p.isPendingOrder);
            const tradeOpenOrders = allOpenOrders.filter((o: any) => isSameSymbol(o.symbol, cleanSymbol));

            const isLong = getTradeIsLong(trade);
            const exitSide = isLong ? 'SELL' : 'BUY';
            // Open exit orders are limit TPs or stop-loss orders on the exit side (SELL for Long)
            const tradeExitOrders = tradeOpenOrders.filter((o: any) => o.side === exitSide);

            const isImportedSpotTrade = Boolean(
              trade.notes?.includes('Imported from Binance Spot') || 
              trade.notes?.includes('synced from Binance Spot') || 
              trade.notes?.includes('Updated & synced from Binance Spot') ||
              trade.notes?.includes('Auto-synced from Binance Spot') ||
              trade.binanceOrderId ||
              trade.clientOrderId
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
            const isExitedOnBinance = openOrdersSuccess && (!bpSpot || bpSpot.usdValue < 2) && tradeExitOrders.length === 0;

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
                      // Fallback close: inspect analyze-trade endpoint directly for true Binance fill data
                      const anRes = await fetch(`/api/exchange/analyze-trade?symbol=${encodeURIComponent(cleanSymbol)}`).then(r => r.json()).catch(() => null);
                      if (anRes && anRes.totalSoldQty > 0.0001) {
                        const exitP = anRes.avgExitPrice || trade.entryPrice || 0;
                        const realPnl = anRes.realizedPnL !== undefined ? anRes.realizedPnL : 0;
                        const fees = anRes.totalFeesUsd || 0;
                        const soldC = anRes.totalSoldQty || trade.positionSizeCoins || 0;
                        const closeTime = anRes.latestSellTime || Date.now();

                        await updateDoc(doc(db, 'trades', trade.id), {
                          status: 'CLOSED_MANUAL',
                          exitPrice: exitP,
                          realizedProfitUsd: realPnl,
                          feeUsd: fees,
                          soldCoins: soldC,
                          closedAt: closeTime,
                          notes: (trade.notes ? trade.notes + '\n' : '') + 'Auto-synced: Position fully closed on Binance Spot'
                        });
                      }
                    }
                  } catch (err) {
                    console.warn(`Auto-close sync error for ${trade.symbol}`, err);
                  }
                })());
            } else if (isImportedSpotTrade || bpSpot || tradeOpenOrders.length > 0) {
                // If this is the sole active trade for this Binance Spot coin, sync full coins & entry price
                const siblingTrades = activeOrPendingLocal.filter(t => t.id !== trade.id && isSameSymbol(t.symbol, cleanSymbol) && !isTradeClosed(t) && t.status !== 'PENDING');
                if (siblingTrades.length === 0 && bpSpot && bpSpot.positionAmt > 0) {
                  const currentCoins = trade.positionSizeCoins || 0;
                  const currentEntry = trade.entryPrice || 0;
                  const newCoins = bpSpot.positionAmt;
                  const newEntry = bpSpot.entryPrice > 0 ? bpSpot.entryPrice : currentEntry;
                  const newCost = newCoins * newEntry;

                  const diffCoins = Math.abs(newCoins - currentCoins);
                  const diffEntry = Math.abs(newEntry - currentEntry);

                  // If user bought more coins on Binance, update position size.
                  // If coins are LESS (user sold coins on Binance), DO NOT shrink initial position size!
                  // Let syncTradeWithBinance query analyze-trade, record soldCoins, and bank realized profit!
                  if (newCoins > currentCoins * 1.005 || (!trade.soldCoins && diffEntry > (currentEntry || 1) * 0.005)) {
                    trade.positionSizeCoins = newCoins;
                    trade.entryPrice = newEntry;
                    trade.totalBuyUsd = newCost;
                    promises.push(updateDoc(doc(db, 'trades', trade.id), {
                      positionSizeCoins: newCoins,
                      entryPrice: newEntry,
                      totalBuyUsd: newCost,
                      updatedAt: Date.now()
                    }));
                  }
                }

                // Active or partially exited position: auto-sync TPs, SLs, and partial fills from Binance!
                promises.push((async () => {
                  try {
                    const syncRes = await syncTradeWithBinance(trade, tradeOpenOrders);
                    if (
                      syncRes.updated &&
                      syncRes.summary &&
                      syncRes.summary !== 'Trade updated from Binance' &&
                      syncRes.summary !== 'Already up to date'
                    ) {
                      const toastKey = `synced_orders_${trade.id}_${syncRes.summary}`;
                      if (!notifiedToastsRef.current.has(toastKey)) {
                        notifiedToastsRef.current.add(toastKey);
                        try {
                          localStorage.setItem(
                            'trade_sizer_notified_toasts',
                            JSON.stringify(Array.from(notifiedToastsRef.current).slice(-300))
                          );
                        } catch {}
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

      await Promise.allSettled(promises);
      const deduped = deduplicateTrades(tradesRef.current);
      tradesRef.current = deduped;
      setTrades(deduped);
      try {
        localStorage.setItem('trade_sizer_cached_trades', JSON.stringify(deduped.slice(0, 150)));
      } catch {}
    } catch (e) {
      console.warn("Auto-sync error:", e);
    } finally {
      isSyncingPositionsRef.current = false;
    }
  }, [baseCapital]);

  // Automatic ingestion of closed trades directly from Binance Spot trade history (recent 3-month window only)
  const syncClosedTradesFromBinance = useCallback(async (silent = true): Promise<number> => {
    const uid = getEffectiveUid();
    if (!uid || !tradesLoadedRef.current) return 0;
    if (isSyncingClosedRef.current) return 0;
    isSyncingClosedRef.current = true;

    try {
      let deletedIds: string[] = [];
      let alreadySyncedIds = new Set<string>();
      try {
        const rawDeleted = localStorage.getItem('trade_sizer_deleted_trade_ids');
        if (rawDeleted) deletedIds = JSON.parse(rawDeleted);
      } catch {}
      try {
        const rawSynced = localStorage.getItem('trade_sizer_synced_closed_ids');
        if (rawSynced) {
          const parsed = JSON.parse(rawSynced);
          if (Array.isArray(parsed)) alreadySyncedIds = new Set(parsed);
        }
      } catch {}

      // 0. Fetch current spot positions to know which coins are actively held right now in the wallet
      const activeSpotHoldingSymbols = new Set<string>();
      try {
        const posRes = await fetch('/api/exchange/positions?excludeOpenOrders=true').catch(() => null);
        if (posRes && posRes.ok) {
          const posData = await posRes.json();
          if (posData.status === 'success' && Array.isArray(posData.positions)) {
            posData.positions.forEach((p: any) => {
              if (!p.isPendingOrder && (p.usdValue || 0) >= 2) {
                const raw = (p.symbol || '').toUpperCase().trim();
                const clean = getCleanSymbol(p.symbol);
                if (raw) activeSpotHoldingSymbols.add(raw);
                if (clean) activeSpotHoldingSymbols.add(clean);
              }
            });
          }
        }
      } catch {}

      const localSymbols = Array.from(new Set(tradesRef.current.map(t => t.symbol?.trim()?.toUpperCase()).filter(Boolean)));
      const queryParam = localSymbols.length > 0 ? `?symbols=${encodeURIComponent(localSymbols.join(','))}` : '';
      
      const res = await fetch(`/api/exchange/recentClosedTrades${queryParam}`);
      if (!res.ok) return 0;
      const data = await res.json();
      if (data.status !== 'success' || !Array.isArray(data.closedTrades)) return 0;

      const binanceClosed: any[] = data.closedTrades;
      let importedCount = 0;
      let hadChanges = false;
      const THREE_MONTHS_START = 1787000000000;

      for (const bTrade of binanceClosed) {
        // Enforce strict 3-month recency window matching fetchTrades() and getInitialTrades()
        const tradeTime = bTrade.closedAt || bTrade.filledAt || bTrade.createdAt || 0;
        if (tradeTime < THREE_MONTHS_START) continue;

        const cleanSym = getCleanSymbol(bTrade.symbol);

        // CFX is consolidated into cfx_master_unified; skip importing individual CFX/CFXUSDT trades
        if (cleanSym === 'CFX' || cleanSym === 'CFXUSDT' || cleanSym.includes('CFX')) continue;

        const docId = `binance_closed_${bTrade.binanceOrderId || `${cleanSym}_${bTrade.closedAt}`}`;
        if (REMOVED_TRADE_IDS.has(docId) || deletedIds.includes(docId)) continue;

        // 1. Check if an ACTIVE short-term trade exists in the app that has now legitimately closed on Binance
        const matchingActiveIndex = tradesRef.current.findIndex(t => {
          if (isTradeClosed(t)) return false;
          if (!isSameSymbol(t.symbol, cleanSym)) return false;
          if (isAlphaTradeOrSymbol(t)) return false;
          if (t.type === 'HOLDING') return false;
          // Protect manually reopened trades from being auto-closed by historical Binance sells
          if (t.notes?.includes('reopened') || t.notes?.includes('Reopened')) return false;
          // The closed trade MUST have closed strictly after this active trade was opened
          if ((bTrade.closedAt || 0) <= (t.filledAt || t.createdAt || 0) + 60000) return false;
          // If both have binanceOrderId, they must match
          if (t.binanceOrderId && bTrade.binanceOrderId && String(t.binanceOrderId) !== String(bTrade.binanceOrderId)) return false;
          return true;
        });

        if (matchingActiveIndex !== -1) {
          const activeTrade = tradesRef.current[matchingActiveIndex];
          if (activeTrade.id) {
            const activeCoins = activeTrade.positionSizeCoins || 0;
            const soldQty = bTrade.positionSizeCoins || 0;
            const spotHolding = spotPositionsRef.current.find(p => isSameSymbol(p.symbol, cleanSym) && !p.isPendingOrder);
            const stillHoldsSpot = Boolean(spotHolding && (spotHolding.positionAmt > 0.0001 || (spotHolding.usdValue || 0) >= 1.50));
            // Institutional Partial Exit Check: If user sold only a portion (e.g., 50% ARB) or still holds spot coins on Binance, keep trade active with reduced size!
            const isPartialClose = stillHoldsSpot || (activeCoins > 0 && (soldQty < activeCoins * 0.95));

            if (isPartialClose) {
              const remainingCoins = (stillHoldsSpot && spotHolding && spotHolding.positionAmt > 0.0001)
                ? spotHolding.positionAmt
                : Math.max(0, activeCoins - soldQty);
              const initialCoins = (activeTrade as any).initialPositionCoins || activeCoins;
              const totalInitialCost = activeTrade.totalBuyUsd || (initialCoins * (activeTrade.entryPrice || 0));
              const retPct = activeTrade.entryPrice > 0 ? (((bTrade.exitPrice - activeTrade.entryPrice) / activeTrade.entryPrice) * 100).toFixed(1) : '0.0';
              const isProf = (bTrade.realizedProfitUsd || 0) >= 0;
              const pnlSign = isProf ? '+' : '-';
              const pnlVal = Math.abs(bTrade.realizedProfitUsd || 0).toFixed(2);
              const tagLabel = isProf ? '🎯 Profit Banked' : '✂️ Loss Cut';
              const noteLine = `${tagLabel}: ${pnlSign}$${pnlVal} (@ $${formatPrice(bTrade.exitPrice)} · ${soldQty.toLocaleString(undefined, { maximumFractionDigits: 4 })} coins · ${retPct}%)`;
              const existingNotes = activeTrade.notes || '';
              const newNotes = existingNotes.includes(noteLine) ? existingNotes : (existingNotes ? `${existingNotes}\n${noteLine}` : noteLine);

              const updatePayload: any = {
                status: 'PARTIAL_EXIT',
                initialPositionCoins: initialCoins,
                positionSizeCoins: initialCoins,
                remainingCoins: remainingCoins,
                totalBuyUsd: totalInitialCost,
                positionSize: totalInitialCost,
                soldCoins: (activeTrade.soldCoins || 0) + soldQty,
                updatedAt: Date.now(),
                notes: newNotes
              };

              await updateDoc(doc(db, 'trades', activeTrade.id), updatePayload);
              tradesRef.current[matchingActiveIndex] = { ...activeTrade, ...updatePayload };
              hadChanges = true;
              continue;
            } else {
              // Full exit: Entire position closed on Binance
              const fullInitialCoins = (activeTrade as any).initialPositionCoins || bTrade.positionSizeCoins || activeCoins;
              const fullInitialCost = activeTrade.totalBuyUsd || bTrade.totalBuyUsd || (fullInitialCoins * (activeTrade.entryPrice || bTrade.entryPrice || 0));
              const updatePayload: any = {
                status: 'CLOSED_MANUAL',
                entryPrice: bTrade.entryPrice || activeTrade.entryPrice,
                exitPrice: bTrade.exitPrice,
                positionSizeCoins: fullInitialCoins,
                totalBuyUsd: fullInitialCost,
                positionSize: fullInitialCost,
                totalSellUsd: bTrade.totalSellUsd,
                realizedProfitUsd: bTrade.realizedProfitUsd,
                feeUsd: bTrade.feeUsd,
                sellFeeUsd: bTrade.sellFeeUsd || bTrade.feeUsd,
                buyFeeUsd: bTrade.buyFeeUsd || 0,
                totalFeesUsd: bTrade.totalFeesUsd || bTrade.feeUsd,
                closedAt: bTrade.closedAt,
                soldCoins: bTrade.soldCoins || (soldQty > 0 ? soldQty : fullInitialCoins),
                updatedAt: Date.now(),
                notes: bTrade.notes || (activeTrade.notes ? `${activeTrade.notes}\n` : '') + `Auto-closed from Binance Spot trade history (Order #${bTrade.binanceOrderId || ''})`
              };
              if (bTrade.binanceOrderId && !activeTrade.binanceOrderId) {
                updatePayload.binanceOrderId = String(bTrade.binanceOrderId);
              }
              if (bTrade.idempotencyKey) {
                updatePayload.idempotencyKey = bTrade.idempotencyKey;
              }
              if (Array.isArray(bTrade.openBuyLots) && bTrade.openBuyLots.length > 0) {
                updatePayload.openBuyLots = bTrade.openBuyLots;
              }
              if (Array.isArray(bTrade.ledgerMatches) && bTrade.ledgerMatches.length > 0) {
                updatePayload.ledgerMatches = bTrade.ledgerMatches;
              }
              if (bTrade.fifoSummary) updatePayload.fifoSummary = bTrade.fifoSummary;
              if (bTrade.wacSummary) updatePayload.wacSummary = bTrade.wacSummary;
              if (Array.isArray(bTrade.wacExits) && bTrade.wacExits.length > 0) updatePayload.wacExits = bTrade.wacExits;
              await updateDoc(doc(db, 'trades', activeTrade.id), updatePayload);
              tradesRef.current[matchingActiveIndex] = { ...activeTrade, ...updatePayload };
              alreadySyncedIds.add(docId);
              importedCount++;
              hadChanges = true;
              continue;
            }
          }
        }

        // 2. Find if this trade already exists in our local list among CLOSED trades ONLY
        const existingIndex = tradesRef.current.findIndex(t => {
          if (t.id === docId) return true;
          if (!isTradeClosed(t)) return false;
          if (bTrade.idempotencyKey && t.idempotencyKey && t.idempotencyKey === bTrade.idempotencyKey) {
            return true;
          }
          if (bTrade.binanceOrderId && t.binanceOrderId && String(t.binanceOrderId) === String(bTrade.binanceOrderId)) {
            return true;
          }
          if (isSameSymbol(t.symbol, cleanSym)) {
            const hasOrderInBuyLots = bTrade.binanceOrderId && Array.isArray(t.openBuyLots) && t.openBuyLots.some((l: any) => String(l.orderId) === String(bTrade.binanceOrderId));
            const hasOrderInMatches = bTrade.binanceOrderId && Array.isArray(t.ledgerMatches) && t.ledgerMatches.some((m: any) => String(m.buyOrderId) === String(bTrade.binanceOrderId));
            if (hasOrderInBuyLots || hasOrderInMatches) return true;

            if (bTrade.binanceOrderId && t.binanceOrderId && String(bTrade.binanceOrderId) !== String(t.binanceOrderId)) {
              // Two closed trades with distinct binanceOrderIds are separate round-trip trades unless they closed at the same time (< 3 min)
              const isSameExit = t.closedAt && bTrade.closedAt && Math.abs(t.closedAt - bTrade.closedAt) < 180000;
              return Boolean(isSameExit);
            }

            const closeTimeMatch = t.closedAt && bTrade.closedAt && Math.abs(t.closedAt - bTrade.closedAt) < 86400000;
            const openTimeMatch = t.createdAt && bTrade.createdAt && Math.abs(t.createdAt - bTrade.createdAt) < 86400000;
            if (closeTimeMatch || openTimeMatch) return true;
          }
          return false;
        });

        if (existingIndex !== -1) {
          // STRICT IMMUTABILITY FOR CLOSED TRADES:
          // Once a trade is closed and stored in Firestore, its historical stats (realizedProfitUsd,
          // exitPrice, entryPrice, positionSizeCoins, closedAt) are 100% immutable and must NEVER
          // be overwritten or recalculated on reload or background sync.
          alreadySyncedIds.add(docId);
          continue;
        } else {
          // Skip if already synced previously in this browser, or if it is a historical fill prior to Oct 25, 2026
          const HISTORICAL_CUTOFF = 1792860000000;
          if (alreadySyncedIds.has(docId) || tradeTime <= HISTORICAL_CUTOFF) {
            alreadySyncedIds.add(docId);
            continue;
          }

          // Missing newly closed trade - import from Binance using deterministic ID
          const newTradeDoc: any = {
            id: docId,
            userId: uid,
            symbol: cleanSym,
            portfolioSize: baseCapital || 10000,
            riskPercent: 1,
            entryPrice: bTrade.entryPrice,
            stopLoss: 0,
            riskAmount: 0,
            positionSizeCoins: bTrade.positionSizeCoins,
            soldCoins: bTrade.soldCoins || bTrade.positionSizeCoins,
            totalBuyUsd: bTrade.totalBuyUsd,
            status: 'CLOSED_MANUAL',
            market: 'SPOT',
            type: 'TRADE',
            exitPrice: bTrade.exitPrice,
            totalSellUsd: bTrade.totalSellUsd,
            realizedProfitUsd: bTrade.realizedProfitUsd,
            feeUsd: bTrade.feeUsd,
            buyFeeUsd: bTrade.buyFeeUsd || 0,
            sellFeeUsd: bTrade.sellFeeUsd || bTrade.feeUsd,
            totalFeesUsd: bTrade.totalFeesUsd || bTrade.feeUsd,
            createdAt: bTrade.createdAt,
            filledAt: bTrade.filledAt,
            closedAt: bTrade.closedAt,
            notes: bTrade.notes,
            binanceOrderId: bTrade.binanceOrderId,
            ...(bTrade.binanceTradeId ? { binanceTradeId: bTrade.binanceTradeId } : {}),
            ...(bTrade.idempotencyKey ? { idempotencyKey: bTrade.idempotencyKey } : {}),
            ...(Array.isArray(bTrade.ledgerMatches) && bTrade.ledgerMatches.length > 0 ? { ledgerMatches: bTrade.ledgerMatches } : {}),
            ...(bTrade.fifoSummary ? { fifoSummary: bTrade.fifoSummary } : {}),
            ...(bTrade.wacSummary ? { wacSummary: bTrade.wacSummary } : {}),
            ...(Array.isArray(bTrade.wacExits) && bTrade.wacExits.length > 0 ? { wacExits: bTrade.wacExits } : {})
          };

          await setDoc(doc(db, 'trades', docId), newTradeDoc, { merge: true });
          tradesRef.current = normalizeAndConsolidateTrades([newTradeDoc, ...tradesRef.current], uid, baseCapital || 2595);
          alreadySyncedIds.add(docId);
          importedCount++;
          hadChanges = true;
        }
      }

      try {
        localStorage.setItem('trade_sizer_synced_closed_ids', JSON.stringify(Array.from(alreadySyncedIds).slice(-500)));
      } catch {}

      if (hadChanges) {
        const deduped = normalizeAndConsolidateTrades(tradesRef.current, uid, baseCapital || 2595);
        tradesRef.current = deduped;
        setTrades(deduped);
      }

      if (importedCount > 0) {
        try {
          localStorage.setItem('trade_sizer_cached_trades', JSON.stringify(tradesRef.current));
        } catch {}
      }

      return importedCount;
    } catch (e) {
      console.warn("Error auto-syncing closed trades from Binance:", e);
      return 0;
    } finally {
      isSyncingClosedRef.current = false;
    }
  }, [baseCapital]);

  // Fetch trades
  const fetchTrades = () => {
    const uid = getEffectiveUid();
    if (!uid) return null;
    const q = query(
      collection(db, 'trades'),
      where('userId', '==', uid),
      orderBy('createdAt', 'desc')
    );
    return onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Trade));
      const finalTrades = normalizeAndConsolidateTrades(data, uid, baseCapital || 2595);

      // Valid trades loaded
      setTrades(finalTrades);
      tradesRef.current = finalTrades;
      tradesLoadedRef.current = true;
      setLoading(false);
      setIsRefreshing(false);
      try {
        localStorage.setItem('trade_sizer_cached_trades', JSON.stringify(finalTrades));
      } catch {}
    }, (error) => {
      console.error("Error fetching trades with compound query, using fallback:", error);
      try {
        const fallbackQ = query(collection(db, 'trades'), where('userId', '==', uid));
        onSnapshot(fallbackQ, (snapshot) => {
          const fallbackRaw = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Trade));
          const fallbackData = normalizeAndConsolidateTrades(fallbackRaw, uid, baseCapital || 2595);
          setTrades(fallbackData);
          tradesRef.current = fallbackData;
          tradesLoadedRef.current = true;
          setLoading(false);
          try {
            localStorage.setItem('trade_sizer_cached_trades', JSON.stringify(fallbackData));
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
  }, [currentUserId]);

  const fetchBinanceBalance = useCallback(async () => {
    try {
      const res = await fetch('/api/exchange/balance');
      if (!res.ok) return null;
      const data = await res.json();
      if (data.status === 'success' && data.totalEquity !== undefined) {
        // If data.totalEquity is 0 or drops drastically due to network hiccup or rate limits, don't clobber a valid balance
        if (binanceBalance && binanceBalance.totalEquity > 10) {
          if (data.totalEquity <= 1) {
            return binanceBalance;
          }
          // If totalEquity dropped by more than 15% without a corresponding increase in USDT cash, ignore transient dip
          const isLargeDrop = data.totalEquity < binanceBalance.totalEquity * 0.85;
          const didNotLiquidate = (data.usdtTotal || 0) <= (binanceBalance.usdtTotal || 0) * 1.05 + 2;
          if (isLargeDrop && didNotLiquidate && (data.assets?.length || 0) >= (binanceBalance.assets?.length || 1)) {
            console.warn("Ignoring transient Binance balance dip during sync:", data.totalEquity, "vs current:", binanceBalance.totalEquity);
            return binanceBalance;
          }
        }

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
  }, [binanceBalance]);

  // Dedicated background sync scheduler - NEVER run inside onSnapshot listener!
  const hasInitialSyncedRef = useRef(false);
  const lastSyncAllTimeRef = useRef(0);

  const runBackgroundSync = useCallback(async (silent = true) => {
    const now = Date.now();
    if (now - lastSyncAllTimeRef.current < 15000) return; // 15-second throttle between automatic sync cycles
    lastSyncAllTimeRef.current = now;
    await reconcileAll();
    await syncBinanceSpotPositions();
    await syncClosedTradesFromBinance(silent);
  }, [reconcileAll, syncBinanceSpotPositions, syncClosedTradesFromBinance]);

  // Network connectivity listener: silently background-revalidate when coming back online
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      flushOfflineQueue();
      setWsTrigger(prev => prev + 1);
      fetchBinanceBalance();
      fetchBinancePkrRate();
      if (tradesLoadedRef.current) {
        lastSyncPositionsTimeRef.current = 0;
        syncBinanceSpotPositions();
        syncClosedTradesFromBinance(true);
      }
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [fetchBinanceBalance, fetchBinancePkrRate, syncBinanceSpotPositions, syncClosedTradesFromBinance]);

  // Lifecycle background sync & balance fetcher
  useEffect(() => {
    const uid = getEffectiveUid();
    if (!uid) return;

    // Run initial cold-start sync once after trades are first loaded
    const initialTimer = setTimeout(() => {
      if (!hasInitialSyncedRef.current && tradesLoadedRef.current) {
        hasInitialSyncedRef.current = true;
        runBackgroundSync(true);
      }
    }, 2000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && tradesLoadedRef.current) {
        runBackgroundSync(true);
        fetchBinanceBalance();
        setWsTrigger(prev => prev + 1);
      }
    };
    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);

    // Real-Time Server-Sent Events (SSE) Stream Subscription (sub-50ms UI updates from Binance User Data Stream)
    let sseSource: EventSource | null = null;
    try {
      sseSource = new EventSource('/api/exchange/events');
      sseSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'TRADE_STREAM_UPDATE') {
            // Instant sub-50ms UI state mutation without waiting for REST round-trip
            const { tradeId, status, fillPrice, fillQty, soldCoins, realizedProfitUsd, idempotencyKey, ledgerMatch } = payload;
            setTrades(prev => {
              const idx = prev.findIndex(t => t.id === tradeId);
              if (idx === -1) return prev;
              const next = [...prev];
              const existing = next[idx];
              const updatedMatches = ledgerMatch
                ? [...(existing.ledgerMatches || []).filter(m => m.sellFillId !== ledgerMatch.sellFillId), ledgerMatch]
                : existing.ledgerMatches;
              next[idx] = {
                ...existing,
                ...(status ? { status } : {}),
                ...(fillPrice ? { entryPrice: fillPrice } : {}),
                ...(fillQty ? { positionSizeCoins: fillQty } : {}),
                ...(soldCoins !== undefined ? { soldCoins } : {}),
                ...(realizedProfitUsd !== undefined ? { realizedProfitUsd } : {}),
                ...(idempotencyKey ? { idempotencyKey } : {}),
                ...(updatedMatches ? { ledgerMatches: updatedMatches } : {}),
                ...(status === 'CLOSED_MANUAL' ? { closedAt: Date.now() } : {})
              };
              tradesRef.current = next;
              return next;
            });
          } else if (payload.type === 'EXECUTION_REPORT' || payload.type === 'BALANCE_UPDATE') {
            console.log('[SSE] ⚡ Real-Time Binance Event Received:', payload.type);
            fetchBinanceBalance();
            if (tradesLoadedRef.current) {
              syncBinanceSpotPositions(true);
              syncClosedTradesFromBinance(true);
            }
          }
        } catch (_) {}
      };
      sseSource.onerror = () => {
        // EventSource will automatically retry in background
      };
    } catch (_) {}

    // Periodic 5-minute checksum validator (real-time fills are pushed via WebSocket User Data Stream)
    const interval = setInterval(() => {
      if (tradesLoadedRef.current) {
        runBackgroundSync(true);
      }
      fetchBinanceBalance();
    }, 5 * 60 * 1000);
    
    // Initial balance fetch on mount
    fetchBinanceBalance();

    return () => {
      clearTimeout(initialTimer);
      if (sseSource) {
        try { sseSource.close(); } catch (_) {}
      }
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
      clearInterval(interval);
    };
  }, [currentUserId, runBackgroundSync, fetchBinanceBalance, syncBinanceSpotPositions, syncClosedTradesFromBinance]);

  const refreshTrades = async () => {
    setIsRefreshing(true);
    setWsTrigger(prev => prev + 1);
    await Promise.all([reconcileAll(), syncBinanceSpotPositions(true), fetchBinanceBalance(), syncClosedTradesFromBinance(true)]);
    setTimeout(() => setIsRefreshing(false), 500);
  };

  // --- Custom Coin Price Alerts State & Real-Time Firestore Sync ---
  const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>(() => {
    try {
      const cached = localStorage.getItem('trade_sizer_custom_price_alerts');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });
  const priceAlertsRef = useRef<PriceAlert[]>(priceAlerts);
  priceAlertsRef.current = priceAlerts;

  useEffect(() => {
    try {
      const q = query(collection(db, 'price_alerts'));
      const unsub = onSnapshot(q, (snapshot) => {
        const currentUid = auth.currentUser?.uid || currentUserId || 'anonymous';
        const items: PriceAlert[] = [];
        snapshot.docs.forEach((d) => {
          const data = d.data() as PriceAlert;
          if (!data || !data.symbol || !data.targetPrice) return;
          if (!data.userId || data.userId === currentUid || data.userId === 'anonymous' || currentUid === 'anonymous') {
            items.push({
              ...data,
              id: d.id,
              symbol: getCleanTradingSymbol(data.symbol),
            });
          }
        });
        items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setPriceAlerts(items);
        try {
          localStorage.setItem('trade_sizer_custom_price_alerts', JSON.stringify(items));
        } catch {}
      }, () => {
        // Ignore offline/permission notice and retain localStorage state
      });
      return () => unsub();
    } catch {
      return;
    }
  }, [currentUserId]);

  const addPriceAlert = useCallback(async (alertData: Omit<PriceAlert, 'id' | 'userId' | 'createdAt'>): Promise<PriceAlert> => {
    const cleanSymbol = getCleanTradingSymbol(alertData.symbol);
    const id = `pa_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();
    const newAlert: PriceAlert = {
      id,
      userId: auth.currentUser?.uid || 'anonymous',
      symbol: cleanSymbol,
      targetPrice: Number(alertData.targetPrice),
      condition: alertData.condition,
      recurring: Boolean(alertData.recurring),
      isActive: alertData.isActive !== undefined ? alertData.isActive : true,
      note: alertData.note?.trim() || '',
      createdAt: now,
      updatedAt: now,
      lastTriggeredAt: null,
      triggerCount: 0,
      lastTriggeredPrice: null,
    };

    setPriceAlerts((prev) => {
      const next = [newAlert, ...prev];
      try {
        localStorage.setItem('trade_sizer_custom_price_alerts', JSON.stringify(next));
      } catch {}
      return next;
    });

    try {
      await setDoc(doc(db, 'price_alerts', id), newAlert, { merge: true });
    } catch (e) {
      console.warn('Could not persist price alert to Firestore:', e);
    }
    return newAlert;
  }, []);

  const updatePriceAlert = useCallback(async (alertId: string, updates: Partial<PriceAlert>): Promise<void> => {
    const now = Date.now();
    const payload = { ...updates, updatedAt: now };
    setPriceAlerts((prev) => {
      const next = prev.map((a) => (a.id === alertId ? { ...a, ...payload } : a));
      try {
        localStorage.setItem('trade_sizer_custom_price_alerts', JSON.stringify(next));
      } catch {}
      return next;
    });

    try {
      await updateDoc(doc(db, 'price_alerts', alertId), payload as any);
    } catch {
      try {
        const existing = priceAlertsRef.current.find((a) => a.id === alertId);
        if (existing) {
          await setDoc(doc(db, 'price_alerts', alertId), { ...existing, ...payload }, { merge: true });
        }
      } catch (_) {}
    }
  }, []);

  const deletePriceAlert = useCallback(async (alertId: string): Promise<void> => {
    setPriceAlerts((prev) => {
      const next = prev.filter((a) => a.id !== alertId);
      try {
        localStorage.setItem('trade_sizer_custom_price_alerts', JSON.stringify(next));
      } catch {}
      return next;
    });

    try {
      await deleteDoc(doc(db, 'price_alerts', alertId));
    } catch (_) {}
  }, []);

  const clearTriggeredPriceAlerts = useCallback(async (): Promise<void> => {
    const triggeredIds = priceAlertsRef.current.filter((a) => !a.isActive && (a.triggerCount || 0) > 0).map((a) => a.id);
    if (triggeredIds.length === 0) return;

    setPriceAlerts((prev) => {
      const next = prev.filter((a) => !triggeredIds.includes(a.id));
      try {
        localStorage.setItem('trade_sizer_custom_price_alerts', JSON.stringify(next));
      } catch {}
      return next;
    });

    await Promise.allSettled(
      triggeredIds.map((id) => deleteDoc(doc(db, 'price_alerts', id)))
    );
  }, []);

  // Live prices & auto close (Union of Open Trade Symbols + Custom Coin Alert Symbols)
  const activeSymbolsKey = useMemo(() => {
    const tradeSyms = trades
      .filter(t => !['CLOSED_MANUAL', 'HIT_SL', 'HIT_TP3'].includes(t.status || 'ACTIVE'))
      .map(t => t.symbol?.trim()?.toUpperCase());
    const alertSyms = priceAlerts
      .map(a => a.symbol?.trim()?.toUpperCase());
    return Array.from(new Set([...tradeSyms, ...alertSyms]))
      .filter(Boolean)
      .sort()
      .join(',');
  }, [trades, priceAlerts]);

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

        // CRITICAL: For trades running on Binance Spot, Binance exchange order books and trade history
        // are the absolute source of truth. NEVER auto-fill or auto-close a Binance trade via client ticks!
        if (isBinanceLinkedTrade(trade) || isBinanceLimitOrder(trade) || trade.binanceOrderId || trade.type === 'HOLDING') {
          continue;
        }

        // 1. LIMIT ORDERS (PENDING): Check if live market price hits entry!
        // When a limit order hits entry, it MUST transition to ACTIVE automatically.
        if (currentStatus === 'PENDING') {
          const isStopLimitBreakout = isBreakoutStopLimitTrade(trade, livePrice);
          const entryHit = isStopLimitBreakout
            ? (isLong ? livePrice >= trade.entryPrice : livePrice <= trade.entryPrice)
            : (isLong ? livePrice <= trade.entryPrice : livePrice >= trade.entryPrice);

          if (entryHit && trade.entryPrice > 0) {
            newStatus = 'ACTIVE';
            filledAt = Date.now();
          }
        } else {
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
      costBasisMethod,
      setCostBasisMethod,
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
      deleteTradeOptimistic,
      syncClosedTradesFromBinance,
      historyTimeHorizon,
      setHistoryTimeHorizon,
      // Custom Coin Price Alerts
      priceAlerts,
      addPriceAlert,
      updatePriceAlert,
      deletePriceAlert,
      clearTriggeredPriceAlerts,
    }}>
      {children}
    </TradeContext.Provider>
  );
};

