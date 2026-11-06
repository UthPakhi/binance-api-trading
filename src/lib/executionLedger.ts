import Decimal from 'decimal.js';
import {
  D,
  dRound8,
  dRound2,
  CostBasisMethod,
  CostBasisValuationSummary,
  WacExitAllocationRecord,
  computeWacCostBasis
} from './financialMath';

export type {
  CostBasisMethod,
  CostBasisValuationSummary,
  WacExitAllocationRecord
};

export type FeeCurrencyMode = 'QUOTE_ASSET' | 'BASE_ASSET' | 'BNB' | 'OTHER';

export interface ExecutionEvent {
  eventId: string;
  orderId: string;
  tradeId?: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  price: number;
  qty: number;
  quoteQty: number;
  feeUsd: number;
  commission?: number;
  commissionAmount?: number;
  commissionAsset?: string;
  feeCurrencyMode?: FeeCurrencyMode;
  feeMode?: FeeCurrencyMode;
  timestamp: number;
  isBuyer: boolean;
  fingerprint: string;
  idempotencyKey?: string;
}

/**
 * Immutable Double-Entry Ledger record mapping a specific buy fill lot to a sell fill lot:
 * (buy_fill_id ➔ sell_fill_id) with 8-decimal ($0.00000001) Decimal precision.
 */
export interface DoubleEntryMatchRecord {
  matchId: string;             // "${buyFillId}->${sellFillId}"
  symbol: string;
  buyFillId: string;           // Strict idempotency key of buy fill
  sellFillId: string;          // Strict idempotency key of sell fill
  buyOrderId: string;
  sellOrderId: string;
  buyTradeId: string;
  sellTradeId: string;
  matchedQty: number;          // 8-decimal matched base coin quantity
  buyPrice: number;            // 8-decimal buy execution price
  sellPrice: number;           // 8-decimal sell execution price
  costBasisUsd: number;        // 8-decimal exact USD cost basis for matchedQty
  grossProceedsUsd: number;    // 8-decimal exact USD gross proceeds for matchedQty
  allocatedBuyFeeUsd: number;  // 8-decimal pro-rata buy fee in USD
  allocatedSellFeeUsd: number; // 8-decimal pro-rata sell fee in USD
  buyFeeAsset: string;
  sellFeeAsset: string;
  netPnlUsd: number;           // 8-decimal exact net PnL: grossProceeds - costBasis - buyFee - sellFee
  netRealizedPnlUsd: number;   // Alias for netPnlUsd
  buyTimestamp: number;
  sellTimestamp: number;
  reconciliationDeltaUsd: number; // Guaranteed <= 0.00000001
}

export interface BuyLotLedgerState {
  buyFillId: string;
  orderId: string;
  tradeId: string;
  symbol: string;
  price: number;
  initialQty: number;
  netDeliverableQty: number;
  remainingQty: number;
  quoteQty: number;
  unitCostUsd: number;
  feeUsd: number;
  commissionAmount: number;
  commissionAsset: string;
  feeMode: FeeCurrencyMode;
  timestamp: number;
  matchedRecords: DoubleEntryMatchRecord[];
}

export interface DoubleEntryCycleResult {
  symbol: string;
  buyLots: BuyLotLedgerState[];
  matches: DoubleEntryMatchRecord[];
  wacExits: WacExitAllocationRecord[];
  fifoSummary: CostBasisValuationSummary;
  wacSummary: CostBasisValuationSummary;
  remainingCoins: number;
  soldCoins: number;
  totalBuyCostUsd: number;
  totalProceedsUsd: number;
  totalFeesUsd: number;
  netRealizedPnlUsd: number;
  isClosed: boolean;
  reconciliationDriftUsd: number;
  maxDiscrepancyUsd: number;
}

export interface RebuiltPosition {
  symbol: string;
  isLong: boolean;
  positionSizeCoins: number;
  entryPrice: number;
  wacEntryPrice: number;
  totalBuyUsd: number;
  totalFeeUsd: number;
  soldCoins: number;
  realizedProfitUsd: number;
  realizedProfitExact8Usd: number;
  wacRealizedProfitUsd: number;
  wacRealizedProfitExact8Usd: number;
  status: 'ACTIVE' | 'HIT_TP1' | 'HIT_TP2' | 'CLOSED_MANUAL';
  fills: ExecutionEvent[];
  ledgerMatches: DoubleEntryMatchRecord[];
  wacExits: WacExitAllocationRecord[];
  fifoSummary: CostBasisValuationSummary;
  wacSummary: CostBasisValuationSummary;
  openBuyLots: BuyLotLedgerState[];
  reconciledToSubCent: boolean;
  maxDiscrepancyUsd: number;
  idempotencyKey?: string;
}

/**
 * Rounds a number to 8 decimal places ($0.00000001 / 1 satoshi precision)
 * using arbitrary-precision Decimal.js to eliminate IEEE-754 floating-point drift.
 */
export function round8(value: Decimal.Value | undefined | null): number {
  return dRound8(value);
}

/**
 * Normalizes a symbol to its base ticker (e.g., BTCUSDT -> BTC).
 */
export function normalizeBaseSymbol(symbol: string): string {
  const clean = (symbol || '').trim().toUpperCase().replace(/[\/\-_ ]/g, '');
  const stripped = clean.replace(/(USDT|USDC|BUSD|FDUSD|TUSD)$/, '');
  return stripped || clean;
}

/**
 * Determines the fee currency mode for blended fee reconciliation (USDT/USDC vs Base Coin vs BNB).
 */
export function classifyFeeCurrencyMode(symbol: string, commissionAsset?: string): FeeCurrencyMode {
  if (!commissionAsset) return 'QUOTE_ASSET';
  const asset = commissionAsset.trim().toUpperCase();
  const cleanSym = (symbol || '').trim().toUpperCase();

  if (['USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD', 'USD'].includes(asset)) {
    return 'QUOTE_ASSET';
  }
  if (asset === 'BNB') {
    return 'BNB';
  }
  const baseAsset = normalizeBaseSymbol(cleanSym).replace(/^(1000000|100000|10000|1000)/, '');
  if (asset === baseAsset || cleanSym.startsWith(asset)) {
    return 'BASE_ASSET';
  }
  return 'OTHER';
}

/**
 * Generates a strict idempotency key keyed directly to Binance's unique orderId and tradeId.
 * Supports both positional `(symbol, orderId, tradeId)` and object `{ symbol, orderId, tradeId, ... }` calls.
 * Format: `${BASE_SYMBOL}_ORD${orderId}_TRD${tradeId}`
 */
export function generateStrictIdempotencyKey(
  symbolOrFill: string | {
    symbol: string;
    orderId: string | number;
    tradeId?: string | number;
    isBuyer?: boolean;
    side?: 'BUY' | 'SELL';
    price?: number;
    qty?: number;
    timestamp?: number;
  },
  orderIdArg?: string | number,
  tradeIdArg?: string | number
): string {
  if (typeof symbolOrFill === 'string') {
    const baseSym = normalizeBaseSymbol(symbolOrFill);
    const ord = String(orderIdArg ?? '').trim();
    const trd = tradeIdArg !== undefined && tradeIdArg !== null && String(tradeIdArg).trim() !== ''
      ? String(tradeIdArg).trim()
      : '0';
    return `${baseSym}_ORD${ord}_TRD${trd}`;
  }

  const fill = symbolOrFill;
  const baseSym = normalizeBaseSymbol(fill.symbol || '');
  const orderStr = String(fill.orderId ?? '').trim();
  const tradeStr = fill.tradeId !== undefined && fill.tradeId !== null && String(fill.tradeId).trim() !== '' && String(fill.tradeId) !== '-1'
    ? String(fill.tradeId).trim()
    : '';

  if (orderStr && tradeStr) {
    return `${baseSym}_ORD${orderStr}_TRD${tradeStr}`;
  }

  const cleanSym = (fill.symbol || '').toUpperCase().trim();
  const side = fill.side || (fill.isBuyer ? 'BUY' : 'SELL');
  const priceStr = D(fill.price || 0).toDecimalPlaces(8).toFixed(8);
  const qtyStr = D(fill.qty || 0).toDecimalPlaces(6).toFixed(6);
  const time = Number(fill.timestamp || 0);
  return `${cleanSym}_${orderStr}_${side}_${priceStr}_${qtyStr}_${time}`;
}

/**
 * Generates an immutable, collision-resistant fingerprint for an execution fill event.
 * Prioritizes strict `(symbol, orderId, tradeId)` idempotency when `tradeId` is present.
 */
export function generateEventFingerprint(fill: {
  orderId: string | number;
  tradeId?: string | number;
  symbol: string;
  price: number;
  qty: number;
  timestamp: number;
  isBuyer: boolean;
}): string {
  const order = String(fill.orderId || '');
  if (fill.tradeId !== undefined && fill.tradeId !== null && String(fill.tradeId).trim() !== '' && String(fill.tradeId) !== '-1') {
    return generateStrictIdempotencyKey(fill.symbol, order, fill.tradeId);
  }
  const cleanSym = (fill.symbol || '').toUpperCase().trim();
  const side = fill.isBuyer ? 'BUY' : 'SELL';
  const priceStr = D(fill.price || 0).toDecimalPlaces(8).toFixed(8);
  const qtyStr = D(fill.qty || 0).toDecimalPlaces(6).toFixed(6);
  const time = Number(fill.timestamp || 0);
  return `${cleanSym}_${order}_${side}_${priceStr}_${qtyStr}_${time}`;
}

/**
 * Deduplicates an array of raw execution events by both their strict `(orderId, tradeId)`
 * idempotency key and their cryptographic fingerprint, guaranteeing zero duplicate entries
 * across WebSocket stream events and REST backfill syncs.
 */
export function deduplicateExecutionEvents(events: ExecutionEvent[]): ExecutionEvent[] {
  const map = new Map<string, ExecutionEvent>();
  const seenIdempotencyKeys = new Set<string>();

  for (const ev of events) {
    const strictKey = ev.idempotencyKey || (ev.tradeId ? generateStrictIdempotencyKey(ev) : (ev.fingerprint || generateStrictIdempotencyKey(ev)));
    const fp = ev.fingerprint || generateEventFingerprint(ev);

    if (seenIdempotencyKeys.has(strictKey) || map.has(fp)) {
      continue;
    }

    const mode = ev.feeCurrencyMode || ev.feeMode || classifyFeeCurrencyMode(ev.symbol, ev.commissionAsset);
    const normalizedEvent: ExecutionEvent = {
      ...ev,
      price: dRound8(ev.price),
      qty: dRound8(ev.qty),
      quoteQty: dRound8(ev.quoteQty || D(ev.price).times(D(ev.qty))),
      feeUsd: dRound8(ev.feeUsd || 0),
      fingerprint: fp,
      idempotencyKey: strictKey,
      feeMode: mode,
      feeCurrencyMode: mode
    };

    seenIdempotencyKeys.add(strictKey);
    map.set(fp, normalizedEvent);
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    return String(a.tradeId || a.eventId || '').localeCompare(String(b.tradeId || b.eventId || ''));
  });
}

/**
 * Computes both strict FIFO lot-matching (`buy_fill_id ➔ sell_fill_id`) AND formal WAC (Weighted Average Cost)
 * pool accounting for a single symbol's chronological fills using 20-digit Decimal.js arithmetic.
 */
function computeSymbolDoubleEntry(
  symbol: string,
  chronologicalFills: ExecutionEvent[]
): DoubleEntryCycleResult {
  const cleanSym = (symbol || chronologicalFills[0]?.symbol || '').toUpperCase().trim();
  const buyLots: BuyLotLedgerState[] = [];
  const matches: DoubleEntryMatchRecord[] = [];
  let maxDiscrepancyDec = new Decimal(0);

  for (const fill of chronologicalFills) {
    const qtyDec = D(fill.qty).toDecimalPlaces(8);
    const priceDec = D(fill.price).toDecimalPlaces(8);
    const quoteQtyDec = fill.quoteQty !== undefined && D(fill.quoteQty).greaterThan(0)
      ? D(fill.quoteQty).toDecimalPlaces(8)
      : qtyDec.times(priceDec).toDecimalPlaces(8);
    const feeUsdDec = D(fill.feeUsd || 0).toDecimalPlaces(8);
    const commAmtDec = D(fill.commissionAmount ?? fill.commission ?? 0).toDecimalPlaces(8);
    const commAsset = (fill.commissionAsset || 'USDT').toUpperCase().trim();
    const feeMode = fill.feeCurrencyMode || fill.feeMode || classifyFeeCurrencyMode(cleanSym, commAsset);
    const fillId = fill.idempotencyKey || (fill.tradeId ? generateStrictIdempotencyKey(fill) : (fill.fingerprint || generateStrictIdempotencyKey(fill)));
    const tradeIdStr = String(fill.tradeId || fill.eventId || fill.orderId);

    if (fill.isBuyer || fill.side === 'BUY') {
      const netDeliverableDec = (feeMode === 'BASE_ASSET' && commAmtDec.greaterThan(0) && commAmtDec.lessThan(qtyDec))
        ? qtyDec.minus(commAmtDec).toDecimalPlaces(8)
        : qtyDec;
      const unitCostDec = qtyDec.greaterThan(0) ? quoteQtyDec.dividedBy(qtyDec).toDecimalPlaces(8) : priceDec;

      buyLots.push({
        buyFillId: fillId,
        orderId: String(fill.orderId),
        tradeId: tradeIdStr,
        symbol: cleanSym,
        price: priceDec.toNumber(),
        initialQty: qtyDec.toNumber(),
        netDeliverableQty: netDeliverableDec.toNumber(),
        remainingQty: netDeliverableDec.toNumber(),
        quoteQty: quoteQtyDec.toNumber(),
        unitCostUsd: unitCostDec.toNumber(),
        feeUsd: feeUsdDec.toNumber(),
        commissionAmount: commAmtDec.toNumber(),
        commissionAsset: commAsset,
        feeMode,
        timestamp: fill.timestamp,
        matchedRecords: []
      });
    } else {
      let sellQtyRemainingDec = qtyDec;
      const sellUnitPriceDec = qtyDec.greaterThan(0) ? quoteQtyDec.dividedBy(qtyDec).toDecimalPlaces(8) : priceDec;

      // Step 1: Check for an exact lot quantity match first (or net deliverable coin match within step-size tolerance)
      const exactLotIdx = buyLots.findIndex(lot => {
        const remDec = D(lot.remainingQty);
        const netDelivDec = D(lot.netDeliverableQty);
        const initDec = D(lot.initialQty);
        const stepTol = Decimal.max(initDec.times(0.0015), new Decimal(0.01));
        return remDec.greaterThan(1e-8) && (
          remDec.minus(sellQtyRemainingDec).abs().lessThanOrEqualTo(stepTol) ||
          netDelivDec.minus(sellQtyRemainingDec).abs().lessThanOrEqualTo(stepTol)
        );
      });

      const candidateLots: BuyLotLedgerState[] = [];
      if (exactLotIdx !== -1) {
        candidateLots.push(buyLots[exactLotIdx]);
      }
      for (const lot of buyLots) {
        if (D(lot.remainingQty).greaterThan(1e-8) && !candidateLots.includes(lot)) {
          candidateLots.push(lot);
        }
      }

      for (const buyLot of candidateLots) {
        if (sellQtyRemainingDec.lessThanOrEqualTo(1e-8)) break;
        const lotRemDec = D(buyLot.remainingQty);
        if (lotRemDec.lessThanOrEqualTo(1e-8)) continue;

        const lotInitDec = D(buyLot.initialQty);
        const lotNetDelivDec = D(buyLot.netDeliverableQty);
        const lotEffectiveCapDec = buyLot.feeMode === 'BASE_ASSET' && lotNetDelivDec.greaterThan(0)
          ? lotNetDelivDec
          : lotInitDec;
        const lotQuoteDec = D(buyLot.quoteQty);
        const lotUnitCostDec = D(buyLot.unitCostUsd);
        const lotFeeDec = D(buyLot.feeUsd);

        // Allow minor step-size rounding (e.g. 3386.74 sold vs 3386.73987 net deliverable) to match cleanly
        const stepToleranceDec = Decimal.max(lotEffectiveCapDec.times(0.002), new Decimal(0.02));
        const isFullLotExitWithinStep =
          sellQtyRemainingDec.greaterThanOrEqualTo(lotRemDec.minus(stepToleranceDec)) &&
          sellQtyRemainingDec.lessThanOrEqualTo(lotRemDec.plus(stepToleranceDec));

        const matchedQtyDec = isFullLotExitWithinStep
          ? sellQtyRemainingDec
          : Decimal.min(lotRemDec, sellQtyRemainingDec).toDecimalPlaces(8);

        const nextLotRemRaw = lotRemDec.minus(matchedQtyDec);
        const isLotExhausted = isFullLotExitWithinStep || nextLotRemRaw.lessThanOrEqualTo(stepToleranceDec);

        // Calculate exact already-allocated cost basis and buy fee on this lot so full exit reconciles to 100% of quoteQty
        const prevCostAllocatedDec = buyLot.matchedRecords.reduce(
          (sum, r) => sum.plus(D(r.costBasisUsd)),
          new Decimal(0)
        );
        const prevBuyFeeAllocatedDec = buyLot.matchedRecords.reduce(
          (sum, r) => sum.plus(D(r.allocatedBuyFeeUsd)),
          new Decimal(0)
        );

        const buyProportionDec = lotEffectiveCapDec.greaterThan(0)
          ? Decimal.min(1, matchedQtyDec.dividedBy(lotEffectiveCapDec))
          : new Decimal(1);
        const sellProportionDec = qtyDec.greaterThan(0)
          ? Decimal.min(1, matchedQtyDec.dividedBy(qtyDec))
          : new Decimal(1);

        // For BASE_ASSET fees, quoteQty (e.g. $259.35489 for 1,695.13 IO) already includes the coins taken as fee.
        // So pure deliverable coin cost is (quoteQty - feeUsd) and allocatedBuyFee is feeUsd, summing to quoteQty!
        const totalLotPureCostDec = buyLot.feeMode === 'BASE_ASSET'
          ? Decimal.max(0, lotQuoteDec.minus(lotFeeDec)).toDecimalPlaces(8)
          : lotQuoteDec;

        const costBasisDec = isLotExhausted
          ? Decimal.max(0, totalLotPureCostDec.minus(prevCostAllocatedDec)).toDecimalPlaces(8)
          : totalLotPureCostDec.times(buyProportionDec).toDecimalPlaces(8);

        const allocatedBuyFeeDec = isLotExhausted
          ? Decimal.max(0, lotFeeDec.minus(prevBuyFeeAllocatedDec)).toDecimalPlaces(8)
          : lotFeeDec.times(buyProportionDec).toDecimalPlaces(8);

        const grossProceedsDec = matchedQtyDec.times(sellUnitPriceDec).toDecimalPlaces(8);
        const allocatedSellFeeDec = feeUsdDec.times(sellProportionDec).toDecimalPlaces(8);

        const netRealizedPnlDec = grossProceedsDec
          .minus(costBasisDec)
          .minus(allocatedBuyFeeDec)
          .minus(allocatedSellFeeDec)
          .toDecimalPlaces(8);

        const reconstructedProceedsDec = costBasisDec
          .plus(netRealizedPnlDec)
          .plus(allocatedBuyFeeDec)
          .plus(allocatedSellFeeDec)
          .toDecimalPlaces(8);
        const deltaDec = grossProceedsDec.minus(reconstructedProceedsDec).abs().toDecimalPlaces(8);
        if (deltaDec.greaterThan(maxDiscrepancyDec)) {
          maxDiscrepancyDec = deltaDec;
        }

        const record: DoubleEntryMatchRecord = {
          matchId: `${buyLot.buyFillId}->${fillId}`,
          symbol: cleanSym,
          buyFillId: buyLot.buyFillId,
          sellFillId: fillId,
          buyOrderId: buyLot.orderId,
          sellOrderId: String(fill.orderId),
          buyTradeId: buyLot.tradeId,
          sellTradeId: tradeIdStr,
          matchedQty: matchedQtyDec.toNumber(),
          buyPrice: lotUnitCostDec.toNumber(),
          sellPrice: sellUnitPriceDec.toNumber(),
          costBasisUsd: costBasisDec.toNumber(),
          grossProceedsUsd: grossProceedsDec.toNumber(),
          allocatedBuyFeeUsd: allocatedBuyFeeDec.toNumber(),
          allocatedSellFeeUsd: allocatedSellFeeDec.toNumber(),
          buyFeeAsset: buyLot.commissionAsset,
          sellFeeAsset: commAsset,
          netPnlUsd: netRealizedPnlDec.toNumber(),
          netRealizedPnlUsd: netRealizedPnlDec.toNumber(),
          buyTimestamp: buyLot.timestamp,
          sellTimestamp: fill.timestamp,
          reconciliationDeltaUsd: deltaDec.toNumber()
        };

        buyLot.matchedRecords.push(record);
        matches.push(record);

        buyLot.remainingQty = isLotExhausted ? 0 : Decimal.max(0, nextLotRemRaw).toDecimalPlaces(8).toNumber();
        sellQtyRemainingDec = Decimal.max(0, sellQtyRemainingDec.minus(matchedQtyDec)).toDecimalPlaces(8);
      }
    }
  }

  // Compute FIFO CostBasisValuationSummary using Decimal
  let remCoinsDec = new Decimal(0);
  let remCostTotalDec = new Decimal(0);
  let unallocBuyFeeDec = new Decimal(0);
  for (const l of buyLots) {
    const r = D(l.remainingQty);
    if (r.greaterThan(1e-8)) {
      remCoinsDec = remCoinsDec.plus(r).toDecimalPlaces(8);
      remCostTotalDec = remCostTotalDec.plus(r.times(D(l.unitCostUsd))).toDecimalPlaces(8);
      const ratio = D(l.initialQty).greaterThan(0) ? r.dividedBy(D(l.initialQty)) : new Decimal(0);
      if (l.feeMode !== 'BASE_ASSET') {
        unallocBuyFeeDec = unallocBuyFeeDec.plus(D(l.feeUsd).times(ratio)).toDecimalPlaces(8);
      }
    }
  }

  let soldCoinsDec = new Decimal(0);
  let closedCostTotalDec = new Decimal(0);
  let grossProceedsTotalDec = new Decimal(0);
  let allocBuyFeeTotalDec = new Decimal(0);
  let allocSellFeeTotalDec = new Decimal(0);
  let netRealizedPnlTotalDec = new Decimal(0);

  for (const m of matches) {
    soldCoinsDec = soldCoinsDec.plus(D(m.matchedQty)).toDecimalPlaces(8);
    closedCostTotalDec = closedCostTotalDec.plus(D(m.costBasisUsd)).toDecimalPlaces(8);
    grossProceedsTotalDec = grossProceedsTotalDec.plus(D(m.grossProceedsUsd)).toDecimalPlaces(8);
    allocBuyFeeTotalDec = allocBuyFeeTotalDec.plus(D(m.allocatedBuyFeeUsd)).toDecimalPlaces(8);
    allocSellFeeTotalDec = allocSellFeeTotalDec.plus(D(m.allocatedSellFeeUsd)).toDecimalPlaces(8);
    netRealizedPnlTotalDec = netRealizedPnlTotalDec.plus(D(m.netRealizedPnlUsd)).toDecimalPlaces(8);
  }

  let totalBuyCostDec = new Decimal(0);
  for (const l of buyLots) {
    totalBuyCostDec = totalBuyCostDec.plus(D(l.quoteQty)).toDecimalPlaces(8);
  }

  const closedUnitCostDec = soldCoinsDec.greaterThan(0)
    ? closedCostTotalDec.dividedBy(soldCoinsDec).toDecimalPlaces(8)
    : (buyLots.length > 0 ? D(buyLots[0].unitCostUsd) : new Decimal(0));

  const remUnitCostDec = remCoinsDec.greaterThan(0)
    ? remCostTotalDec.dividedBy(remCoinsDec).toDecimalPlaces(8)
    : closedUnitCostDec;

  let fifoDynamicBe: number | null = null;
  if (remCoinsDec.greaterThan(1e-8)) {
    const netMult = new Decimal(1).minus(0.001);
    const denom = remCoinsDec.times(netMult);
    if (denom.greaterThan(0)) {
      const reqGross = remCostTotalDec.plus(unallocBuyFeeDec).minus(netRealizedPnlTotalDec);
      fifoDynamicBe = Decimal.max(0, reqGross.dividedBy(denom)).toDecimalPlaces(8).toNumber();
    }
  }

  const totalRealizedFeesDec = allocBuyFeeTotalDec.plus(allocSellFeeTotalDec).toDecimalPlaces(8);

  const fifoSummary: CostBasisValuationSummary = {
    method: 'FIFO',
    remainingQty: remCoinsDec.toNumber(),
    soldQty: soldCoinsDec.toNumber(),
    remainingUnitCostBasisUsd: remUnitCostDec.toNumber(),
    remainingCostBasisTotalUsd: remCostTotalDec.toNumber(),
    closedUnitCostBasisUsd: closedUnitCostDec.toNumber(),
    closedCostBasisTotalUsd: closedCostTotalDec.toNumber(),
    grossProceedsUsd: grossProceedsTotalDec.toNumber(),
    allocatedBuyFeeUsd: allocBuyFeeTotalDec.toNumber(),
    allocatedSellFeeUsd: allocSellFeeTotalDec.toNumber(),
    unallocatedRemainingBuyFeeUsd: unallocBuyFeeDec.toNumber(),
    totalRealizedFeesUsd: totalRealizedFeesDec.toNumber(),
    netRealizedPnlExact8Usd: netRealizedPnlTotalDec.toNumber(),
    netRealizedPnl2Usd: dRound2(netRealizedPnlTotalDec),
    dynamicBreakevenPriceUsd: fifoDynamicBe,
    reconciliationDriftUsd: maxDiscrepancyDec.toNumber()
  };

  // Compute parallel WAC (Weighted Average Cost) summary and exits
  const wacInputs = chronologicalFills.map(f => ({
    fillId: f.idempotencyKey || f.fingerprint || generateStrictIdempotencyKey(f),
    orderId: String(f.orderId),
    tradeId: f.tradeId ? String(f.tradeId) : undefined,
    symbol: cleanSym,
    isBuyer: Boolean(f.isBuyer || f.side === 'BUY'),
    price: f.price,
    qty: f.qty,
    quoteQty: f.quoteQty || D(f.price).times(D(f.qty)).toNumber(),
    feeUsd: f.feeUsd || 0,
    commissionAmount: f.commissionAmount ?? f.commission ?? 0,
    commissionAsset: f.commissionAsset,
    isBaseAssetFee: (f.feeCurrencyMode || f.feeMode || classifyFeeCurrencyMode(cleanSym, f.commissionAsset)) === 'BASE_ASSET',
    timestamp: f.timestamp
  }));

  const { summary: wacSummary, wacExits } = computeWacCostBasis(cleanSym, wacInputs);

  return {
    symbol: cleanSym,
    buyLots,
    matches,
    wacExits,
    fifoSummary,
    wacSummary,
    remainingCoins: remCoinsDec.toNumber(),
    soldCoins: soldCoinsDec.toNumber(),
    totalBuyCostUsd: totalBuyCostDec.toNumber(),
    totalProceedsUsd: grossProceedsTotalDec.toNumber(),
    totalFeesUsd: totalRealizedFeesDec.toNumber(),
    netRealizedPnlUsd: netRealizedPnlTotalDec.toNumber(),
    isClosed:
      soldCoinsDec.greaterThan(0) &&
      (remCoinsDec.lessThanOrEqualTo(1e-6) ||
        remCostTotalDec.lessThan(1.0) ||
        remCoinsDec.lessThanOrEqualTo(soldCoinsDec.times(0.02))),
    reconciliationDriftUsd: maxDiscrepancyDec.toNumber(),
    maxDiscrepancyUsd: maxDiscrepancyDec.toNumber()
  };
}

/**
 * Executes deterministic double-entry lot matching (`buy_fill_id ➔ sell_fill_id`) and WAC cost basis calculation.
 * Supports both:
 * - `matchSymbolDoubleEntryLedger(events)` -> returns `DoubleEntryCycleResult[]`
 * - `matchSymbolDoubleEntryLedger(symbol, events)` -> returns `DoubleEntryCycleResult`
 */
export function matchSymbolDoubleEntryLedger(events: ExecutionEvent[]): DoubleEntryCycleResult[];
export function matchSymbolDoubleEntryLedger(symbol: string, chronologicalFills: ExecutionEvent[]): DoubleEntryCycleResult;
export function matchSymbolDoubleEntryLedger(
  symbolOrEvents: string | ExecutionEvent[],
  maybeFills?: ExecutionEvent[]
): DoubleEntryCycleResult | DoubleEntryCycleResult[] {
  if (typeof symbolOrEvents === 'string') {
    return computeSymbolDoubleEntry(symbolOrEvents, maybeFills || []);
  }

  const events = deduplicateExecutionEvents(symbolOrEvents || []);
  const bySymbol = new Map<string, ExecutionEvent[]>();
  for (const ev of events) {
    const sym = (ev.symbol || '').toUpperCase().trim();
    if (!bySymbol.has(sym)) bySymbol.set(sym, []);
    bySymbol.get(sym)!.push(ev);
  }

  const results: DoubleEntryCycleResult[] = [];
  for (const [sym, fills] of bySymbol.entries()) {
    results.push(computeSymbolDoubleEntry(sym, fills));
  }
  return results;
}

/**
 * Deterministically assembles position states from an immutable stream of execution fill events
 * using the arbitrary-precision Double-Entry Ledger (`FIFO` & `WAC`).
 */
export function assemblePositionsFromEvents(events: ExecutionEvent[]): RebuiltPosition[] {
  const sorted = deduplicateExecutionEvents(events);
  const symbolMap = new Map<string, ExecutionEvent[]>();

  for (const ev of sorted) {
    const sym = ev.symbol.toUpperCase().trim();
    if (!symbolMap.has(sym)) {
      symbolMap.set(sym, []);
    }
    symbolMap.get(sym)!.push(ev);
  }

  const rebuiltPositions: RebuiltPosition[] = [];

  for (const [symbol, fills] of symbolMap.entries()) {
    const cycle = computeSymbolDoubleEntry(symbol, fills);
    const { buyLots, matches, wacExits, fifoSummary, wacSummary, maxDiscrepancyUsd } = cycle;
    if (buyLots.length === 0) continue;

    const openBuyLots = buyLots.filter(l => D(l.remainingQty).greaterThan(1e-5));
    const remainingCoinsDec = openBuyLots.reduce((sum, l) => sum.plus(D(l.remainingQty)), new Decimal(0)).toDecimalPlaces(8);
    const openCostUsdDec = openBuyLots.reduce((sum, l) => sum.plus(D(l.remainingQty).times(D(l.unitCostUsd))), new Decimal(0)).toDecimalPlaces(8);
    const totalAllBuysFeesDec = buyLots.reduce((sum, l) => sum.plus(D(l.feeUsd)), new Decimal(0)).toDecimalPlaces(8);
    const totalAllSellsFeesDec = fills
      .filter(f => !f.isBuyer && f.side !== 'BUY')
      .reduce((sum, f) => sum.plus(D(f.feeUsd || 0)), new Decimal(0))
      .toDecimalPlaces(8);
    const totalAllFeesDec = totalAllBuysFeesDec.plus(totalAllSellsFeesDec).toDecimalPlaces(8);

    const totalSoldCoinsDec = matches.reduce((sum, m) => sum.plus(D(m.matchedQty)), new Decimal(0)).toDecimalPlaces(8);
    const totalGrossPnlDec = matches.reduce(
      (sum, m) => sum.plus(D(m.grossProceedsUsd).minus(D(m.costBasisUsd))),
      new Decimal(0)
    ).toDecimalPlaces(8);
    const totalExactRealizedPnlDec = totalGrossPnlDec.minus(totalAllFeesDec).toDecimalPlaces(8);

    const isFullyClosed = remainingCoinsDec.lessThanOrEqualTo(1e-5) && totalSoldCoinsDec.greaterThan(0);

    if (isFullyClosed) {
      const totalBuyCoinsDec = buyLots.reduce((sum, l) => sum.plus(D(l.initialQty)), new Decimal(0)).toDecimalPlaces(8);
      const totalBuyCostDec = buyLots.reduce((sum, l) => sum.plus(D(l.quoteQty)), new Decimal(0)).toDecimalPlaces(8);
      const avgEntryDec = totalBuyCoinsDec.greaterThan(0) ? totalBuyCostDec.dividedBy(totalBuyCoinsDec).toDecimalPlaces(8) : new Decimal(0);
      const buyerFills = fills.filter(f => f.isBuyer);

      rebuiltPositions.push({
        symbol,
        isLong: true,
        positionSizeCoins: 0,
        entryPrice: avgEntryDec.toNumber(),
        wacEntryPrice: wacSummary.closedUnitCostBasisUsd || avgEntryDec.toNumber(),
        totalBuyUsd: totalBuyCostDec.toNumber(),
        totalFeeUsd: totalAllFeesDec.toNumber(),
        soldCoins: totalSoldCoinsDec.toNumber(),
        realizedProfitUsd: dRound2(totalExactRealizedPnlDec),
        realizedProfitExact8Usd: totalExactRealizedPnlDec.toNumber(),
        wacRealizedProfitUsd: wacSummary.netRealizedPnl2Usd,
        wacRealizedProfitExact8Usd: wacSummary.netRealizedPnlExact8Usd,
        status: 'CLOSED_MANUAL',
        fills: buyerFills,
        ledgerMatches: matches,
        wacExits,
        fifoSummary,
        wacSummary,
        openBuyLots: [],
        reconciledToSubCent: maxDiscrepancyUsd <= 1e-8,
        maxDiscrepancyUsd,
        idempotencyKey: buyerFills[0]?.idempotencyKey
      });
    } else {
      // Find the start timestamp of the current continuous open position cycle (last time running inventory started from ~0)
      let runningInv = new Decimal(0);
      let currentCycleStartTime = buyLots.length > 0 ? buyLots[0].timestamp : 0;
      for (const f of fills) {
        if (f.isBuyer || f.side === 'BUY') {
          if (runningInv.lessThanOrEqualTo(1e-5)) {
            currentCycleStartTime = f.timestamp;
          }
          runningInv = runningInv.plus(D(f.qty));
        } else {
          runningInv = Decimal.max(0, runningInv.minus(D(f.qty)));
        }
      }

      const currentCycleMatches = matches.filter(m => m.buyTimestamp >= currentCycleStartTime);
      const currentCycleSoldCoinsDec = currentCycleMatches.reduce((sum, m) => sum.plus(D(m.matchedQty)), new Decimal(0)).toDecimalPlaces(8);
      const currentCycleGrossPnlDec = currentCycleMatches.reduce(
        (sum, m) => sum.plus(D(m.grossProceedsUsd).minus(D(m.costBasisUsd))),
        new Decimal(0)
      ).toDecimalPlaces(8);
      const activeFills = fills.filter(f => f.isBuyer && f.timestamp >= currentCycleStartTime);
      const activeSells = fills.filter(f => !f.isBuyer && f.timestamp >= currentCycleStartTime);
      const activeTotalFeesDec = activeFills.reduce((s, f) => s.plus(D(f.feeUsd || 0)), new Decimal(0))
        .plus(activeSells.reduce((s, f) => s.plus(D(f.feeUsd || 0)), new Decimal(0)))
        .toDecimalPlaces(8);
      const currentCycleRealizedPnlDec = currentCycleGrossPnlDec.minus(activeTotalFeesDec).toDecimalPlaces(8);

      const avgEntryDec = remainingCoinsDec.greaterThan(0) && openCostUsdDec.greaterThan(0)
        ? openCostUsdDec.dividedBy(remainingCoinsDec).toDecimalPlaces(8)
        : (openBuyLots.length > 0 ? D(openBuyLots[0].price) : new Decimal(0));

      rebuiltPositions.push({
        symbol,
        isLong: true,
        positionSizeCoins: remainingCoinsDec.toNumber(),
        entryPrice: avgEntryDec.toNumber(),
        wacEntryPrice: wacSummary.remainingUnitCostBasisUsd || avgEntryDec.toNumber(),
        totalBuyUsd: openCostUsdDec.greaterThan(0)
          ? openCostUsdDec.toNumber()
          : remainingCoinsDec.times(avgEntryDec).toDecimalPlaces(8).toNumber(),
        totalFeeUsd: activeTotalFeesDec.toNumber(),
        soldCoins: currentCycleSoldCoinsDec.toNumber(),
        realizedProfitUsd: dRound2(currentCycleRealizedPnlDec),
        realizedProfitExact8Usd: fifoSummary.netRealizedPnlExact8Usd,
        wacRealizedProfitUsd: wacSummary.netRealizedPnl2Usd,
        wacRealizedProfitExact8Usd: wacSummary.netRealizedPnlExact8Usd,
        status: currentCycleSoldCoinsDec.greaterThan(0) ? 'HIT_TP1' : 'ACTIVE',
        fills: activeFills,
        ledgerMatches: currentCycleMatches,
        wacExits,
        fifoSummary,
        wacSummary,
        openBuyLots,
        reconciledToSubCent: maxDiscrepancyUsd <= 1e-8,
        maxDiscrepancyUsd,
        idempotencyKey: activeFills[0]?.idempotencyKey
      });
    }
  }

  return rebuiltPositions;
}
