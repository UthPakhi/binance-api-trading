import { 
  Trade, 
  BinanceBalanceInfo, 
  DisciplineTag, 
  PnlViewMode, 
  TradeRiskFramework, 
  TradeRiskType, 
  RecommendedStops 
} from '../types';
import {
  D,
  dRound8,
  dRound6,
  dRound4,
  dRound2,
  dAdaptivePrice,
  CostBasisMethod,
  CostBasisValuationSummary,
  computeUnskewedRMultiple
} from './financialMath';

export type { CostBasisMethod, CostBasisValuationSummary };

export const formatPrice = (price: number | string | undefined | null, isEntry: boolean = false): string | number => {
  if (price === undefined || price === null || price === '') return '';
  let cleanPrice = typeof price === 'string' ? price.trim() : price;
  if (typeof cleanPrice === 'string' && cleanPrice.startsWith('$')) {
    cleanPrice = cleanPrice.replace(/^\$+/, '').trim();
  }
  const num = typeof cleanPrice === 'string' ? parseFloat(cleanPrice) : cleanPrice;
  if (isNaN(num)) return typeof price === 'string' ? price.replace(/^\$+/, '').trim() : price;
  if (num === 0) return 0;
  return dAdaptivePrice(cleanPrice);
};

export const getTradeCoins = (trade: Partial<Trade>): number => {
  if (trade.positionSizeCoins && trade.positionSizeCoins > 0) {
    return dRound8(trade.positionSizeCoins);
  }
  if ((trade as any)?.coins && (trade as any).coins > 0) {
    return dRound8((trade as any).coins);
  }
  if (trade.totalBuyUsd && trade.entryPrice && trade.entryPrice > 0) {
    return dRound8(D(trade.totalBuyUsd).dividedBy(D(trade.entryPrice)));
  }
  if ((trade as any)?.positionSize && trade.entryPrice && trade.entryPrice > 0) {
    return dRound8(D((trade as any).positionSize).dividedBy(D(trade.entryPrice)));
  }
  return 0;
};

export const getTradeInvestedAmount = (trade: Partial<Trade>, method: CostBasisMethod = 'WAC'): number => {
  if (method === 'WAC' && trade.wacSummary) {
    const totalWac = D(trade.wacSummary.remainingCostBasisTotalUsd).plus(D(trade.wacSummary.closedCostBasisTotalUsd));
    if (totalWac.greaterThan(0)) return dRound8(totalWac);
  }
  if (method === 'FIFO' && trade.fifoSummary) {
    const totalFifo = D(trade.fifoSummary.remainingCostBasisTotalUsd).plus(D(trade.fifoSummary.closedCostBasisTotalUsd));
    if (totalFifo.greaterThan(0)) return dRound8(totalFifo);
  }

  const sold = D(trade.soldCoins || 0);
  const remaining = D(trade.positionSizeCoins !== undefined ? trade.positionSizeCoins : ((trade as any)?.coins || 0));
  const totalCoins = remaining.plus(sold);
  const entry = D(trade.entryPrice || 0);

  const calculatedTotal = totalCoins.greaterThan(0) && entry.greaterThan(0) ? totalCoins.times(entry) : D(0);
  const storedTotal = D(
    trade.totalBuyUsd !== undefined && trade.totalBuyUsd > 0
      ? trade.totalBuyUsd
      : ((trade as any)?.positionSize !== undefined ? (trade as any).positionSize : 0)
  );

  if (sold.greaterThan(0) && calculatedTotal.greaterThan(storedTotal)) {
    return dRound8(calculatedTotal);
  }
  if (storedTotal.greaterThan(0)) {
    return dRound8(storedTotal);
  }
  return dRound8(calculatedTotal);
};

/**
 * Returns the authoritative 8-decimal CostBasisValuationSummary for a trade under FIFO or WAC.
 * If the trade has precomputed `fifoSummary` or `wacSummary` from the Execution Ledger, returns it directly.
 * Otherwise, deterministically synthesizes an exact Decimal-backed summary from the trade's fields and matches.
 */
export const getTradeCostBasisSummary = (
  trade: Partial<Trade>,
  method: CostBasisMethod = 'WAC'
): CostBasisValuationSummary => {
  if (method === 'WAC' && trade.wacSummary) {
    return trade.wacSummary;
  }
  if (method === 'FIFO' && trade.fifoSummary) {
    return trade.fifoSummary;
  }

  const closed = isTradeClosed(trade as Trade);
  const remCoins = closed ? D(0) : D(calculateRemainingCoins(trade as Trade));
  const soldCoins = D(trade.soldCoins || (closed ? getTradeCoins(trade) : 0));
  const entry = D(trade.entryPrice || 0);
  const exitP = D(getTradeExitPrice(trade) || trade.exitPrice || entry);
  const fees = getTradeConsolidatedFees(trade);

  // If ledgerMatches exist, aggregate exact FIFO cost basis from matches
  if (method === 'FIFO' && Array.isArray(trade.ledgerMatches) && trade.ledgerMatches.length > 0) {
    let matchedQty = D(0);
    let closedCost = D(0);
    let grossProc = D(0);
    let allocBuyFee = D(0);
    let allocSellFee = D(0);
    let netPnl = D(0);
    let maxDrift = D(0);

    for (const m of trade.ledgerMatches) {
      matchedQty = matchedQty.plus(D(m.matchedQty));
      closedCost = closedCost.plus(D(m.costBasisUsd));
      grossProc = grossProc.plus(D(m.grossProceedsUsd));
      allocBuyFee = allocBuyFee.plus(D(m.allocatedBuyFeeUsd));
      allocSellFee = allocSellFee.plus(D(m.allocatedSellFeeUsd));
      netPnl = netPnl.plus(D(m.netRealizedPnlUsd ?? m.netPnlUsd ?? 0));
      const d = D(m.reconciliationDeltaUsd || 0).abs();
      if (d.greaterThan(maxDrift)) maxDrift = d;
    }

    const closedUnit = matchedQty.greaterThan(0) ? closedCost.dividedBy(matchedQty) : entry;
    const remCost = remCoins.times(entry);
    const totalRealizedFees = allocBuyFee.plus(allocSellFee);

    return {
      method: 'FIFO',
      remainingQty: dRound8(remCoins),
      soldQty: dRound8(matchedQty.greaterThan(0) ? matchedQty : soldCoins),
      remainingUnitCostBasisUsd: dRound8(entry),
      remainingCostBasisTotalUsd: dRound8(remCost),
      closedUnitCostBasisUsd: dRound8(closedUnit),
      closedCostBasisTotalUsd: dRound8(closedCost),
      grossProceedsUsd: dRound8(grossProc),
      allocatedBuyFeeUsd: dRound8(allocBuyFee),
      allocatedSellFeeUsd: dRound8(allocSellFee),
      unallocatedRemainingBuyFeeUsd: dRound8(DecimalMaxZero(D(fees.buyFee).minus(allocBuyFee))),
      totalRealizedFeesUsd: dRound8(totalRealizedFees),
      netRealizedPnlExact8Usd: dRound8(netPnl),
      netRealizedPnl2Usd: dRound2(netPnl),
      dynamicBreakevenPriceUsd: !closed && remCoins.greaterThan(0)
        ? dRound8(calculateBlendedBreakeven(trade as Trade).blendedBreakeven || entry)
        : null,
      reconciliationDriftUsd: dRound8(maxDrift)
    };
  }

  // Fallback synthesis using arbitrary-precision Decimal
  const closedCostBasisTotal = soldCoins.times(entry);
  const remainingCostBasisTotal = remCoins.times(entry);
  const grossProceeds = D(trade.totalSellUsd || 0).greaterThan(0)
    ? D(trade.totalSellUsd)
    : soldCoins.times(exitP);
  const totalBuySearchCoins = remCoins.plus(soldCoins);
  const soldRatio = totalBuySearchCoins.greaterThan(0) ? soldCoins.dividedBy(totalBuySearchCoins) : D(closed ? 1 : 0);
  const allocatedBuyFee = D(fees.buyFee).times(soldRatio);
  const allocatedSellFee = D(fees.sellFee);
  const unallocatedBuyFee = DecimalMaxZero(D(fees.buyFee).minus(allocatedBuyFee));
  const totalRealizedFees = allocatedBuyFee.plus(allocatedSellFee);

  const explicitRealized = trade.realizedProfitUsd !== undefined && trade.realizedProfitUsd !== null
    ? D(trade.realizedProfitUsd)
    : (soldCoins.greaterThan(0) ? grossProceeds.minus(closedCostBasisTotal).minus(totalRealizedFees) : D(0));

  return {
    method,
    remainingQty: dRound8(remCoins),
    soldQty: dRound8(soldCoins),
    remainingUnitCostBasisUsd: dRound8(entry),
    remainingCostBasisTotalUsd: dRound8(remainingCostBasisTotal),
    closedUnitCostBasisUsd: dRound8(entry),
    closedCostBasisTotalUsd: dRound8(closedCostBasisTotal),
    grossProceedsUsd: dRound8(grossProceeds),
    allocatedBuyFeeUsd: dRound8(allocatedBuyFee),
    allocatedSellFeeUsd: dRound8(allocatedSellFee),
    unallocatedRemainingBuyFeeUsd: dRound8(unallocatedBuyFee),
    totalRealizedFeesUsd: dRound8(totalRealizedFees),
    netRealizedPnlExact8Usd: dRound8(explicitRealized),
    netRealizedPnl2Usd: dRound2(explicitRealized),
    dynamicBreakevenPriceUsd: !closed && remCoins.greaterThan(0) ? dRound8(entry) : null,
    reconciliationDriftUsd: 0
  };
};

function DecimalMaxZero(val: ReturnType<typeof D>) {
  return val.greaterThan(0) ? val : D(0);
}

/**
 * Returns the active Unit Cost Basis price (entryPrice) under the selected accounting method (FIFO or WAC).
 */
export const getTradeEntryPriceByMethod = (
  trade: Partial<Trade>,
  method: CostBasisMethod = 'WAC'
): number => {
  if (!trade) return 0;
  const closed = isTradeClosed(trade as Trade);
  if (method === 'WAC' && trade.wacSummary) {
    const unit = closed
      ? (trade.wacSummary.closedUnitCostBasisUsd || trade.wacSummary.remainingUnitCostBasisUsd)
      : (trade.wacSummary.remainingUnitCostBasisUsd || trade.wacSummary.closedUnitCostBasisUsd);
    if (unit && unit > 0) return dRound8(unit);
  }
  if (method === 'FIFO' && trade.fifoSummary) {
    const unit = closed
      ? (trade.fifoSummary.closedUnitCostBasisUsd || trade.fifoSummary.remainingUnitCostBasisUsd)
      : (trade.fifoSummary.remainingUnitCostBasisUsd || trade.fifoSummary.closedUnitCostBasisUsd);
    if (unit && unit > 0) return dRound8(unit);
  }
  return dRound8(trade.entryPrice || 0);
};

/**
 * Returns the authoritative Net Realized PnL for a trade under the selected accounting method (FIFO or WAC).
 * Set `exact8 = true` for 8-decimal audit drawer figures, or `exact8 = false` for 2-decimal card figures.
 */
export const getTradeRealizedPnlByMethod = (
  trade: Trade,
  method: CostBasisMethod = 'WAC',
  exact8: boolean = false
): number => {
  if (!trade) return 0;
  if (method === 'WAC' && trade.wacSummary && (trade.wacSummary.soldQty > 0 || isTradeClosed(trade))) {
    return exact8
      ? dRound8(trade.wacSummary.netRealizedPnlExact8Usd)
      : dRound2(trade.wacSummary.netRealizedPnlExact8Usd);
  }
  if (method === 'FIFO' && trade.fifoSummary && (trade.fifoSummary.soldQty > 0 || isTradeClosed(trade))) {
    return exact8
      ? dRound8(trade.fifoSummary.netRealizedPnlExact8Usd)
      : dRound2(trade.fifoSummary.netRealizedPnlExact8Usd);
  }
  const basePnl = getTradeAchievedPnL(trade);
  return exact8 ? dRound8(basePnl) : dRound2(basePnl);
};

export interface SolidSellPlan {
  takeProfit1: number;
  tp1Percent: number;
  takeProfit2: number;
  tp2Percent: number;
  takeProfit3: number;
  tp3Percent: number;
  stopLoss: number;
  targetTakeProfit: number;
  targetStopLoss: number;
  riskAmount: number;
}

export function generateSolidSellPlan(_entryPrice: number, _positionSizeCoins: number, _symbol?: string): SolidSellPlan {
  // Never invent synthetic stop-loss or take-profit levels when none are set by the user or on Binance
  return {
    takeProfit1: 0,
    tp1Percent: 0,
    takeProfit2: 0,
    tp2Percent: 0,
    takeProfit3: 0,
    tp3Percent: 0,
    stopLoss: 0,
    targetTakeProfit: 0,
    targetStopLoss: 0,
    riskAmount: 0
  };
}

export const parseExitFromNotes = (notes?: string | null): number | null => {
  if (!notes) return null;
  const lines = notes.split(/\r?\n| \| /);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const match = line.match(/(?:Closed|Exit|Exited|Sold)[^@\n]*@\s*~?\$?([0-9.]+)/i)
               || line.match(/Closed\s*@\s*~?\$?([0-9.]+)/i);
    if (match && match[1]) {
      const val = parseFloat(match[1]);
      if (!isNaN(val) && val > 0) return val;
    }
  }
  return null;
};

export const formatExecTimeShort = (timestamp?: number | null): string => {
  if (!timestamp || timestamp <= 0) return '';
  try {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  } catch {
    return '';
  }
};

export const formatBuyLevelNote = (params: {
  qty: number;
  usdAmount?: number;
  usd?: number;
  price: number;
  timestamp?: number | null;
  symbol?: string;
}): string => {
  const { qty, price, timestamp, symbol } = params;
  const usd = params.usdAmount !== undefined && params.usdAmount > 0 
    ? params.usdAmount 
    : (params.usd !== undefined && params.usd > 0 ? params.usd : qty * price);
  const baseSym = symbol ? getBaseSymbol(symbol) : '';
  const qtyStr = qty.toLocaleString('en-US', { maximumFractionDigits: 6 });
  const unitStr = baseSym ? ` ${baseSym}` : '';
  const usdStr = `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const priceStr = `$${formatPrice(price)}`;
  const timeStr = timestamp ? ` · ${formatExecTimeShort(timestamp)}` : '';
  return `Bought ${qtyStr}${unitStr} for ${usdStr} @ ${priceStr}${timeStr}`;
};

export const formatSellLevelNote = (params: {
  qty: number;
  usdAmount?: number;
  usd?: number;
  price: number;
  pnlUsd?: number;
  returnPct?: number;
  timestamp?: number | null;
  symbol?: string;
}): string => {
  const { qty, price, pnlUsd, returnPct, timestamp, symbol } = params;
  const usd = params.usdAmount !== undefined && params.usdAmount > 0 
    ? params.usdAmount 
    : (params.usd !== undefined && params.usd > 0 ? params.usd : qty * price);
  const baseSym = symbol ? getBaseSymbol(symbol) : '';
  const qtyStr = qty.toLocaleString('en-US', { maximumFractionDigits: 6 });
  const unitStr = baseSym ? ` ${baseSym}` : '';
  const usdStr = `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const priceStr = `$${formatPrice(price)}`;
  const timeStr = timestamp ? ` · ${formatExecTimeShort(timestamp)}` : '';

  if (pnlUsd !== undefined) {
    const isProf = pnlUsd >= 0;
    const pnlStr = isProf ? `+$${Math.abs(pnlUsd).toFixed(2)}` : `-$${Math.abs(pnlUsd).toFixed(2)}`;
    const retStr = returnPct !== undefined ? ` · ${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(1)}%` : '';
    const tag = isProf ? 'Profit Banked' : 'Loss Cut';
    return `${isProf ? '🎯' : '✂️'} Sold ${qtyStr}${unitStr} for ${usdStr} @ ${priceStr}${timeStr} (${tag}: ${pnlStr}${retStr})`;
  }
  return `Sold ${qtyStr}${unitStr} for ${usdStr} @ ${priceStr}${timeStr}`;
};

export const parseTradeNotesLineByLine = (notes?: string | null): string[] => {
  if (!notes) return [];
  // Split on newlines, pipes, or unspaced event prefixes like "🎯", "Synced ", "Auto-synced", etc.
  const rawParts = notes
    .replace(/([^\n|])(🎯)/g, '$1\n$2')
    .replace(/([^\n|])(✂️)/g, '$1\n$2')
    .replace(/([^\n|])(Bought\s+[0-9])/g, '$1\n$2')
    .replace(/([^\n|])(Sold\s+[0-9])/g, '$1\n$2')
    .replace(/([^\n|])(Synced (?:Exit|Partial|1 buy|2 buy|\d+ buy|Final|:))/g, '$1\n$2')
    .replace(/([^\n|])(Auto-synced)/g, '$1\n$2')
    .replace(/([^\n|])(Reopened as)/g, '$1\n$2')
    .replace(/([^\n|])(Stop Loss Limit hit)/g, '$1\n$2')
    .split(/\r?\n| \| /);

  const cleanLines: string[] = [];
  for (const part of rawParts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    // Deduplicate consecutive identical lines
    if (cleanLines.length > 0 && cleanLines[cleanLines.length - 1] === trimmed) {
      continue;
    }
    cleanLines.push(trimmed);
  }
  return cleanLines;
};

export interface ParsedTradeNoteItem {
  raw: string;
  type: 'BUY_FILL' | 'PROFIT_BANKED' | 'LOSS_CUT' | 'MILESTONE' | 'SYNC' | 'GENERAL';
  price?: number;
  usdAmount?: number;
  profitUsd?: number;
  returnPct?: number;
  coins?: number;
  percent?: number;
  timestamp?: number;
  label?: string;
  displayText: string;
}

/**
 * Generates an empirical note line recording the exact profit or loss banked at a specific exit price.
 */
export const formatPartialExitNote = (params: {
  trade: Partial<Trade>;
  exitPrice: number;
  exitCoins: number;
  exitPercent?: number;
  reason?: string;
}): string => {
  const { trade, exitPrice, exitCoins, exitPercent, reason } = params;
  const isLong = getTradeIsLong(trade);
  const entry = trade.entryPrice || 0;
  const pnlPerCoin = isLong ? (exitPrice - entry) : (entry - exitPrice);
  const profitUsd = exitCoins * pnlPerCoin;
  const returnPct = entry > 0 ? (pnlPerCoin / entry) * 100 : 0;
  const isProfit = profitUsd >= 0;

  const pctLabel = exitPercent !== undefined && exitPercent > 0 ? `${exitPercent}% ` : '';
  const priceLabel = `@ $${formatPrice(exitPrice)}`;
  const coinsLabel = `${exitCoins.toLocaleString(undefined, { maximumFractionDigits: 6 })} coins`;
  const profitLabel = isProfit ? `+$${profitUsd.toFixed(2)}` : `-$${Math.abs(profitUsd).toFixed(2)}`;
  const returnLabel = `${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(1)}%`;

  if (isProfit) {
    const action = reason || 'Profit Banked';
    return `🎯 ${action} ${pctLabel}${priceLabel}: ${profitLabel} (${coinsLabel} · ${returnLabel})`;
  } else {
    const action = reason || 'Loss Cut';
    return `✂️ ${action} ${pctLabel}${priceLabel}: ${profitLabel} (${coinsLabel} · ${returnLabel})`;
  }
};

/**
 * Parses notes line by line and enriches each line with empirical profit or loss calculations
 * at each price level, even for legacy notes that didn't include the profit calculation.
 */
export const parseStructuredTradeNotes = (
  notes?: string | null,
  trade?: Partial<Trade>
): ParsedTradeNoteItem[] => {
  const lines = parseTradeNotesLineByLine(notes);
  if (lines.length === 0) return [];

  const entry = trade?.entryPrice || 0;
  const isLong = trade ? getTradeIsLong(trade) : true;
  const totalCoins = trade ? getTradeCoins(trade) : 0;

  return lines.map(line => {
    // 0. Check if line is a Buy execution note ("Bought ...")
    if (/^[🟢📥•▪\s]*Bought\b/i.test(line)) {
      const cleanBuyLine = line.replace(/^[🟢📥•▪\s]+/, '').trim();
      const buyCoinsMatch = cleanBuyLine.match(/^Bought\s+([0-9,]+(?:\.[0-9]+)?)/i);
      const buyUsdMatch = cleanBuyLine.match(/for\s+\$([0-9,]+(?:\.[0-9]+)?)/i) || cleanBuyLine.match(/\(\$([0-9,]+(?:\.[0-9]+)?)\)/i);
      const buyPriceMatch = cleanBuyLine.match(/@\s*~?\$?([0-9,]+(?:\.[0-9]+)?)/i);

      return {
        raw: line,
        type: 'BUY_FILL',
        price: buyPriceMatch ? parseFloat(buyPriceMatch[1].replace(/,/g, '')) : undefined,
        usdAmount: buyUsdMatch ? parseFloat(buyUsdMatch[1].replace(/,/g, '')) : undefined,
        coins: buyCoinsMatch ? parseFloat(buyCoinsMatch[1].replace(/,/g, '')) : undefined,
        label: 'Buy',
        displayText: cleanBuyLine
      };
    }

    // 1. Check if line already has explicit "Profit Banked" or "Loss Cut"
    const explicitProfitMatch = line.match(/(?:Profit Banked|Banked profit|Total Banked|Banked|Profit|Gain)\s*(?:[^\n:]*?):\s*([+-]?\$?[0-9,.]+)/i);
    const explicitLossMatch = line.match(/(?:Loss Cut|Loss cut|Cut loss|Total Loss Cut|Loss)\s*(?:[^\n:]*?):\s*([+-]?\$?[0-9,.]+)/i);
    
    // Prefer @ $1.50 first so "for $156.82 @ $0.6130" extracts 0.6130 as the execution price
    const priceMatch = line.match(/@\s*~?\$?([0-9,]+(?:\.[0-9]+)?)/i) ||
      line.match(/(?:price:?|exit:?|hit\s+at|at)\s*~?\$?([0-9,]+(?:\.[0-9]+)?)/i) ||
      line.match(/\$([0-9,]+(?:\.[0-9]+)?)/i);
      
    const pctMatch = line.match(/(?<![+-])(\d+(?:\.\d+)?)\s*%/);
    const coinsMatch = line.match(/([0-9,]+(?:\.[0-9]+)?)\s*(?:coins|tokens|units|shares|pcs)/i) ||
      line.match(/^[🎯✂️\s]*Sold\s+([0-9,]+(?:\.[0-9]+)?)/i);
    const usdForMatch = line.match(/for\s+\$([0-9,]+(?:\.[0-9]+)?)/i);

    let price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : undefined;
    let coins = coinsMatch ? parseFloat(coinsMatch[1].replace(/,/g, '')) : undefined;
    let percent = pctMatch ? parseFloat(pctMatch[1]) : undefined;
    let usdAmount = usdForMatch ? parseFloat(usdForMatch[1].replace(/,/g, '')) : undefined;

    if (!coins && percent && totalCoins > 0) {
      coins = totalCoins * (percent / 100);
    } else if (!coins && !percent && totalCoins > 0 && (line.includes('Final') || line.includes('Closed') || line.includes('Stop Loss Limit hit'))) {
      coins = trade?.soldCoins || totalCoins;
    }

    const isExitKeyword = line.includes('Profit Banked') || line.includes('Loss Cut') || 
      line.includes('🎯') || line.includes('✂️') || 
      line.includes('TP1 Hit') || line.includes('TP2 Hit') || line.includes('TP3 Hit') ||
      line.includes('Trimmed') || line.includes('Sold') || line.includes('Partial') ||
      line.includes('Scale Out') || line.includes('Scaled Out') ||
      line.includes('Stop Loss Limit hit') || line.includes('SL hit') ||
      explicitProfitMatch !== null || explicitLossMatch !== null;

    if (isExitKeyword) {
      let profitUsd: number | undefined;
      let returnPct: number | undefined;

      if (explicitProfitMatch) {
        profitUsd = parseFloat(explicitProfitMatch[1].replace(/[\$,+]/g, ''));
      } else if (explicitLossMatch) {
        const rawLoss = parseFloat(explicitLossMatch[1].replace(/[\$,]/g, ''));
        profitUsd = rawLoss > 0 ? -rawLoss : rawLoss;
      } else if (price !== undefined && coins !== undefined && entry > 0) {
        profitUsd = isLong ? (price - entry) * coins : (entry - price) * coins;
      } else if (price !== undefined && entry > 0 && totalCoins > 0) {
        const assumedCoins = trade?.soldCoins && trade.soldCoins > 0 ? trade.soldCoins : totalCoins;
        profitUsd = isLong ? (price - entry) * assumedCoins : (entry - price) * assumedCoins;
      }

      if (price !== undefined && entry > 0) {
        returnPct = parseFloat(((isLong ? (price - entry) / entry : (entry - price) / entry) * 100).toFixed(2));
      }

      const isProfit = profitUsd !== undefined ? profitUsd >= 0 : (price !== undefined && entry > 0 ? (isLong ? price >= entry : price <= entry) : !line.includes('Loss') && !line.includes('✂️'));

      let displayText = line;
      if (profitUsd !== undefined && !line.includes('+$') && !line.includes('-$')) {
        const sign = profitUsd >= 0 ? '+' : '';
        const pctStr = returnPct !== undefined ? ` · ${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(1)}%` : '';
        if (isProfit) {
          displayText = `${line} → Profit Banked: ${sign}$${profitUsd.toFixed(2)}${pctStr}`;
        } else {
          displayText = `${line} → Loss Cut: -$${Math.abs(profitUsd).toFixed(2)}${pctStr}`;
        }
      }

      return {
        raw: line,
        type: isProfit ? 'PROFIT_BANKED' : 'LOSS_CUT',
        price,
        usdAmount,
        profitUsd,
        returnPct,
        coins,
        percent,
        label: isProfit ? 'Profit Banked' : 'Loss Cut',
        displayText
      };
    }

    if (
      line.includes('Synced') ||
      line.includes('Auto-synced') ||
      line.includes('Binance') ||
      line.includes('Consolidated') ||
      line.includes('Imported from')
    ) {
      return {
        raw: line,
        type: 'SYNC',
        displayText: line
      };
    }

    if (line.includes('Plan:') || line.includes('SL') || line.includes('TP')) {
      return {
        raw: line,
        type: 'MILESTONE',
        displayText: line
      };
    }

    return {
      raw: line,
      type: 'GENERAL',
      displayText: line
    };
  });
};

/**
 * Produces short, subtle buy and sell level notes for any running or closed trade.
 * Ensures every trade shows its buy levels (how much bought, for how much $, at what price, at what time)
 * and sell levels (how much sold, for how much $, at what price, at what time, plus net PnL).
 */
export const getTradeExecutionNotes = (trade?: Partial<Trade> | null): ParsedTradeNoteItem[] => {
  if (!trade) return [];
  const rawItems = parseStructuredTradeNotes(trade.notes, trade);
  if (isLimitOrderTrade(trade)) {
    return rawItems;
  }

  const baseSym = getBaseSymbol(trade.symbol);
  const entry = trade.entryPrice || 0;
  const totalCoins = getTradeCoins(trade);
  const isClosed = isTradeClosed(trade);

  // Separate parsed items by category, filtering out noisy sync boilerplate
  const buyItems: ParsedTradeNoteItem[] = [];
  const exitItems: ParsedTradeNoteItem[] = [];
  const otherItems: ParsedTradeNoteItem[] = [];

  for (const item of rawItems) {
    if (item.type === 'BUY_FILL') {
      buyItems.push(item);
    } else if (item.type === 'PROFIT_BANKED' || item.type === 'LOSS_CUT') {
      exitItems.push(item);
    } else if (item.type === 'SYNC') {
      // Omit boilerplate sync lines when showing execution log
      continue;
    } else {
      const cleaned = (item.displayText || item.raw || '').trim();
      if (/^(?:Auto-synced|Imported from Binance|Updated & synced|Consolidated Binance)/i.test(cleaned)) {
        continue;
      }
      otherItems.push(item);
    }
  }

  // Collect all distinct buy orders from openBuyLots, fills, or ledgerMatches (using else-if to prevent double counting)
  const buyOrderMap = new Map<string, { qty: number; usd: number; price: number; time: number }>();

  if (Array.isArray(trade.openBuyLots) && (trade.openBuyLots as any).length > 0) {
    for (const lot of (trade.openBuyLots as any)) {
      const lotQty = lot.initialQty || lot.qty || lot.remainingQty || 0;
      const lotTime = lot.timestamp || lot.time || trade.filledAt || trade.createdAt || 0;
      const key = String(lot.orderId || lot.buyFillId || lotTime || `lot_${lot.price}_${lotQty}`);
      const cur = buyOrderMap.get(key) || { 
        qty: 0, 
        usd: 0, 
        price: lot.price || entry, 
        time: lotTime 
      };
      cur.qty += lotQty;
      cur.usd += lot.usdValue || lot.costUsd || (lotQty * (lot.price || entry));
      if (lotTime && (!cur.time || lotTime < cur.time)) {
        cur.time = lotTime;
      }
      buyOrderMap.set(key, cur);
    }
  } else if (Array.isArray(trade.fills) && trade.fills.length > 0) {
    for (const f of trade.fills) {
      if (f.isBuyer || f.side === 'BUY') {
        const key = String(f.orderId || f.tradeId || f.timestamp || `fill_${f.price}_${f.qty}`);
        const cur = buyOrderMap.get(key) || { 
          qty: 0, 
          usd: 0, 
          price: f.price || entry, 
          time: f.timestamp || trade.filledAt || trade.createdAt || 0 
        };
        cur.qty += f.qty || 0;
        cur.usd += f.quoteQty || ((f.qty || 0) * (f.price || entry));
        if (f.timestamp && (!cur.time || f.timestamp < cur.time)) {
          cur.time = f.timestamp;
        }
        buyOrderMap.set(key, cur);
      }
    }
  } else if (Array.isArray(trade.ledgerMatches) && trade.ledgerMatches.length > 0) {
    for (const m of trade.ledgerMatches) {
      const key = String(m.buyOrderId || m.buyTradeId || m.buyTimestamp || `buy_${m.buyPrice}_${m.matchedQty}`);
      const cur = buyOrderMap.get(key) || { 
        qty: 0, 
        usd: 0, 
        price: m.buyPrice || entry, 
        time: m.buyTimestamp || trade.filledAt || trade.createdAt || 0 
      };
      cur.qty += m.matchedQty || 0;
      cur.usd += (m.matchedQty || 0) * (m.buyPrice || entry);
      if (m.buyTimestamp && (!cur.time || m.buyTimestamp < cur.time)) {
        cur.time = m.buyTimestamp;
      }
      buyOrderMap.set(key, cur);
    }
    // If single buy order matched via ledgerMatches and initial pre-fee buy size is slightly larger, preserve exact initial buy size
    if (buyOrderMap.size === 1 && totalCoins > 0) {
      const single = Array.from(buyOrderMap.values())[0];
      if (totalCoins > single.qty && Math.abs(totalCoins - single.qty) / totalCoins < 0.01) {
        single.qty = totalCoins;
        single.usd = trade.totalBuyUsd && trade.totalBuyUsd > 0 ? trade.totalBuyUsd : totalCoins * single.price;
      }
    }
  }

  // Always format from buyOrderMap when available so timestamps are rendered in the user's local browser timezone
  if (buyOrderMap.size > 0) {
    const sortedBuys = Array.from(buyOrderMap.values()).sort((a, b) => a.time - b.time);
    if (sortedBuys.length > 0) {
      buyItems.length = 0;
      for (const b of sortedBuys) {
        if (b.qty > 0 && b.price > 0) {
          const line = formatBuyLevelNote({
            qty: b.qty,
            usdAmount: b.usd,
            price: b.price,
            timestamp: b.time,
            symbol: baseSym
          });
          buyItems.push({
            raw: line,
            type: 'BUY_FILL',
            price: b.price,
            usdAmount: b.usd,
            coins: b.qty,
            timestamp: b.time,
            label: 'Buy',
            displayText: line
          });
        }
      }
    }
  } else if (buyItems.length === 1 && (trade.filledAt || trade.createdAt)) {
    // Re-format single note-based buy line using authoritative filledAt/createdAt so server UTC strings never leak into UI
    const bi = buyItems[0];
    const bQty = bi.coins || totalCoins;
    const bPrice = bi.price || entry;
    const bUsd = bi.usdAmount || (trade.totalBuyUsd && trade.totalBuyUsd > 0 ? trade.totalBuyUsd : bQty * bPrice);
    const bTime = trade.filledAt || trade.createdAt;
    if (bQty > 0 && bPrice > 0) {
      const line = formatBuyLevelNote({
        qty: bQty,
        usdAmount: bUsd,
        price: bPrice,
        timestamp: bTime,
        symbol: baseSym
      });
      buyItems[0] = {
        ...bi,
        raw: line,
        price: bPrice,
        usdAmount: bUsd,
        coins: bQty,
        timestamp: bTime,
        displayText: line
      };
    }
  }

  if (buyItems.length === 0 && totalCoins > 0 && entry > 0) {
    const usd = trade.totalBuyUsd && trade.totalBuyUsd > 0 ? trade.totalBuyUsd : totalCoins * entry;
    const ts = trade.filledAt || trade.createdAt;
    const line = formatBuyLevelNote({
      qty: totalCoins,
      usdAmount: usd,
      price: entry,
      timestamp: ts,
      symbol: baseSym
    });
    buyItems.push({
      raw: line,
      type: 'BUY_FILL',
      price: entry,
      usdAmount: usd,
      coins: totalCoins,
      timestamp: ts,
      label: 'Buy',
      displayText: line
    });
  }

  // 2. Normalize or synthesize Sell / Exit items so every sell shows qty, $, price, and local browser timestamp
  let normalizedExits: ParsedTradeNoteItem[] = [];
  const hasShortSoldFormat = exitItems.length > 0 && exitItems.every(it => /^[🎯✂️\s]*Sold\b/i.test(it.raw));
  const earliestBuyTime = buyItems.reduce((min, b) => (b.timestamp && b.timestamp > 0 && b.timestamp < min ? b.timestamp : min), Infinity);
  const validLedgerMatches = Array.isArray(trade.ledgerMatches)
    ? trade.ledgerMatches.filter(m => !Number.isFinite(earliestBuyTime) || !m.sellTimestamp || m.sellTimestamp >= earliestBuyTime - 60000)
    : [];
  const isUnsoldActiveTrade = !isClosed && trade.status === 'ACTIVE' && (!trade.soldCoins || trade.soldCoins <= 0.0001);

  if (isUnsoldActiveTrade) {
    normalizedExits = [];
  } else if (validLedgerMatches.length > 0) {
    const sellOrderMap = new Map<string, { qty: number; usd: number; price: number; pnl: number; time: number }>();
    for (const m of validLedgerMatches) {
      const key = String(m.sellOrderId || m.sellTradeId || m.sellTimestamp || 'sell_1');
      const cur = sellOrderMap.get(key) || {
        qty: 0,
        usd: 0,
        price: m.sellPrice || trade.exitPrice || entry,
        pnl: 0,
        time: m.sellTimestamp || trade.closedAt || 0
      };
      cur.qty += m.matchedQty || 0;
      cur.usd += m.grossProceedsUsd || ((m.matchedQty || 0) * (m.sellPrice || 0));
      cur.pnl += m.netRealizedPnlUsd || 0;
      if (m.sellTimestamp && m.sellTimestamp > cur.time) {
        cur.time = m.sellTimestamp;
      }
      sellOrderMap.set(key, cur);
    }
    const sortedSells = Array.from(sellOrderMap.values()).sort((a, b) => a.time - b.time);
    for (const s of sortedSells) {
      if (s.qty > 0 && s.price > 0) {
        const avgSellPrice = s.usd > 0 ? s.usd / s.qty : s.price;
        const retPct = entry > 0 ? ((avgSellPrice - entry) / entry) * 100 : undefined;
        const isProf = s.pnl >= 0;
        const line = formatSellLevelNote({
          qty: s.qty,
          usdAmount: s.usd,
          price: avgSellPrice,
          pnlUsd: s.pnl,
          returnPct: retPct,
          timestamp: s.time,
          symbol: baseSym
        });
        normalizedExits.push({
          raw: line,
          type: isProf ? 'PROFIT_BANKED' : 'LOSS_CUT',
          price: avgSellPrice,
          usdAmount: s.usd,
          profitUsd: s.pnl,
          returnPct: retPct,
          coins: s.qty,
          timestamp: s.time,
          label: isProf ? 'Profit Banked' : 'Loss Cut',
          displayText: line
        });
      }
    }
  } else if (hasShortSoldFormat) {
    if (exitItems.length === 1 && trade.closedAt) {
      const it = exitItems[0];
      const q = it.coins || trade.soldCoins || (isClosed ? totalCoins : 0);
      const p = it.price || trade.exitPrice || 0;
      if (q > 0 && p > 0) {
        const usd = it.usdAmount || (q * p);
        const line = formatSellLevelNote({
          qty: q,
          usdAmount: usd,
          price: p,
          pnlUsd: it.profitUsd,
          returnPct: it.returnPct,
          timestamp: trade.closedAt,
          symbol: baseSym
        });
        normalizedExits = [{ ...it, raw: line, displayText: line, timestamp: trade.closedAt }];
      } else {
        normalizedExits = exitItems;
      }
    } else {
      normalizedExits = exitItems;
    }
  } else if (exitItems.length > 0) {
    normalizedExits = exitItems.map(it => {
      if (/^[🎯✂️\s]*Sold\b/i.test(it.raw)) return it;
      const q = it.coins || trade.soldCoins || (isClosed ? totalCoins : 0);
      const p = it.price || trade.exitPrice || 0;
      if (q > 0 && p > 0) {
        const usd = q * p;
        const ts = trade.closedAt;
        const line = formatSellLevelNote({
          qty: q,
          usdAmount: usd,
          price: p,
          pnlUsd: it.profitUsd,
          returnPct: it.returnPct,
          timestamp: ts,
          symbol: baseSym
        });
        return {
          ...it,
          usdAmount: usd,
          coins: q,
          displayText: line
        };
      }
      return it;
    });
  } else if (isClosed || (trade.soldCoins && trade.soldCoins > 0)) {
    const soldQ = trade.soldCoins && trade.soldCoins > 0 ? trade.soldCoins : totalCoins;
    const exitP = getTradeExitPrice(trade) || trade.exitPrice || entry;
    if (soldQ > 0 && exitP > 0) {
      const sellUsd = trade.totalSellUsd && trade.totalSellUsd > 0 ? trade.totalSellUsd : soldQ * exitP;
      const pnl = trade.realizedProfitUsd !== undefined ? trade.realizedProfitUsd : (exitP - entry) * soldQ;
      const retPct = entry > 0 ? ((exitP - entry) / entry) * 100 : undefined;
      const isProf = pnl >= 0;
      const ts = trade.closedAt || trade.updatedAt;
      const line = formatSellLevelNote({
        qty: soldQ,
        usdAmount: sellUsd,
        price: exitP,
        pnlUsd: pnl,
        returnPct: retPct,
        timestamp: ts,
        symbol: baseSym
      });
      normalizedExits.push({
        raw: line,
        type: isProf ? 'PROFIT_BANKED' : 'LOSS_CUT',
        price: exitP,
        usdAmount: sellUsd,
        profitUsd: pnl,
        returnPct: retPct,
        coins: soldQ,
        timestamp: ts,
        label: isProf ? 'Profit Banked' : 'Loss Cut',
        displayText: line
      });
    }
  }

  return [...buyItems, ...normalizedExits, ...otherItems];
};

export interface TradeBankedProfitInfo {
  hasBankedProfit: boolean;
  hasLossCut: boolean;
  bankedAmountUsd: number;
  totalProfitBankedUsd: number;
  totalLossCutUsd: number;
  soldCoins: number;
  soldPercent: number;
  exits: ParsedTradeNoteItem[];
}

/**
 * Returns banked profit/loss cut status and metrics for any trade,
 * enriched with empirical exit-by-exit price points from structured notes.
 */
export const getTradeBankedProfit = (trade: Partial<Trade>): TradeBankedProfitInfo => {
  const soldCoins = trade.soldCoins || 0;
  const initialCoins = getTradeCoins(trade);
  const soldPercent = initialCoins > 0 && soldCoins > 0
    ? Math.min(100, Math.round((soldCoins / initialCoins) * 100))
    : (trade.status === 'HIT_TP1' ? (trade.tp1Percent || 50) : (trade.status === 'PARTIAL_EXIT' ? (trade.tp1Percent || 50) : 0));

  // Protect untouched long-term investments from phantom banked profits
  const isUntouchedEthHolding = trade.type === 'HOLDING' && (trade.symbol || '').toUpperCase().includes('ETH');
  if (isUntouchedEthHolding || (trade.type === 'HOLDING' && (trade.soldCoins || 0) <= 0.00001 && trade.status !== 'PARTIAL_EXIT')) {
    return {
      hasBankedProfit: false,
      hasLossCut: false,
      bankedAmountUsd: 0,
      totalProfitBankedUsd: 0,
      totalLossCutUsd: 0,
      soldCoins: 0,
      soldPercent: 0,
      exits: []
    };
  }

  const parsedItems = parseStructuredTradeNotes(trade.notes, trade);
  const exits = parsedItems.filter(item => (item.type === 'PROFIT_BANKED' || item.type === 'LOSS_CUT') && item.price !== undefined);

  let sumBankedFromExits = 0;
  let totalProfitBankedUsd = 0;
  let totalLossCutUsd = 0;

  for (const exit of exits) {
    if (exit.profitUsd !== undefined) {
      sumBankedFromExits += exit.profitUsd;
      if (exit.profitUsd >= 0) {
        totalProfitBankedUsd += exit.profitUsd;
      } else {
        totalLossCutUsd += Math.abs(exit.profitUsd);
      }
    }
  }

  const explicitRealized = trade.realizedProfitUsd !== undefined && trade.realizedProfitUsd !== null
    ? trade.realizedProfitUsd
    : 0;

  // Use sum of note exits if available and non-zero, otherwise fallback to explicitRealized
  const bankedAmountUsd = sumBankedFromExits !== 0 ? sumBankedFromExits : explicitRealized;

  if (explicitRealized !== 0) {
    if (explicitRealized > 0 && totalProfitBankedUsd === 0) {
      totalProfitBankedUsd = explicitRealized;
    } else if (explicitRealized < 0 && totalLossCutUsd === 0) {
      totalLossCutUsd = Math.abs(explicitRealized);
    }
  }

  const hasBankedProfit = bankedAmountUsd > 0.005 || totalProfitBankedUsd > 0.005;
  const hasLossCut = bankedAmountUsd < -0.005 || totalLossCutUsd > 0.005;

  return {
    hasBankedProfit,
    hasLossCut,
    bankedAmountUsd,
    totalProfitBankedUsd,
    totalLossCutUsd,
    soldCoins,
    soldPercent,
    exits
  };
};

export const getBankedReturnPercent = (
  trade: Partial<Trade>, 
  bankedInfo: TradeBankedProfitInfo, 
  portfolioSize?: number
): number => {
  const soldCoins = trade.soldCoins || bankedInfo.soldCoins || 0;
  const entry = trade.entryPrice || 0;
  if (entry > 0 && soldCoins > 0) {
    const costBasis = soldCoins * entry;
    if (costBasis > 0) return (bankedInfo.bankedAmountUsd / costBasis) * 100;
  }
  const totalCoins = trade.positionSizeCoins || (trade.totalBuyUsd && entry > 0 ? trade.totalBuyUsd / entry : 0);
  if (entry > 0 && totalCoins > 0) {
    const totalCost = totalCoins * entry;
    if (totalCost > 0) return (bankedInfo.bankedAmountUsd / totalCost) * 100;
  }
  if (trade.totalBuyUsd && trade.totalBuyUsd > 0) {
    return (bankedInfo.bankedAmountUsd / trade.totalBuyUsd) * 100;
  }
  const port = portfolioSize || trade.portfolioSize || 0;
  if (port > 0) {
    return (bankedInfo.bankedAmountUsd / port) * 100;
  }
  return 0;
};

export const formatBankedProfitDisplay = (
  trade: Partial<Trade>,
  bankedInfo: TradeBankedProfitInfo,
  viewMode: PnlViewMode = 'DOLLAR',
  portfolioSize?: number
): string => {
  if (viewMode === 'ZEN') return '••••';
  const isProfit = bankedInfo.bankedAmountUsd >= 0;
  const sign = isProfit ? '+' : '-';
  const absAmount = Math.abs(bankedInfo.bankedAmountUsd);

  if (viewMode === 'PERCENT') {
    const pct = getBankedReturnPercent(trade, bankedInfo, portfolioSize);
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  }
  if (viewMode === 'R_MULTIPLE') {
    const riskUnit = trade.riskAmount || (portfolioSize ? portfolioSize * ((trade.riskPercent || 1) / 100) : 1);
    const r = riskUnit > 0 ? (bankedInfo.bankedAmountUsd / riskUnit) : 0;
    return `${r >= 0 ? '+' : ''}${r.toFixed(2)}R`;
  }
  return `${sign}$${absAmount.toFixed(2)}`;
};

export const formatExitPnlDisplay = (
  exit: ParsedTradeNoteItem,
  viewMode: PnlViewMode = 'DOLLAR',
  entryPrice?: number
): string => {
  if (viewMode === 'ZEN') return '••••';
  const pnl = exit.profitUsd || 0;
  const isProf = pnl >= 0;
  const sign = isProf ? '+' : '-';

  if (viewMode === 'PERCENT') {
    if (exit.returnPct !== undefined) {
      return `${exit.returnPct >= 0 ? '+' : ''}${exit.returnPct.toFixed(1)}%`;
    }
    if (exit.price !== undefined && entryPrice && entryPrice > 0) {
      const p = ((exit.price - entryPrice) / entryPrice) * 100;
      return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
    }
    return `${sign}${Math.abs(pnl).toFixed(1)}%`;
  }

  return `${sign}$${Math.abs(pnl).toFixed(2)}`;
};

export const formatNoteLineForView = (
  item: ParsedTradeNoteItem,
  viewMode: PnlViewMode = 'DOLLAR',
  trade?: Partial<Trade>
): string => {
  let text = item.displayText || item.raw;
  // Always strip leading duplicate emojis
  text = text.replace(/^[🎯✂️🟢📥•▪\s]+/, '').trim();

  // Strip repetitive "Profit Banked:" and "Loss Cut:" prefixes to make notes compact
  text = text.replace(/^(?:Profit Banked|Banked profit|Total Banked|Banked|Loss Cut|Loss cut|Cut loss|Total Loss Cut):\s*/i, '');

  // Strip trailing "(Profit Banked: +$X.XX · +Y.Y%)" when the line starts with "Sold " so the line stays short and subtle
  if (/^Sold\b/i.test(text)) {
    text = text.replace(/\s*\((?:Profit Banked|Loss Cut):\s*[^)]+\)\s*$/i, '').trim();
  }

  if (viewMode === 'PERCENT') {
    if (!/^Bought\b|^Sold\b/i.test(text)) {
      // If text has +$XX.XX or -$XX.XX, replace with return percentage
      if (item.returnPct !== undefined) {
        text = text.replace(/^[+-]?\$?[0-9,.]+(?:\s*USD)?/i, `${item.returnPct >= 0 ? '+' : ''}${item.returnPct.toFixed(1)}%`);
      } else if (item.price !== undefined && trade?.entryPrice && trade.entryPrice > 0) {
        const isLong = getTradeIsLong(trade);
        const ret = ((isLong ? (item.price - trade.entryPrice) : (trade.entryPrice - item.price)) / trade.entryPrice) * 100;
        text = text.replace(/^[+-]?\$?[0-9,.]+(?:\s*USD)?/i, `${ret >= 0 ? '+' : ''}${ret.toFixed(1)}%`);
      }
    }
    // Remove all remaining $ signs and USD tokens in % mode
    text = text.replace(/\$/g, '').replace(/\bUSD\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  }

  return text;
};

export const getTradeExitPrice = (trade: Partial<Trade>): number | null => {
  if (!trade) return null;

  // 1. Check if an explicit execution exit price was logged in Binance notes (most authentic fill data)
  const noteExit = parseExitFromNotes(trade.notes);

  // 2. Mathematical reconstruction from realizedProfitUsd and trade position
  const entry = trade.entryPrice || 0;
  const coins = trade.soldCoins || trade.positionSizeCoins || (trade.totalBuyUsd && entry > 0 ? trade.totalBuyUsd / entry : 0);
  const realizedPnL = trade.realizedProfitUsd;
  let mathExit: number | null = null;

  if (entry > 0 && coins > 0 && realizedPnL !== undefined && realizedPnL !== null) {
    const isLong = getTradeIsLong(trade);
    const fees = trade.sellFeeUsd || (trade.totalFeesUsd ? trade.totalFeesUsd / 2 : (trade.feeUsd ? trade.feeUsd / 2 : 0));
    const grossProfit = realizedPnL + fees;
    const profitPerCoin = grossProfit / coins;
    const calculatedExit = isLong ? (entry + profitPerCoin) : (entry - profitPerCoin);
    if (calculatedExit > 0) {
      mathExit = calculatedExit;
    }
  }

  // If noteExit exists and is reasonable, prefer it as the exact order price
  if (noteExit !== null && noteExit > 0) {
    if (!mathExit || Math.abs(noteExit - mathExit) / mathExit < 0.05) {
      return noteExit;
    }
  }

  // 3. If explicit exitPrice is recorded and > 0, verify it is not a distorted live ticker price
  if (trade.exitPrice !== undefined && trade.exitPrice !== null && trade.exitPrice > 0) {
    // If mathExit exists, ensure exitPrice is consistent with realized PnL
    if (mathExit !== null && mathExit > 0) {
      const relDiff = Math.abs(trade.exitPrice - mathExit) / mathExit;
      if (relDiff > 0.05 && noteExit !== null) {
        return noteExit;
      }
      if (relDiff > 0.05) {
        return mathExit;
      }
    }
    return trade.exitPrice;
  }

  // 4. Mathematical fallback if exitPrice was missing
  if (mathExit !== null && mathExit > 0) {
    return mathExit;
  }

  // 5. Milestone fallbacks
  if (trade.status === 'HIT_SL' && trade.stopLoss && trade.stopLoss > 0) {
    return trade.stopLoss;
  }
  if (trade.status === 'HIT_TP1' && trade.takeProfit1 && trade.takeProfit1 > 0) {
    return trade.takeProfit1;
  }

  // 6. If explicitly closed at breakeven or zero PnL
  if (trade.status === 'CLOSED_BREAK_EVEN' || trade.status === 'BREAK_EVEN' || (realizedPnL !== undefined && Math.abs(realizedPnL) < 0.01)) {
    return trade.entryPrice || null;
  }

  return trade.exitPrice || trade.entryPrice || null;
};

export const getCleanSymbol = (sym: string | undefined | null): string => {
  if (!sym) return '';
  let s = sym.trim().toUpperCase().replace(/[\/\-_ ]/g, '');
  while (s.endsWith('USDCUSDT') || s.endsWith('USDTUSDT') || s.endsWith('USDCUSDC') || s.endsWith('USDTUSDC')) {
    if (s.endsWith('USDCUSDT')) s = s.replace(/USDT$/, '');
    else if (s.endsWith('USDTUSDT')) s = s.replace(/USDT$/, '');
    else if (s.endsWith('USDCUSDC')) s = s.replace(/USDC$/, '');
    else if (s.endsWith('USDTUSDC')) s = s.replace(/USDC$/, '');
  }
  if (
    s.endsWith('USDT') || 
    s.endsWith('USDC') || 
    s.endsWith('BUSD') || 
    s.endsWith('FDUSD') || 
    s.endsWith('TUSD') || 
    (s !== 'BTC' && s.endsWith('BTC')) || 
    (s !== 'ETH' && s.endsWith('ETH'))
  ) {
    return s;
  }
  return `${s}USDT`;
};

export const getBaseSymbol = (sym: string | undefined | null): string => {
  if (!sym) return '';
  const s = sym.trim().toUpperCase().replace(/[\/\-_ ]/g, '');
  return s.replace(/(USDT|USDC|BUSD|FDUSD|TUSD)$/, '');
};

export const isSameSymbol = (sym1: string | undefined | null, sym2: string | undefined | null): boolean => {
  if (!sym1 || !sym2) return false;
  const c1 = getCleanSymbol(sym1);
  const c2 = getCleanSymbol(sym2);
  if (c1 === c2) return true;
  const b1 = getBaseSymbol(sym1);
  const b2 = getBaseSymbol(sym2);
  return Boolean(b1 && b2 && b1 === b2);
};

export const isLimitOrderTrade = (trade: Partial<Trade>): boolean => {
  if (!trade) return false;
  const status = (trade.status || '').toUpperCase();
  return status === 'PENDING' || status === 'LIMIT' || status === 'LIMIT_ORDER';
};

export const isBinanceLimitOrder = (trade: Partial<Trade>): boolean => {
  if (!isLimitOrderTrade(trade)) return false;
  return Boolean(
    trade.binanceOrderId || 
    trade.clientOrderId || 
    (trade.notes && (
      trade.notes.includes('Binance') || 
      trade.notes.includes('synced') || 
      trade.notes.includes('Imported')
    ))
  );
};

export const isBinanceLinkedTrade = (trade: Partial<Trade>): boolean => {
  if (!trade) return false;
  if (trade.isDemo) return false;
  if (trade.type === 'HOLDING') return true;
  if (trade.id && (trade.id.startsWith('binance_') || trade.id.startsWith('trade_closed_'))) return true;
  if (trade.market === 'SPOT' && !isAlphaTradeOrSymbol(trade)) return true;
  return Boolean(
    trade.binanceOrderId || 
    trade.clientOrderId || 
    (trade.notes && (
      trade.notes.includes('Binance') || 
      trade.notes.includes('synced') || 
      trade.notes.includes('Imported') ||
      trade.notes.includes('Auto-synced') ||
      trade.notes.includes('Bought ') ||
      trade.notes.includes('Sold ')
    ))
  );
};

export const getTradeEffectiveRisk = (trade: Partial<Trade>, method: CostBasisMethod = 'WAC'): number => {
  if (trade.stopLoss && isStopLossAtBreakeven(trade)) {
    return 0;
  }
  const activeEntry = getTradeEntryPriceByMethod(trade, method) || trade.entryPrice || 0;
  if (trade.stopLoss && activeEntry && D(activeEntry).minus(D(trade.stopLoss)).abs().greaterThan(0.00000001)) {
    const coins = D(getTradeCoins(trade));
    const riskPerCoin = D(activeEntry).minus(D(trade.stopLoss)).abs();
    const calculatedRisk = dRound6(coins.times(riskPerCoin));
    // When coins and price delta give a valid risk amount, this is the authentic execution risk
    if (calculatedRisk > 0) {
      return calculatedRisk;
    }
    // Fallback to explicit riskAmount if coins could not be derived
    if (trade.riskAmount && trade.riskAmount > 0) {
      return dRound6(trade.riskAmount);
    }
    return calculatedRisk;
  }
  return dRound6(trade.riskAmount || 0);
};

export const getTradeEffectiveRiskPercent = (trade: Partial<Trade>, portfolioSize?: number, method: CostBasisMethod = 'WAC'): number => {
  const riskAmount = D(getTradeEffectiveRisk(trade, method));
  if (riskAmount.lessThanOrEqualTo(0)) return 0;
  const pSize = D((trade.portfolioSize && trade.portfolioSize > 0) ? trade.portfolioSize : (portfolioSize || 0));
  if (pSize.greaterThan(0) && riskAmount.greaterThan(0)) {
    return dRound4(riskAmount.dividedBy(pSize).times(100));
  }
  return trade.riskPercent || 0;
};

/**
 * Institutional No-SL Risk & R:R Framework.
 * 
 * Defines how risk, target R:R, and R-multiples are calculated for trades
 * that lack an explicit stop loss (e.g. Spot holdings, manual DCA, or Binance imports).
 */
export const getTradeRiskFramework = (
  trade: Partial<Trade>,
  portfolioSize?: number,
  method: CostBasisMethod = 'WAC'
): TradeRiskFramework => {
  const isLong = getTradeIsLong(trade);
  const coins = D(getTradeCoins(trade));
  const entry = D(getTradeEntryPriceByMethod(trade, method) || trade.entryPrice || 0);
  const invested = D(getTradeInvestedAmount(trade, method));
  const stopLoss = D(trade.stopLoss || 0);
  const tp1 = D(trade.takeProfit1 || 0);

  // 1. Calculate Portfolio 1R Unit (standard 1% of equity)
  const effectivePortfolio = (trade.portfolioSize && trade.portfolioSize > 0)
    ? D(trade.portfolioSize)
    : (portfolioSize && portfolioSize > 0)
      ? D(portfolioSize)
      : (invested.greaterThan(0) ? invested.times(10) : D(10000));
  
  const riskPct = (trade.riskPercent && trade.riskPercent > 0) ? D(trade.riskPercent) : D(1.0);
  const portfolioRiskUnit = DecimalMaxOne(effectivePortfolio.times(riskPct).dividedBy(100)).toNumber();

  // Case 1: Hard Stop Loss
  if (stopLoss.greaterThan(0) && !isStopLossAtBreakeven(trade) && stopLoss.minus(entry).abs().greaterThan(0.00000001)) {
    const riskPerCoin = entry.minus(stopLoss).abs();
    const calculatedRisk = coins.greaterThan(0) ? coins.times(riskPerCoin) : D(0);
    const riskAmountD = calculatedRisk.greaterThan(0)
      ? calculatedRisk
      : ((trade.riskAmount && trade.riskAmount > 0)
          ? D(trade.riskAmount)
          : (invested.greaterThan(0) && entry.greaterThan(0) ? invested.times(riskPerCoin.dividedBy(entry)) : riskPerCoin));
    const riskAmount = dRound6(riskAmountD);
    
    let impliedRR: number | null = null;
    if (tp1.greaterThan(0) && riskAmount > 0) {
      impliedRR = calculateTargetRR(entry.toNumber(), stopLoss.toNumber(), tp1.toNumber());
    }

    return {
      riskType: 'HARD_STOP',
      effectiveRiskAmount: riskAmount,
      maxDownsideExposure: riskAmount,
      portfolioRiskUnit,
      isUnprotected: false,
      isBreakeven: false,
      impliedStopLoss: stopLoss.toNumber(),
      impliedRiskReward: impliedRR !== null ? dRound2(impliedRR) : null,
      benchmarkLabel: `Hard Stop (-$${riskAmount.toFixed(2)})`,
      recommendedStops: null
    };
  }

  // Case 2: Breakeven Stop Loss (stopLoss === entry)
  if (stopLoss.greaterThan(0) && isStopLossAtBreakeven(trade)) {
    return {
      riskType: 'BREAKEVEN',
      effectiveRiskAmount: 0,
      maxDownsideExposure: 0,
      portfolioRiskUnit,
      isUnprotected: false,
      isBreakeven: true,
      impliedStopLoss: entry.toNumber(),
      impliedRiskReward: null,
      benchmarkLabel: 'Risk-Free Breakeven (0.00R)',
      recommendedStops: null
    };
  }

  // Case 3: No Stop Loss (Unprotected Downside)
  const maxDownsideExposure = (invested.greaterThan(0) ? invested : coins.times(entry)).toNumber();

  // Determine benchmark stops
  let recommendedStops: RecommendedStops;
  let impliedStopLoss: number | null = null;
  let impliedRiskReward: number | null = null;

  if (tp1.greaterThan(0) && entry.greaterThan(0)) {
    const targetDelta = tp1.minus(entry).abs();
    const targetProfit = coins.greaterThan(0) ? coins.times(targetDelta) : targetDelta;
    
    // Implied benchmark stops based on reward targets
    const balancedStop = isLong ? entry.minus(targetDelta.dividedBy(2)) : entry.plus(targetDelta.dividedBy(2)); // 1:2 RR
    const conservativeStop = isLong ? entry.minus(targetDelta.dividedBy(3)) : entry.plus(targetDelta.dividedBy(3)); // 1:3 RR
    const aggressiveStop = isLong ? entry.minus(targetDelta.dividedBy(1.5)) : entry.plus(targetDelta.dividedBy(1.5)); // 1:1.5 RR

    recommendedStops = {
      conservative: Math.max(0, dRound6(conservativeStop)),
      balanced: Math.max(0, dRound6(balancedStop)),
      aggressive: Math.max(0, dRound6(aggressiveStop))
    };
    impliedStopLoss = recommendedStops.balanced;
    
    // Implied R:R against standard portfolio risk unit
    impliedRiskReward = portfolioRiskUnit > 0 ? dRound2(targetProfit.dividedBy(portfolioRiskUnit)) : 2.0;
  } else if (entry.greaterThan(0)) {
    // Technical percentage-based stops (-3%, -5%, -10%)
    recommendedStops = {
      conservative: dRound6(isLong ? entry.times(0.97) : entry.times(1.03)),
      balanced: dRound6(isLong ? entry.times(0.95) : entry.times(1.05)),
      aggressive: dRound6(isLong ? entry.times(0.90) : entry.times(1.10))
    };
    impliedStopLoss = recommendedStops.balanced;
  } else {
    recommendedStops = {
      conservative: 0,
      balanced: 0,
      aggressive: 0
    };
  }

  // Effective risk for R-Multiple: use Portfolio 1R unit (or 5% position cost if no portfolio)
  const effectiveRiskAmount = portfolioRiskUnit > 0
    ? portfolioRiskUnit
    : (maxDownsideExposure > 0 ? dRound6(D(maxDownsideExposure).times(0.05)) : 100);

  return {
    riskType: 'PORTFOLIO_UNIT',
    effectiveRiskAmount,
    maxDownsideExposure,
    portfolioRiskUnit,
    isUnprotected: true,
    isBreakeven: false,
    impliedStopLoss,
    impliedRiskReward,
    benchmarkLabel: `Normalized 1R (${riskPct.toNumber()}% Equity: $${effectiveRiskAmount.toFixed(0)})`,
    recommendedStops
  };
};

function DecimalMaxOne(val: ReturnType<typeof D>) {
  return val.greaterThan(1) ? val : D(1);
}

/**
 * Calculates R-multiple using the No-SL Framework & Decimal arbitrary-precision engine.
 * For trades with hard stops: PnL / explicitRisk (or unskewed per-coin reward/risk).
 * For trades with no stop loss: PnL / portfolioRiskUnit (normalized to 1% equity).
 */
export const calculateNormalizedRMultiple = (
  pnl: number,
  trade: Partial<Trade>,
  portfolioSize?: number,
  method: CostBasisMethod = 'WAC'
): { r: number; rExact4?: number; isNormalized: boolean; note: string } => {
  const framework = getTradeRiskFramework(trade, portfolioSize, method);
  const pnlD = D(pnl);

  if (framework.riskType === 'BREAKEVEN') {
    if (pnlD.abs().lessThan(0.01)) {
      return { r: 0, rExact4: 0, isNormalized: false, note: 'Breakeven (0.00R)' };
    }
    const r = framework.portfolioRiskUnit > 0 ? pnlD.dividedBy(D(framework.portfolioRiskUnit)) : D(0);
    return { r: dRound2(r), rExact4: dRound4(r), isNormalized: true, note: 'Risk-free upside normalized to 1R' };
  }

  if (framework.riskType === 'HARD_STOP') {
    const activeEntry = D(getTradeEntryPriceByMethod(trade, method) || trade.entryPrice || 0);
    // When trade has entryPrice, exitPrice, and stopLoss, calculate empirical R based on reward-to-risk: (exit - entry) / (entry - stop)
    if (trade.exitPrice && activeEntry.greaterThan(0) && trade.stopLoss && activeEntry.minus(D(trade.stopLoss)).abs().greaterThan(0.00000001)) {
      const isLong = getTradeIsLong(trade);
      const perCoinRisk = activeEntry.minus(D(trade.stopLoss)).abs();
      const perCoinReward = isLong ? D(trade.exitPrice).minus(activeEntry) : activeEntry.minus(D(trade.exitPrice));
      const r = perCoinReward.dividedBy(perCoinRisk);
      return { r: dRound2(r), rExact4: dRound4(r), isNormalized: false, note: `Hard Stop R-Multiple (${method})` };
    }
    const r = framework.effectiveRiskAmount > 0 ? pnlD.dividedBy(D(framework.effectiveRiskAmount)) : D(0);
    return { r: dRound2(r), rExact4: dRound4(r), isNormalized: false, note: `Hard Stop R-Multiple (${method})` };
  }

  // No-SL trade: normalized against 1R unit
  const r = framework.effectiveRiskAmount > 0 ? pnlD.dividedBy(D(framework.effectiveRiskAmount)) : D(0);
  return { 
    r: dRound2(r), 
    rExact4: dRound4(r),
    isNormalized: true, 
    note: `Normalized against 1R portfolio risk unit ($${framework.effectiveRiskAmount.toFixed(0)})` 
  };
};

export const getTradeIsLong = (trade: Partial<Trade>): boolean => {
  if (trade.isLong !== undefined) return trade.isLong;
  if (trade.takeProfit1 && trade.entryPrice && trade.takeProfit1 !== trade.entryPrice) {
    return trade.takeProfit1 > trade.entryPrice;
  }
  if (trade.stopLoss && trade.entryPrice && trade.stopLoss !== trade.entryPrice) {
    return trade.entryPrice > trade.stopLoss;
  }
  return true;
};

export const calculateTargetRR = (entry: number, stop: number, tp: number): number => {
  const entryD = D(entry);
  const stopD = D(stop);
  const tpD = D(tp);
  if (entryD.lessThanOrEqualTo(0) || tpD.lessThanOrEqualTo(0)) return 0;
  const isLong = stopD.greaterThan(0) ? entryD.greaterThan(stopD) : tpD.greaterThan(entryD);
  const riskPerCoin = (stopD.greaterThan(0) && entryD.minus(stopD).abs().greaterThan(0.00000001)) 
    ? entryD.minus(stopD).abs() 
    : entryD.times(0.05); // benchmark 5% risk if no SL or breakeven
  const profitPerCoin = isLong ? tpD.minus(entryD) : entryD.minus(tpD);
  return dRound4(profitPerCoin.dividedBy(riskPerCoin));
};

export const calculateTargetProfit = (
  entry: number,
  stop: number,
  tp: number,
  coins: number,
  pct: number
): number => {
  const entryD = D(entry);
  const stopD = D(stop);
  const tpD = D(tp);
  const coinsD = D(coins);
  const pctD = D(pct);
  if (tpD.isZero() || pctD.isZero() || coinsD.lessThanOrEqualTo(0) || entryD.lessThanOrEqualTo(0)) return 0;
  const isLong = stopD.greaterThan(0) ? entryD.greaterThan(stopD) : tpD.greaterThan(entryD);
  const profitPerCoin = isLong ? tpD.minus(entryD) : entryD.minus(tpD);
  const soldCoins = coinsD.times(pctD.dividedBy(100));
  return dRound8(soldCoins.times(profitPerCoin));
};

export const calculateTargetSellFee = (
  tp: number,
  coins: number,
  pct: number,
  feeRate: number = 0.001
): number => {
  const tpD = D(tp);
  const coinsD = D(coins);
  const pctD = D(pct);
  if (tpD.isZero() || pctD.isZero() || coinsD.lessThanOrEqualTo(0)) return 0;
  const soldCoins = coinsD.times(pctD.dividedBy(100));
  return dRound8(soldCoins.times(tpD).times(D(feeRate)));
};

export const calculateProfit = (trade: Partial<Trade>, tp: number, pct: number, method: CostBasisMethod = 'WAC') => {
  const entry = getTradeEntryPriceByMethod(trade, method) || trade.entryPrice;
  if (!entry || !trade.positionSizeCoins) return 0;
  return calculateTargetProfit(
    entry,
    trade.stopLoss || 0,
    tp,
    trade.positionSizeCoins,
    pct
  );
};

export const calculateRemainingCoins = (trade?: Partial<Trade> | null) => {
  if (!trade) return 0;
  const status = trade.status || 'ACTIVE';
  if (['HIT_SL', 'CLOSED_MANUAL', 'CLOSED_BREAK_EVEN', 'BREAK_EVEN', 'HIT_TP3'].includes(status)) return 0;
  if (trade.closedAt) return 0;

  const totalCoins = D(trade.positionSizeCoins || 0);
  if (totalCoins.lessThanOrEqualTo(0)) return 0;

  // 1. If explicit soldCoins is tracked
  if (trade.soldCoins !== undefined && trade.soldCoins > 0) {
    const soldD = D(trade.soldCoins);
    if (totalCoins.greaterThan(soldD)) {
      const remaining = totalCoins.minus(soldD);
      return remaining.greaterThan(0.00000001) ? dRound8(remaining) : 0;
    }
    // If soldCoins >= totalCoins (e.g. positionSizeCoins holds remaining held coins from Binance sync),
    // and status is an open partial exit / active trade, the held coins are still active!
    if (['ACTIVE', 'HIT_TP1', 'HIT_TP2', 'PARTIAL_EXIT'].includes(status)) {
      return dRound8(totalCoins);
    }
    return 0;
  }

  // 2. If status is PARTIAL_EXIT without explicit soldCoins
  if (status === 'PARTIAL_EXIT') {
    const soldPct = D(Math.min(99, trade.tp1Percent || 50));
    return dRound8(totalCoins.times(D(1).minus(soldPct.dividedBy(100))));
  }

  let soldPct = 0;
  if (status === 'HIT_TP1') {
    soldPct = trade.tp1Percent || 50;
  } else if (status === 'HIT_TP2') {
    soldPct = (trade.tp1Percent || 50) + (trade.tp2Percent || 25);
    if (soldPct >= 100) {
      soldPct = 75; // Safety fallback so active trade position is not zeroed out
    }
  }

  const clampedPct = D(Math.min(99, Math.max(0, soldPct)));
  const remaining = totalCoins.times(D(1).minus(clampedPct.dividedBy(100)));
  return remaining.greaterThan(0.00000001) ? dRound8(remaining) : 0;
};

/**
 * Accurately extracts and converts execution commission into USDT using 20-digit Decimal math.
 */
export function calculateExecutionFeeInUsd(
  commissionAsset: string | undefined,
  commissionAmount: number | string | undefined,
  executionPrice: number,
  symbol: string,
  bnbPrice: number = 600
): number {
  if (!commissionAmount) return 0;
  const comm = D(commissionAmount);
  if (comm.lessThanOrEqualTo(0)) return 0;
  const execPriceD = D(executionPrice);
  
  const asset = (commissionAsset || 'USDT').trim().toUpperCase();
  const cleanSym = symbol.trim().toUpperCase();
  
  // 1. USD stablecoins (1:1 USD equivalent)
  if (['USDT', 'USD', 'USDC', 'BUSD', 'FDUSD', 'TUSD'].includes(asset)) {
    return dRound8(comm);
  }
  
  // 2. Base coin of the traded pair (e.g. BTC in BTCUSDT, SOL in SOLUSDT, FLOKI in 1000FLOKIUSDT)
  const withoutQuote = cleanSym.replace(/(USDT|USDC|BUSD|FDUSD|TUSD|EUR|TRY|BIDR)$/, '');
  const baseAssetWithoutPrefix = withoutQuote.replace(/^(1000000|100000|10000|1000)/, '');
  
  if (
    asset === withoutQuote || 
    cleanSym.startsWith(asset) || 
    asset === baseAssetWithoutPrefix ||
    cleanSym.includes(asset)
  ) {
    if (withoutQuote.startsWith('1000') && !asset.startsWith('1000')) {
      const match = withoutQuote.match(/^(1000000|100000|10000|1000)/);
      const mult = match ? parseInt(match[1], 10) : 1000;
      return dRound8(comm.times(execPriceD.dividedBy(mult)));
    }
    return dRound8(comm.times(execPriceD));
  }
  
  // 3. BNB fee discount
  if (asset === 'BNB') {
    const bnbP = D(bnbPrice > 0 ? bnbPrice : 600);
    return dRound8(comm.times(bnbP));
  }
  
  return dRound8(comm.times(execPriceD));
}

/**
 * Consolidates all fee sources for a trade using Decimal arithmetic.
 */
export const getTradeConsolidatedFees = (trade: Partial<Trade>): {
  buyFee: number;
  sellFee: number;
  totalFees: number;
} => {
  const buyFee = D(trade.buyFeeUsd ?? (trade.feeUsd && !trade.soldCoins ? trade.feeUsd : 0));
  const sellFee = D(trade.sellFeeUsd ?? (trade.feeUsd && trade.soldCoins ? trade.feeUsd : 0));
  let totalFees = D(0);

  if (trade.totalFeesUsd !== undefined && trade.totalFeesUsd > 0) {
    totalFees = D(trade.totalFeesUsd);
  } else if (trade.buyFeeUsd !== undefined && trade.sellFeeUsd !== undefined) {
    totalFees = D(trade.buyFeeUsd).plus(D(trade.sellFeeUsd));
  } else if (buyFee.greaterThan(0) || sellFee.greaterThan(0)) {
    totalFees = buyFee.plus(sellFee);
  } else if (trade.feeUsd && trade.feeUsd > 0) {
    totalFees = D(trade.feeUsd);
  } else if (trade.totalBuyUsd && trade.totalBuyUsd > 0) {
    totalFees = D(trade.totalBuyUsd).times(0.001); // 0.1% standard fee
  }

  return {
    buyFee: dRound8(trade.buyFeeUsd !== undefined ? D(trade.buyFeeUsd) : (trade.totalBuyUsd ? D(trade.totalBuyUsd).times(0.001) : D(0))),
    sellFee: dRound8(trade.sellFeeUsd ?? 0),
    totalFees: dRound8(totalFees)
  };
};

/**
 * Calculates the dynamic blended breakeven price on remaining coins using Decimal math.
 */
export const calculateBlendedBreakeven = (trade: Trade, method: CostBasisMethod = 'WAC'): {
  blendedBreakeven: number | null;
  shiftPercent: number;
  originalEntry: number;
} => {
  const originalEntryNum = getTradeEntryPriceByMethod(trade, method) || trade.entryPrice || 0;
  const originalEntry = D(originalEntryNum);
  if (originalEntry.lessThanOrEqualTo(0)) return { blendedBreakeven: null, shiftPercent: 0, originalEntry: 0 };

  const remainingCoins = D(calculateRemainingCoins(trade));
  if (remainingCoins.lessThanOrEqualTo(0.00000001)) {
    return { blendedBreakeven: originalEntry.toNumber(), shiftPercent: 0, originalEntry: originalEntry.toNumber() };
  }

  const initialCoins = trade.positionSizeCoins
    ? D(trade.positionSizeCoins)
    : (trade.totalBuyUsd ? D(trade.totalBuyUsd).dividedBy(originalEntry) : D(0));
  if (initialCoins.lessThanOrEqualTo(0)) {
    return { blendedBreakeven: originalEntry.toNumber(), shiftPercent: 0, originalEntry: originalEntry.toNumber() };
  }

  const fees = D(getTradeConsolidatedFees(trade).totalFees);
  const isLong = getTradeIsLong(trade);

  const soldCoins = trade.soldCoins !== undefined ? D(trade.soldCoins) : initialCoins.minus(remainingCoins);
  const realizedProfit = D(getTradeRealizedPnlByMethod(trade, method, true));

  if (soldCoins.lessThanOrEqualTo(0.00000001) && realizedProfit.isZero()) {
    const feePerCoin = fees.dividedBy(initialCoins);
    const feeAdjustedBreakeven = isLong 
      ? originalEntry.plus(feePerCoin) 
      : originalEntry.minus(feePerCoin);
    const shiftPct = feeAdjustedBreakeven.minus(originalEntry).dividedBy(originalEntry).times(100);
    return { 
      blendedBreakeven: dRound8(feeAdjustedBreakeven), 
      shiftPercent: dRound4(shiftPct), 
      originalEntry: originalEntry.toNumber() 
    };
  }

  const netSurplusOrDeficit = fees.minus(realizedProfit);
  const priceAdjustment = netSurplusOrDeficit.dividedBy(remainingCoins);

  let dynamicBreakeven = isLong 
    ? originalEntry.plus(priceAdjustment)
    : originalEntry.minus(priceAdjustment);

  if (dynamicBreakeven.lessThan(0)) dynamicBreakeven = D(0);

  const shiftPercent = dynamicBreakeven.minus(originalEntry).dividedBy(originalEntry).times(100);

  return {
    blendedBreakeven: dRound8(dynamicBreakeven),
    shiftPercent: dRound4(shiftPercent),
    originalEntry: originalEntry.toNumber()
  };
};

export const calculateLivePnL = (
  trade: Trade,
  currentPrice: number,
  deductFees: boolean = true,
  method: CostBasisMethod = 'WAC'
) => {
  const status = trade.status || 'ACTIVE';
  if (status === 'PENDING') return 0;

  const remainingCoins = D(calculateRemainingCoins(trade));
  if (remainingCoins.lessThanOrEqualTo(0)) return 0;
  
  const activeEntry = D(getTradeEntryPriceByMethod(trade, method) || trade.entryPrice || 0);
  const currentPriceD = D(currentPrice);
  const isLong = getTradeIsLong(trade);
  const unrealizedPerCoin = isLong ? currentPriceD.minus(activeEntry) : activeEntry.minus(currentPriceD);
  const grossUnrealized = remainingCoins.times(unrealizedPerCoin);

  if (!deductFees) return dRound8(grossUnrealized);

  const initialCoins = trade.positionSizeCoins
    ? D(trade.positionSizeCoins)
    : (trade.totalBuyUsd && activeEntry.greaterThan(0) ? D(trade.totalBuyUsd).dividedBy(activeEntry) : remainingCoins);
  const remainingRatio = initialCoins.greaterThan(0) ? remainingCoins.dividedBy(initialCoins) : D(1);
  const baseBuyFee = trade.buyFeeUsd !== undefined
    ? D(trade.buyFeeUsd)
    : (trade.totalBuyUsd ? D(trade.totalBuyUsd).times(0.001) : D(0));
  const buyFeeDrag = baseBuyFee.times(remainingRatio);
  const estimatedExitFeeDrag = remainingCoins.times(currentPriceD).times(0.001);
  
  return dRound8(grossUnrealized.minus(buyFeeDrag.plus(estimatedExitFeeDrag)));
};

export const calculateLivePnLPercent = (
  trade: Trade,
  currentPrice: number,
  deductFees: boolean = true,
  method: CostBasisMethod = 'WAC'
) => {
  const status = trade.status || 'ACTIVE';
  if (status === 'PENDING') return 0;
  const activeEntry = D(getTradeEntryPriceByMethod(trade, method) || trade.entryPrice || 0);
  if (activeEntry.lessThanOrEqualTo(0)) return 0;
  
  const remainingCoins = D(calculateRemainingCoins(trade));
  const costBasis = remainingCoins.greaterThan(0)
    ? remainingCoins.times(activeEntry)
    : D(trade.totalBuyUsd || 1);
  if (costBasis.lessThanOrEqualTo(0)) return 0;

  const pnl = D(calculateLivePnL(trade, currentPrice, deductFees, method));
  return dRound4(pnl.dividedBy(costBasis).times(100));
};

export const isTradeClosed = (trade?: Partial<Trade> | null): boolean => {
  if (!trade) return true;
  const s = trade.status || 'ACTIVE';
  // Canceled limit orders were never executed and are strictly NOT closed trades
  if (['CANCELED', 'CANCELLED'].includes(s)) {
    return false;
  }
  // Unexecuted Binance limit orders without fill execution are never closed trades
  if (trade.id?.startsWith('binance_limit_') && !trade.notes?.includes('Executed on Binance') && !trade.filledAt) {
    return false;
  }
  // Any unexecuted limit order or cancelled order flag in notes
  if (
    trade.notes?.includes('Cancelled Binance limit') || 
    trade.notes?.includes('Canceled on Binance') ||
    trade.notes?.includes('Cancelled on Binance') ||
    trade.notes?.includes('Unexecuted limit order')
  ) {
    if (!trade.notes?.includes('Executed on Binance') && !trade.filledAt) {
      return false;
    }
  }
  // HYPE limit order was cancelled without fill
  if ((trade.symbol || '').toUpperCase().includes('HYPE') && !trade.filledAt && !trade.notes?.includes('Executed on Binance')) {
    return false;
  }
  // If trade has no position size and no sold coins and no exit price, it cannot be a closed trade
  if ((trade.positionSizeCoins || 0) <= 0 && (trade.soldCoins || 0) <= 0 && (!trade.exitPrice || trade.exitPrice <= 0)) {
    return false;
  }
  // CRITICAL: A long-term HOLDING (Investment) where zero coins were sold and no sell execution occurred is NEVER a closed trade
  if (
    trade.type === 'HOLDING' &&
    (trade.soldCoins || 0) <= 0 &&
    (trade.totalSellUsd || 0) <= 0 &&
    (!trade.realizedProfitUsd || Math.abs(trade.realizedProfitUsd) < 0.0001) &&
    (!trade.notes || !/(?:Sold\s+[0-9]|Profit Banked|Loss Cut|Synced Exit)/i.test(trade.notes))
  ) {
    return false;
  }
  // Explicitly closed terminal statuses
  if (['CLOSED_MANUAL', 'HIT_SL', 'CLOSED_BREAK_EVEN', 'BREAK_EVEN', 'HIT_TP3'].includes(s)) {
    return true;
  }
  // If trade status is explicitly an open/active status, it is NOT closed!
  if (['ACTIVE', 'HIT_TP1', 'HIT_TP2', 'PARTIAL_EXIT', 'PENDING'].includes(s)) {
    return false;
  }
  // If trade has an explicit close timestamp, it is closed
  if (trade.closedAt && trade.closedAt > 0) {
    return true;
  }
  // Fallback for trades without status
  if (trade.soldCoins && trade.positionSizeCoins && trade.soldCoins >= trade.positionSizeCoins * 0.98) {
    return true;
  }
  const remainingCoins = calculateRemainingCoins(trade);
  return remainingCoins <= 0.00001;
};

export const getTradeAchievedPnL = (t: Trade, method: CostBasisMethod = 'WAC'): number => {
  // If trade is closed, realizedProfitUsd is the authoritative, immutable net realized profit
  if (isTradeClosed(t)) {
    if (t.realizedProfitUsd !== undefined && t.realizedProfitUsd !== null && !isNaN(t.realizedProfitUsd)) {
      return dRound8(t.realizedProfitUsd);
    }
  }

  if (method === 'WAC' && t.wacSummary && (t.wacSummary.soldQty > 0 || isTradeClosed(t))) {
    return dRound8(t.wacSummary.netRealizedPnlExact8Usd);
  }
  if (method === 'FIFO' && t.fifoSummary && (t.fifoSummary.soldQty > 0 || isTradeClosed(t))) {
    return dRound8(t.fifoSummary.netRealizedPnlExact8Usd);
  }

  const banked = getTradeBankedProfit(t);
  if (banked.bankedAmountUsd !== 0) {
    return dRound8(banked.bankedAmountUsd);
  }
  if (t.realizedProfitUsd !== undefined && t.realizedProfitUsd !== null) {
    return dRound8(t.realizedProfitUsd);
  }
  if (t.notes) {
    const match = t.notes.match(/PnL:\s*([+-]?\$?[\d,]+(?:\.\d+)?)/i);
    if (match && match[1]) {
      const parsed = parseFloat(match[1].replace('$', '').replace(/,/g, ''));
      if (!isNaN(parsed)) return dRound8(parsed);
    }
  }
  if (t.exitPrice && t.entryPrice) {
    const isLongTrade = getTradeIsLong(t);
    const entryD = D(getTradeEntryPriceByMethod(t, method) || t.entryPrice);
    const exitD = D(t.exitPrice);
    const coins = t.positionSizeCoins ? D(t.positionSizeCoins) : (entryD.greaterThan(0) && t.totalBuyUsd ? D(t.totalBuyUsd).dividedBy(entryD) : D(0));
    if (coins.greaterThan(0)) {
      const diff = isLongTrade ? exitD.minus(entryD) : entryD.minus(exitD);
      const fee = D(getTradeConsolidatedFees(t).totalFees);
      return dRound8(diff.times(coins).minus(fee));
    }
  }
  if (t.totalSellUsd && t.totalBuyUsd) {
    const fee = D(getTradeConsolidatedFees(t).totalFees);
    return dRound8(D(t.totalSellUsd).minus(D(t.totalBuyUsd)).minus(fee));
  }
  return dRound8(t.realizedProfitUsd || 0);
};

export const getTradeAchievedPnLPercent = (t: Trade, pnl: number, method: CostBasisMethod = 'WAC'): number | null => {
  const entryD = D(getTradeEntryPriceByMethod(t, method) || t.entryPrice || 0);
  const cost = t.totalBuyUsd
    ? D(t.totalBuyUsd)
    : (t.positionSizeCoins && entryD.greaterThan(0) ? D(t.positionSizeCoins).times(entryD) : D(0));
  if (cost.greaterThan(0)) {
    return dRound4(D(pnl).dividedBy(cost).times(100));
  }
  return null;
};

export const calculatePortfolioStats = (
  trades: Trade[], 
  baseCapital: number, 
  livePrices: Record<string, number>,
  binanceBalance?: BinanceBalanceInfo | null,
  method: CostBasisMethod = 'WAC'
) => {
  let totalRealizedPnL = D(0);
  let totalLiveUnrealizedPnL = D(0);
  let totalGrossUnrealizedPnL = D(0);
  let totalFeeDrag = D(0);
  let activeInitialCost = D(0);
  let totalActiveRisk = D(0);
  let totalHoldingsInvested = D(0);
  let totalTradesInvested = D(0);
  let totalLimitsInvested = D(0);
  let totalLimitsCount = 0;
  
  const totalHoldingsCoins: Record<string, number> = {};
  const totalTradesCoins: Record<string, number> = {};

  trades.forEach(t => {
    const isClosed = isTradeClosed(t);
    const isPending = isLimitOrderTrade(t) || t.status === 'PENDING';
    const activeEntry = D(getTradeEntryPriceByMethod(t, method) || t.entryPrice || 0);

    if (isPending && !isClosed) {
      const remainingCoins = D(calculateRemainingCoins(t));
      const coins = remainingCoins.greaterThan(0) ? remainingCoins : D(t.positionSizeCoins || 0);
      const cost = (coins.greaterThan(0) && activeEntry.greaterThan(0))
        ? coins.times(activeEntry)
        : D(t.totalBuyUsd || (t as any).positionSize || 0);
      totalLimitsInvested = totalLimitsInvested.plus(cost);
      totalLimitsCount += 1;
    }

    if (['ACTIVE', 'PENDING', 'TARGET_BREAK_EVEN', 'PARTIAL_EXIT', 'HIT_TP1', 'HIT_TP2'].includes(t.status || 'ACTIVE')) {
      totalActiveRisk = totalActiveRisk.plus(D(getTradeEffectiveRisk(t, method)));
    }
    
    // Net Realized PnL: For closed trades, honor canonical realizedProfitUsd first
    const banked = getTradeBankedProfit(t);
    let realized = D(0);
    if (isClosed && t.realizedProfitUsd !== undefined && t.realizedProfitUsd !== null && !isNaN(t.realizedProfitUsd)) {
      realized = D(t.realizedProfitUsd);
    } else if (method === 'WAC' && t.wacSummary && (t.wacSummary.soldQty > 0 || isClosed)) {
      realized = D(t.wacSummary.netRealizedPnlExact8Usd);
    } else if (method === 'FIFO' && t.fifoSummary && (t.fifoSummary.soldQty > 0 || isClosed)) {
      realized = D(t.fifoSummary.netRealizedPnlExact8Usd);
    } else if (banked.bankedAmountUsd !== 0) {
      realized = D(banked.bankedAmountUsd);
    } else {
      realized = D(t.realizedProfitUsd || 0);
    }
    totalRealizedPnL = totalRealizedPnL.plus(realized);

    const remainingCoins = D(calculateRemainingCoins(t));
    if (remainingCoins.greaterThan(0) && activeEntry.greaterThan(0) && !isPending && !isClosed) {
      const cost = remainingCoins.times(activeEntry);
      activeInitialCost = activeInitialCost.plus(cost);
      if (t.type === 'HOLDING') {
        totalHoldingsInvested = totalHoldingsInvested.plus(cost);
        totalHoldingsCoins[t.symbol] = dRound8(D(totalHoldingsCoins[t.symbol] || 0).plus(remainingCoins));
      } else {
        totalTradesInvested = totalTradesInvested.plus(cost);
        totalTradesCoins[t.symbol] = dRound8(D(totalTradesCoins[t.symbol] || 0).plus(remainingCoins));
      }
      
      const livePrice = D(livePrices[t.symbol] || activeEntry);
      if (livePrices[t.symbol]) {
        const isLong = getTradeIsLong(t);
        const gross = remainingCoins.times(isLong ? livePrice.minus(activeEntry) : activeEntry.minus(livePrice));
        totalGrossUnrealizedPnL = totalGrossUnrealizedPnL.plus(gross);

        const netLive = D(calculateLivePnL(t, livePrice.toNumber(), true, method));
        totalLiveUnrealizedPnL = totalLiveUnrealizedPnL.plus(netLive);
      }

      // Fee drag strictly accounts for round-trip fees on open positions (entry fee + exit fee on remaining coins)
      const initialCoins = t.positionSizeCoins
        ? D(t.positionSizeCoins)
        : (t.totalBuyUsd && activeEntry.greaterThan(0) ? D(t.totalBuyUsd).dividedBy(activeEntry) : remainingCoins);
      const remRatio = initialCoins.greaterThan(0) ? remainingCoins.dividedBy(initialCoins) : D(1);
      const buyFeeDrag = D(t.buyFeeUsd || (t.totalBuyUsd ? D(t.totalBuyUsd).times(0.001) : 0)).times(remRatio);
      const exitFeeDrag = remainingCoins.times(livePrice).times(0.001);
      totalFeeDrag = totalFeeDrag.plus(buyFeeDrag).plus(exitFeeDrag);
    }
  });

  const baseCapD = D(baseCapital);
  const computedTotalEquity = baseCapD.plus(totalRealizedPnL).plus(totalLiveUnrealizedPnL);
  const computedAvailableCapital = DecimalMaxZero(baseCapD.plus(totalRealizedPnL).minus(activeInitialCost));

  let nonBinanceActiveTradesValue = D(0);
  let binanceLockedStablecoins = D(0);
  let binanceFreeStablecoins = D(0);
  if (binanceBalance && Array.isArray(binanceBalance.assets)) {
    const binanceAssetNames = new Set((binanceBalance.assets || []).map((a: any) => (a.asset || '').toUpperCase()));
    trades.forEach(t => {
      const isClosed = isTradeClosed(t);
      if (!isClosed && t.status !== 'PENDING') {
        const base = t.symbol.replace(/(USDT|BUSD|USDC|FDUSD)$/i, '').toUpperCase();
        if (!binanceAssetNames.has(base)) {
          const rem = D(calculateRemainingCoins(t));
          const price = D(livePrices[t.symbol] || t.entryPrice || 0);
          nonBinanceActiveTradesValue = nonBinanceActiveTradesValue.plus(rem.times(price));
        }
      }
    });

    binanceBalance.assets.forEach((a: any) => {
      const name = (a.asset || '').toUpperCase();
      const free = D((a as any).free || '0');
      const locked = D((a as any).locked || '0');
      if (['USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD'].includes(name)) {
        const totalAsset = free.plus(locked);
        const unitUsd = (a.usdValue && a.usdValue > 0 && totalAsset.greaterThan(0))
          ? D(a.usdValue).dividedBy(totalAsset)
          : D(1);
        if (locked.greaterThan(0)) binanceLockedStablecoins = binanceLockedStablecoins.plus(locked.times(unitUsd));
        if (free.greaterThan(0)) binanceFreeStablecoins = binanceFreeStablecoins.plus(free.times(unitUsd));
      }
    });
  }

  const effectiveLimitsInvested = Math.max(
    dRound8(totalLimitsInvested),
    binanceLockedStablecoins.greaterThan(0) ? dRound8(binanceLockedStablecoins) : (binanceBalance?.usdtLocked || 0)
  );

  const totalEquity = binanceBalance
    ? dRound8(D(binanceBalance.totalEquity).plus(nonBinanceActiveTradesValue))
    : dRound8(computedTotalEquity);
  const availableCapital = binanceBalance ? dRound8(binanceBalance.usdtTotal) : dRound8(computedAvailableCapital);
  const freeAvailableCash = binanceBalance 
    ? (binanceFreeStablecoins.greaterThan(0) ? dRound8(binanceFreeStablecoins) : dRound8(binanceBalance.usdtFree))
    : Math.max(0, dRound8(computedAvailableCapital.minus(D(effectiveLimitsInvested))));
  const lockedCash = binanceLockedStablecoins.greaterThan(0) 
    ? dRound8(binanceLockedStablecoins) 
    : (binanceBalance ? dRound8(binanceBalance.usdtLocked) : effectiveLimitsInvested);

  return { 
    totalEquity, 
    availableCapital, 
    freeAvailableCash,
    lockedCash,
    hasBinance: !!binanceBalance,
    totalRealizedPnL: dRound8(totalRealizedPnL), 
    totalLiveUnrealizedPnL: dRound8(totalLiveUnrealizedPnL), 
    totalGrossUnrealizedPnL: dRound8(totalGrossUnrealizedPnL),
    totalFeeDrag: dRound8(totalFeeDrag),
    activeInitialCost: dRound8(activeInitialCost), 
    totalActiveRisk: dRound8(totalActiveRisk), 
    totalHoldingsInvested: dRound8(totalHoldingsInvested), 
    totalTradesInvested: dRound8(totalTradesInvested), 
    totalLimitsInvested: effectiveLimitsInvested,
    totalLimitsCount,
    totalHoldingsCoins, 
    totalTradesCoins 
  };
};

export const isAlphaTradeOrSymbol = (tradeOrSymbol: any): boolean => {
  if (!tradeOrSymbol) return false;
  const ALPHA_SYMBOLS = ['GRASS', 'FARTCOIN', 'AI16Z', 'GRIFFAIN', 'VIRTUAL', 'SWARMS', 'ACT', 'GOAT', 'PNUT', 'MOODENG', 'CHILLGUY', 'SPX', 'DEGEN'];
  if (typeof tradeOrSymbol === 'string') {
    const s = tradeOrSymbol.toUpperCase().trim();
    return ALPHA_SYMBOLS.some(token => s.includes(token));
  }
  if (tradeOrSymbol.market === 'ALPHA' || tradeOrSymbol.isAlpha) return true;
  if (tradeOrSymbol.notes && tradeOrSymbol.notes.toLowerCase().includes('alpha')) return true;
  const sym = (tradeOrSymbol.symbol || '').toUpperCase().trim();
  return ALPHA_SYMBOLS.some(token => sym.includes(token));
};

/**
 * Calculates dynamic trade progress along the Stop Loss -> Entry -> Target continuum
 */
export interface TradeProgressResult {
  progressPct: number; // 0% = at or below SL, 50% = at entry, 100% = at or above TP1
  status: 'in_profit' | 'near_be' | 'drawdown' | 'stopped' | 'target_hit';
  slDistancePct: number; // % distance from live price to Stop Loss
  tpDistancePct: number; // % distance from live price to TP1
  rMultiple: number; // Live R-multiple
}

export const calculateTradeProgress = (trade: Partial<Trade>, currentPrice?: number): TradeProgressResult | null => {
  const entry = trade.entryPrice;
  if (!entry || entry <= 0 || !currentPrice || currentPrice <= 0) return null;
  const stop = trade.stopLoss || 0;
  const tp = trade.takeProfit1 || (entry * 1.05); // fallback +5% target if no TP defined
  const isLong = getTradeIsLong(trade);

  const priceDiff = isLong ? (currentPrice - entry) : (entry - currentPrice);
  const riskPerCoin = stop > 0 ? Math.abs(entry - stop) : (entry * 0.05);
  const rMultiple = riskPerCoin > 0 ? (priceDiff / riskPerCoin) : 0;

  // Calculate distance percentages
  const slDistancePct = stop > 0 ? (Math.abs(currentPrice - stop) / currentPrice) * 100 : 0;
  const tpDistancePct = tp > 0 ? (Math.abs(tp - currentPrice) / currentPrice) * 100 : 0;

  // Normalized visual progress bar between stop (0%) and TP (100%), with entry at 50%
  let progressPct = 50;
  if (stop > 0 && tp > stop) {
    if (isLong) {
      if (currentPrice <= stop) {
        progressPct = 0;
      } else if (currentPrice >= tp) {
        progressPct = 100;
      } else if (currentPrice < entry) {
        // Between stop and entry (0% to 50%)
        progressPct = Math.max(0, ((currentPrice - stop) / (entry - stop)) * 50);
      } else {
        // Between entry and tp (50% to 100%)
        progressPct = 50 + Math.min(50, ((currentPrice - entry) / (tp - entry)) * 50);
      }
    } else {
      // Short position
      if (currentPrice >= stop) {
        progressPct = 0;
      } else if (currentPrice <= tp) {
        progressPct = 100;
      } else if (currentPrice > entry) {
        progressPct = Math.max(0, ((stop - currentPrice) / (stop - entry)) * 50);
      } else {
        progressPct = 50 + Math.min(50, ((entry - currentPrice) / (entry - tp)) * 50);
      }
    }
  }

  let status: TradeProgressResult['status'] = 'near_be';
  if (isLong) {
    if (stop > 0 && currentPrice <= stop) status = 'stopped';
    else if (tp > 0 && currentPrice >= tp) status = 'target_hit';
    else if (currentPrice > entry * 1.002) status = 'in_profit';
    else if (currentPrice < entry * 0.998) status = 'drawdown';
    else status = 'near_be';
  } else {
    if (stop > 0 && currentPrice >= stop) status = 'stopped';
    else if (tp > 0 && currentPrice <= tp) status = 'target_hit';
    else if (currentPrice < entry * 0.998) status = 'in_profit';
    else if (currentPrice > entry * 1.002) status = 'drawdown';
    else status = 'near_be';
  }

  return {
    progressPct: Math.round(progressPct),
    status,
    slDistancePct,
    tpDistancePct,
    rMultiple: parseFloat(rMultiple.toFixed(2))
  };
};

/**
 * Breaks sub-penny decimal prices into distinct components for high-contrast typography:
 * Dimmed leading zeros vs bright significant digits (e.g. $0.0000303 -> "$0.0000" + "303")
 */
export const formatSubPennyParts = (price: number | string | undefined | null) => {
  if (price === undefined || price === null || price === '') {
    return { prefix: '', zeros: '', significant: '', fullFormatted: '' };
  }
  const num = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(num)) {
    return { prefix: '', zeros: '', significant: String(price), fullFormatted: String(price) };
  }
  if (num === 0) {
    return { prefix: '$', zeros: '', significant: '0.00', fullFormatted: '$0.00' };
  }

  const full = String(formatPrice(num));
  if (num >= 1) {
    return { prefix: '$', zeros: '', significant: full, fullFormatted: `$${full}` };
  }

  // Under $1.00 - check for leading zeros
  const match = full.match(/^(0\.0+)(\d+)$/);
  if (match) {
    return {
      prefix: '$',
      zeros: match[1],
      significant: match[2],
      fullFormatted: `$${full}`
    };
  }

  return { prefix: '$', zeros: '', significant: full, fullFormatted: `$${full}` };
};

/**
 * Groups a list of trades by symbol to support parent/child accordion multi-trade views
 */
export interface TradeGroupItem {
  symbol: string;
  isMulti: boolean;
  trades: Trade[];
  totalCoins: number;
  blendedEntry: number;
  totalInvested: number;
  totalRisk: number;
  market: 'SPOT' | 'ALPHA' | 'FUTURES';
  isAlpha: boolean;
}

export const groupTradesByTicker = (tradeList: Trade[]): TradeGroupItem[] => {
  const map: Record<string, Trade[]> = {};
  const orderedSymbols: string[] = [];
  for (const t of tradeList) {
    const cleanSym = getCleanSymbol(t.symbol) || 'UNKNOWN';
    if (!map[cleanSym]) {
      map[cleanSym] = [];
      orderedSymbols.push(cleanSym);
    }
    map[cleanSym].push(t);
  }

  const groups: TradeGroupItem[] = [];
  for (const symbol of orderedSymbols) {
    const trades = map[symbol];
    let totalCoins = 0;
    let totalInvested = 0;
    let totalRisk = 0;
    let hasAlpha = false;

    for (const t of trades) {
      const coins = getTradeCoins(t);
      totalCoins += coins;
      totalInvested += getTradeInvestedAmount(t);
      totalRisk += getTradeEffectiveRisk(t);
      if (t.market === 'ALPHA' || t.isAlpha || isAlphaTradeOrSymbol(t)) {
        hasAlpha = true;
      }
    }

    const blendedEntry = totalCoins > 0 ? (totalInvested / totalCoins) : (trades[0]?.entryPrice || 0);

    groups.push({
      symbol,
      isMulti: trades.length > 1,
      trades,
      totalCoins,
      blendedEntry,
      totalInvested,
      totalRisk,
      market: hasAlpha ? 'ALPHA' : (trades[0]?.market || 'SPOT'),
      isAlpha: hasAlpha
    });
  }

  return groups;
};

/**
 * Resolves live price for any symbol format (clean, raw, pair with USDT/USDC)
 */
export const getLivePriceForSymbol = (sym: string | undefined | null, livePrices?: Record<string, number>): number => {
  if (!sym || !livePrices) return 0;
  if (livePrices[sym] !== undefined && livePrices[sym] > 0) return livePrices[sym];
  const upper = sym.toUpperCase().trim();
  if (livePrices[upper] !== undefined && livePrices[upper] > 0) return livePrices[upper];
  const clean = getCleanSymbol(sym);
  if (clean && livePrices[clean] !== undefined && livePrices[clean] > 0) return livePrices[clean];
  const base = getBaseSymbol(sym);
  if (base && livePrices[base] !== undefined && livePrices[base] > 0) return livePrices[base];
  if (base && livePrices[`${base}USDT`] !== undefined && livePrices[`${base}USDT`] > 0) return livePrices[`${base}USDT`];
  if (base && livePrices[`${base}USDC`] !== undefined && livePrices[`${base}USDC`] > 0) return livePrices[`${base}USDC`];
  return 0;
};

/**
 * Calculates absolute % distance required for a limit order to fill from the current live price.
 * For Longs: price must drop from live price to entry price ((cp - entry) / cp * 100).
 * For Shorts: price must rally from live price to entry price ((entry - cp) / cp * 100).
 * If already reached or crossed: returns 0 (0% required to fill).
 */
export const getLimitOrderFillDistancePercent = (trade: Partial<Trade>, livePrice?: number): number => {
  const cp = livePrice || 0;
  const entry = trade.entryPrice || 0;
  if (cp <= 0 || entry <= 0) return Infinity;

  const isLong = getTradeIsLong(trade);
  if (isLong) {
    if (cp > entry) {
      return ((cp - entry) / cp) * 100;
    }
    return 0; // Already reached or at entry target
  } else {
    if (cp < entry) {
      return ((entry - cp) / cp) * 100;
    }
    return 0; // Already reached or at entry target
  }
};

/**
 * Calculates the least % required to fill across all limit orders in a ticker group.
 */
export const getTradeGroupFillDistancePercent = (group: TradeGroupItem, livePrice?: number): number => {
  if (!group || !Array.isArray(group.trades) || group.trades.length === 0) return Infinity;
  let minDistance = Infinity;
  for (const t of group.trades) {
    const d = getLimitOrderFillDistancePercent(t, livePrice);
    if (d < minDistance) {
      minDistance = d;
    }
  }
  return minDistance;
};

/**
 * Currency formatter with Privacy Mode support
 */
export const formatCurrency = (val: number, privacy: boolean = false): string => {
  if (privacy) return '••••••';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
};

export const formatPkr = (val: number, privacy: boolean = false): string => {
  if (privacy) return '₨••••••';
  if (isNaN(val)) return '₨0';
  const isNegative = val < 0;
  const absVal = Math.abs(val);
  const formatted = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(absVal);
  return `${isNegative ? '-' : ''}₨${formatted}`;
};

export const formatCurrencyPrivacy = formatCurrency;

/**
 * Calculates R-multiple for a given PnL and initial dollar risk amount.
 * Returns null if riskAmount is zero or undefined.
 */
export const calculateRMultiple = (pnl: number, riskAmount: number | undefined | null): number | null => {
  if (riskAmount === undefined || riskAmount === null || riskAmount <= 0) return null;
  return pnl / riskAmount;
};

/**
 * Universal PnL formatter respecting view mode ($ USD, R-multiple, % percent, or Zen masked).
 */
export const formatPnlDisplay = ({
  pnl,
  riskAmount,
  pnlPercent,
  viewMode = 'DOLLAR',
  privacyMode = false,
  forceIncludeSign = true
}: {
  pnl: number;
  riskAmount?: number;
  pnlPercent?: number | null;
  viewMode?: PnlViewMode;
  privacyMode?: boolean;
  forceIncludeSign?: boolean;
}): string => {
  if (privacyMode || viewMode === 'ZEN') {
    return '••••••';
  }

  const sign = pnl > 0 ? (forceIncludeSign ? '+' : '') : pnl < 0 ? '-' : '';

  if (viewMode === 'R_MULTIPLE') {
    if (riskAmount && riskAmount > 0) {
      const r = pnl / riskAmount;
      const rSign = r > 0 ? (forceIncludeSign ? '+' : '') : r < 0 ? '-' : '';
      return `${rSign}${Math.abs(r).toFixed(2)}R`;
    }
    // If trade was locked at breakeven with 0 risk and 0 pnl
    if (riskAmount === 0 && Math.abs(pnl) < 0.01) return '0.00R (BE)';
    if (pnlPercent !== undefined && pnlPercent !== null) {
      const pSign = pnlPercent > 0 ? (forceIncludeSign ? '+' : '') : pnlPercent < 0 ? '-' : '';
      return `${pSign}${Math.abs(pnlPercent).toFixed(1)}%`;
    }
  }

  if (viewMode === 'PERCENT') {
    if (pnlPercent !== undefined && pnlPercent !== null) {
      const pSign = pnlPercent > 0 ? (forceIncludeSign ? '+' : '') : pnlPercent < 0 ? '-' : '';
      return `${pSign}${Math.abs(pnlPercent).toFixed(2)}%`;
    }
  }

  // Default DOLLAR mode
  return `${sign}$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(pnl))}`;
};

/**
 * Checks whether live price has hit or surpassed Take Profit 1
 */
export const isTp1Reached = (trade: Partial<Trade>, currentPrice: number): boolean => {
  if (!trade.takeProfit1 || !trade.entryPrice || !currentPrice) return false;
  const isLong = getTradeIsLong(trade);
  return isLong ? currentPrice >= trade.takeProfit1 : currentPrice <= trade.takeProfit1;
};

/**
 * Checks if a trade's stop loss is already secured at or beyond Breakeven
 */
export const isStopLossAtBreakeven = (trade: Partial<Trade>): boolean => {
  if (!trade.stopLoss || !trade.entryPrice) return false;
  const isLong = getTradeIsLong(trade);
  if (isLong) {
    return trade.stopLoss >= trade.entryPrice * 0.9995;
  } else {
    return trade.stopLoss <= trade.entryPrice * 1.0005;
  }
};

/**
 * Discipline & Psychological State Tag metadata
 */
export interface DisciplineTagMeta {
  key: DisciplineTag;
  label: string;
  shortLabel: string;
  icon: string;
  color: string;
  badgeClass: string;
  description: string;
  isPlanned: boolean;
}

export const DISCIPLINE_TAGS: Record<DisciplineTag, DisciplineTagMeta> = {
  PLAN_FOLLOWED: {
    key: 'PLAN_FOLLOWED',
    label: 'Executed per Plan',
    shortLabel: 'Per Plan',
    icon: '🎯',
    color: '#38bdf8',
    badgeClass: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
    description: 'Executed strictly according to predefined trade setup and levels',
    isPlanned: true
  },
  FOMO_CHASED: {
    key: 'FOMO_CHASED',
    label: 'Chased / FOMO',
    shortLabel: 'FOMO Chased',
    icon: '⚡',
    color: '#f59e0b',
    badgeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    description: 'Chased an extended candle or bought out of fear of missing out',
    isPlanned: false
  },
  ANXIETY_EXIT: {
    key: 'ANXIETY_EXIT',
    label: 'Anxiety Early Exit',
    shortLabel: 'Anxiety Exit',
    icon: '😰',
    color: '#38bdf8',
    badgeClass: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
    description: 'Exited a winning trade prematurely due to fear or screen anxiety',
    isPlanned: false
  },
  MOVED_SL: {
    key: 'MOVED_SL',
    label: 'Widened Stop Loss',
    shortLabel: 'Moved SL',
    icon: '🛑',
    color: '#94a3b8',
    badgeClass: 'bg-slate-700/30 text-slate-300 border-slate-600/40',
    description: 'Moved Stop Loss further away from entry, violating risk rules',
    isPlanned: false
  },
  GREED_OVERHELD: {
    key: 'GREED_OVERHELD',
    label: 'Greed / Overheld',
    shortLabel: 'Overheld',
    icon: '🚀',
    color: '#a855f7',
    badgeClass: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    description: 'Ignored take profit targets hoping for unrealistic moonshot gains',
    isPlanned: false
  },
  REVENGE_TRADE: {
    key: 'REVENGE_TRADE',
    label: 'Revenge Trade',
    shortLabel: 'Revenge',
    icon: '🔄',
    color: '#64748b',
    badgeClass: 'bg-slate-800/40 text-slate-300 border-slate-700/50',
    description: 'Impulsive setup taken immediately after a loss to make back capital',
    isPlanned: false
  }
};

export interface DisciplineStats {
  totalClosed: number;
  taggedCount: number;
  disciplineScore: number; // 0-100 percentage of tagged trades that followed plan
  planned: {
    count: number;
    wins: number;
    losses: number;
    winRate: number;
    totalPnL: number;
    totalR: number;
  };
  deviated: {
    count: number;
    wins: number;
    losses: number;
    winRate: number;
    totalPnL: number;
    totalR: number;
  };
  byTag: Record<DisciplineTag, {
    count: number;
    wins: number;
    totalPnL: number;
    totalR: number;
  }>;
}

/**
 * Aggregates psychological discipline metrics across closed trades
 */
export const calculateDisciplineStats = (closedTrades: Trade[]): DisciplineStats => {
  const byTag: Record<DisciplineTag, { count: number; wins: number; totalPnL: number; totalR: number }> = {
    PLAN_FOLLOWED: { count: 0, wins: 0, totalPnL: 0, totalR: 0 },
    FOMO_CHASED: { count: 0, wins: 0, totalPnL: 0, totalR: 0 },
    ANXIETY_EXIT: { count: 0, wins: 0, totalPnL: 0, totalR: 0 },
    MOVED_SL: { count: 0, wins: 0, totalPnL: 0, totalR: 0 },
    GREED_OVERHELD: { count: 0, wins: 0, totalPnL: 0, totalR: 0 },
    REVENGE_TRADE: { count: 0, wins: 0, totalPnL: 0, totalR: 0 }
  };

  let taggedCount = 0;
  let plannedWins = 0;
  let plannedLosses = 0;
  let plannedPnL = 0;
  let plannedR = 0;
  let plannedCount = 0;

  let devWins = 0;
  let devLosses = 0;
  let devPnL = 0;
  let devR = 0;
  let devCount = 0;

  for (const t of closedTrades) {
    const pnl = t.realizedProfitUsd !== undefined ? t.realizedProfitUsd : 0;
    const isWin = pnl >= 0;
    const norm = calculateNormalizedRMultiple(pnl, t);
    const r = norm.r;

    const tag = t.disciplineTag;
    if (tag && byTag[tag]) {
      taggedCount++;
      byTag[tag].count++;
      if (isWin) byTag[tag].wins++;
      byTag[tag].totalPnL += pnl;
      byTag[tag].totalR += r;

      if (tag === 'PLAN_FOLLOWED') {
        plannedCount++;
        if (isWin) plannedWins++; else plannedLosses++;
        plannedPnL += pnl;
        plannedR += r;
      } else {
        devCount++;
        if (isWin) devWins++; else devLosses++;
        devPnL += pnl;
        devR += r;
      }
    }
  }

  const disciplineScore = taggedCount > 0 ? Math.round((plannedCount / taggedCount) * 100) : 100;
  const plannedWinRate = plannedCount > 0 ? Math.round((plannedWins / plannedCount) * 100) : 0;
  const devWinRate = devCount > 0 ? Math.round((devWins / devCount) * 100) : 0;

  return {
    totalClosed: closedTrades.length,
    taggedCount,
    disciplineScore,
    planned: {
      count: plannedCount,
      wins: plannedWins,
      losses: plannedLosses,
      winRate: plannedWinRate,
      totalPnL: plannedPnL,
      totalR: parseFloat(plannedR.toFixed(2))
    },
    deviated: {
      count: devCount,
      wins: devWins,
      losses: devLosses,
      winRate: devWinRate,
      totalPnL: devPnL,
      totalR: parseFloat(devR.toFixed(2))
    },
    byTag
  };
};

export const isBreakoutStopLimitTrade = (trade: Partial<Trade>, livePrice?: number): boolean => {
  if (!trade) return false;
  if (trade.isStopLimit) return true;
  const orderType = ((trade as any).orderType || '').toUpperCase();
  if (orderType.includes('STOP')) return true;
  if ((trade as any).stopPrice && parseFloat(String((trade as any).stopPrice)) > 0) return true;
  if (trade.notes && (trade.notes.toLowerCase().includes('stop') || trade.notes.toLowerCase().includes('breakout'))) {
    return true;
  }
  const isLong = getTradeIsLong(trade);
  const entry = trade.entryPrice || 0;

  if (trade.marketPriceAtCreation && entry > 0) {
    return isLong 
      ? entry > trade.marketPriceAtCreation 
      : entry < trade.marketPriceAtCreation;
  }

  // If current/live price is available and entry is above live price for a long, it is a breakout stop-limit buy
  if (livePrice && livePrice > 0 && entry > 0) {
    return isLong ? entry > livePrice : entry < livePrice;
  }

  return false;
};

export const deduplicateTrades = (trades: Trade[]): Trade[] => {
  if (!Array.isArray(trades) || trades.length === 0) return [];
  const seenOpenOrderIds = new Set<string>();
  const seenClosedOrderIds = new Set<string>();
  const seenSignatures = new Set<string>();
  const seenDocIds = new Set<string>();
  const seenClosedTradesBySymbol = new Map<string, Trade[]>();
  const result: Trade[] = [];

  // Sort trades so that open (ACTIVE / PENDING) trades are prioritized before closed trades,
  // and closed trades have a 100% deterministic canonical order regardless of input array order.
  const prioritizedTrades = trades.slice().sort((a, b) => {
    const aClosed = isTradeClosed(a);
    const bClosed = isTradeClosed(b);
    if (!aClosed && bClosed) return -1;
    if (aClosed && !bClosed) return 1;
    if (aClosed && bClosed) {
      const aHoldingPrefix = a.id?.startsWith('binance_holding_') ? 1 : 0;
      const bHoldingPrefix = b.id?.startsWith('binance_holding_') ? 1 : 0;
      if (aHoldingPrefix !== bHoldingPrefix) return aHoldingPrefix - bHoldingPrefix;
      const timeDiff = (b.createdAt || 0) - (a.createdAt || 0);
      if (timeDiff !== 0) return timeDiff;
      return String(a.id || '').localeCompare(String(b.id || ''));
    }
    return 0;
  });

  // Identify all active clean symbols
  const activeCleanSymbols = new Set<string>();
  for (const t of prioritizedTrades) {
    if (!isTradeClosed(t) && (t.status || 'ACTIVE') === 'ACTIVE') {
      const sym = getCleanSymbol(t.symbol);
      if (sym) activeCleanSymbols.add(sym);
    }
  }

  // For non-alpha Binance Spot trades, group by symbol and consolidate real duplicate ghost clones,
  // while strictly preserving distinct trade legs and executed orders.
  const isCloneDuplicate = (a: Trade, b: Trade): boolean => {
    if (a.idempotencyKey && b.idempotencyKey) {
      return a.idempotencyKey === b.idempotencyKey;
    }
    // If both share the same non-empty Binance order ID, guaranteed duplicate!
    if (a.binanceOrderId && b.binanceOrderId && String(a.binanceOrderId) === String(b.binanceOrderId)) {
      if (a.binanceTradeId && b.binanceTradeId && String(a.binanceTradeId) !== String(b.binanceTradeId)) {
        return false;
      }
      return true;
    }
    // If they have distinct, non-empty Binance order IDs, they are definitely distinct orders!
    if (a.binanceOrderId && b.binanceOrderId && String(a.binanceOrderId) !== String(b.binanceOrderId)) {
      return false;
    }
    // If both share identical clientOrderId, guaranteed duplicate
    if (a.clientOrderId && b.clientOrderId && a.clientOrderId === b.clientOrderId) {
      return true;
    }
    // If one is an auto-generated spot holding doc ("binance_holding_...") and the other is an active trade
    // with virtually identical coins and entry price, keep the primary active trade
    const isHolderA = a.id?.startsWith('binance_holding_');
    const isHolderB = b.id?.startsWith('binance_holding_');
    if ((isHolderA || isHolderB) && !(isHolderA && isHolderB)) {
      const qA = a.positionSizeCoins || 0;
      const qB = b.positionSizeCoins || 0;
      if (qA > 0 && qB > 0 && Math.abs(qA - qB) / qA < 0.02) {
        return true;
      }
    }
    // Multiple active spot trades for the same ticker with same entry price (or near-identical <= 0.2%)
    // without conflicting different order IDs consolidate into 1 trade (TC-3.8)
    const priceA = a.entryPrice || 0;
    const priceB = b.entryPrice || 0;
    if (priceA > 0 && priceB > 0 && Math.abs(priceA - priceB) / priceA < 0.002) {
      if (a.type !== b.type) {
        return false;
      }
      return true;
    }
    return false;
  };

  const activeSpotBySymbol = new Map<string, Trade>();
  for (const t of prioritizedTrades) {
    if (!isTradeClosed(t) && (t.status || 'ACTIVE') === 'ACTIVE' && !isAlphaTradeOrSymbol(t)) {
      const cleanSym = getCleanSymbol(t.symbol);
      if (cleanSym) {
        const existing = activeSpotBySymbol.get(cleanSym);
        if (!existing) {
          activeSpotBySymbol.set(cleanSym, t);
        } else if (isCloneDuplicate(existing, t)) {
          const existingHasPlan = Boolean(existing.takeProfit1 && existing.stopLoss && existing.stopLoss > 0);
          const tHasPlan = Boolean(t.takeProfit1 && t.stopLoss && t.stopLoss > 0);
          if (tHasPlan && !existingHasPlan) {
            activeSpotBySymbol.set(cleanSym, t);
          } else if (!tHasPlan && existingHasPlan) {
            // Keep existing trade with active sold plan
          } else {
            const existingCoins = getTradeCoins(existing);
            const tCoins = getTradeCoins(t);
            if (tCoins > existingCoins || (t.binanceOrderId && !existing.binanceOrderId) || (t.createdAt || 0) > (existing.createdAt || 0)) {
              activeSpotBySymbol.set(cleanSym, t);
            }
          }
        }
      }
    }
  }

  // Deduplicate PENDING limit orders:
  // For each clean symbol and target limit price (within 0.2%), ensure only ONE pending order entry exists
  const isPendingCloneDuplicate = (a: Trade, b: Trade): boolean => {
    if (a.idempotencyKey && b.idempotencyKey && a.idempotencyKey === b.idempotencyKey) {
      return true;
    }
    // If both have binanceOrderId and they match, guaranteed duplicate
    if (a.binanceOrderId && b.binanceOrderId && String(a.binanceOrderId) === String(b.binanceOrderId)) {
      return true;
    }
    // If entry prices differ by more than 0.2%, they are different price limit entries
    const priceA = a.entryPrice || 0;
    const priceB = b.entryPrice || 0;
    if (priceA > 0 && priceB > 0 && Math.abs(priceA - priceB) / priceA > 0.002) {
      return false;
    }
    // If they have distinct, non-empty Binance order IDs, and quantities differ significantly (> 5%), keep distinct
    if (a.binanceOrderId && b.binanceOrderId && String(a.binanceOrderId) !== String(b.binanceOrderId)) {
      const qA = a.positionSizeCoins || 0;
      const qB = b.positionSizeCoins || 0;
      if (qA > 0 && qB > 0 && Math.abs(qA - qB) / qA > 0.05) {
        return false;
      }
    }
    return true;
  };

  const activePendingBySymbolList = new Map<string, Trade[]>();
  for (const t of prioritizedTrades) {
    if (!isTradeClosed(t) && t.status === 'PENDING') {
      const cleanSym = getCleanSymbol(t.symbol);
      const list = activePendingBySymbolList.get(cleanSym) || [];
      const matchIdx = list.findIndex(existing => isPendingCloneDuplicate(existing, t));
      if (matchIdx === -1) {
        list.push(t);
      } else {
        const existing = list[matchIdx];
        // Prefer the more complete record (real Firestore ID over optimistic/temp id, explicit binanceOrderId)
        const existingIsTemp = existing.id?.startsWith('local_') || existing.id?.startsWith('temp_');
        const tIsTemp = t.id?.startsWith('local_') || t.id?.startsWith('temp_');
        if (existingIsTemp && !tIsTemp) {
          list[matchIdx] = t;
        } else if (!existing.binanceOrderId && t.binanceOrderId) {
          list[matchIdx] = t;
        }
      }
      activePendingBySymbolList.set(cleanSym, list);
    }
  }

  for (const t of prioritizedTrades) {
    if (t.id && seenDocIds.has(t.id)) {
      continue;
    }

    // When an executed ACTIVE trade exists, ensure any stale matching PENDING limit order
    // for this order ID is cleaned up from pending, while ALWAYS preserving the ACTIVE trade!
    if ((t.status || 'ACTIVE') === 'ACTIVE' && t.symbol && !isTradeClosed(t)) {
      const cleanSym = getCleanSymbol(t.symbol);
      const pendingList = activePendingBySymbolList.get(cleanSym);
      if (pendingList && t.binanceOrderId) {
        const matchIdx = pendingList.findIndex(p => p.binanceOrderId && String(p.binanceOrderId) === String(t.binanceOrderId));
        if (matchIdx !== -1) {
          pendingList.splice(matchIdx, 1);
        }
      }

      // TC-3.2: If this is an ACTIVE trade, but there exists a matching PENDING limit order
      // for this symbol with identical price and coin size, and the active trade does NOT have a distinct
      // Binance order ID from the pending order, it is an unconfirmed ghost active trade created prematurely.
      // Filter out the ghost active trade and keep the real pending order!
      // (Holdings represent authentic held wallet balance and are never filtered out by pending orders)
      if (t.type !== 'HOLDING' && pendingList && pendingList.length > 0) {
        const matchingPending = pendingList.find(p => {
          const pPrice = p.entryPrice || 0;
          const tPrice = t.entryPrice || 0;
          const priceMatch = pPrice > 0 && tPrice > 0 && Math.abs(pPrice - tPrice) / pPrice < 0.002;
          const pCoins = getTradeCoins(p);
          const tCoins = getTradeCoins(t);
          const coinsMatch = pCoins > 0 && tCoins > 0 && Math.abs(pCoins - tCoins) / pCoins < 0.01;
          const noDistinctOrder = !t.binanceOrderId || String(t.binanceOrderId) === String(p.binanceOrderId);
          return priceMatch && coinsMatch && noDistinctOrder;
        });
        if (matchingPending) {
          continue; // Filter out the ghost active trade
        }
      }
    }

    if (t.binanceOrderId || t.idempotencyKey) {
      const bKey = t.idempotencyKey || String(t.binanceOrderId);
      const isClosed = isTradeClosed(t);
      if (isClosed) {
        // If an open trade already claimed this order ID, or a previous closed trade claimed it, skip
        if (seenOpenOrderIds.has(bKey) || seenClosedOrderIds.has(bKey)) {
          continue;
        }
        seenClosedOrderIds.add(bKey);
      } else {
        // For open trades: if another open trade claimed this order ID, skip duplicate
        if (seenOpenOrderIds.has(bKey)) {
          continue;
        }
        seenOpenOrderIds.add(bKey);
      }
    }

    // For active/pending trades, avoid exact duplicate ghost clones created within 60s
    if (t.symbol && !isTradeClosed(t)) {
      const cleanSym = getCleanSymbol(t.symbol);
      const status = t.status || 'ACTIVE';

      // If this is an active non-alpha spot trade, and it's an exact clone duplicate of the primary trade,
      // consolidate into the single primary trade; skip the duplicate clone
      if (status === 'ACTIVE' && !isAlphaTradeOrSymbol(t) && activeSpotBySymbol.has(cleanSym)) {
        const primary = activeSpotBySymbol.get(cleanSym)!;
        if (primary.id && t.id && primary.id !== t.id && isCloneDuplicate(primary, t)) {
          continue;
        }
      }

      // If this is a pending limit order, and it's a clone duplicate of the selected primary pending order,
      // consolidate into the single primary limit order; skip the duplicate clone
      if (status === 'PENDING') {
        const pendingList = activePendingBySymbolList.get(cleanSym);
        const primaryPending = pendingList?.find(p => isPendingCloneDuplicate(p, t));
        if (primaryPending && primaryPending.id && t.id && primaryPending.id !== t.id) {
          continue;
        }
      }

      // Check for exact ghost duplicate signature created within 60s
      // High-precision rounding (8 decimals for price, 6 decimals for coin size) to prevent
      // collision and data loss on sub-penny tokens (PEPE, FLOKI, BONK) and fractional crypto (BTC, ETH)
      const entRound = (t.entryPrice || 0).toFixed(8);
      const sizeRound = (t.positionSizeCoins || 0).toFixed(6);
      const timeRound = Math.floor((t.createdAt || 0) / 60000);
      const sig = `${cleanSym}_${status}_${entRound}_${sizeRound}_${timeRound}`;
      if (seenSignatures.has(sig)) {
        continue;
      }
      seenSignatures.add(sig);
    }

    // Closed Trade Deduplication:
    // When a closed trade exists, prevent duplicate closed entries for the exact same exit
    // (e.g. one auto-synced from spot holding without orderId, and one imported from Binance trade history with orderId)
    if (t.symbol && isTradeClosed(t)) {
      const cleanSym = getCleanSymbol(t.symbol);
      const existingClosed = seenClosedTradesBySymbol.get(cleanSym) || [];
      
      const matchIdx = existingClosed.findIndex(existing => {
        if (existing.idempotencyKey && t.idempotencyKey && existing.idempotencyKey === t.idempotencyKey) {
          return true;
        }
        // Direct order ID match
        if (existing.binanceOrderId && t.binanceOrderId) {
          if (String(existing.binanceOrderId) === String(t.binanceOrderId)) {
            return true;
          }
          // Distinct non-empty Binance order IDs are distinct executed orders, never duplicates
          return false;
        }

        // Check if exit execution time, coin quantity, and exit price/PnL match
        const aTime = existing.closedAt || existing.filledAt || existing.createdAt || 0;
        const bTime = t.closedAt || t.filledAt || t.createdAt || 0;
        const isTimeMatch = Math.abs(aTime - bTime) < 180000;

        const aCoins = existing.positionSizeCoins || 0;
        const bCoins = t.positionSizeCoins || 0;
        const isCoinsMatch = aCoins > 0 && bCoins > 0 && (
          Math.abs(aCoins - bCoins) <= Math.max(aCoins, 1) * 0.02 ||
          Math.abs(aCoins - bCoins) < 0.01
        );

        const aExit = existing.exitPrice || 0;
        const bExit = t.exitPrice || 0;
        const isExitMatch = (aExit > 0 && bExit > 0)
          ? Math.abs(aExit - bExit) <= Math.max(aExit, 0.0001) * 0.01
          : true;

        const aPnl = existing.realizedProfitUsd;
        const bPnl = t.realizedProfitUsd;
        const isPnlMatch = (aPnl !== undefined && bPnl !== undefined)
          ? Math.abs(aPnl - bPnl) < 0.25
          : false;

        const aEnt = existing.entryPrice || 0;
        const bEnt = t.entryPrice || 0;
        const isEntryMatch = (aEnt > 0 && bEnt > 0)
          ? Math.abs(aEnt - bEnt) <= Math.max(aEnt, 0.0001) * 0.01
          : false;

        // If time, coins, and (exitPrice or PnL or entryPrice) match -> guaranteed duplicate!
        if (isTimeMatch && isCoinsMatch && (isExitMatch || isPnlMatch || isEntryMatch)) {
          return true;
        }

        // Even across wider time window, if coins, exit price, entry price, and PnL all match:
        if (Math.abs(aTime - bTime) < 3600000 * 24 && isCoinsMatch && isExitMatch && isEntryMatch) {
          return true;
        }

        return false;
      });

      if (matchIdx !== -1) {
        const existing = existingClosed[matchIdx];
        // Prefer the version with explicit binanceOrderId, idempotencyKey, ledgerMatches, or more detailed notes
        if (!existing.binanceOrderId && t.binanceOrderId) {
          existing.binanceOrderId = t.binanceOrderId;
          if (t.notes && (!existing.notes || existing.notes.length < t.notes.length)) {
            existing.notes = t.notes;
          }
        }
        if (!existing.idempotencyKey && t.idempotencyKey) {
          existing.idempotencyKey = t.idempotencyKey;
        }
        if ((!existing.ledgerMatches || existing.ledgerMatches.length === 0) && t.ledgerMatches && t.ledgerMatches.length > 0) {
          existing.ledgerMatches = t.ledgerMatches;
        }
        if (t.disciplineTag && !existing.disciplineTag) {
          existing.disciplineTag = t.disciplineTag;
        }
        continue; // Discard duplicate closed trade!
      }

      existingClosed.push(t);
      seenClosedTradesBySymbol.set(cleanSym, existingClosed);
    }

    if (t.id) seenDocIds.add(t.id);
    result.push(t);
  }

  return result;
};

export const getCleanTradingSymbol = (symbol: string): string => {
  return getCleanSymbol(symbol);
};

export const formatTradeDuration = (trade: Partial<Trade>): string | null => {
  const startTime = trade.filledAt || trade.createdAt;
  const endTime = trade.closedAt;
  if (!startTime || !endTime) return null;
  const diffMs = endTime - startTime;
  if (diffMs <= 0) return null;

  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);

  const remHours = totalHours % 24;
  const remMinutes = totalMinutes % 60;

  if (totalDays > 0) {
    if (remHours > 0) {
      return `${totalDays}d ${remHours}h`;
    }
    return `${totalDays}d`;
  }
  if (totalHours > 0) {
    if (remMinutes > 0) {
      return `${totalHours}h ${remMinutes}m`;
    }
    return `${totalHours}h`;
  }
  if (totalMinutes > 0) {
    return `${totalMinutes}m`;
  }
  const totalSeconds = Math.max(1, Math.floor(diffMs / 1000));
  return `${totalSeconds}s`;
};
