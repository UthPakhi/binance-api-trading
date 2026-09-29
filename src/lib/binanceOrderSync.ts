import { Trade } from '../types';
import { db } from './firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { isTradeClosed, getTradeIsLong, formatPrice } from './tradeUtils';

export interface BinanceOrderSyncResult {
  updatePayload: Partial<Trade>;
  hasChanges: boolean;
  syncSummary: string;
}

/**
 * Parses Binance open orders (Limit TPs and Stop SLs) and trade executions
 * into exact Trade fields (takeProfit1, takeProfit2, takeProfit3, percentages, stopLoss, status, risk).
 */
export function parseBinanceOpenOrdersForTrade(
  trade: Trade,
  openOrders: any[],
  analysisData?: any
): BinanceOrderSyncResult {
  const isLong = getTradeIsLong(trade);
  const exitSide = isLong ? 'SELL' : 'BUY';
  const exitOrders = (openOrders || []).filter((o: any) => o.side === exitSide);

  // Filter limit orders (Take Profits)
  const limitOrders = exitOrders.filter((o: any) => 
    (o.type === 'LIMIT' || o.type === 'LIMIT_MAKER' || o.type === 'TAKE_PROFIT_LIMIT') &&
    !o.type.includes('STOP') &&
    parseFloat(o.stopPrice || '0') === 0
  );

  // Filter stop orders (Stop Losses)
  const stopOrders = exitOrders.filter((o: any) => 
    o.type.includes('STOP') || parseFloat(o.stopPrice || '0') > 0
  );

  // Group limit orders by price
  const priceMap = new Map<number, number>();
  limitOrders.forEach((o: any) => {
    const p = parseFloat(o.price);
    const q = parseFloat(o.origQty || o.qty || 0);
    if (p > 0 && q > 0) {
      const pKey = parseFloat(p.toFixed(8));
      priceMap.set(pKey, (priceMap.get(pKey) || 0) + q);
    }
  });

  const uniquePrices = Array.from(priceMap.keys()).sort((a, b) => isLong ? a - b : b - a);

  // Calculate base / initial coins
  const totalSold = analysisData?.totalSoldQty || trade.soldCoins || 0;
  const currentCoinsHeld = analysisData?.remainingQty !== undefined 
    ? analysisData.remainingQty 
    : (trade.positionSizeCoins || 0);
  const initialCoins = (analysisData?.openBuys?.totalQty && analysisData.openBuys.totalQty > 0)
    ? analysisData.openBuys.totalQty
    : ((totalSold + currentCoinsHeld) > 0 ? (totalSold + currentCoinsHeld) : (trade.positionSizeCoins || 1));

  const hasTp1AlreadyHit = Boolean(
    analysisData?.isPartialExit || 
    trade.status === 'HIT_TP1' || 
    trade.status === 'PARTIAL_EXIT' || 
    (totalSold > 0.0001 && currentCoinsHeld > 0.0001)
  );

  const updatePayload: Partial<Trade> = {};
  const syncParts: string[] = [];

  // Update Execution stats if analysisData provided
  if (analysisData) {
    if (analysisData.isFullyClosed) {
      updatePayload.status = 'CLOSED_MANUAL';
      updatePayload.soldCoins = analysisData.totalSoldQty || trade.positionSizeCoins;
      updatePayload.exitPrice = analysisData.avgExitPrice;
      updatePayload.realizedProfitUsd = analysisData.realizedPnL;
      updatePayload.closedAt = analysisData.latestSellTime || trade.filledAt || trade.createdAt;
      return { updatePayload, hasChanges: true, syncSummary: 'Position fully closed on Binance' };
    }

    if (hasTp1AlreadyHit) {
      updatePayload.status = 'HIT_TP1';
      updatePayload.closedAt = null;
      updatePayload.soldCoins = totalSold;
      const existingNotified = Array.isArray(trade.notifiedMilestones) ? trade.notifiedMilestones : [];
      if (!existingNotified.includes('TP1')) {
        updatePayload.notifiedMilestones = [...existingNotified, 'TP1'];
      }
      if (initialCoins > 0 && initialCoins > totalSold) {
        updatePayload.positionSizeCoins = initialCoins;
      }
      if (analysisData.realizedPnL !== undefined) {
        updatePayload.realizedProfitUsd = analysisData.realizedPnL;
      }
      if (analysisData.avgExitPrice > 0) {
        updatePayload.takeProfit1 = analysisData.avgExitPrice;
      }
      if (analysisData.soldPercent > 0) {
        updatePayload.tp1Percent = analysisData.soldPercent;
      }
      syncParts.push(`TP1 Hit: ${updatePayload.tp1Percent || 50}% sold @ $${formatPrice(updatePayload.takeProfit1 || 0)} (+$${(updatePayload.realizedProfitUsd || 0).toFixed(2)})`);
    } else {
      if (trade.closedAt) {
        updatePayload.closedAt = null;
      }
    }

    if (analysisData.openBuys?.avgEntryPrice > 0) {
      updatePayload.entryPrice = analysisData.openBuys.avgEntryPrice;
      if (analysisData.openBuys.totalCost > 0) {
        updatePayload.totalBuyUsd = analysisData.openBuys.totalCost;
      }
    }
  }

  // TARGETS MAPPING:
  if (hasTp1AlreadyHit) {
    // TP1 was already executed on Binance.
    // Any open limit sell orders on Binance are the remaining targets (TP2, TP3)
    if (!updatePayload.takeProfit1 && trade.takeProfit1) {
      updatePayload.takeProfit1 = trade.takeProfit1;
      updatePayload.tp1Percent = trade.tp1Percent || 50;
    }

    if (uniquePrices.length >= 2) {
      updatePayload.takeProfit2 = uniquePrices[0];
      const q2 = priceMap.get(uniquePrices[0]) || 0;
      updatePayload.tp2Percent = Math.max(1, Math.round((q2 / initialCoins) * 100));

      updatePayload.takeProfit3 = uniquePrices[1];
      const q3 = priceMap.get(uniquePrices[1]) || 0;
      updatePayload.tp3Percent = Math.max(1, Math.round((q3 / initialCoins) * 100));
      syncParts.push(`Targets from Binance: TP2 $${formatPrice(uniquePrices[0])} (${updatePayload.tp2Percent}%), TP3 $${formatPrice(uniquePrices[1])} (${updatePayload.tp3Percent}%)`);
    } else if (uniquePrices.length === 1) {
      updatePayload.takeProfit2 = uniquePrices[0];
      const q2 = priceMap.get(uniquePrices[0]) || 0;
      updatePayload.tp2Percent = Math.max(1, Math.round((q2 / initialCoins) * 100));
      updatePayload.takeProfit3 = null;
      updatePayload.tp3Percent = null;
      syncParts.push(`Target from Binance: TP2 $${formatPrice(uniquePrices[0])} (${updatePayload.tp2Percent}%)`);
    } else {
      // 0 open TP orders on Binance
      if (trade.takeProfit2 !== null || trade.takeProfit3 !== null) {
        updatePayload.takeProfit2 = null;
        updatePayload.tp2Percent = null;
        updatePayload.takeProfit3 = null;
        updatePayload.tp3Percent = null;
        syncParts.push('Remaining TP orders cleared on Binance');
      }
    }
  } else {
    // Fresh trade (TP1 has not hit yet)
    if (uniquePrices.length >= 3) {
      updatePayload.takeProfit1 = uniquePrices[0];
      updatePayload.tp1Percent = Math.max(1, Math.round(((priceMap.get(uniquePrices[0]) || 0) / initialCoins) * 100));
      updatePayload.takeProfit2 = uniquePrices[1];
      updatePayload.tp2Percent = Math.max(1, Math.round(((priceMap.get(uniquePrices[1]) || 0) / initialCoins) * 100));
      updatePayload.takeProfit3 = uniquePrices[2];
      updatePayload.tp3Percent = Math.max(1, Math.round(((priceMap.get(uniquePrices[2]) || 0) / initialCoins) * 100));
      syncParts.push(`Synced 3 TPs: $${formatPrice(uniquePrices[0])}, $${formatPrice(uniquePrices[1])}, $${formatPrice(uniquePrices[2])}`);
    } else if (uniquePrices.length === 2) {
      updatePayload.takeProfit1 = uniquePrices[0];
      updatePayload.tp1Percent = Math.max(1, Math.round(((priceMap.get(uniquePrices[0]) || 0) / initialCoins) * 100));
      updatePayload.takeProfit2 = uniquePrices[1];
      updatePayload.tp2Percent = Math.max(1, Math.round(((priceMap.get(uniquePrices[1]) || 0) / initialCoins) * 100));
      updatePayload.takeProfit3 = null;
      updatePayload.tp3Percent = null;
      syncParts.push(`Synced 2 TPs: $${formatPrice(uniquePrices[0])}, $${formatPrice(uniquePrices[1])}`);
    } else if (uniquePrices.length === 1) {
      updatePayload.takeProfit1 = uniquePrices[0];
      updatePayload.tp1Percent = 100;
      updatePayload.takeProfit2 = null;
      updatePayload.tp2Percent = null;
      updatePayload.takeProfit3 = null;
      updatePayload.tp3Percent = null;
      syncParts.push(`Synced TP1: $${formatPrice(uniquePrices[0])} (100%)`);
    } else if (limitOrders.length === 0 && (trade.takeProfit1 || trade.takeProfit2 || trade.takeProfit3)) {
      updatePayload.takeProfit1 = null;
      updatePayload.tp1Percent = null;
      updatePayload.takeProfit2 = null;
      updatePayload.tp2Percent = null;
      updatePayload.takeProfit3 = null;
      updatePayload.tp3Percent = null;
      syncParts.push('TP orders canceled on Binance');
    }
  }

  // STOP LOSS MAPPING:
  if (stopOrders.length > 0) {
    const slPrice = parseFloat(stopOrders[0].stopPrice || stopOrders[0].price);
    if (slPrice > 0) {
      updatePayload.stopLoss = slPrice;
      const entry = updatePayload.entryPrice || trade.entryPrice || (analysisData?.openBuys?.avgEntryPrice) || 0;
      const isAtBreakeven = entry > 0 && (
        isLong ? slPrice >= (entry * 0.998) : slPrice <= (entry * 1.002)
      );

      if (isAtBreakeven) {
        updatePayload.riskAmount = 0;
        updatePayload.riskPercent = 0;
        syncParts.push(`SL: $${formatPrice(slPrice)} (Breakeven - $0.00 Risk)`);
      } else if (entry > 0 && currentCoinsHeld > 0) {
        const rAmt = currentCoinsHeld * Math.abs(entry - slPrice);
        updatePayload.riskAmount = rAmt;
        const pSize = trade.portfolioSize || 0;
        if (pSize > 0) {
          updatePayload.riskPercent = parseFloat(((rAmt / pSize) * 100).toFixed(2));
        }
        syncParts.push(`SL: $${formatPrice(slPrice)}`);
      }
    }
  }

  // Check if any actual field changed compared to current trade
  let hasChanges = false;
  for (const [key, val] of Object.entries(updatePayload)) {
    const currentVal = (trade as any)[key];
    if (val !== undefined && val !== currentVal) {
      if (typeof val === 'number' && typeof currentVal === 'number') {
        if (Math.abs(val - currentVal) > 0.00001) {
          hasChanges = true;
          break;
        }
      } else {
        hasChanges = true;
        break;
      }
    }
  }

  return {
    updatePayload,
    hasChanges,
    syncSummary: syncParts.join(' | ')
  };
}

/**
 * Fetches analysis and open orders for a specific trade from Binance,
 * and updates Firestore document if any data changed.
 */
export async function syncTradeWithBinance(
  trade: Trade,
  preloadedOrders?: any[]
): Promise<{ updated: boolean; summary: string }> {
  if (!trade.id || !trade.symbol) {
    return { updated: false, summary: 'Invalid trade' };
  }

  const rawSym = trade.symbol.trim().toUpperCase();
  const cleanSymbol = rawSym.endsWith('USDT') ? rawSym : `${rawSym}USDT`;

  try {
    const startTime = trade.filledAt || trade.createdAt;
    const orderIdParam = trade.binanceOrderId ? `&binanceOrderId=${encodeURIComponent(trade.binanceOrderId.toString())}` : '';
    const clientOrderIdParam = trade.clientOrderId ? `&clientOrderId=${encodeURIComponent(trade.clientOrderId)}` : '';
    const url = `/api/exchange/analyze-trade?symbol=${encodeURIComponent(cleanSymbol)}&tradeStartTime=${startTime || ''}&tradeEntryPrice=${trade.entryPrice || ''}&tradeCoins=${trade.positionSizeCoins || ''}${orderIdParam}${clientOrderIdParam}`;

    const res = await fetch(url);
    if (!res.ok) {
      return { updated: false, summary: 'API call failed' };
    }
    const data = await res.json();
    if (data.status !== 'success') {
      return { updated: false, summary: data.message || 'Analysis failed' };
    }

    // Orders from analysis endpoint, or preloaded orders, or fallback fetch
    let openOrders = data.openOrders;
    if (!Array.isArray(openOrders) || openOrders.length === 0) {
      if (Array.isArray(preloadedOrders) && preloadedOrders.length > 0) {
        openOrders = preloadedOrders.filter((o: any) => o.symbol === cleanSymbol || o.symbol === rawSym);
      } else {
        const ordRes = await fetch(`/api/exchange/openOrders?symbol=${encodeURIComponent(cleanSymbol)}`);
        if (ordRes.ok) {
          const ordData = await ordRes.json();
          if (ordData.status === 'success' && Array.isArray(ordData.orders)) {
            openOrders = ordData.orders;
          }
        }
      }
    }

    const { updatePayload, hasChanges, syncSummary } = parseBinanceOpenOrdersForTrade(
      trade,
      openOrders || [],
      data
    );

    if (hasChanges && Object.keys(updatePayload).length > 0) {
      updatePayload.updatedAt = Date.now();
      await updateDoc(doc(db, 'trades', trade.id), updatePayload);
      return { updated: true, summary: syncSummary || 'Trade updated from Binance' };
    }

    return { updated: false, summary: syncSummary || 'Already up to date' };
  } catch (err: any) {
    console.warn(`Sync failed for ${trade.symbol}:`, err);
    return { updated: false, summary: err.message || 'Sync error' };
  }
}
