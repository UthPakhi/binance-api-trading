import { Trade, BinanceBalanceInfo, PnlViewMode, FeeTierId, OfflineAction } from '../types';

const DB_NAME = 'trade_sizer_idb';
const DB_VERSION = 1;
const STORE_SNAPSHOT = 'portfolio_snapshot';
const STORE_TICKERS = 'ticker_cache';
const STORE_QUEUE = 'offline_queue';

const SNAPSHOT_KEY = 'last_authenticated_state';
const TICKER_KEY = 'live_tickers';
const QUEUE_KEY = 'pending_actions';

const LS_TICKER_CACHE_KEY = 'trade_sizer_cached_tickers';

export interface PersistedPortfolioSnapshot {
  uid?: string;
  trades: Trade[];
  binanceBalance: BinanceBalanceInfo | null;
  spotPositions?: any[];
  baseCapital: number;
  pkrRate: number;
  binancePkrRate: number | null;
  viewMode: PnlViewMode;
  historyTimeHorizon: string;
  feeTier: FeeTierId;
  customFeeRate: number;
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openOfflineDB(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_SNAPSHOT)) {
          db.createObjectStore(STORE_SNAPSHOT);
        }
        if (!db.objectStoreNames.contains(STORE_TICKERS)) {
          db.createObjectStore(STORE_TICKERS);
        }
        if (!db.objectStoreNames.contains(STORE_QUEUE)) {
          db.createObjectStore(STORE_QUEUE);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        resolve(null);
      };
      request.onblocked = () => {
        dbPromise = null;
        resolve(null);
      };
    } catch {
      dbPromise = null;
      resolve(null);
    }
  });

  return dbPromise;
}

async function idbGet<T>(storeName: string, key: string): Promise<T | null> {
  const db = await openOfflineDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbPut<T>(storeName: string, key: string, value: T): Promise<void> {
  const db = await openOfflineDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

// 1. Portfolio Snapshot Persistence (IndexedDB + fast synchronous fallback)
export async function savePortfolioSnapshotToIDB(
  partial: Partial<PersistedPortfolioSnapshot>
): Promise<void> {
  try {
    const existing = (await idbGet<PersistedPortfolioSnapshot>(STORE_SNAPSHOT, SNAPSHOT_KEY)) || {
      trades: [],
      binanceBalance: null,
      spotPositions: [],
      baseCapital: 2595,
      pkrRate: 283.89,
      binancePkrRate: null,
      viewMode: 'DOLLAR' as PnlViewMode,
      historyTimeHorizon: '3M',
      feeTier: 'BINANCE_STANDARD' as FeeTierId,
      customFeeRate: 0.001,
      updatedAt: Date.now(),
    };

    const merged: PersistedPortfolioSnapshot = {
      ...existing,
      ...partial,
      updatedAt: Date.now(),
    };

    await idbPut(STORE_SNAPSHOT, SNAPSHOT_KEY, merged);
  } catch {
    // Fail silently if IndexedDB quota or private browsing restricts writes
  }
}

export async function loadPortfolioSnapshotFromIDB(): Promise<PersistedPortfolioSnapshot | null> {
  return idbGet<PersistedPortfolioSnapshot>(STORE_SNAPSHOT, SNAPSHOT_KEY);
}

// 2. Live Ticker Price Cache Persistence (IndexedDB + synchronous localStorage mirror for 0ms mount)
export function getInitialTickerCacheSync(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LS_TICKER_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.prices) {
        return parsed.prices as Record<string, number>;
      }
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, number>;
      }
    }
  } catch {}
  return {};
}

export async function saveTickerCacheToIDB(prices: Record<string, number>): Promise<void> {
  if (!prices || Object.keys(prices).length === 0) return;
  try {
    const existing = await loadTickerCacheFromIDB();
    const merged = { ...(existing || {}), ...prices };
    const payload = { prices: merged, updatedAt: Date.now() };
    try {
      localStorage.setItem(LS_TICKER_CACHE_KEY, JSON.stringify(payload));
    } catch {}
    await idbPut(STORE_TICKERS, TICKER_KEY, payload);
  } catch {}
}

export async function loadTickerCacheFromIDB(): Promise<Record<string, number> | null> {
  const res = await idbGet<{ prices?: Record<string, number>; updatedAt?: number }>(
    STORE_TICKERS,
    TICKER_KEY
  );
  if (res && res.prices && typeof res.prices === 'object') {
    return res.prices;
  }
  return null;
}

// 3. Offline Mutation Queue Persistence in IndexedDB
export async function saveOfflineQueueToIDB(queue: OfflineAction[]): Promise<void> {
  await idbPut(STORE_QUEUE, QUEUE_KEY, queue);
}

export async function loadOfflineQueueFromIDB(): Promise<OfflineAction[] | null> {
  return idbGet<OfflineAction[]>(STORE_QUEUE, QUEUE_KEY);
}
