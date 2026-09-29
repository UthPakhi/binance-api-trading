import { Trade } from '../types';
import { calculateProfit, getTradeIsLong, getTradeEffectiveRisk, isBinanceLinkedTrade, isStopLossAtBreakeven } from './tradeUtils';

export interface ReconciliationUpdate {
  tradeId: string;
  symbol: string;
  status: string;
  realizedProfitUsd: number;
  filledAt?: number;
  closedAt?: number;
  reason: string;
}

/**
 * Determines the best Binance kline interval to span from startTime to now with <= 1000 candles.
 */
function getBestInterval(startTime: number): { interval: string; msPerCandle: number } {
  const durationMs = Math.max(0, Date.now() - startTime);
  const minutes = durationMs / (60 * 1000);

  if (minutes <= 950) {
    return { interval: '1m', msPerCandle: 60 * 1000 };
  } else if (minutes <= 950 * 5) {
    return { interval: '5m', msPerCandle: 5 * 60 * 1000 };
  } else if (minutes <= 950 * 15) {
    return { interval: '15m', msPerCandle: 15 * 60 * 1000 };
  } else {
    return { interval: '1h', msPerCandle: 60 * 60 * 1000 };
  }
}

/**
 * Reconciles a single trade against real Binance historical candlestick data.
 * This ensures that even if the app was closed, backgrounded, or phone was locked,
 * limit fills, stop-loss hits, and take-profit hits that occurred in the past are accurately caught.
 */
export async function reconcileTrade(trade: Trade): Promise<ReconciliationUpdate | null> {
  if (!trade.id || !trade.symbol || !trade.entryPrice) return null;

  const currentStatus = trade.status || 'ACTIVE';
  if (['CLOSED_MANUAL', 'HIT_SL', 'HIT_TP3', 'CLOSED_BREAK_EVEN', 'BREAK_EVEN'].includes(currentStatus)) {
    return null; // Already fully concluded
  }

  // CRITICAL: For trades running on Binance Spot, Binance exchange order books and trade history
  // are the absolute source of truth. NEVER auto-close an active or pending Binance trade via candlestick wicks!
  // If the user placed Stop Loss or Take Profit orders on Binance, Binance executes them and
  // syncBinanceSpotPositions() / handleSyncExecutions() will sync the actual executed order.
  if (isBinanceLinkedTrade(trade)) {
    return null;
  }

  const isLong = getTradeIsLong(trade);
  const startTime = currentStatus === 'PENDING' ? trade.createdAt : (trade.filledAt || trade.createdAt);
  const { interval } = getBestInterval(startTime);

  // Time when SL was last created or modified. Never check candles before this timestamp!
  // Otherwise moving SL to breakeven or trailing SL evaluates entry candles and falsely closes the trade!
  const slSetTime = trade.slUpdatedAt || trade.updatedAt || (trade.filledAt || trade.createdAt);

  try {
    const rawSym = trade.symbol.trim().toUpperCase();
    const sym = rawSym.endsWith('USDT') ? rawSym : `${rawSym}USDT`;
    const url = `/api/exchange/klines?symbol=${encodeURIComponent(sym)}&interval=${interval}&startTime=${startTime}&limit=1000`;
    const res = await fetch(url).catch(() => null);
    if (!res || !res.ok) {
      return null;
    }
    const data = await res.json().catch(() => null);
    const klines: any[] = data?.klines || [];
    if (!Array.isArray(klines) || klines.length === 0) return null;

    let status = currentStatus;
    let filledAt = trade.filledAt;
    let closedAt = trade.closedAt;
    let realized = trade.realizedProfitUsd || 0;
    let stateChanged = false;
    let changeReason = '';

    for (const k of klines) {
      const cTime = Number(k[0]);
      const high = parseFloat(k[2]);
      const low = parseFloat(k[3]);

      // 1. If currently PENDING, check if candle filled the limit order
      if (status === 'PENDING') {
        const orderFilled = isLong ? (low <= trade.entryPrice) : (high >= trade.entryPrice);
        if (orderFilled) {
          status = 'ACTIVE';
          filledAt = cTime;
          stateChanged = true;
          changeReason = `Limit order filled at ${new Date(cTime).toLocaleTimeString()}`;
        }
        // Always continue to next candle! A trade cannot fill entry and trigger stop loss on the same entry candle!
        continue;
      }

      // 2. If ACTIVE (or just filled in this candle), check Stop Loss and Take Profits for manual/paper trades
      if (status === 'ACTIVE' || status === 'HIT_TP1' || status === 'HIT_TP2') {
        // Priority 1: Check Stop Loss (ONLY on candles strictly opened after the stop loss was set/updated!)
        if (trade.stopLoss && trade.stopLoss > 0 && cTime > slSetTime) {
          const isAtBreakeven = isStopLossAtBreakeven(trade);
          // For a breakeven stop, require meaningful adverse price movement below entry (not a micro-tick spread touch)
          const stopLossHit = isLong 
            ? (isAtBreakeven ? low < trade.stopLoss * 0.998 : low <= trade.stopLoss)
            : (isAtBreakeven ? high > trade.stopLoss * 1.002 : high >= trade.stopLoss);

          if (stopLossHit) {
            status = isAtBreakeven ? 'CLOSED_BREAK_EVEN' : 'HIT_SL';
            realized = isAtBreakeven ? (trade.realizedProfitUsd || 0) : -(getTradeEffectiveRisk(trade));
            closedAt = cTime;
            stateChanged = true;
            changeReason = isAtBreakeven 
              ? `Breakeven Stop triggered at ${new Date(cTime).toLocaleTimeString()}`
              : `Stop Loss hit at ${new Date(cTime).toLocaleTimeString()}`;
            break; // Trade stopped out
          }
        }

        // Priority 2: Check TP3 (100% full exit)
        if (trade.takeProfit3) {
          const tp3Hit = isLong ? (high >= trade.takeProfit3) : (low <= trade.takeProfit3);
          if (tp3Hit) {
            status = 'HIT_TP3';
            realized = trade.totalProfitUsd || 0;
            closedAt = cTime;
            stateChanged = true;
            changeReason = `Take Profit 3 hit at ${new Date(cTime).toLocaleTimeString()}`;
            break; // Fully closed at TP3
          }
        }

        // Priority 3: Check TP2
        if (trade.takeProfit2 && !['HIT_TP3', 'HIT_TP2'].includes(status)) {
          const tp2Hit = isLong ? (high >= trade.takeProfit2) : (low <= trade.takeProfit2);
          if (tp2Hit) {
            status = 'HIT_TP2';
            realized = (trade.tp1Profit || 0) + calculateProfit(trade, trade.takeProfit2, trade.tp2Percent || 0);
            stateChanged = true;
            changeReason = `Take Profit 2 hit at ${new Date(cTime).toLocaleTimeString()}`;
          }
        }

        // Priority 4: Check TP1
        if (trade.takeProfit1 && !['HIT_TP3', 'HIT_TP2', 'HIT_TP1'].includes(status)) {
          const tp1Hit = isLong ? (high >= trade.takeProfit1) : (low <= trade.takeProfit1);
          if (tp1Hit) {
            status = 'HIT_TP1';
            realized = trade.tp1Profit || 0;
            stateChanged = true;
            changeReason = `Take Profit 1 hit at ${new Date(cTime).toLocaleTimeString()}`;
          }
        }
      }
    }

    if (stateChanged && status !== currentStatus) {
      return {
        tradeId: trade.id,
        symbol: trade.symbol,
        status,
        realizedProfitUsd: realized,
        filledAt,
        closedAt,
        reason: changeReason
      };
    }

    // If only filledAt changed for an active trade
    if (filledAt && filledAt !== trade.filledAt) {
      return {
        tradeId: trade.id,
        symbol: trade.symbol,
        status,
        realizedProfitUsd: realized,
        filledAt,
        closedAt,
        reason: changeReason || 'Fill timestamp synchronized'
      };
    }

    return null;
  } catch (err) {
    // Graceful fallback for non-standard / dex pairs without candlestick data
    return null;
  }
}
