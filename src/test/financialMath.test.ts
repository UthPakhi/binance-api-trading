import test from 'node:test';
import assert from 'node:assert';
import {
  D,
  dAdd,
  dSub,
  dMul,
  dDiv,
  dRound8,
  dRound2,
  dFormat8,
  computeWacCostBasis,
  computeUnskewedRMultiple
} from '../lib/financialMath';
import {
  matchSymbolDoubleEntryLedger,
  assemblePositionsFromEvents,
  ExecutionEvent
} from '../lib/executionLedger';
import {
  getTradeCostBasisSummary,
  getTradeEntryPriceByMethod,
  getTradeRealizedPnlByMethod,
  calculateNormalizedRMultiple
} from '../lib/tradeUtils';

test('Decimal.js Arbitrary-Precision Arithmetic eliminates IEEE 754 floating-point drift', () => {
  // Classic IEEE 754 failure: 0.1 + 0.2 = 0.30000000000000004 in native JS Number
  assert.strictEqual(dAdd(0.1, 0.2).toNumber(), 0.3);
  assert.strictEqual(dSub(0.3, 0.1).toNumber(), 0.2);

  // Micro-priced meme token aggregation (PEPE at $0.00000843 * 123,456,789 coins)
  const unitPrice = '0.00000843';
  const qty1 = '41152263';
  const qty2 = '41152263';
  const qty3 = '41152263';

  const totalQty = dAdd(dAdd(qty1, qty2), qty3);
  assert.strictEqual(totalQty.toNumber(), 123456789);

  const cost1 = dMul(unitPrice, qty1);
  const cost2 = dMul(unitPrice, qty2);
  const cost3 = dMul(unitPrice, qty3);
  const sumCost = dAdd(dAdd(cost1, cost2), cost3);
  const directCost = dMul(unitPrice, totalQty);

  assert.strictEqual(dFormat8(sumCost), dFormat8(directCost));
  assert.strictEqual(dRound8(sumCost), 1040.74073127);
});

test('FIFO vs. WAC Cost-Basis Engine: Multi-tier DCA entries with partial TP1 exit and full close convergence', () => {
  // 3 Entry Tiers:
  // Lot 1: 100 coins @ $10.00 = $1,000.00 (Buy fee $1.00)
  // Lot 2: 100 coins @ $12.00 = $1,200.00 (Buy fee $1.20)
  // Lot 3: 100 coins @ $14.00 = $1,400.00 (Buy fee $1.40)
  // Total Pool: 300 coins, Total Cost = $3,600.00, WAC = $12.00/coin, Total Buy Fees = $3.60
  //
  // Partial Exit TP1:
  // Sell 150 coins @ $15.00 = $2,250.00 (Sell fee $2.25)
  const partialFills: ExecutionEvent[] = [
    { eventId: 'e1001', symbol: 'SOLUSDT', side: 'BUY', fingerprint: 'fp1001', orderId: '101', tradeId: '1001', isBuyer: true, price: 10, qty: 100, quoteQty: 1000, feeUsd: 1.0, commissionAsset: 'USDT', timestamp: 1000 },
    { eventId: 'e1002', symbol: 'SOLUSDT', side: 'BUY', fingerprint: 'fp1002', orderId: '102', tradeId: '1002', isBuyer: true, price: 12, qty: 100, quoteQty: 1200, feeUsd: 1.2, commissionAsset: 'USDT', timestamp: 2000 },
    { eventId: 'e1003', symbol: 'SOLUSDT', side: 'BUY', fingerprint: 'fp1003', orderId: '103', tradeId: '1003', isBuyer: true, price: 14, qty: 100, quoteQty: 1400, feeUsd: 1.4, commissionAsset: 'USDT', timestamp: 3000 },
    { eventId: 'e2001', symbol: 'SOLUSDT', side: 'SELL', fingerprint: 'fp2001', orderId: '201', tradeId: '2001', isBuyer: false, price: 15, qty: 150, quoteQty: 2250, feeUsd: 2.25, commissionAsset: 'USDT', timestamp: 4000 }
  ];

  const ledgerPartial = matchSymbolDoubleEntryLedger('SOLUSDT', partialFills);

  // Verify FIFO after TP1 (150 coins sold: 100 @ $10 + 50 @ $12 = $1,600 closed cost basis; 150 remaining = 50 @ $12 + 100 @ $14 = $2,000)
  assert.strictEqual(ledgerPartial.fifoSummary.soldQty, 150);
  assert.strictEqual(ledgerPartial.fifoSummary.remainingQty, 150);
  assert.strictEqual(ledgerPartial.fifoSummary.closedCostBasisTotalUsd, 1600);
  assert.strictEqual(ledgerPartial.fifoSummary.remainingCostBasisTotalUsd, 2000);
  assert.strictEqual(ledgerPartial.fifoSummary.closedUnitCostBasisUsd, 10.66666667);
  assert.strictEqual(ledgerPartial.fifoSummary.remainingUnitCostBasisUsd, 13.33333333);
  // Allocated FIFO buy fee: 100% of Lot 1 ($1.00) + 50% of Lot 2 ($0.60) = $1.60
  assert.strictEqual(ledgerPartial.fifoSummary.allocatedBuyFeeUsd, 1.6);
  assert.strictEqual(ledgerPartial.fifoSummary.allocatedSellFeeUsd, 2.25);
  // Net FIFO Realized PnL at TP1: $2,250.00 - $1,600.00 - $1.60 - $2.25 = +$646.15
  assert.strictEqual(ledgerPartial.fifoSummary.netRealizedPnlExact8Usd, 646.15);

  // Verify WAC after TP1 (150 coins sold @ $12.00 WAC = $1,800 closed cost basis; 150 remaining @ $12.00 WAC = $1,800)
  assert.strictEqual(ledgerPartial.wacSummary.soldQty, 150);
  assert.strictEqual(ledgerPartial.wacSummary.remainingQty, 150);
  assert.strictEqual(ledgerPartial.wacSummary.closedUnitCostBasisUsd, 12);
  assert.strictEqual(ledgerPartial.wacSummary.remainingUnitCostBasisUsd, 12);
  assert.strictEqual(ledgerPartial.wacSummary.closedCostBasisTotalUsd, 1800);
  assert.strictEqual(ledgerPartial.wacSummary.remainingCostBasisTotalUsd, 1800);
  // Allocated WAC buy fee: 50% of pool buy fees ($3.60 * 0.5 = $1.80)
  assert.strictEqual(ledgerPartial.wacSummary.allocatedBuyFeeUsd, 1.8);
  assert.strictEqual(ledgerPartial.wacSummary.allocatedSellFeeUsd, 2.25);
  // Net WAC Realized PnL at TP1: $2,250.00 - $1,800.00 - $1.80 - $2.25 = +$445.95
  assert.strictEqual(ledgerPartial.wacSummary.netRealizedPnlExact8Usd, 445.95);

  // Now add TP2 selling the remaining 150 coins @ $18.00 = $2,700.00 (Sell fee $2.70)
  const fullFills: ExecutionEvent[] = [
    ...partialFills,
    { eventId: 'e2002', symbol: 'SOLUSDT', side: 'SELL', fingerprint: 'fp2002', orderId: '202', tradeId: '2002', isBuyer: false, price: 18, qty: 150, quoteQty: 2700, feeUsd: 2.7, commissionAsset: 'USDT', timestamp: 5000 }
  ];
  const ledgerFull = matchSymbolDoubleEntryLedger('SOLUSDT', fullFills);

  // Once 100% of the position is exited, FIFO and WAC cumulative realized PnL must converge to the exact same 8-decimal penny!
  // Total Proceeds = $2,250 + $2,700 = $4,950.00
  // Total Cost = $3,600.00
  // Total Fees = $3.60 (buy) + $4.95 (sell) = $8.55
  // Total Net Realized PnL = $4,950.00 - $3,600.00 - $8.55 = $1,341.45
  assert.strictEqual(ledgerFull.fifoSummary.netRealizedPnlExact8Usd, 1341.45);
  assert.strictEqual(ledgerFull.wacSummary.netRealizedPnlExact8Usd, 1341.45);
  assert.strictEqual(ledgerFull.fifoSummary.reconciliationDriftUsd, 0);
  assert.strictEqual(ledgerFull.wacSummary.reconciliationDriftUsd, 0);
});

test('assemblePositionsFromEvents and tradeUtils selectors honor FIFO and WAC cost basis methods', () => {
  const events: ExecutionEvent[] = [
    {
      eventId: 'ev1',
      orderId: '1',
      tradeId: '11',
      symbol: 'ETHUSDT',
      side: 'BUY',
      price: 2000,
      qty: 1,
      quoteQty: 2000,
      feeUsd: 2,
      timestamp: 1000,
      isBuyer: true,
      fingerprint: 'fp1'
    },
    {
      eventId: 'ev2',
      orderId: '2',
      tradeId: '12',
      symbol: 'ETHUSDT',
      side: 'BUY',
      price: 2400,
      qty: 1,
      quoteQty: 2400,
      feeUsd: 2.4,
      timestamp: 2000,
      isBuyer: true,
      fingerprint: 'fp2'
    },
    {
      eventId: 'ev3',
      orderId: '3',
      tradeId: '13',
      symbol: 'ETHUSDT',
      side: 'SELL',
      price: 2600,
      qty: 1,
      quoteQty: 2600,
      feeUsd: 2.6,
      timestamp: 3000,
      isBuyer: false,
      fingerprint: 'fp3'
    }
  ];

  const rebuilt = assemblePositionsFromEvents(events);
  assert.strictEqual(rebuilt.length, 1);
  const pos = rebuilt[0];

  // Remaining 1 ETH:
  // Under FIFO, Lot 1 ($2000) was sold, so Lot 2 ($2400) remains!
  assert.strictEqual(pos.entryPrice, 2400);
  // Under WAC, Pool average of $2000 and $2400 is $2200!
  assert.strictEqual(pos.wacEntryPrice, 2200);

  // Realized PnL on the 1 ETH sold @ $2600:
  // FIFO: $2600 - $2000 - $2.00 - $2.60 = +$595.40
  assert.strictEqual(pos.realizedProfitExact8Usd, 595.4);
  // WAC: $2600 - $2200 - $2.20 - $2.60 = +$395.20
  assert.strictEqual(pos.wacRealizedProfitExact8Usd, 395.2);

  // Verify tradeUtils selectors
  const tradeObj: any = {
    symbol: 'ETHUSDT',
    status: 'HIT_TP1',
    entryPrice: pos.entryPrice,
    positionSizeCoins: 1,
    soldCoins: 1,
    totalBuyUsd: 4400,
    realizedProfitUsd: pos.realizedProfitUsd,
    stopLoss: 1800,
    fifoSummary: pos.fifoSummary,
    wacSummary: pos.wacSummary,
    ledgerMatches: pos.ledgerMatches,
    wacExits: pos.wacExits
  };

  assert.strictEqual(getTradeEntryPriceByMethod(tradeObj, 'FIFO'), 2400);
  assert.strictEqual(getTradeEntryPriceByMethod(tradeObj, 'WAC'), 2200);
  assert.strictEqual(getTradeRealizedPnlByMethod(tradeObj, 'FIFO', true), 595.4);
  assert.strictEqual(getTradeRealizedPnlByMethod(tradeObj, 'WAC', true), 395.2);

  // Verify unskewed R-multiple under both FIFO and WAC
  const rFifo = computeUnskewedRMultiple({
    pnlUsd: getTradeRealizedPnlByMethod(tradeObj, 'FIFO', true),
    unitCostBasisPrice: getTradeCostBasisSummary(tradeObj, 'FIFO').closedUnitCostBasisUsd,
    stopLossPrice: 1800,
    evaluatedCoins: 1,
    totalInitialCoins: 1,
    isLong: true
  });
  // Sold lot cost $2000, SL $1800 => 1R risk = $200. Net PnL $595.40 / $200 = +2.98R (+2.9770R)
  assert.strictEqual(rFifo.rMultiple, 2.98);
  assert.strictEqual(rFifo.rMultipleExact4, 2.977);
});
