import Decimal from 'decimal.js';

// Configure institutional matching-engine precision:
// 20 significant digits for intermediate divisions/ratios, standard ROUND_HALF_UP rounding
Decimal.set({
  precision: 20,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -9,
  toExpPos: 21
});

export type CostBasisMethod = 'FIFO' | 'WAC';

/**
 * Safely constructs a Decimal instance from any numeric or string input.
 * Eliminates NaN, Infinity, currency symbols, and IEEE-754 float noise.
 */
export function D(value: Decimal.Value | undefined | null): Decimal {
  if (value === undefined || value === null || value === '') {
    return new Decimal(0);
  }
  if (value instanceof Decimal) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return new Decimal(0);
    // Convert via fixed string if sub-penny to avoid scientific notation issues, or direct number
    return new Decimal(value);
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/[$,\s]/g, '').trim();
    if (!cleaned || cleaned === '-' || cleaned === '+') return new Decimal(0);
    try {
      const d = new Decimal(cleaned);
      return d.isFinite() ? d : new Decimal(0);
    } catch {
      return new Decimal(0);
    }
  }
  return new Decimal(0);
}

/**
 * Arbitrary-precision addition: a + b
 */
export function dAdd(a: Decimal.Value | undefined | null, b: Decimal.Value | undefined | null): Decimal {
  return D(a).plus(D(b));
}

/**
 * Arbitrary-precision subtraction: a - b
 */
export function dSub(a: Decimal.Value | undefined | null, b: Decimal.Value | undefined | null): Decimal {
  return D(a).minus(D(b));
}

/**
 * Arbitrary-precision multiplication: a * b
 */
export function dMul(a: Decimal.Value | undefined | null, b: Decimal.Value | undefined | null): Decimal {
  return D(a).times(D(b));
}

/**
 * Safe arbitrary-precision division: a / b (returns 0 if divisor is 0)
 */
export function dDiv(a: Decimal.Value | undefined | null, b: Decimal.Value | undefined | null): Decimal {
  const divisor = D(b);
  if (divisor.isZero()) return new Decimal(0);
  return D(a).dividedBy(divisor);
}

/**
 * Rounds to 8 decimal places ($0.00000001 / 1 satoshi precision) matching Binance matching engine.
 */
export function dRound8(value: Decimal.Value | undefined | null): number {
  return D(value).toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * Rounds to 6 decimal places.
 */
export function dRound6(value: Decimal.Value | undefined | null): number {
  return D(value).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * Rounds to 4 decimal places.
 */
export function dRound4(value: Decimal.Value | undefined | null): number {
  return D(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * Rounds to 2 decimal places ($0.01 precision for compact UI cards).
 */
export function dRound2(value: Decimal.Value | undefined | null): number {
  return D(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * Rounds to arbitrary decimal places.
 */
export function dRound(value: Decimal.Value | undefined | null, decimals: number): number {
  return D(value).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * Formats a value to a fixed 8-decimal string ("0.00000000").
 */
export function dFormat8(value: Decimal.Value | undefined | null): string {
  return D(value).toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toFixed(8);
}

/**
 * Formats a value to a fixed 2-decimal string ("0.00").
 */
export function dFormat2(value: Decimal.Value | undefined | null): string {
  return D(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/**
 * Adaptive price rounding using Decimal (2 decimals for >=1000 down to 8 decimals for micro-tokens).
 */
export function dAdaptivePrice(price: Decimal.Value | undefined | null): number {
  const d = D(price);
  if (d.isZero()) return 0;
  const abs = d.abs();
  if (abs.greaterThanOrEqualTo(1000)) return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
  if (abs.greaterThanOrEqualTo(10)) return d.toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toNumber();
  if (abs.greaterThanOrEqualTo(1)) return d.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber();
  if (abs.greaterThanOrEqualTo(0.01)) return d.toDecimalPlaces(5, Decimal.ROUND_HALF_UP).toNumber();
  if (abs.greaterThanOrEqualTo(0.0001)) return d.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toNumber();
  return d.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toNumber();
}

export interface WacExitAllocationRecord {
  exitId: string;
  symbol: string;
  sellFillId: string;
  sellOrderId: string;
  sellTradeId: string;
  matchedQty: number;
  wacUnitCostUsd: number;
  sellPrice: number;
  costBasisUsd: number;
  grossProceedsUsd: number;
  allocatedPoolBuyFeeUsd: number;
  allocatedSellFeeUsd: number;
  netRealizedPnlUsd: number;
  poolQtyBefore: number;
  poolQtyAfter: number;
  sellTimestamp: number;
  reconciliationDeltaUsd: number;
}

export interface CostBasisValuationSummary {
  method: CostBasisMethod;
  remainingQty: number;
  soldQty: number;
  remainingUnitCostBasisUsd: number;
  remainingCostBasisTotalUsd: number;
  closedUnitCostBasisUsd: number;
  closedCostBasisTotalUsd: number;
  grossProceedsUsd: number;
  allocatedBuyFeeUsd: number;
  allocatedSellFeeUsd: number;
  unallocatedRemainingBuyFeeUsd: number;
  totalRealizedFeesUsd: number;
  netRealizedPnlExact8Usd: number;
  netRealizedPnl2Usd: number;
  dynamicBreakevenPriceUsd: number | null;
  reconciliationDriftUsd: number;
}

export interface CostBasisFillInput {
  fillId: string;
  orderId: string;
  tradeId?: string;
  symbol: string;
  isBuyer: boolean;
  price: Decimal.Value;
  qty: Decimal.Value;
  quoteQty?: Decimal.Value;
  feeUsd?: Decimal.Value;
  commissionAmount?: Decimal.Value;
  commissionAsset?: string;
  isBaseAssetFee?: boolean;
  timestamp: number;
}

/**
 * Computes Weighted Average Cost (WAC) pool state and exit allocations across a chronological stream of fills
 * using 20-digit Decimal arithmetic and 8-decimal tick rounding.
 *
 * WAC Accounting Standard:
 * - On BUY fill: PoolQty_new = PoolQty + Q_buy; PoolCost_new = PoolCost + QuoteCost_buy; WAC = PoolCost_new / PoolQty_new.
 *   Unallocated buy fees accumulate in PoolBuyFees.
 * - On SELL fill: Cost basis of sold shares is (matchedQty * current WAC).
 *   PoolQty decreases by matchedQty; PoolCost decreases by (matchedQty * WAC) so remaining shares retain the exact same WAC!
 *   PoolBuyFees are allocated pro-rata by (matchedQty / PoolQty_before).
 */
export function computeWacCostBasis(
  symbol: string,
  chronologicalFills: CostBasisFillInput[],
  estimatedExitFeeRate: number = 0.001
): {
  summary: CostBasisValuationSummary;
  wacExits: WacExitAllocationRecord[];
} {
  const cleanSym = (symbol || '').toUpperCase().trim();
  let poolQty = new Decimal(0);
  let poolCostUsd = new Decimal(0);
  let poolUnallocatedBuyFeesUsd = new Decimal(0);
  let currentWacUnitCost = new Decimal(0);

  let totalSoldQty = new Decimal(0);
  let totalClosedCostBasisUsd = new Decimal(0);
  let totalGrossProceedsUsd = new Decimal(0);
  let totalAllocatedBuyFeesUsd = new Decimal(0);
  let totalAllocatedSellFeesUsd = new Decimal(0);
  let totalNetRealizedPnlUsd = new Decimal(0);
  let maxDriftUsd = new Decimal(0);

  const wacExits: WacExitAllocationRecord[] = [];

  for (const fill of chronologicalFills) {
    const qty = D(fill.qty).toDecimalPlaces(8);
    const price = D(fill.price).toDecimalPlaces(8);
    const quoteQty = fill.quoteQty !== undefined && D(fill.quoteQty).greaterThan(0)
      ? D(fill.quoteQty).toDecimalPlaces(8)
      : qty.times(price).toDecimalPlaces(8);
    const feeUsd = D(fill.feeUsd || 0).toDecimalPlaces(8);
    const commAmt = D(fill.commissionAmount || 0).toDecimalPlaces(8);
    const isBaseFee = Boolean(fill.isBaseAssetFee);

    if (fill.isBuyer) {
      // If previous position was completely closed (dust <= 1e-8), reset pool cleanly for the new cycle
      if (poolQty.lessThanOrEqualTo(1e-8)) {
        poolQty = new Decimal(0);
        poolCostUsd = new Decimal(0);
        poolUnallocatedBuyFeesUsd = new Decimal(0);
      }

      const netQty = (isBaseFee && commAmt.greaterThan(0) && commAmt.lessThan(qty))
        ? qty.minus(commAmt).toDecimalPlaces(8)
        : qty;

      poolQty = poolQty.plus(netQty).toDecimalPlaces(8);
      poolCostUsd = poolCostUsd.plus(quoteQty).toDecimalPlaces(8);
      // If base asset fee was already deducted from netQty, quoteQty already includes the fee cost
      if (!isBaseFee) {
        poolUnallocatedBuyFeesUsd = poolUnallocatedBuyFeesUsd.plus(feeUsd).toDecimalPlaces(8);
      }
      currentWacUnitCost = poolQty.greaterThan(0)
        ? poolCostUsd.dividedBy(poolQty).toDecimalPlaces(8)
        : price;
    } else {
      if (poolQty.lessThanOrEqualTo(1e-8) || qty.lessThanOrEqualTo(0)) {
        continue;
      }

      const poolQtyBefore = poolQty;
      const matchedQty = Decimal.min(poolQty, qty).toDecimalPlaces(8);
      const sellProportionOfFill = qty.greaterThan(0) ? matchedQty.dividedBy(qty) : new Decimal(1);
      const poolDepletionRatio = poolQtyBefore.greaterThan(0) ? matchedQty.dividedBy(poolQtyBefore) : new Decimal(1);

      const sellUnitPrice = qty.greaterThan(0) ? quoteQty.dividedBy(qty).toDecimalPlaces(8) : price;
      const costBasisUsd = poolDepletionRatio.greaterThanOrEqualTo(0.999999)
        ? poolCostUsd
        : matchedQty.times(currentWacUnitCost).toDecimalPlaces(8);
      const grossProceedsUsd = matchedQty.times(sellUnitPrice).toDecimalPlaces(8);

      const allocatedPoolBuyFeeUsd = poolDepletionRatio.greaterThanOrEqualTo(0.999999)
        ? poolUnallocatedBuyFeesUsd
        : poolUnallocatedBuyFeesUsd.times(poolDepletionRatio).toDecimalPlaces(8);
      const allocatedSellFeeUsd = feeUsd.times(sellProportionOfFill).toDecimalPlaces(8);

      const netRealizedPnl = grossProceedsUsd
        .minus(costBasisUsd)
        .minus(allocatedPoolBuyFeeUsd)
        .minus(allocatedSellFeeUsd)
        .toDecimalPlaces(8);

      const reconstructedProceeds = costBasisUsd
        .plus(netRealizedPnl)
        .plus(allocatedPoolBuyFeeUsd)
        .plus(allocatedSellFeeUsd)
        .toDecimalPlaces(8);
      const delta = grossProceedsUsd.minus(reconstructedProceeds).abs().toDecimalPlaces(8);
      if (delta.greaterThan(maxDriftUsd)) {
        maxDriftUsd = delta;
      }

      poolQty = Decimal.max(0, poolQty.minus(matchedQty)).toDecimalPlaces(8);
      poolCostUsd = poolQty.lessThanOrEqualTo(1e-8)
        ? new Decimal(0)
        : Decimal.max(0, poolCostUsd.minus(costBasisUsd)).toDecimalPlaces(8);
      poolUnallocatedBuyFeesUsd = poolQty.lessThanOrEqualTo(1e-8)
        ? new Decimal(0)
        : Decimal.max(0, poolUnallocatedBuyFeesUsd.minus(allocatedPoolBuyFeeUsd)).toDecimalPlaces(8);

      totalSoldQty = totalSoldQty.plus(matchedQty).toDecimalPlaces(8);
      totalClosedCostBasisUsd = totalClosedCostBasisUsd.plus(costBasisUsd).toDecimalPlaces(8);
      totalGrossProceedsUsd = totalGrossProceedsUsd.plus(grossProceedsUsd).toDecimalPlaces(8);
      totalAllocatedBuyFeesUsd = totalAllocatedBuyFeesUsd.plus(allocatedPoolBuyFeeUsd).toDecimalPlaces(8);
      totalAllocatedSellFeesUsd = totalAllocatedSellFeesUsd.plus(allocatedSellFeeUsd).toDecimalPlaces(8);
      totalNetRealizedPnlUsd = totalNetRealizedPnlUsd.plus(netRealizedPnl).toDecimalPlaces(8);

      wacExits.push({
        exitId: `WAC_${cleanSym}_${fill.fillId}`,
        symbol: cleanSym,
        sellFillId: fill.fillId,
        sellOrderId: String(fill.orderId),
        sellTradeId: String(fill.tradeId || fill.orderId),
        matchedQty: matchedQty.toNumber(),
        wacUnitCostUsd: currentWacUnitCost.toNumber(),
        sellPrice: sellUnitPrice.toNumber(),
        costBasisUsd: costBasisUsd.toNumber(),
        grossProceedsUsd: grossProceedsUsd.toNumber(),
        allocatedPoolBuyFeeUsd: allocatedPoolBuyFeeUsd.toNumber(),
        allocatedSellFeeUsd: allocatedSellFeeUsd.toNumber(),
        netRealizedPnlUsd: netRealizedPnl.toNumber(),
        poolQtyBefore: poolQtyBefore.toNumber(),
        poolQtyAfter: poolQty.toNumber(),
        sellTimestamp: fill.timestamp,
        reconciliationDeltaUsd: delta.toNumber()
      });
    }
  }

  const closedUnitCost = totalSoldQty.greaterThan(0)
    ? totalClosedCostBasisUsd.dividedBy(totalSoldQty).toDecimalPlaces(8)
    : currentWacUnitCost;

  const remainingUnitCost = poolQty.greaterThan(0)
    ? currentWacUnitCost
    : closedUnitCost;

  // Dynamic breakeven price for remaining shares:
  // Price where (remainingQty * P * (1 - exitFeeRate)) - remainingCostBasis - unallocatedBuyFees - totalNetRealizedPnl == 0
  let dynamicBreakevenPriceUsd: number | null = null;
  if (poolQty.greaterThan(1e-8)) {
    const netMultiplier = new Decimal(1).minus(D(estimatedExitFeeRate));
    const denom = poolQty.times(netMultiplier);
    if (denom.greaterThan(0)) {
      const requiredGross = poolCostUsd.plus(poolUnallocatedBuyFeesUsd).minus(totalNetRealizedPnlUsd);
      dynamicBreakevenPriceUsd = Decimal.max(0, requiredGross.dividedBy(denom)).toDecimalPlaces(8).toNumber();
    }
  }

  const totalRealizedFees = totalAllocatedBuyFeesUsd.plus(totalAllocatedSellFeesUsd).toDecimalPlaces(8);

  return {
    summary: {
      method: 'WAC',
      remainingQty: poolQty.toNumber(),
      soldQty: totalSoldQty.toNumber(),
      remainingUnitCostBasisUsd: remainingUnitCost.toNumber(),
      remainingCostBasisTotalUsd: poolCostUsd.toNumber(),
      closedUnitCostBasisUsd: closedUnitCost.toNumber(),
      closedCostBasisTotalUsd: totalClosedCostBasisUsd.toNumber(),
      grossProceedsUsd: totalGrossProceedsUsd.toNumber(),
      allocatedBuyFeeUsd: totalAllocatedBuyFeesUsd.toNumber(),
      allocatedSellFeeUsd: totalAllocatedSellFeesUsd.toNumber(),
      unallocatedRemainingBuyFeeUsd: poolUnallocatedBuyFeesUsd.toNumber(),
      totalRealizedFeesUsd: totalRealizedFees.toNumber(),
      netRealizedPnlExact8Usd: totalNetRealizedPnlUsd.toNumber(),
      netRealizedPnl2Usd: totalNetRealizedPnlUsd.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      dynamicBreakevenPriceUsd,
      reconciliationDriftUsd: maxDriftUsd.toNumber()
    },
    wacExits
  };
}

/**
 * Calculates an unskewed R-Multiple using arbitrary-precision Decimal math.
 * Anchors 1R risk to the exact unit cost basis (FIFO or WAC) and the trade's stop loss or initial risk unit,
 * ensuring partial scale-outs and multi-tier DCA entries never distort R-multiple ratios.
 */
export function computeUnskewedRMultiple(params: {
  pnlUsd: Decimal.Value;
  unitCostBasisPrice: Decimal.Value;
  stopLossPrice?: Decimal.Value | null;
  evaluatedCoins?: Decimal.Value | null;
  totalInitialCoins?: Decimal.Value | null;
  explicitRiskAmountUsd?: Decimal.Value | null;
  portfolioSizeUsd?: Decimal.Value | null;
  riskPercent?: Decimal.Value | null;
  isLong?: boolean;
}): {
  rMultiple: number;
  rMultipleExact4: number;
  oneRUnitUsd: number;
  isNormalized: boolean;
} {
  const pnl = D(params.pnlUsd);
  const entry = D(params.unitCostBasisPrice);
  const sl = D(params.stopLossPrice);
  const evalCoins = D(params.evaluatedCoins);
  const totalCoins = D(params.totalInitialCoins).greaterThan(0) ? D(params.totalInitialCoins) : evalCoins;
  const explicitRisk = D(params.explicitRiskAmountUsd);
  const portfolio = D(params.portfolioSizeUsd);
  const riskPct = D(params.riskPercent).greaterThan(0) ? D(params.riskPercent) : new Decimal(1);
  const isLong = params.isLong !== false;

  // 1. If a valid structural Stop Loss exists (not moved above/at breakeven), compute exact per-coin structural risk
  if (entry.greaterThan(0) && sl.greaterThan(0)) {
    const unitStopDistance = isLong ? entry.minus(sl) : sl.minus(entry);
    // Check that stop loss is genuinely a risk stop (at least 0.15% away from entry, not a breakeven/trailing lock)
    const minDistance = entry.times(0.0015);
    if (unitStopDistance.greaterThan(minDistance) && totalCoins.greaterThan(0)) {
      const fullPositionRiskUsd = unitStopDistance.times(totalCoins);
      if (fullPositionRiskUsd.greaterThan(0.01)) {
        const r = pnl.dividedBy(fullPositionRiskUsd);
        return {
          rMultiple: r.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
          rMultipleExact4: r.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber(),
          oneRUnitUsd: fullPositionRiskUsd.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber(),
          isNormalized: false
        };
      }
    }
  }

  // 2. If explicit riskAmountUsd > 0 was recorded on trade creation
  if (explicitRisk.greaterThan(0.5)) {
    const r = pnl.dividedBy(explicitRisk);
    return {
      rMultiple: r.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      rMultipleExact4: r.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber(),
      oneRUnitUsd: explicitRisk.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber(),
      isNormalized: false
    };
  }

  // 3. Portfolio-anchored 1R risk unit OR 5% notional benchmark
  if (portfolio.greaterThan(0)) {
    const portRisk = portfolio.times(riskPct.dividedBy(100));
    if (portRisk.greaterThan(0)) {
      const r = pnl.dividedBy(portRisk);
      return {
        rMultiple: r.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
        rMultipleExact4: r.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber(),
        oneRUnitUsd: portRisk.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber(),
        isNormalized: true
      };
    }
  }

  const notional = entry.times(totalCoins);
  const benchmarkRisk = Decimal.max(1, notional.times(0.05));
  const r = pnl.dividedBy(benchmarkRisk);
  return {
    rMultiple: r.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    rMultipleExact4: r.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber(),
    oneRUnitUsd: benchmarkRisk.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber(),
    isNormalized: true
  };
}
