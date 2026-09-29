/**
 * Institutional Market Intelligence Engine
 * Computes deep quantitative metrics: Order Book Depth, Derivatives Funding/OI,
 * Fair Value Gaps, Liquidity Sweeps, ATR Invalidation, Volume Profile, and Session Killzones.
 */

export interface OrderBookAnalysis {
  bidVolume: number;
  askVolume: number;
  bidRatioPercent: number;
  bias: 'BUY_PRESSURE' | 'SELL_PRESSURE' | 'BALANCED';
  closestBuyWall?: { price: number; volume: number };
  closestSellWall?: { price: number; volume: number };
}

export interface DerivativesData {
  fundingRatePercent: number;
  fundingBias: 'HEAVY_LONGS_SQUEEZE_RISK' | 'HEAVY_SHORTS_SQUEEZE_PROBABLE' | 'NEUTRAL';
  openInterestUsd?: number;
}

export interface VolumeProfileData {
  pocPrice: number;
  vahPrice: number;
  valPrice: number;
  pricePosition: 'PREMIUM_ABOVE_VAH' | 'DISCOUNT_BELOW_VAL' | 'EQUILIBRIUM_VALUE_AREA';
}

export interface PriceActionSignatures {
  atr14: number;
  atrPercent: number;
  recommendedMinStopBuffer: number;
  marketRegime: 'STRONG_BULL_TREND' | 'STRONG_BEAR_TREND' | 'RANGE_BOUND' | 'CHOPPY_LOW_MOMENTUM';
  ema20?: number;
  ema50?: number;
  ema200?: number;
  bullishFvgs: { low: number; high: number }[];
  bearishFvgs: { low: number; high: number }[];
  recentSwingHigh: { price: number; timeAgoMinutes: number };
  recentSwingLow: { price: number; timeAgoMinutes: number };
  liquiditySweep?: 'BUY_SIDE_LIQUIDITY_SWEPT' | 'SELL_SIDE_LIQUIDITY_SWEPT' | 'NONE';
}

export interface SessionInfo {
  utcTimeStr: string;
  activeSession: string;
  isHighLiquidityKillzone: boolean;
  isWeekend: boolean;
}

export interface BtcVolatilityGuard {
  btcRange15mPercent: number;
  status: 'CALM_STABLE' | 'MODERATE_VOLATILITY' | 'EXTREME_VOLATILITY_ALERT';
  warningMessage?: string;
}

// 1. Order Book Depth
export async function analyzeOrderBook(symbol: string): Promise<OrderBookAnalysis | null> {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/depth?symbol=${symbol.trim().toUpperCase()}&limit=50`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.bids || !data.asks) return null;

    const topBids = data.bids.slice(0, 20);
    const topAsks = data.asks.slice(0, 20);

    const bidVol = topBids.reduce((sum: number, b: any) => sum + parseFloat(b[1]), 0);
    const askVol = topAsks.reduce((sum: number, a: any) => sum + parseFloat(a[1]), 0);
    const totalVol = bidVol + askVol;
    const bidRatio = totalVol > 0 ? (bidVol / totalVol) * 100 : 50;

    let bias: 'BUY_PRESSURE' | 'SELL_PRESSURE' | 'BALANCED' = 'BALANCED';
    if (bidRatio > 60) bias = 'BUY_PRESSURE';
    else if (bidRatio < 40) bias = 'SELL_PRESSURE';

    // Find significant buy/sell walls (> 2.5x mean volume)
    const meanBid = bidVol / (topBids.length || 1);
    const meanAsk = askVol / (topAsks.length || 1);

    const buyWall = topBids.find((b: any) => parseFloat(b[1]) >= meanBid * 2.5);
    const sellWall = topAsks.find((a: any) => parseFloat(a[1]) >= meanAsk * 2.5);

    return {
      bidVolume: parseFloat(bidVol.toFixed(2)),
      askVolume: parseFloat(askVol.toFixed(2)),
      bidRatioPercent: parseFloat(bidRatio.toFixed(1)),
      bias,
      closestBuyWall: buyWall ? { price: parseFloat(buyWall[0]), volume: parseFloat(buyWall[1]) } : undefined,
      closestSellWall: sellWall ? { price: parseFloat(sellWall[0]), volume: parseFloat(sellWall[1]) } : undefined,
    };
  } catch (e) {
    return null;
  }
}

// 2. Derivatives Funding & Open Interest
export async function analyzeDerivatives(symbol: string): Promise<DerivativesData | null> {
  try {
    const [fundingRes, oiRes] = await Promise.all([
      fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol.trim().toUpperCase()}&limit=1`),
      fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol.trim().toUpperCase()}`)
    ]);

    let fundingRatePercent = 0.01;
    if (fundingRes.ok) {
      const fData = await fundingRes.json();
      if (Array.isArray(fData) && fData[0]?.fundingRate) {
        fundingRatePercent = parseFloat(fData[0].fundingRate) * 100;
      }
    }

    let openInterestUsd: number | undefined;
    if (oiRes.ok) {
      const oiData = await oiRes.json();
      if (oiData?.openInterest) {
        openInterestUsd = parseFloat(oiData.openInterest);
      }
    }

    let fundingBias: 'HEAVY_LONGS_SQUEEZE_RISK' | 'HEAVY_SHORTS_SQUEEZE_PROBABLE' | 'NEUTRAL' = 'NEUTRAL';
    if (fundingRatePercent > 0.035) {
      fundingBias = 'HEAVY_LONGS_SQUEEZE_RISK';
    } else if (fundingRatePercent < -0.015) {
      fundingBias = 'HEAVY_SHORTS_SQUEEZE_PROBABLE';
    }

    return {
      fundingRatePercent: parseFloat(fundingRatePercent.toFixed(4)),
      fundingBias,
      openInterestUsd
    };
  } catch (e) {
    return null;
  }
}

// 3. Technical Indicators & Price Action Signatures
export function analyzePriceAction(candles: any[]): PriceActionSignatures | null {
  if (!candles || candles.length < 20) return null;

  const closes = candles.map(c => parseFloat(c[4]));
  const highs = candles.map(c => parseFloat(c[2]));
  const lows = candles.map(c => parseFloat(c[3]));
  const currentPrice = closes[closes.length - 1];

  // ATR(14)
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const h = highs[i];
    const l = lows[i];
    const prevC = closes[i - 1];
    const tr = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
    trs.push(tr);
  }
  const period = 14;
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  const atrPercent = (atr / currentPrice) * 100;
  const recommendedMinStopBuffer = atr * 1.35;

  // EMAs
  const calcEMA = (data: number[], len: number) => {
    if (data.length < len) return undefined;
    const k = 2 / (len + 1);
    let val = data.slice(0, len).reduce((a, b) => a + b, 0) / len;
    for (let i = len; i < data.length; i++) {
      val = data[i] * k + val * (1 - k);
    }
    return val;
  };

  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const ema200 = calcEMA(closes, Math.min(closes.length, 200));

  let marketRegime: 'STRONG_BULL_TREND' | 'STRONG_BEAR_TREND' | 'RANGE_BOUND' | 'CHOPPY_LOW_MOMENTUM' = 'RANGE_BOUND';
  if (ema20 && ema50) {
    if (currentPrice > ema20 && ema20 > ema50) {
      marketRegime = 'STRONG_BULL_TREND';
    } else if (currentPrice < ema20 && ema20 < ema50) {
      marketRegime = 'STRONG_BEAR_TREND';
    } else {
      const spreadPct = Math.abs(ema20 - ema50) / currentPrice;
      if (spreadPct < 0.003) {
        marketRegime = 'CHOPPY_LOW_MOMENTUM';
      }
    }
  }

  // Fair Value Gaps (Unmitigated)
  const bullishFvgs: { low: number; high: number }[] = [];
  const bearishFvgs: { low: number; high: number }[] = [];

  for (let i = 2; i < candles.length - 1; i++) {
    // Bullish FVG: Candle i-2 High < Candle i Low
    if (highs[i - 2] < lows[i]) {
      const gapLow = highs[i - 2];
      const gapHigh = lows[i];
      // Check if mitigated by later candles
      let mitigated = false;
      for (let j = i + 1; j < candles.length; j++) {
        if (lows[j] <= gapLow) {
          mitigated = true;
          break;
        }
      }
      if (!mitigated && Math.abs(currentPrice - gapHigh) / currentPrice < 0.04) {
        bullishFvgs.push({ low: parseFloat(gapLow.toFixed(4)), high: parseFloat(gapHigh.toFixed(4)) });
      }
    }

    // Bearish FVG: Candle i-2 Low > Candle i High
    if (lows[i - 2] > highs[i]) {
      const gapHigh = lows[i - 2];
      const gapLow = highs[i];
      let mitigated = false;
      for (let j = i + 1; j < candles.length; j++) {
        if (highs[j] >= gapHigh) {
          mitigated = true;
          break;
        }
      }
      if (!mitigated && Math.abs(currentPrice - gapLow) / currentPrice < 0.04) {
        bearishFvgs.push({ low: parseFloat(gapLow.toFixed(4)), high: parseFloat(gapHigh.toFixed(4)) });
      }
    }
  }

  // Key Swings over last 30 candles
  const lookback = Math.min(30, candles.length);
  const subsetHighs = highs.slice(-lookback);
  const subsetLows = lows.slice(-lookback);
  const maxHigh = Math.max(...subsetHighs);
  const minLow = Math.min(...subsetLows);
  const maxHighIdx = subsetHighs.lastIndexOf(maxHigh);
  const minLowIdx = subsetLows.lastIndexOf(minLow);

  const recentSwingHigh = {
    price: maxHigh,
    timeAgoMinutes: (lookback - 1 - maxHighIdx) * 15
  };
  const recentSwingLow = {
    price: minLow,
    timeAgoMinutes: (lookback - 1 - minLowIdx) * 15
  };

  // Liquidity Sweeps (most recent 2 candles)
  let liquiditySweep: 'BUY_SIDE_LIQUIDITY_SWEPT' | 'SELL_SIDE_LIQUIDITY_SWEPT' | 'NONE' = 'NONE';
  const lastCandle = candles[candles.length - 1];
  const prevCandle = candles[candles.length - 2];

  const cHigh = parseFloat(lastCandle[2]);
  const cLow = parseFloat(lastCandle[3]);
  const cClose = parseFloat(lastCandle[4]);
  const cOpen = parseFloat(lastCandle[1]);

  if (cHigh >= recentSwingHigh.price && cClose < recentSwingHigh.price && (cHigh - Math.max(cOpen, cClose)) > (Math.abs(cClose - cOpen))) {
    liquiditySweep = 'BUY_SIDE_LIQUIDITY_SWEPT';
  } else if (cLow <= recentSwingLow.price && cClose > recentSwingLow.price && (Math.min(cOpen, cClose) - cLow) > (Math.abs(cClose - cOpen))) {
    liquiditySweep = 'SELL_SIDE_LIQUIDITY_SWEPT';
  }

  return {
    atr14: parseFloat(atr.toFixed(4)),
    atrPercent: parseFloat(atrPercent.toFixed(2)),
    recommendedMinStopBuffer: parseFloat(recommendedMinStopBuffer.toFixed(4)),
    marketRegime,
    ema20: ema20 ? parseFloat(ema20.toFixed(4)) : undefined,
    ema50: ema50 ? parseFloat(ema50.toFixed(4)) : undefined,
    ema200: ema200 ? parseFloat(ema200.toFixed(4)) : undefined,
    bullishFvgs: bullishFvgs.slice(-3),
    bearishFvgs: bearishFvgs.slice(-3),
    recentSwingHigh,
    recentSwingLow,
    liquiditySweep
  };
}

// 4. Volume Profile & POC (Point of Control)
export function calculateVolumeProfile(candles: any[]): VolumeProfileData | null {
  if (!candles || candles.length < 15) return null;

  const highs = candles.map(c => parseFloat(c[2]));
  const lows = candles.map(c => parseFloat(c[3]));
  const currentPrice = parseFloat(candles[candles.length - 1][4]);

  const minPrice = Math.min(...lows);
  const maxPrice = Math.max(...highs);
  if (minPrice === maxPrice) return null;

  const NUM_BINS = 25;
  const binStep = (maxPrice - minPrice) / NUM_BINS;
  const bins = new Array(NUM_BINS).fill(0);

  candles.forEach(c => {
    const h = parseFloat(c[2]);
    const l = parseFloat(c[3]);
    const cl = parseFloat(c[4]);
    const vol = parseFloat(c[5]);
    const typical = (h + l + cl) / 3;
    const binIdx = Math.min(NUM_BINS - 1, Math.max(0, Math.floor((typical - minPrice) / binStep)));
    bins[binIdx] += vol;
  });

  // POC = bin with highest volume
  let maxVol = 0;
  let pocIdx = 0;
  let totalVol = 0;
  bins.forEach((v, idx) => {
    totalVol += v;
    if (v > maxVol) {
      maxVol = v;
      pocIdx = idx;
    }
  });

  const pocPrice = minPrice + (pocIdx + 0.5) * binStep;

  // 70% Value Area
  const targetAreaVol = totalVol * 0.7;
  let areaVol = bins[pocIdx];
  let lowerIdx = pocIdx;
  let upperIdx = pocIdx;

  while (areaVol < targetAreaVol && (lowerIdx > 0 || upperIdx < NUM_BINS - 1)) {
    const nextLower = lowerIdx > 0 ? bins[lowerIdx - 1] : -1;
    const nextUpper = upperIdx < NUM_BINS - 1 ? bins[upperIdx + 1] : -1;

    if (nextLower >= nextUpper && lowerIdx > 0) {
      areaVol += nextLower;
      lowerIdx--;
    } else if (upperIdx < NUM_BINS - 1) {
      areaVol += nextUpper;
      upperIdx++;
    } else if (lowerIdx > 0) {
      areaVol += nextLower;
      lowerIdx--;
    } else {
      break;
    }
  }

  const valPrice = minPrice + lowerIdx * binStep;
  const vahPrice = minPrice + (upperIdx + 1) * binStep;

  let pricePosition: 'PREMIUM_ABOVE_VAH' | 'DISCOUNT_BELOW_VAL' | 'EQUILIBRIUM_VALUE_AREA' = 'EQUILIBRIUM_VALUE_AREA';
  if (currentPrice > vahPrice) pricePosition = 'PREMIUM_ABOVE_VAH';
  else if (currentPrice < valPrice) pricePosition = 'DISCOUNT_BELOW_VAL';

  return {
    pocPrice: parseFloat(pocPrice.toFixed(4)),
    vahPrice: parseFloat(vahPrice.toFixed(4)),
    valPrice: parseFloat(valPrice.toFixed(4)),
    pricePosition
  };
}

// 5. Session & Killzone Timing
export function getSessionTiming(): SessionInfo {
  const now = new Date();
  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();
  const day = now.getUTCDay();
  const isWeekend = day === 0 || day === 6;

  let activeSession = 'Off-hours Consolidation';
  let isHighLiquidityKillzone = false;

  if (utcHours >= 7 && utcHours < 11) {
    activeSession = 'London Open Killzone (High Volatility Expansion)';
    isHighLiquidityKillzone = true;
  } else if (utcHours >= 12 && utcHours < 16) {
    activeSession = 'New York Open Killzone (Peak Institutional Volume)';
    isHighLiquidityKillzone = true;
  } else if (utcHours >= 16 && utcHours < 20) {
    activeSession = 'New York Afternoon / Close';
  } else if (utcHours >= 0 && utcHours < 7) {
    activeSession = 'Asia Session (Range Formation & Liquidity Build)';
  }

  const utcTimeStr = `${utcHours.toString().padStart(2, '0')}:${utcMinutes.toString().padStart(2, '0')} UTC`;

  return {
    utcTimeStr,
    activeSession: isWeekend ? `${activeSession} [WEEKEND LOW LIQUIDITY]` : activeSession,
    isHighLiquidityKillzone: !isWeekend && isHighLiquidityKillzone,
    isWeekend
  };
}

// 6. BTC Volatility Spike Guard
export async function getBtcVolatilityGuard(): Promise<BtcVolatilityGuard> {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=4`);
    if (!res.ok) return { btcRange15mPercent: 0, status: 'CALM_STABLE' };
    const klines = await res.json();
    if (!Array.isArray(klines) || klines.length === 0) return { btcRange15mPercent: 0, status: 'CALM_STABLE' };

    const last = klines[klines.length - 1];
    const high = parseFloat(last[2]);
    const low = parseFloat(last[3]);
    const close = parseFloat(last[4]);
    const rangePct = ((high - low) / close) * 100;

    let status: 'CALM_STABLE' | 'MODERATE_VOLATILITY' | 'EXTREME_VOLATILITY_ALERT' = 'CALM_STABLE';
    let warningMessage: string | undefined;

    if (rangePct > 1.8) {
      status = 'EXTREME_VOLATILITY_ALERT';
      warningMessage = `BTC is having an aggressive ${rangePct.toFixed(2)}% move in 15m. Altcoins have severe breakdown correlation.`;
    } else if (rangePct > 0.9) {
      status = 'MODERATE_VOLATILITY';
    }

    return {
      btcRange15mPercent: parseFloat(rangePct.toFixed(2)),
      status,
      warningMessage
    };
  } catch (e) {
    return { btcRange15mPercent: 0, status: 'CALM_STABLE' };
  }
}
