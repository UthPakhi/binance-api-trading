import { Trade } from '../types';
import { db } from './firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { isTradeClosed, getTradeIsLong, formatPrice, getCleanSymbol, formatBuyLevelNote, formatSellLevelNote } from './tradeUtils';

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

  // Safeguard: If there are active open orders (like SL or TP orders waiting to execute), the position is NOT fully closed!
  if (Array.isArray(openOrders) && openOrders.length > 0 && analysisData) {
    analysisData.isFullyClosed = false;
  }

  // Calculate base / initial coins (CRITICAL: respect analysisData.totalSoldQty === 0 instead of falling back via || to stale trade.soldCoins)
  const totalSold = (analysisData && typeof analysisData.totalSoldQty === 'number')
    ? analysisData.totalSoldQty
    : (trade.soldCoins || 0);
  const currentCoinsHeld = analysisData?.remainingQty !== undefined 
    ? analysisData.remainingQty 
    : (trade.positionSizeCoins || 0);
  const initialCoins = (analysisData?.openBuys?.totalQty && analysisData.openBuys.totalQty > 0)
    ? analysisData.openBuys.totalQty
    : ((totalSold + currentCoinsHeld) > 0 ? (totalSold + currentCoinsHeld) : (trade.positionSizeCoins || 1));

  // CRITICAL RULE: NEVER take into consideration or revive positions that were closed or are ancient historical orphans (e.g. older than 180 days with no open balance)
  // Exception: If the user currently holds the coins on Binance (currentCoinsHeld > 0.0001) and has sold 0 coins (totalSold <= 0.0001),
  // it was NEVER sold and must NEVER be forced into CLOSED_MANUAL or PARTIAL_EXIT!
  const isAncientTrade = Boolean(trade.createdAt && (Date.now() - trade.createdAt > 180 * 24 * 60 * 60 * 1000) && (!currentCoinsHeld || currentCoinsHeld <= 0.00001));
  const hasActiveUnsoldHolding = !analysisData?.isFullyClosed && currentCoinsHeld > 0.0001 && totalSold <= 0.0001;
  const wasAlreadyClosed = !hasActiveUnsoldHolding && (isTradeClosed(trade) || Boolean(trade.closedAt) || isAncientTrade);

  const isPartialExitExecuted = !wasAlreadyClosed && !hasActiveUnsoldHolding && Boolean(
    (analysisData?.isPartialExit === true || totalSold > 0.0001) && 
    !analysisData?.isFullyClosed
  );
  const hasTp1AlreadyHit = isPartialExitExecuted;

  const updatePayload: Partial<Trade> = {};
  const syncParts: string[] = [];

  if (hasActiveUnsoldHolding) {
    if (trade.closedAt || ['CLOSED_MANUAL', 'HIT_SL', 'HIT_TP3', 'CLOSED_BREAK_EVEN', 'BREAK_EVEN', 'PARTIAL_EXIT', 'HIT_TP1', 'HIT_TP2'].includes(trade.status || '')) {
      updatePayload.status = 'ACTIVE';
      (updatePayload as any).closedAt = null;
      syncParts.push('Active unsold position verified');
    }
    if ((trade.soldCoins || 0) > 0) {
      updatePayload.soldCoins = 0;
    }
    if ((trade.totalSellUsd || 0) > 0) {
      updatePayload.totalSellUsd = 0;
    }
    if (trade.exitPrice) {
      (updatePayload as any).exitPrice = null;
    }
    if (trade.realizedProfitUsd) {
      updatePayload.realizedProfitUsd = 0;
    }
    if (Array.isArray(trade.ledgerMatches) && trade.ledgerMatches.length > 0) {
      updatePayload.ledgerMatches = [];
    }
    if (Array.isArray(trade.wacExits) && trade.wacExits.length > 0) {
      updatePayload.wacExits = [];
    }
    if (Array.isArray(trade.notifiedMilestones) && trade.notifiedMilestones.includes('PARTIAL_EXIT')) {
      updatePayload.notifiedMilestones = trade.notifiedMilestones.filter(m => m !== 'PARTIAL_EXIT');
    }
  }

  // Update Execution stats if analysisData provided
  if (analysisData) {
    if (analysisData.idempotencyKey) {
      updatePayload.idempotencyKey = analysisData.idempotencyKey;
    }
    if (Array.isArray(analysisData.ledgerMatches) && analysisData.ledgerMatches.length > 0 && !hasActiveUnsoldHolding) {
      updatePayload.ledgerMatches = analysisData.ledgerMatches;
    }
    if (analysisData.fifoSummary) {
      updatePayload.fifoSummary = analysisData.fifoSummary;
    }
    if (analysisData.wacSummary) {
      updatePayload.wacSummary = analysisData.wacSummary;
    }
    if (Array.isArray(analysisData.wacExits) && analysisData.wacExits.length > 0) {
      updatePayload.wacExits = analysisData.wacExits;
    }

    const rawBuyOrders = Array.isArray(analysisData.openBuyLots)
      ? analysisData.openBuyLots
      : (Array.isArray(analysisData.openBuys?.orders) ? analysisData.openBuys.orders : []);
    if (rawBuyOrders.length > 0) {
      updatePayload.openBuyLots = rawBuyOrders;
    }

    if ((analysisData.isFullyClosed || wasAlreadyClosed) && !hasActiveUnsoldHolding) {
      updatePayload.status = 'CLOSED_MANUAL';
      if (analysisData.totalSoldQty > 0) {
        updatePayload.soldCoins = analysisData.totalSoldQty;
      }
      if (analysisData.openBuys?.totalQty > 0) {
        updatePayload.positionSizeCoins = analysisData.openBuys.totalQty;
      } else if (analysisData.totalSoldQty > 0) {
        updatePayload.positionSizeCoins = analysisData.totalSoldQty;
      }
      if (analysisData.openBuys?.totalCost > 0) {
        updatePayload.totalBuyUsd = analysisData.openBuys.totalCost;
        (updatePayload as any).positionSize = analysisData.openBuys.totalCost;
      }
      if (analysisData.avgExitPrice > 0) {
        updatePayload.exitPrice = analysisData.avgExitPrice;
      }
      if (analysisData.totalProceeds > 0) {
        updatePayload.totalSellUsd = analysisData.totalProceeds;
      }
      if (analysisData.realizedPnL !== undefined && analysisData.realizedPnL !== null) {
        updatePayload.realizedProfitUsd = analysisData.realizedPnL;
      }
      if (analysisData.sellFeesUsd !== undefined && analysisData.sellFeesUsd > 0) {
        updatePayload.sellFeeUsd = analysisData.sellFeesUsd;
      }
      if (analysisData.totalFeesUsd !== undefined && analysisData.totalFeesUsd > 0) {
        updatePayload.totalFeesUsd = analysisData.totalFeesUsd;
        updatePayload.feeUsd = analysisData.totalFeesUsd;
      }
      if (!trade.closedAt) {
        updatePayload.closedAt = analysisData.latestSellTime || trade.filledAt || trade.createdAt;
      }

      const baseSym = getCleanSymbol(trade.symbol || '');
      let currentNotes = (updatePayload.notes || trade.notes || '')
        .split('\n')
        .filter(line => !/Profit Banked:\s*-/i.test(line))
        .join('\n')
        .trim();
      const buyQty = analysisData.openBuys?.totalQty || trade.positionSizeCoins || analysisData.totalSoldQty || 0;
      const buyPrice = analysisData.openBuys?.avgEntryPrice || trade.entryPrice || 0;
      const existingBoughtCount = (currentNotes.match(/Bought\s+/gi) || []).length;
      if (rawBuyOrders.length > 0 && (existingBoughtCount === 0 || (rawBuyOrders.length > 1 && existingBoughtCount < rawBuyOrders.length))) {
        const buyLines = rawBuyOrders.map((bo: any) => {
          const bq = bo.qty || bo.remainingQty || bo.initialQty || 0;
          const bp = bo.price || buyPrice;
          return formatBuyLevelNote({
            qty: bq,
            symbol: baseSym,
            price: bp,
            usd: bo.usdValue || bo.costUsd || (bq * bp),
            timestamp: bo.time || bo.timestamp || trade.filledAt || trade.createdAt,
          });
        }).join('\n');
        const strippedNotes = currentNotes
          .split('\n')
          .filter(line => !/^Bought\s+/i.test(line.trim()) && !/^(?:Open Limit Buy Order|Executed on Binance)/i.test(line.trim()))
          .join('\n')
          .trim();
        currentNotes = strippedNotes ? `${buyLines}\n${strippedNotes}` : buyLines;
      } else if (buyQty > 0 && buyPrice > 0 && !/Bought\s+/i.test(currentNotes)) {
        const buyLine = formatBuyLevelNote({
          qty: buyQty,
          symbol: baseSym,
          price: buyPrice,
          usd: analysisData.openBuys?.totalCost || (buyQty * buyPrice),
          timestamp: trade.filledAt || trade.createdAt,
        });
        currentNotes = currentNotes ? `${buyLine}\n${currentNotes}` : buyLine;
      }

      if (Array.isArray(analysisData.partialSells) && analysisData.partialSells.length > 0) {
        // Aggregate fills by sell orderId so split fills of the same sell order show the combined order qty & proceeds
        const groupedSellsMap = new Map<string, { price: number; qty: number; proceeds: number; pnl: number; time: number }>();
        for (const ps of analysisData.partialSells) {
          const key = String(ps.orderId || ps.price);
          const cur = groupedSellsMap.get(key) || { price: ps.price, qty: 0, proceeds: 0, pnl: 0, time: ps.time || 0 };
          cur.qty += (ps.qty || 0);
          cur.proceeds += (ps.proceeds || ((ps.qty || 0) * (ps.price || 0)));
          cur.pnl += (ps.pnl !== undefined ? ps.pnl : (ps.grossPnl || 0));
          if ((ps.time || 0) > cur.time) cur.time = ps.time;
          groupedSellsMap.set(key, cur);
        }

        for (const gs of groupedSellsMap.values()) {
          const p = gs.price;
          const q = gs.qty;
          const pnl = gs.pnl;
          const lineStr = formatSellLevelNote({
            qty: q,
            symbol: baseSym,
            price: p,
            usd: gs.proceeds || (q * p),
            pnlUsd: pnl,
            timestamp: gs.time || analysisData.latestSellTime || trade.closedAt,
          });

          const priceSig = `@ $${formatPrice(p)}`;
          if (!currentNotes.includes(priceSig)) {
            currentNotes = currentNotes ? `${currentNotes}\n${lineStr}` : lineStr;
          }
        }
      }
      if (currentNotes !== (trade.notes || '')) {
        updatePayload.notes = currentNotes;
      }

      return { updatePayload, hasChanges: true, syncSummary: 'Position fully closed and verified on Binance' };
    }

    if (isPartialExitExecuted) {
      updatePayload.status = (trade.status === 'HIT_TP1' || trade.status === 'HIT_TP2') ? trade.status : 'PARTIAL_EXIT';
      updatePayload.closedAt = null;
      updatePayload.soldCoins = totalSold;
      const existingNotified = Array.isArray(trade.notifiedMilestones) ? trade.notifiedMilestones : [];
      if (!existingNotified.includes('PARTIAL_EXIT')) {
        updatePayload.notifiedMilestones = [...existingNotified, 'PARTIAL_EXIT'];
      }
      if (initialCoins > 0 && initialCoins > totalSold) {
        updatePayload.positionSizeCoins = initialCoins;
      }
      if (initialCoins > 0) {
        updatePayload.totalBuyUsd = initialCoins * (updatePayload.entryPrice || trade.entryPrice || 0);
      }
      if (analysisData.realizedPnL !== undefined) {
        updatePayload.realizedProfitUsd = analysisData.realizedPnL;
      }
      if (analysisData.avgExitPrice > 0) {
        updatePayload.exitPrice = analysisData.avgExitPrice;
        if (!trade.takeProfit1) {
          updatePayload.takeProfit1 = analysisData.avgExitPrice;
        }
      }
      if (analysisData.soldPercent > 0) {
        updatePayload.tp1Percent = analysisData.soldPercent;
      }

      const baseSym = getCleanSymbol(trade.symbol || '');
      let currentNotes = updatePayload.notes || trade.notes || '';
      const buyQty = initialCoins || trade.positionSizeCoins || 0;
      const buyPrice = analysisData.openBuys?.avgEntryPrice || trade.entryPrice || 0;
      const existingBoughtCount = (currentNotes.match(/Bought\s+/gi) || []).length;
      if (rawBuyOrders.length > 0 && (existingBoughtCount === 0 || (rawBuyOrders.length > 1 && existingBoughtCount < rawBuyOrders.length))) {
        const buyLines = rawBuyOrders.map((bo: any) => {
          const bq = bo.qty || bo.remainingQty || bo.initialQty || 0;
          const bp = bo.price || buyPrice;
          return formatBuyLevelNote({
            qty: bq,
            symbol: baseSym,
            price: bp,
            usd: bo.usdValue || bo.costUsd || (bq * bp),
            timestamp: bo.time || bo.timestamp || trade.filledAt || trade.createdAt,
          });
        }).join('\n');
        const strippedNotes = currentNotes
          .split('\n')
          .filter(line => !/^Bought\s+/i.test(line.trim()) && !/^(?:Open Limit Buy Order|Executed on Binance)/i.test(line.trim()))
          .join('\n')
          .trim();
        currentNotes = strippedNotes ? `${buyLines}\n${strippedNotes}` : buyLines;
      } else if (buyQty > 0 && buyPrice > 0 && !/Bought\s+/i.test(currentNotes)) {
        const buyLine = formatBuyLevelNote({
          qty: buyQty,
          symbol: baseSym,
          price: buyPrice,
          usd: buyQty * buyPrice,
          timestamp: trade.filledAt || trade.createdAt,
        });
        currentNotes = currentNotes ? `${buyLine}\n${currentNotes}` : buyLine;
      }

      // Format clean structured notes for every partial sell execution so profits banked appear on the card & detail drawer
      if (Array.isArray(analysisData.partialSells) && analysisData.partialSells.length > 0) {
        for (const ps of analysisData.partialSells) {
          const p = ps.price;
          const q = ps.qty;
          const pnl = ps.pnl !== undefined ? ps.pnl : ps.grossPnl;
          const lineStr = formatSellLevelNote({
            qty: q,
            symbol: baseSym,
            price: p,
            usd: ps.proceeds || (q * p),
            pnlUsd: pnl,
            timestamp: ps.time || analysisData.latestSellTime,
          });

          const priceSig = `@ $${formatPrice(p)}`;
          const pnlSig = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
          if (!currentNotes.includes(priceSig) && !currentNotes.includes(pnlSig)) {
            currentNotes = currentNotes ? `${currentNotes}\n${lineStr}` : lineStr;
          }
        }
        if (currentNotes !== (trade.notes || '')) {
          updatePayload.notes = currentNotes;
        }
      } else if (analysisData.realizedPnL !== undefined && totalSold > 0 && analysisData.avgExitPrice > 0) {
        const lineStr = formatSellLevelNote({
          qty: totalSold,
          symbol: baseSym,
          price: analysisData.avgExitPrice,
          usd: totalSold * analysisData.avgExitPrice,
          pnlUsd: analysisData.realizedPnL,
          timestamp: analysisData.latestSellTime,
        });
        const isProf = analysisData.realizedPnL >= 0;
        if (!currentNotes.includes(`@ $${formatPrice(analysisData.avgExitPrice)}`) && !currentNotes.includes(isProf ? `+$${analysisData.realizedPnL.toFixed(2)}` : `-$${Math.abs(analysisData.realizedPnL).toFixed(2)}`)) {
          updatePayload.notes = currentNotes ? `${currentNotes}\n${lineStr}` : lineStr;
        }
      } else if (currentNotes !== (trade.notes || '')) {
        updatePayload.notes = currentNotes;
      }

      const pnlDisplay = (updatePayload.realizedProfitUsd !== undefined ? updatePayload.realizedProfitUsd : (analysisData.realizedPnL || 0));
      const pnlSign = pnlDisplay >= 0 ? '+' : '-';
      syncParts.push(`Banked: ${pnlSign}$${Math.abs(pnlDisplay).toFixed(2)} (${updatePayload.tp1Percent || analysisData.soldPercent || Math.round((totalSold / initialCoins) * 100)}% sold @ $${formatPrice(updatePayload.exitPrice || analysisData.avgExitPrice || 0)})`);
    } else {
      if (trade.closedAt) {
        updatePayload.closedAt = null;
      }
      if (rawBuyOrders.length > 0) {
        const earliestBuyTime = Math.min(...rawBuyOrders.map((bo: any) => bo.time || bo.timestamp || Infinity));
        if (Number.isFinite(earliestBuyTime) && earliestBuyTime > 0) {
          if (!trade.createdAt || Math.abs(trade.createdAt - earliestBuyTime) > 60000) {
            updatePayload.createdAt = earliestBuyTime;
          }
          if (!trade.filledAt || Math.abs(trade.filledAt - earliestBuyTime) > 60000) {
            updatePayload.filledAt = earliestBuyTime;
          }
        }
        const baseSym = getCleanSymbol(trade.symbol || '');
        const currentNotes = updatePayload.notes || trade.notes || '';
        const buyLines = rawBuyOrders.map((bo: any) => {
          const bq = bo.qty || bo.remainingQty || bo.initialQty || 0;
          const bp = bo.price || analysisData.openBuys?.avgEntryPrice || trade.entryPrice || 0;
          return formatBuyLevelNote({
            qty: bq,
            symbol: baseSym,
            price: bp,
            usd: bo.usdValue || bo.costUsd || (bq * bp),
            timestamp: bo.time || bo.timestamp || trade.filledAt || trade.createdAt,
          });
        }).join('\n');
        const strippedNotes = currentNotes
          .split('\n')
          .filter(line => {
            const t = line.trim();
            if (!t) return false;
            if (/^Bought\s+/i.test(t)) return false;
            if (/^(?:Open Limit Buy Order|Executed on Binance)/i.test(t)) return false;
            // On an unsold active trade (totalSold === 0), strip any stale Sold / Profit Banked / Loss Cut lines
            if (totalSold <= 0.0001 && /^[🎯✂️\s]*Sold\b|Profit Banked|Loss Cut/i.test(t)) return false;
            return true;
          })
          .join('\n')
          .trim();
        const newNotes = strippedNotes ? `${buyLines}\n${strippedNotes}` : buyLines;
        if (newNotes !== (trade.notes || '')) {
          updatePayload.notes = newNotes;
        }
      }
    }

    if (analysisData.openBuys?.avgEntryPrice > 0) {
      updatePayload.entryPrice = analysisData.openBuys.avgEntryPrice;
      if (analysisData.openBuys.totalCost > 0) {
        updatePayload.totalBuyUsd = analysisData.openBuys.totalCost;
      }
      if (!isPartialExitExecuted && analysisData.openBuys.totalQty > 0) {
        updatePayload.positionSizeCoins = analysisData.openBuys.totalQty;
      }
    }
  }

  // TARGETS MAPPING:
  const openTpCoins = uniquePrices.reduce((sum, p) => sum + (priceMap.get(p) || 0), 0);

  const isDiffPrice = (a: number | null | undefined, b: number | null | undefined) => {
    const na = Number(a || 0);
    const nb = Number(b || 0);
    if (na === 0 && nb === 0) return false;
    if (na === 0 || nb === 0) return true;
    return Math.abs(na - nb) / Math.max(Math.abs(na), Math.abs(nb), 1e-12) > 0.0005;
  };

  if (totalSold >= initialCoins || currentCoinsHeld <= 0.00001) {
    updatePayload.takeProfit1 = null;
    updatePayload.tp1Percent = null;
    updatePayload.takeProfit2 = null;
    updatePayload.tp2Percent = null;
    updatePayload.takeProfit3 = null;
    updatePayload.tp3Percent = null;
    if (trade.takeProfit1 || trade.takeProfit2 || trade.takeProfit3) {
      syncParts.push('All targets executed and position 100% sold');
    }
  } else if (limitOrders.length === 0 && totalSold === 0) {
    if (trade.takeProfit1 || trade.takeProfit2 || trade.takeProfit3) {
      updatePayload.takeProfit1 = null;
      updatePayload.tp1Percent = null;
      updatePayload.takeProfit2 = null;
      updatePayload.tp2Percent = null;
      updatePayload.takeProfit3 = null;
      updatePayload.tp3Percent = null;
      syncParts.push('All TP orders canceled or removed on Binance');
    }
  } else if (hasTp1AlreadyHit) {
    // TP1 was already executed on Binance.
    // Any open limit sell orders on Binance are the remaining targets (TP2, TP3)
    if (!updatePayload.takeProfit1 && trade.takeProfit1) {
      updatePayload.takeProfit1 = trade.takeProfit1;
    }
    const hitPct = Math.min(90, Math.max(10, trade.tp1Percent || Math.round((totalSold / Math.max(1, totalSold + currentCoinsHeld)) * 100) || 50));
    updatePayload.tp1Percent = hitPct;
    const remainingPct = 100 - hitPct;

    if (uniquePrices.length >= 2) {
      updatePayload.takeProfit2 = uniquePrices[0];
      const q2 = priceMap.get(uniquePrices[0]) || 0;
      const ratio2 = openTpCoins > 0 ? (q2 / openTpCoins) : 0.5;
      updatePayload.tp2Percent = Math.max(1, Math.round(remainingPct * ratio2));

      updatePayload.takeProfit3 = uniquePrices[1];
      updatePayload.tp3Percent = Math.max(1, remainingPct - updatePayload.tp2Percent);
      if (isDiffPrice(trade.takeProfit2, uniquePrices[0]) || isDiffPrice(trade.takeProfit3, uniquePrices[1])) {
        syncParts.push(`Targets from Binance: TP2 $${formatPrice(uniquePrices[0])} (${updatePayload.tp2Percent}%), TP3 $${formatPrice(uniquePrices[1])} (${updatePayload.tp3Percent}%)`);
      }
    } else if (uniquePrices.length === 1) {
      updatePayload.takeProfit2 = uniquePrices[0];
      updatePayload.tp2Percent = remainingPct;
      updatePayload.takeProfit3 = null;
      updatePayload.tp3Percent = null;
      if (isDiffPrice(trade.takeProfit2, uniquePrices[0]) || Boolean(trade.takeProfit3)) {
        syncParts.push(`Target from Binance: TP2 $${formatPrice(uniquePrices[0])} (${updatePayload.tp2Percent}%)`);
      }
    } else {
      // 0 open TP orders on Binance
      if (trade.takeProfit2 || trade.takeProfit3) {
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
      const q1 = priceMap.get(uniquePrices[0]) || 0;
      const q2 = priceMap.get(uniquePrices[1]) || 0;
      const q3 = priceMap.get(uniquePrices[2]) || 0;
      const tot = (q1 + q2 + q3) > 0 ? (q1 + q2 + q3) : (openTpCoins > 0 ? openTpCoins : 1);
      updatePayload.tp1Percent = Math.max(1, Math.round((q1 / tot) * 100));
      updatePayload.takeProfit2 = uniquePrices[1];
      updatePayload.tp2Percent = Math.max(1, Math.round((q2 / tot) * 100));
      updatePayload.takeProfit3 = uniquePrices[2];
      updatePayload.tp3Percent = Math.max(1, 100 - (updatePayload.tp1Percent + updatePayload.tp2Percent));
      if (
        isDiffPrice(trade.takeProfit1, uniquePrices[0]) ||
        isDiffPrice(trade.takeProfit2, uniquePrices[1]) ||
        isDiffPrice(trade.takeProfit3, uniquePrices[2])
      ) {
        syncParts.push(`Synced 3 TPs: $${formatPrice(uniquePrices[0])}, $${formatPrice(uniquePrices[1])}, $${formatPrice(uniquePrices[2])}`);
      }
    } else if (uniquePrices.length === 2) {
      updatePayload.takeProfit1 = uniquePrices[0];
      const q1 = priceMap.get(uniquePrices[0]) || 0;
      const tot = openTpCoins > 0 ? openTpCoins : 1;
      updatePayload.tp1Percent = Math.max(1, Math.round((q1 / tot) * 100));
      updatePayload.takeProfit2 = uniquePrices[1];
      updatePayload.tp2Percent = Math.max(1, 100 - updatePayload.tp1Percent);
      updatePayload.takeProfit3 = null;
      updatePayload.tp3Percent = null;
      if (isDiffPrice(trade.takeProfit1, uniquePrices[0]) || isDiffPrice(trade.takeProfit2, uniquePrices[1]) || Boolean(trade.takeProfit3)) {
        syncParts.push(`Synced 2 TPs: $${formatPrice(uniquePrices[0])}, $${formatPrice(uniquePrices[1])}`);
      }
    } else if (uniquePrices.length === 1) {
      updatePayload.takeProfit1 = uniquePrices[0];
      updatePayload.tp1Percent = 100;
      updatePayload.takeProfit2 = null;
      updatePayload.tp2Percent = null;
      updatePayload.takeProfit3 = null;
      updatePayload.tp3Percent = null;
      if (isDiffPrice(trade.takeProfit1, uniquePrices[0]) || Boolean(trade.takeProfit2) || Boolean(trade.takeProfit3)) {
        syncParts.push(`Synced TP1: $${formatPrice(uniquePrices[0])} (100%)`);
      }
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
      const slChanged = isDiffPrice(trade.stopLoss, slPrice);
      updatePayload.stopLoss = slPrice;
      const entry = updatePayload.entryPrice || trade.entryPrice || (analysisData?.openBuys?.avgEntryPrice) || 0;
      const isAtBreakeven = entry > 0 && (
        isLong ? slPrice >= (entry * 0.998) : slPrice <= (entry * 1.002)
      );

      if (isAtBreakeven) {
        updatePayload.riskAmount = 0;
        updatePayload.riskPercent = 0;
        if (slChanged) {
          syncParts.push(`SL: $${formatPrice(slPrice)} (Breakeven - $0.00 Risk)`);
        }
      } else if (entry > 0 && currentCoinsHeld > 0) {
        const rAmt = currentCoinsHeld * Math.abs(entry - slPrice);
        updatePayload.riskAmount = rAmt;
        const pSize = trade.portfolioSize || 0;
        if (pSize > 0) {
          updatePayload.riskPercent = parseFloat(((rAmt / pSize) * 100).toFixed(2));
        }
        if (slChanged) {
          syncParts.push(`SL: $${formatPrice(slPrice)}`);
        }
      }
    }
  } else if (stopOrders.length === 0 && trade.stopLoss && trade.stopLoss > 0) {
    const entry = updatePayload.entryPrice || trade.entryPrice || (analysisData?.openBuys?.avgEntryPrice) || 0;
    const isSyntheticSl = entry > 0 && Math.abs(trade.stopLoss - entry * 0.915) / entry < 0.01;
    if (trade.type === 'HOLDING' || isSyntheticSl) {
      updatePayload.stopLoss = 0;
      updatePayload.riskAmount = 0;
      syncParts.push('Cleared unset stop loss');
    }
  }

  // Check if any actual meaningful trade field changed compared to current trade
  const ignoredDiffKeys = new Set(['fifoSummary', 'wacSummary', 'wacExits', 'idempotencyKey']);
  let hasChanges = false;
  for (const [key, val] of Object.entries(updatePayload)) {
    if (ignoredDiffKeys.has(key)) continue;
    const currentVal = (trade as any)[key];
    if (val === undefined || val === currentVal) continue;
    // Treat null, undefined, and 0 as equivalent for optional target fields
    if ((val === null || val === 0) && (currentVal === null || currentVal === undefined || currentVal === 0)) {
      continue;
    }
    if (typeof val === 'number' && typeof currentVal === 'number') {
      if (isDiffPrice(val, currentVal)) {
        hasChanges = true;
        break;
      }
    } else if (key === 'openBuyLots' && Array.isArray(val) && Array.isArray(currentVal)) {
      if (val.length !== currentVal.length) {
        hasChanges = true;
        break;
      }
    } else if (key === 'notes' && typeof val === 'string' && typeof currentVal === 'string') {
      // Ignore trivial timestamp formatting differences if the same Buy/Sell lines are already present
      const norm = (s: string) => s.replace(/·[^\n(]*/g, '').replace(/\s+/g, ' ').trim();
      if (norm(val) !== norm(currentVal)) {
        hasChanges = true;
        break;
      }
    } else if (typeof val === 'object' && val !== null) {
      if (JSON.stringify(val) !== JSON.stringify(currentVal)) {
        hasChanges = true;
        break;
      }
    } else {
      hasChanges = true;
      break;
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

  const cleanSymbol = getCleanSymbol(trade.symbol);

  try {
    const startTime = trade.filledAt || trade.createdAt;
    const orderIdParam = trade.binanceOrderId ? `&binanceOrderId=${encodeURIComponent(trade.binanceOrderId.toString())}` : '';
    const clientOrderIdParam = trade.clientOrderId ? `&clientOrderId=${encodeURIComponent(trade.clientOrderId)}` : '';
    const tradeCoinsParam = (trade as any).initialPositionCoins || (trade.soldCoins && trade.soldCoins > 0 && (trade.positionSizeCoins || 0) > 0 ? ((trade.soldCoins || 0) + (trade.positionSizeCoins || 0)) : (trade.positionSizeCoins || ''));
    const url = `/api/exchange/analyze-trade?symbol=${encodeURIComponent(cleanSymbol)}&tradeStartTime=${startTime || ''}&tradeEntryPrice=${trade.entryPrice || ''}&tradeCoins=${tradeCoinsParam}${orderIdParam}${clientOrderIdParam}`;

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
        openOrders = preloadedOrders.filter((o: any) => o.symbol === cleanSymbol || o.symbol === getCleanSymbol(trade.symbol));
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
