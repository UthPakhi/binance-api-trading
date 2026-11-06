import { Trade } from '../types';
import { calculateRemainingCoins, isAlphaTradeOrSymbol, isLimitOrderTrade, isSameSymbol } from './tradeUtils';

export interface BinancePositionItem {
  symbol: string;
  positionAmt: number;
  entryPrice: number;
  feeUsd: number;
  isLong?: boolean;
  unRealizedProfit?: number;
  currentPrice?: number;
  usdValue?: number;
  isPendingOrder?: boolean;
  binanceOrderId?: string;
  clientOrderId?: string;
  orderTime?: number;
}

export interface UnassignedBalanceAnalysis {
  symbol: string;
  totalBinanceCoins: number;
  trackedCoins: number;
  unassignedCoins: number;
  unassignedUsdValue: number;
  existingTrades: Trade[];
  hasUnassigned: boolean;
  canDCA: boolean;
  canCreateNewTrade: boolean;
}

export interface TradeFill {
  tradeId?: number | string;
  orderId: number | string;
  symbol: string;
  price: number;
  qty: number;
  quoteQty: number;
  commission: number;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
  feeUsd: number;
}

export interface ExecutionBatch {
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  avgPrice: number;
  totalQty: number;
  totalUsd: number;
  totalFeeUsd: number;
  time: number;
  fillCount: number;
}

/**
 * Calculates unassigned wallet balance by comparing total balance on Binance
 * with the sum of coins already assigned to ACTIVE/PENDING trades or holdings in the app.
 */
export function calculateUnassignedBalance(
  position: BinancePositionItem,
  activeTrades: Trade[] = []
): UnassignedBalanceAnalysis {
  const symbol = position.symbol.toUpperCase();
  const totalBinanceCoins = Math.abs(position.positionAmt || 0);
  const currentPrice = position.currentPrice || position.entryPrice || 0;

  // Filter active trades for this exact symbol.
  // For spot wallet positions (!position.isPendingOrder), match only active/holding trades with real wallet coins.
  // For pending limit orders (position.isPendingOrder), match only PENDING limit order trades.
  const existingTrades = activeTrades.filter(t => {
    if (!isSameSymbol(t.symbol, symbol)) return false;
    if (position.isPendingOrder) {
      return t.status === 'PENDING';
    } else {
      return t.status === 'ACTIVE' || t.status === 'HIT_TP1' || t.status === 'HIT_TP2' || t.status === 'PARTIAL_EXIT';
    }
  });

  const trackedCoins = existingTrades.reduce((sum, t) => {
    return sum + calculateRemainingCoins(t);
  }, 0);

  // Remaining unallocated balance (with floating point tolerance)
  const diff = totalBinanceCoins - trackedCoins;
  const unassignedCoins = diff > 0.00001 ? diff : 0;
  const unassignedUsdValue = unassignedCoins * currentPrice;

  return {
    symbol,
    totalBinanceCoins,
    trackedCoins,
    unassignedCoins,
    unassignedUsdValue,
    existingTrades,
    hasUnassigned: unassignedCoins > 0.00001,
    canDCA: existingTrades.length > 0 && unassignedCoins > 0.00001,
    canCreateNewTrade: true // Multi-trade support: user can always create an additional distinct trade
  };
}

/**
 * Groups raw Binance /api/v3/myTrades fills into distinct order execution batches.
 */
export function groupFillsByOrder(fills: TradeFill[]): ExecutionBatch[] {
  const orderMap = new Map<string, ExecutionBatch>();

  for (const fill of fills) {
    const key = String(fill.orderId);
    const existing = orderMap.get(key);

    if (!existing) {
      orderMap.set(key, {
        orderId: key,
        symbol: fill.symbol,
        side: fill.isBuyer ? 'BUY' : 'SELL',
        avgPrice: fill.price,
        totalQty: fill.qty,
        totalUsd: fill.price * fill.qty,
        totalFeeUsd: fill.feeUsd || 0,
        time: fill.time,
        fillCount: 1
      });
    } else {
      const newTotalQty = existing.totalQty + fill.qty;
      const newTotalUsd = existing.totalUsd + (fill.price * fill.qty);
      existing.avgPrice = newTotalQty > 0 ? newTotalUsd / newTotalQty : existing.avgPrice;
      existing.totalQty = newTotalQty;
      existing.totalUsd = newTotalUsd;
      existing.totalFeeUsd += (fill.feeUsd || 0);
      existing.time = Math.max(existing.time, fill.time);
      existing.fillCount += 1;
    }
  }

  return Array.from(orderMap.values()).sort((a, b) => b.time - a.time);
}

/**
 * Generates an idempotent, unique fingerprint for a trade keyed directly to Binance's unique orderId and tradeId.
 */
export function generateTradeFingerprint(trade: Partial<Trade>): string {
  if (trade.idempotencyKey) {
    return trade.idempotencyKey;
  }
  const sym = (trade.symbol || '').toUpperCase().trim();
  if (trade.binanceOrderId && trade.binanceTradeId) {
    return `${sym}_${trade.binanceOrderId}_${trade.binanceTradeId}`;
  }
  if (trade.binanceOrderId) {
    return `binance_${trade.binanceOrderId}`;
  }
  const entry = (trade.entryPrice || 0).toFixed(8);
  const size = (trade.positionSizeCoins || 0).toFixed(4);
  const type = trade.type || 'TRADE';
  const status = trade.status || 'ACTIVE';
  return `${sym}_${entry}_${size}_${type}_${status}`;
}

/**
 * Calculates dollar-cost averaging (DCA) when merging new coins into an existing trade.
 */
export function calculateMergedDCA(
  existingTrade: Trade,
  addedCoins: number,
  addedPrice: number,
  addedFeeUsd: number = 0
): {
  newPositionSizeCoins: number;
  newEntryPrice: number;
  newTotalBuyUsd: number;
  newFeeUsd: number;
} {
  const currentCoins = existingTrade.positionSizeCoins || 0;
  const currentEntry = existingTrade.entryPrice || 0;
  const currentTotalUsd = currentCoins * currentEntry;

  const additionalCost = addedCoins * addedPrice;
  const newPositionSizeCoins = currentCoins + addedCoins;
  const newTotalBuyUsd = currentTotalUsd + additionalCost;
  const newEntryPrice = newPositionSizeCoins > 0 ? newTotalBuyUsd / newPositionSizeCoins : currentEntry;
  const newFeeUsd = (existingTrade.feeUsd || 0) + addedFeeUsd;

  return {
    newPositionSizeCoins,
    newEntryPrice,
    newTotalBuyUsd,
    newFeeUsd
  };
}

/**
 * Computes exact mathematical Realized PnL:
 * (exitPrice - entryPrice) * size - totalFees (Long)
 * (entryPrice - exitPrice) * size - totalFees (Short)
 */
export function computeRealizedPnL(
  entryPrice: number,
  exitPrice: number,
  positionSizeCoins: number,
  feeUsd: number = 0,
  isLong: boolean = true
): number {
  if (positionSizeCoins <= 0 || entryPrice <= 0 || exitPrice <= 0) return 0;
  const gross = isLong 
    ? (exitPrice - entryPrice) * positionSizeCoins 
    : (entryPrice - exitPrice) * positionSizeCoins;
  const net = gross - (feeUsd || 0);
  return Math.round(net * 100) / 100; // Exact to the cent
}

/**
 * Validates whether an Alpha token should be guarded against Spot auto-sync closures.
 */
export function shouldProtectFromSpotSync(trade: Partial<Trade>): boolean {
  if (trade.market === 'ALPHA' || trade.isAlpha) return true;
  if (trade.type === 'HOLDING') return true; // Long-term holdings never auto-closed by spot balance sync
  if (isAlphaTradeOrSymbol(trade)) return true;
  return false;
}
