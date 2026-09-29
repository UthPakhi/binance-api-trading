import { 
  Trade, 
  BinanceBalanceInfo, 
  DisciplineTag, 
  PnlViewMode, 
  TradeRiskFramework, 
  TradeRiskType, 
  RecommendedStops 
} from '../types';

export const formatPrice = (price: number | string | undefined | null, isEntry: boolean = false): string | number => {
  if (price === undefined || price === null || price === '') return '';
  let cleanPrice = typeof price === 'string' ? price.trim() : price;
  if (typeof cleanPrice === 'string' && cleanPrice.startsWith('$')) {
    cleanPrice = cleanPrice.replace(/^\$+/, '').trim();
  }
  const num = typeof cleanPrice === 'string' ? parseFloat(cleanPrice) : cleanPrice;
  if (isNaN(num)) return typeof price === 'string' ? price.replace(/^\$+/, '').trim() : price;
  
  if (num === 0) return 0;
  
  if (num >= 1000) return parseFloat(num.toFixed(2));
  if (num >= 10) return parseFloat(num.toFixed(3));
  if (num >= 1) return parseFloat(num.toFixed(4));
  if (num >= 0.01) return parseFloat(num.toFixed(5));
  if (num >= 0.0001) return parseFloat(num.toFixed(6));
  return parseFloat(num.toFixed(8));
};

export const getTradeCoins = (trade: Partial<Trade>): number => {
  if (trade.positionSizeCoins && trade.positionSizeCoins > 0) {
    return trade.positionSizeCoins;
  }
  if ((trade as any)?.coins && (trade as any).coins > 0) {
    return (trade as any).coins;
  }
  if (trade.totalBuyUsd && trade.entryPrice && trade.entryPrice > 0) {
    return trade.totalBuyUsd / trade.entryPrice;
  }
  if ((trade as any)?.positionSize && trade.entryPrice && trade.entryPrice > 0) {
    return (trade as any).positionSize / trade.entryPrice;
  }
  return 0;
};

export const getTradeInvestedAmount = (trade: Partial<Trade>): number => {
  if (trade.totalBuyUsd !== undefined && trade.totalBuyUsd > 0) {
    return trade.totalBuyUsd;
  }
  if ((trade as any)?.positionSize !== undefined && (trade as any).positionSize > 0) {
    return (trade as any).positionSize;
  }
  const coins = trade.positionSizeCoins !== undefined ? trade.positionSizeCoins : ((trade as any)?.coins || 0);
  const entry = trade.entryPrice || 0;
  if (coins > 0 && entry > 0) {
    return coins * entry;
  }
  return 0;
};

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

export const parseTradeNotesLineByLine = (notes?: string | null): string[] => {
  if (!notes) return [];
  // Split on newlines, pipes, or unspaced event prefixes like "🎯", "Synced ", "Auto-synced", etc.
  const rawParts = notes
    .replace(/([^\n|])(🎯)/g, '$1\n$2')
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
    trade.notes?.includes('Binance') || 
    trade.market === 'SPOT'
  );
};

export const isBinanceLinkedTrade = (trade: Partial<Trade>): boolean => {
  if (!trade) return false;
  return Boolean(
    trade.binanceOrderId || 
    trade.clientOrderId || 
    trade.notes?.includes('Binance') || 
    trade.notes?.includes('synced') || 
    trade.notes?.includes('Imported') || 
    trade.market === 'SPOT' ||
    (!trade.isAlpha && trade.market !== 'ALPHA' && !(trade as any)?.isDemo)
  );
};

export const getTradeEffectiveRisk = (trade: Partial<Trade>): number => {
  if (trade.stopLoss && isStopLossAtBreakeven(trade)) {
    return 0;
  }
  if (trade.stopLoss && trade.entryPrice && Math.abs(trade.entryPrice - trade.stopLoss) > 0.000001) {
    const coins = getTradeCoins(trade);
    const riskPerCoin = Math.abs(trade.entryPrice - trade.stopLoss);
    const calculatedRisk = parseFloat((coins * riskPerCoin).toFixed(6));
    // When coins and price delta give a valid risk amount, this is the authentic execution risk
    if (calculatedRisk > 0) {
      return calculatedRisk;
    }
    // Fallback to explicit riskAmount if coins could not be derived
    if (trade.riskAmount && trade.riskAmount > 0) {
      return trade.riskAmount;
    }
    return calculatedRisk;
  }
  return trade.riskAmount || 0;
};

export const getTradeEffectiveRiskPercent = (trade: Partial<Trade>, portfolioSize?: number): number => {
  const riskAmount = getTradeEffectiveRisk(trade);
  if (riskAmount <= 0) return 0;
  const pSize = (trade.portfolioSize && trade.portfolioSize > 0) ? trade.portfolioSize : (portfolioSize || 0);
  if (pSize > 0 && riskAmount > 0) {
    return (riskAmount / pSize) * 100;
  }
  return trade.riskPercent || 0;
};

/**
 * Institutional No-SL Risk & R:R Framework.
 * 
 * Defines how risk, target R:R, and R-multiples are calculated for trades
 * that lack an explicit stop loss (e.g. Spot holdings, manual DCA, or Binance imports).
 * 
 * 1. Hard Stop: Exact risk = coins * |entry - stopLoss|.
 * 2. Breakeven: Risk = $0.00 (Guaranteed capital preservation; pure upside).
 * 3. No-SL Unprotected:
 *    - Catastrophic Exposure: 100% position capital (coins * entryPrice).
 *    - Standard 1R Unit: Portfolio Equity * (riskPercent || 1%).
 *    - Implied Benchmark Stops:
 *      - 1:2 RR Implied Stop: entry - (TP1 - entry)/2
 *      - 1:1.5 RR Implied Stop: entry - (TP1 - entry)/1.5
 *      - Percentage Stops: -3% (conservative), -5% (balanced), -10% (wide swing).
 *    - Normalized R-Multiple: PnL / Portfolio 1R Risk Unit.
 */
export const getTradeRiskFramework = (
  trade: Partial<Trade>,
  portfolioSize?: number
): TradeRiskFramework => {
  const isLong = getTradeIsLong(trade);
  const coins = getTradeCoins(trade);
  const entry = trade.entryPrice || 0;
  const invested = getTradeInvestedAmount(trade);
  const stopLoss = trade.stopLoss || 0;
  const tp1 = trade.takeProfit1 || 0;

  // 1. Calculate Portfolio 1R Unit (standard 1% of equity)
  const effectivePortfolio = (trade.portfolioSize && trade.portfolioSize > 0)
    ? trade.portfolioSize
    : (portfolioSize && portfolioSize > 0)
      ? portfolioSize
      : (invested > 0 ? invested * 10 : 10000);
  
  const riskPct = (trade.riskPercent && trade.riskPercent > 0) ? trade.riskPercent : 1.0;
  const portfolioRiskUnit = Math.max(1, (effectivePortfolio * riskPct) / 100);

  // Case 1: Hard Stop Loss
  if (stopLoss > 0 && !isStopLossAtBreakeven(trade) && Math.abs(stopLoss - entry) > 0.000001) {
    const riskPerCoin = Math.abs(entry - stopLoss);
    const calculatedRisk = coins > 0 ? (coins * riskPerCoin) : 0;
    const riskAmount = calculatedRisk > 0
      ? calculatedRisk
      : ((trade.riskAmount && trade.riskAmount > 0)
          ? trade.riskAmount
          : (invested > 0 ? invested * (riskPerCoin / entry) : riskPerCoin));
    
    let impliedRR: number | null = null;
    if (tp1 > 0 && riskAmount > 0) {
      impliedRR = calculateTargetRR(entry, stopLoss, tp1);
    }

    return {
      riskType: 'HARD_STOP',
      effectiveRiskAmount: riskAmount,
      maxDownsideExposure: riskAmount,
      portfolioRiskUnit,
      isUnprotected: false,
      isBreakeven: false,
      impliedStopLoss: stopLoss,
      impliedRiskReward: impliedRR !== null ? parseFloat(impliedRR.toFixed(2)) : null,
      benchmarkLabel: `Hard Stop (-$${riskAmount.toFixed(2)})`,
      recommendedStops: null
    };
  }

  // Case 2: Breakeven Stop Loss (stopLoss === entry)
  if (stopLoss > 0 && isStopLossAtBreakeven(trade)) {
    return {
      riskType: 'BREAKEVEN',
      effectiveRiskAmount: 0,
      maxDownsideExposure: 0,
      portfolioRiskUnit,
      isUnprotected: false,
      isBreakeven: true,
      impliedStopLoss: entry,
      impliedRiskReward: null,
      benchmarkLabel: 'Risk-Free Breakeven (0.00R)',
      recommendedStops: null
    };
  }

  // Case 3: No Stop Loss (Unprotected Downside)
  const maxDownsideExposure = invested > 0 ? invested : (coins * entry);

  // Determine benchmark stops
  let recommendedStops: RecommendedStops;
  let impliedStopLoss: number | null = null;
  let impliedRiskReward: number | null = null;

  if (tp1 > 0 && entry > 0) {
    const targetDelta = Math.abs(tp1 - entry);
    const targetProfit = coins > 0 ? coins * targetDelta : targetDelta;
    
    // Implied benchmark stops based on reward targets
    const balancedStop = isLong ? (entry - targetDelta / 2) : (entry + targetDelta / 2); // 1:2 RR
    const conservativeStop = isLong ? (entry - targetDelta / 3) : (entry + targetDelta / 3); // 1:3 RR
    const aggressiveStop = isLong ? (entry - targetDelta / 1.5) : (entry + targetDelta / 1.5); // 1:1.5 RR

    recommendedStops = {
      conservative: Math.max(0, parseFloat(conservativeStop.toFixed(6))),
      balanced: Math.max(0, parseFloat(balancedStop.toFixed(6))),
      aggressive: Math.max(0, parseFloat(aggressiveStop.toFixed(6)))
    };
    impliedStopLoss = recommendedStops.balanced;
    
    // Implied R:R against standard portfolio risk unit
    impliedRiskReward = portfolioRiskUnit > 0 ? parseFloat((targetProfit / portfolioRiskUnit).toFixed(2)) : 2.0;
  } else if (entry > 0) {
    // Technical percentage-based stops (-3%, -5%, -10%)
    recommendedStops = {
      conservative: parseFloat((isLong ? entry * 0.97 : entry * 1.03).toFixed(6)),
      balanced: parseFloat((isLong ? entry * 0.95 : entry * 1.05).toFixed(6)),
      aggressive: parseFloat((isLong ? entry * 0.90 : entry * 1.10).toFixed(6))
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
    : (maxDownsideExposure > 0 ? maxDownsideExposure * 0.05 : 100);

  return {
    riskType: 'PORTFOLIO_UNIT',
    effectiveRiskAmount,
    maxDownsideExposure,
    portfolioRiskUnit,
    isUnprotected: true,
    isBreakeven: false,
    impliedStopLoss,
    impliedRiskReward,
    benchmarkLabel: `Normalized 1R (${riskPct}% Equity: $${effectiveRiskAmount.toFixed(0)})`,
    recommendedStops
  };
};

/**
 * Calculates R-multiple using the No-SL Framework.
 * For trades with hard stops: PnL / explicitRisk.
 * For trades with no stop loss: PnL / portfolioRiskUnit (normalized to 1% equity).
 */
export const calculateNormalizedRMultiple = (
  pnl: number,
  trade: Partial<Trade>,
  portfolioSize?: number
): { r: number; isNormalized: boolean; note: string } => {
  const framework = getTradeRiskFramework(trade, portfolioSize);

  if (framework.riskType === 'BREAKEVEN') {
    if (Math.abs(pnl) < 0.01) {
      return { r: 0, isNormalized: false, note: 'Breakeven (0.00R)' };
    }
    const r = framework.portfolioRiskUnit > 0 ? pnl / framework.portfolioRiskUnit : 0;
    return { r: parseFloat(r.toFixed(2)), isNormalized: true, note: 'Risk-free upside normalized to 1R' };
  }

  if (framework.riskType === 'HARD_STOP') {
    const r = framework.effectiveRiskAmount > 0 ? pnl / framework.effectiveRiskAmount : 0;
    return { r: parseFloat(r.toFixed(2)), isNormalized: false, note: 'Hard Stop R-Multiple' };
  }

  // No-SL trade: normalized against 1R unit
  const r = framework.effectiveRiskAmount > 0 ? pnl / framework.effectiveRiskAmount : 0;
  return { 
    r: parseFloat(r.toFixed(2)), 
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
  if (entry <= 0 || tp <= 0) return 0;
  const isLong = stop > 0 ? entry > stop : tp > entry;
  const riskPerCoin = (stop > 0 && Math.abs(entry - stop) > 0.00000001) 
    ? Math.abs(entry - stop) 
    : (entry * 0.05); // benchmark 5% risk if no SL or breakeven
  const profitPerCoin = isLong ? (tp - entry) : (entry - tp);
  return profitPerCoin / riskPerCoin;
};

export const calculateTargetProfit = (
  entry: number,
  stop: number,
  tp: number,
  coins: number,
  pct: number
): number => {
  if (tp === 0 || pct === 0 || coins <= 0 || entry <= 0) return 0;
  const isLong = stop > 0 ? entry > stop : tp > entry;
  const profitPerCoin = isLong ? (tp - entry) : (entry - tp);
  const soldCoins = coins * (pct / 100);
  return soldCoins * profitPerCoin;
};

export const calculateTargetSellFee = (
  tp: number,
  coins: number,
  pct: number,
  feeRate: number = 0.001
): number => {
  if (tp === 0 || pct === 0 || coins <= 0) return 0;
  const soldCoins = coins * (pct / 100);
  return soldCoins * tp * feeRate;
};

export const calculateProfit = (trade: Partial<Trade>, tp: number, pct: number) => {
  if (!trade.entryPrice || !trade.positionSizeCoins) return 0;
  return calculateTargetProfit(
    trade.entryPrice,
    trade.stopLoss || 0,
    tp,
    trade.positionSizeCoins,
    pct
  );
};

export const calculateRemainingCoins = (trade: Trade) => {
  const status = trade.status || 'ACTIVE';
  if (['HIT_SL', 'CLOSED_MANUAL', 'CLOSED_BREAK_EVEN', 'BREAK_EVEN', 'HIT_TP3'].includes(status)) return 0;
  if (trade.closedAt) return 0;

  const totalCoins = trade.positionSizeCoins || 0;
  if (totalCoins <= 0) return 0;

  // 1. If explicit soldCoins is tracked
  if (trade.soldCoins !== undefined && trade.soldCoins > 0) {
    if (totalCoins > trade.soldCoins) {
      const remaining = totalCoins - trade.soldCoins;
      return remaining > 0.00001 ? remaining : 0;
    }
    // If soldCoins >= totalCoins (e.g. positionSizeCoins holds remaining held coins from Binance sync),
    // and status is an open partial exit / active trade, the held coins are still active!
    if (['ACTIVE', 'HIT_TP1', 'HIT_TP2', 'PARTIAL_EXIT'].includes(status)) {
      return totalCoins;
    }
    return 0;
  }

  // 2. If status is PARTIAL_EXIT without explicit soldCoins
  if (status === 'PARTIAL_EXIT') {
    const soldPct = Math.min(99, trade.tp1Percent || 50);
    return totalCoins * (1 - soldPct / 100);
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

  const remaining = totalCoins * (1 - Math.min(99, Math.max(0, soldPct)) / 100);
  return remaining > 0.00001 ? remaining : 0;
};

/**
 * Accurately extracts and converts execution commission into USDT:
 * 1. If commission is in a USD-pegged stablecoin (USDT, USDC, BUSD, FDUSD, TUSD), use face value 1:1.
 * 2. If commission is in the traded coin (e.g. BTC on BTCUSDT, ETH on ETHUSDT, FLOKI on 1000FLOKIUSDT):
 *    Calculates the exact USDT amount at that specific time based on the coin's execution price!
 * 3. If commission is in BNB (Binance fee deduction), converts using BNB/USDT price.
 * 4. Supports mixed orders (e.g. Buy order fee charged in coin, Sell order fee charged in USDT).
 */
export function calculateExecutionFeeInUsd(
  commissionAsset: string | undefined,
  commissionAmount: number | string | undefined,
  executionPrice: number,
  symbol: string,
  bnbPrice: number = 600
): number {
  if (!commissionAmount) return 0;
  const comm = typeof commissionAmount === 'number' ? commissionAmount : parseFloat(commissionAmount);
  if (isNaN(comm) || comm <= 0) return 0;
  
  const asset = (commissionAsset || 'USDT').trim().toUpperCase();
  const cleanSym = symbol.trim().toUpperCase();
  
  // 1. USD stablecoins (1:1 USD equivalent)
  if (['USDT', 'USD', 'USDC', 'BUSD', 'FDUSD', 'TUSD'].includes(asset)) {
    return comm;
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
      return comm * (executionPrice / mult);
    }
    return comm * executionPrice;
  }
  
  // 3. BNB fee discount
  if (asset === 'BNB') {
    return comm * (bnbPrice > 0 ? bnbPrice : 600);
  }
  
  // 4. Default fallback: if asset is present anywhere in symbol, treat as base coin
  if (cleanSym.includes(asset)) {
    return comm * executionPrice;
  }
  
  return comm * executionPrice;
}

/**
 * Consolidates all fee sources for a trade:
 * buyFeeUsd, sellFeeUsd, totalFeesUsd, feeUsd, or estimated 0.1% spot fee standard.
 */
export const getTradeConsolidatedFees = (trade: Partial<Trade>): {
  buyFee: number;
  sellFee: number;
  totalFees: number;
} => {
  const buyFee = trade.buyFeeUsd ?? (trade.feeUsd && !trade.soldCoins ? trade.feeUsd : 0);
  const sellFee = trade.sellFeeUsd ?? (trade.feeUsd && trade.soldCoins ? trade.feeUsd : 0);
  let totalFees: number;

  if (trade.buyFeeUsd !== undefined && trade.sellFeeUsd !== undefined) {
    totalFees = trade.buyFeeUsd + trade.sellFeeUsd;
  } else if (trade.totalFeesUsd !== undefined && trade.totalFeesUsd > 0) {
    totalFees = trade.totalFeesUsd;
  } else if (buyFee > 0 || sellFee > 0) {
    totalFees = buyFee + sellFee;
  } else if (trade.feeUsd && trade.feeUsd > 0) {
    totalFees = trade.feeUsd;
  } else if (trade.totalBuyUsd && trade.totalBuyUsd > 0) {
    totalFees = trade.totalBuyUsd * 0.001; // 0.1% standard fee
  } else {
    totalFees = 0;
  }

  return {
    buyFee: trade.buyFeeUsd ?? (trade.totalBuyUsd ? trade.totalBuyUsd * 0.001 : 0),
    sellFee: trade.sellFeeUsd ?? 0,
    totalFees
  };
};

/**
 * Calculates the dynamic blended breakeven price on remaining coins.
 * When partial take profits are executed (e.g. at TP1), profit banked lowers the required
 * exit price on the remaining position to achieve overall dollar neutrality (0 PnL).
 * 
 * Formula:
 * Remaining Cost Basis = (Total Initial Cost + Total Fees - Realized Banked Proceeds)
 * Blended Breakeven = Remaining Cost Basis / Remaining Coins
 */
export const calculateBlendedBreakeven = (trade: Trade): {
  blendedBreakeven: number | null;
  shiftPercent: number;
  originalEntry: number;
} => {
  const originalEntry = trade.entryPrice || 0;
  if (originalEntry <= 0) return { blendedBreakeven: null, shiftPercent: 0, originalEntry: 0 };

  const remainingCoins = calculateRemainingCoins(trade);
  if (remainingCoins <= 0.00001) {
    return { blendedBreakeven: originalEntry, shiftPercent: 0, originalEntry };
  }

  const initialCoins = trade.positionSizeCoins || (trade.totalBuyUsd ? trade.totalBuyUsd / originalEntry : 0);
  if (initialCoins <= 0) {
    return { blendedBreakeven: originalEntry, shiftPercent: 0, originalEntry };
  }

  const totalBuyCost = trade.totalBuyUsd || (initialCoins * originalEntry);
  const fees = getTradeConsolidatedFees(trade).totalFees;
  const isLong = getTradeIsLong(trade);

  // If no partial exits have occurred yet, breakeven is entry + fee cost per coin
  const soldCoins = trade.soldCoins || (initialCoins - remainingCoins);
  const realizedProfit = trade.realizedProfitUsd || 0;

  if (soldCoins <= 0.00001 && realizedProfit === 0) {
    const feeAdjustedBreakeven = isLong 
      ? originalEntry + (fees / initialCoins) 
      : originalEntry - (fees / initialCoins);
    return { 
      blendedBreakeven: feeAdjustedBreakeven, 
      shiftPercent: ((feeAdjustedBreakeven - originalEntry) / originalEntry) * 100, 
      originalEntry 
    };
  }

  // When partial profit is already realized:
  // For Long: Remaining coins need to cover (Total Cost + Total Fees - Total Return So Far)
  // Total Return So Far = (Sold Coins * Entry) + Realized Profit (or Net Proceeds)
  // Thus Remaining Required Value = Total Buy Cost + fees - (Sold Coins * Entry + Realized Profit)
  // = (Remaining Coins * Entry) + fees - Realized Profit
  // Blended Breakeven = Entry + (fees - Realized Profit) / Remaining Coins
  const netSurplusOrDeficit = fees - realizedProfit;
  const priceAdjustment = netSurplusOrDeficit / remainingCoins;

  let dynamicBreakeven = isLong 
    ? originalEntry + priceAdjustment
    : originalEntry - priceAdjustment;

  // Protect against edge case math (e.g. massive profit making breakeven negative)
  if (dynamicBreakeven < 0) dynamicBreakeven = 0;

  const shiftPercent = ((dynamicBreakeven - originalEntry) / originalEntry) * 100;

  return {
    blendedBreakeven: dynamicBreakeven,
    shiftPercent,
    originalEntry
  };
};

export const calculateLivePnL = (trade: Trade, currentPrice: number, deductFees: boolean = true) => {
  const status = trade.status || 'ACTIVE';
  if (status === 'PENDING') return 0;

  const remainingCoins = calculateRemainingCoins(trade);
  if (remainingCoins <= 0) return 0;
  
  const isLong = getTradeIsLong(trade);
  const unrealizedPerCoin = isLong ? (currentPrice - trade.entryPrice) : (trade.entryPrice - currentPrice);
  const grossUnrealized = remainingCoins * unrealizedPerCoin;

  if (!deductFees) return grossUnrealized;

  // Consolidate net fee drag: deduct prorated entry fee for remaining coins plus estimated exit fee
  const initialCoins = trade.positionSizeCoins || (trade.totalBuyUsd ? trade.totalBuyUsd / trade.entryPrice : remainingCoins);
  const remainingRatio = initialCoins > 0 ? (remainingCoins / initialCoins) : 1;
  const buyFeeDrag = (trade.buyFeeUsd || (trade.totalBuyUsd ? trade.totalBuyUsd * 0.001 : 0)) * remainingRatio;
  const estimatedExitFeeDrag = (remainingCoins * currentPrice) * 0.001; // 0.1% spot fee
  
  return grossUnrealized - (buyFeeDrag + estimatedExitFeeDrag);
};

export const calculateLivePnLPercent = (trade: Trade, currentPrice: number, deductFees: boolean = true) => {
  const status = trade.status || 'ACTIVE';
  if (status === 'PENDING') return 0;
  if (!trade.entryPrice) return 0;
  
  const remainingCoins = calculateRemainingCoins(trade);
  const costBasis = remainingCoins > 0 ? remainingCoins * trade.entryPrice : (trade.totalBuyUsd || 1);
  if (costBasis <= 0) return 0;

  const pnl = calculateLivePnL(trade, currentPrice, deductFees);
  return (pnl / costBasis) * 100;
};

export const isTradeClosed = (trade: Trade): boolean => {
  const s = trade.status || 'ACTIVE';
  // Explicitly closed terminal statuses
  if (['CLOSED_MANUAL', 'HIT_SL', 'CLOSED_BREAK_EVEN', 'BREAK_EVEN', 'HIT_TP3'].includes(s)) {
    return true;
  }
  // If trade has an explicit close timestamp, it is closed
  if (trade.closedAt) {
    return true;
  }
  // If trade status is explicitly an open/active status, it is NOT closed!
  if (['ACTIVE', 'HIT_TP1', 'HIT_TP2', 'PARTIAL_EXIT', 'PENDING'].includes(s)) {
    return false;
  }
  // Fallback for trades without status
  if (trade.soldCoins && trade.positionSizeCoins && trade.soldCoins >= trade.positionSizeCoins * 0.98) {
    return true;
  }
  const remainingCoins = calculateRemainingCoins(trade);
  return remainingCoins <= 0.00001;
};

export const calculatePortfolioStats = (
  trades: Trade[], 
  baseCapital: number, 
  livePrices: Record<string, number>,
  binanceBalance?: BinanceBalanceInfo | null
) => {
  let totalRealizedPnL = 0;
  let totalLiveUnrealizedPnL = 0;
  let totalGrossUnrealizedPnL = 0;
  let totalFeeDrag = 0;
  let activeInitialCost = 0;
  let totalActiveRisk = 0;
  let totalHoldingsInvested = 0;
  let totalTradesInvested = 0;
  
  const totalHoldingsCoins: Record<string, number> = {};
  const totalTradesCoins: Record<string, number> = {};

  trades.forEach(t => {
    const isClosed = isTradeClosed(t);
    const isPending = isLimitOrderTrade(t);

    if (['ACTIVE', 'PENDING', 'TARGET_BREAK_EVEN', 'PARTIAL_EXIT', 'HIT_TP1', 'HIT_TP2'].includes(t.status || 'ACTIVE')) {
      totalActiveRisk += getTradeEffectiveRisk(t);
    }
    
    // Net Realized PnL: Already accounts for realized fees, or deduct explicit sellFeeUsd
    const realized = t.realizedProfitUsd || 0;
    totalRealizedPnL += realized;

    const remainingCoins = calculateRemainingCoins(t);
    if (remainingCoins > 0 && t.entryPrice && !isPending && !isClosed) {
      const cost = remainingCoins * t.entryPrice;
      activeInitialCost += cost;
      if (t.type === 'HOLDING') {
        totalHoldingsInvested += cost;
        totalHoldingsCoins[t.symbol] = (totalHoldingsCoins[t.symbol] || 0) + remainingCoins;
      } else {
        totalTradesInvested += cost;
        totalTradesCoins[t.symbol] = (totalTradesCoins[t.symbol] || 0) + remainingCoins;
      }
      
      const livePrice = livePrices[t.symbol] || t.entryPrice;
      if (livePrices[t.symbol]) {
        const isLong = getTradeIsLong(t);
        const gross = remainingCoins * (isLong ? (livePrice - t.entryPrice) : (t.entryPrice - livePrice));
        totalGrossUnrealizedPnL += gross;

        const netLive = calculateLivePnL(t, livePrice, true);
        totalLiveUnrealizedPnL += netLive;
      }

      // Fee drag strictly accounts for round-trip fees on open positions (entry fee + exit fee on remaining coins)
      const initialCoins = t.positionSizeCoins || (t.totalBuyUsd ? t.totalBuyUsd / t.entryPrice : remainingCoins);
      const remRatio = initialCoins > 0 ? (remainingCoins / initialCoins) : 1;
      const buyFeeDrag = (t.buyFeeUsd || (t.totalBuyUsd ? t.totalBuyUsd * 0.001 : 0)) * remRatio;
      const exitFeeDrag = (remainingCoins * livePrice) * 0.001;
      totalFeeDrag += (buyFeeDrag + exitFeeDrag);
    }
  });

  const computedTotalEquity = baseCapital + totalRealizedPnL + totalLiveUnrealizedPnL;
  const computedAvailableCapital = Math.max(0, baseCapital + totalRealizedPnL - activeInitialCost);

  // If live Binance balance is available, use real Binance wallet figures
  // Plus any active trades tracked in the app not in Binance Spot/Funding (e.g. Binance Alpha/Web3 tokens like FARTCOIN)
  let nonBinanceActiveTradesValue = 0;
  if (binanceBalance && Array.isArray(binanceBalance.assets)) {
    const binanceAssetNames = new Set((binanceBalance.assets || []).map((a: any) => (a.asset || '').toUpperCase()));
    trades.forEach(t => {
      const isClosed = isTradeClosed(t);
      if (!isClosed && t.status !== 'PENDING') {
        const base = t.symbol.replace(/(USDT|BUSD|USDC|FDUSD)$/i, '').toUpperCase();
        if (!binanceAssetNames.has(base)) {
          const rem = calculateRemainingCoins(t);
          const price = livePrices[t.symbol] || t.entryPrice || 0;
          nonBinanceActiveTradesValue += rem * price;
        }
      }
    });
  }

  const totalEquity = binanceBalance ? (binanceBalance.totalEquity + nonBinanceActiveTradesValue) : computedTotalEquity;
  const availableCapital = binanceBalance ? binanceBalance.usdtTotal : computedAvailableCapital;
  const freeAvailableCash = binanceBalance ? binanceBalance.usdtFree : computedAvailableCapital;
  const lockedCash = binanceBalance ? binanceBalance.usdtLocked : 0;

  return { 
    totalEquity, 
    availableCapital, 
    freeAvailableCash,
    lockedCash,
    hasBinance: !!binanceBalance,
    totalRealizedPnL, 
    totalLiveUnrealizedPnL, 
    totalGrossUnrealizedPnL,
    totalFeeDrag,
    activeInitialCost, 
    totalActiveRisk, 
    totalHoldingsInvested, 
    totalTradesInvested, 
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
  for (const t of tradeList) {
    const sym = (t.symbol || 'UNKNOWN').toUpperCase().trim();
    if (!map[sym]) map[sym] = [];
    map[sym].push(t);
  }

  const groups: TradeGroupItem[] = [];
  for (const [symbol, trades] of Object.entries(map)) {
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
 * Currency formatter with Privacy Mode support
 */
export const formatCurrency = (val: number, privacy: boolean = false): string => {
  if (privacy) return '••••••';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
};

export const formatPkr = (val: number, privacy: boolean = false): string => {
  if (privacy) return '₨••••••';
  return `₨${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(val)}`;
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



