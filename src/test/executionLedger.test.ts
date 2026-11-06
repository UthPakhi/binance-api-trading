import test from 'node:test';
import assert from 'node:assert';
import {
  generateEventFingerprint,
  generateStrictIdempotencyKey,
  deduplicateExecutionEvents,
  assemblePositionsFromEvents,
  matchSymbolDoubleEntryLedger,
  ExecutionEvent
} from '../lib/executionLedger';
import { BinanceStreamManager } from '../lib/binanceStreamManager';

test('Test Suite 2: Immutable Execution Ledger & Deterministic Position State Engine', async (t) => {
  await t.test('TC-2.1: Generates unique collision-resistant fingerprints and strict (orderId, tradeId) idempotency keys', () => {
    const fill1 = { orderId: '1001', tradeId: '5001', symbol: 'BTCUSDT', price: 90000, qty: 0.5, timestamp: 1780000000000, isBuyer: true };
    const fill2 = { orderId: '1001', tradeId: '5001', symbol: 'BTCUSDT', price: 90000, qty: 0.5, timestamp: 1780000000000, isBuyer: true };
    const fill3 = { orderId: '1001', tradeId: '5002', symbol: 'BTCUSDT', price: 90000, qty: 0.5, timestamp: 1780000000000, isBuyer: true };

    const fp1 = generateEventFingerprint(fill1);
    const fp2 = generateEventFingerprint(fill2);
    const fp3 = generateEventFingerprint(fill3);

    assert.strictEqual(fp1, fp2, 'Identical fills with same orderId and tradeId must produce identical fingerprints');
    assert.notStrictEqual(fp1, fp3, 'Split fills of the same orderId with distinct tradeIds must produce distinct idempotency keys');
    assert.strictEqual(generateStrictIdempotencyKey('BTCUSDT', '1001', '5001'), 'BTC_ORD1001_TRD5001');
  });

  await t.test('TC-2.2: Deduplicates execution events stream perfectly using strict idempotency keys', () => {
    const events: ExecutionEvent[] = [
      { eventId: 'e1', orderId: '101', tradeId: '9001', symbol: 'ETHUSDT', side: 'BUY', price: 3000, qty: 1.0, quoteQty: 3000, feeUsd: 1.0, timestamp: 1000, isBuyer: true, fingerprint: 'ETH_ORD101_TRD9001' },
      { eventId: 'e2', orderId: '101', tradeId: '9001', symbol: 'ETHUSDT', side: 'BUY', price: 3000, qty: 1.0, quoteQty: 3000, feeUsd: 1.0, timestamp: 1000, isBuyer: true, fingerprint: 'ETH_ORD101_TRD9001' }, // Duplicate
      { eventId: 'e3', orderId: '101', tradeId: '9002', symbol: 'ETHUSDT', side: 'BUY', price: 3000, qty: 1.0, quoteQty: 3000, feeUsd: 1.0, timestamp: 1000, isBuyer: true, fingerprint: 'ETH_ORD101_TRD9002' }, // Distinct split fill of same order
    ];

    const deduped = deduplicateExecutionEvents(events);
    assert.strictEqual(deduped.length, 2, 'Duplicate fill must be stripped while preserving distinct tradeId split fill');
    assert.strictEqual(deduped[0].tradeId, '9001');
    assert.strictEqual(deduped[1].tradeId, '9002');
  });

  await t.test('TC-2.3: Deterministically assembles positions and calculates FIFO realized PnL with double-entry ledger matches', () => {
    const events: ExecutionEvent[] = [
      { eventId: 'e1', orderId: '201', tradeId: '701', symbol: 'SOLUSDT', side: 'BUY', price: 100, qty: 10, quoteQty: 1000, feeUsd: 0.5, timestamp: 100, isBuyer: true, fingerprint: 'SOL_1' },
      { eventId: 'e2', orderId: '202', tradeId: '702', symbol: 'SOLUSDT', side: 'SELL', price: 120, qty: 5, quoteQty: 600, feeUsd: 0.3, timestamp: 200, isBuyer: false, fingerprint: 'SOL_2' }
    ];

    const positions = assemblePositionsFromEvents(events);
    assert.strictEqual(positions.length, 1, 'Should assemble 1 position');
    const pos = positions[0];
    assert.strictEqual(pos.symbol, 'SOLUSDT');
    assert.strictEqual(pos.positionSizeCoins, 5, 'Remaining position size should be 5 coins');
    assert.strictEqual(pos.soldCoins, 5, 'Sold coins should be 5');
    assert.strictEqual(pos.status, 'HIT_TP1', 'Partial exit status should be HIT_TP1');
    assert.strictEqual(pos.realizedProfitUsd, 99.2, 'Net Realized PnL should be (120 - 100) * 5 - 0.8 fees = 99.2');
    assert.strictEqual(pos.ledgerMatches.length, 1, 'Should produce 1 double-entry match record');
    assert.strictEqual(pos.ledgerMatches[0].buyFillId, 'SOL_ORD201_TRD701');
    assert.strictEqual(pos.ledgerMatches[0].sellFillId, 'SOL_ORD202_TRD702');
  });

  await t.test('TC-2.4: Double-entry ledger (buy_fill_id -> sell_fill_id) reconciles split fills, multiple TPs, and blended BNB/quote fees to $0.00000001', () => {
    const events: ExecutionEvent[] = [
      // Split buy fill #1 (BNB fee discount)
      {
        eventId: 'b1',
        orderId: '5001',
        tradeId: '10001',
        symbol: 'AAVEUSDT',
        side: 'BUY',
        price: 150.12345678,
        qty: 4.5,
        quoteQty: 150.12345678 * 4.5,
        commission: 0.0008,
        commissionAsset: 'BNB',
        feeCurrencyMode: 'BNB',
        feeUsd: 0.48123456,
        timestamp: 1000,
        isBuyer: true,
        fingerprint: 'AAVE_ORD5001_TRD10001'
      },
      // Split buy fill #2 (USDT quote fee)
      {
        eventId: 'b2',
        orderId: '5001',
        tradeId: '10002',
        symbol: 'AAVEUSDT',
        side: 'BUY',
        price: 150.25000000,
        qty: 5.5,
        quoteQty: 150.25000000 * 5.5,
        commission: 0.82637500,
        commissionAsset: 'USDT',
        feeCurrencyMode: 'QUOTE_ASSET',
        feeUsd: 0.82637500,
        timestamp: 1005,
        isBuyer: true,
        fingerprint: 'AAVE_ORD5001_TRD10002'
      },
      // Partial TP1 Sell (6.0 coins spanning across buy fill #1 and #2)
      {
        eventId: 's1',
        orderId: '6001',
        tradeId: '20001',
        symbol: 'AAVEUSDT',
        side: 'SELL',
        price: 162.50000000,
        qty: 6.0,
        quoteQty: 162.50000000 * 6.0,
        commission: 0.73125000,
        commissionAsset: 'USDT',
        feeCurrencyMode: 'QUOTE_ASSET',
        feeUsd: 0.73125000,
        timestamp: 2000,
        isBuyer: false,
        fingerprint: 'AAVE_ORD6001_TRD20001'
      },
      // Final TP2 Sell (remaining 4.0 coins)
      {
        eventId: 's2',
        orderId: '6002',
        tradeId: '20002',
        symbol: 'AAVEUSDT',
        side: 'SELL',
        price: 170.00000000,
        qty: 4.0,
        quoteQty: 170.00000000 * 4.0,
        commission: 0.00085,
        commissionAsset: 'BNB',
        feeCurrencyMode: 'BNB',
        feeUsd: 0.51000000,
        timestamp: 3000,
        isBuyer: false,
        fingerprint: 'AAVE_ORD6002_TRD20002'
      }
    ];

    const cycles = matchSymbolDoubleEntryLedger(events);
    assert.strictEqual(cycles.length, 1, 'Should produce 1 complete trade cycle');
    const cycle = cycles[0];
    assert.strictEqual(cycle.isClosed, true, 'Cycle should be completely closed with zero phantom remainder');
    assert.strictEqual(cycle.remainingCoins, 0, 'Remaining coins must be 0');
    assert.strictEqual(cycle.matches.length, 3, 'Should produce 3 exact double-entry lot matches (4.5 from b1->s1, 1.5 from b2->s1, 4.0 from b2->s2)');
    assert.ok(cycle.reconciliationDriftUsd <= 0.00000001, `Reconciliation drift (${cycle.reconciliationDriftUsd}) must be <= $0.00000001`);
    assert.strictEqual(cycle.matches[0].buyFillId, 'AAVE_ORD5001_TRD10001');
    assert.strictEqual(cycle.matches[0].sellFillId, 'AAVE_ORD6001_TRD20001');
    assert.strictEqual(cycle.matches[1].buyFillId, 'AAVE_ORD5001_TRD10002');
    assert.strictEqual(cycle.matches[1].sellFillId, 'AAVE_ORD6001_TRD20001');
    assert.strictEqual(cycle.matches[2].buyFillId, 'AAVE_ORD5001_TRD10002');
    assert.strictEqual(cycle.matches[2].sellFillId, 'AAVE_ORD6002_TRD20002');
  });

  await t.test('TC-2.5: Stateful WebSocket Stream Manager processes executionReport, balanceUpdate, and outboundAccountPosition in-memory', () => {
    const stream = new BinanceStreamManager({ apiKey: 'test', apiSecret: 'test' });
    const receivedEvents: any[] = [];
    stream.onEvent((ev) => receivedEvents.push(ev));

    // 1. Simulate outboundAccountPosition
    stream.handleStreamEvent({
      e: 'outboundAccountPosition',
      E: 1700000000100,
      u: 1700000000100,
      B: [
        { a: 'USDT', f: '5000.50000000', l: '250.00000000' },
        { a: 'BTC', f: '0.15000000', l: '0.00000000' }
      ]
    });

    assert.strictEqual(stream.getBalances().get('USDT')?.free, 5000.5);
    assert.strictEqual(stream.getBalances().get('USDT')?.locked, 250);

    // 2. Simulate balanceUpdate
    stream.handleStreamEvent({
      e: 'balanceUpdate',
      E: 1700000000200,
      a: 'USDT',
      d: '100.25000000',
      T: 1700000000200
    });
    assert.strictEqual(stream.getBalances().get('USDT')?.free, 5100.75);

    // 3. Simulate NEW limit order executionReport
    stream.handleStreamEvent({
      e: 'executionReport',
      E: 1700000000300,
      s: 'SOLUSDT',
      c: 'client_1',
      S: 'BUY',
      o: 'LIMIT',
      x: 'NEW',
      X: 'NEW',
      i: 88801,
      t: -1,
      q: '10.00000000',
      p: '140.00000000',
      l: '0.00000000',
      z: '0.00000000',
      L: '0.00000000',
      Z: '0.00000000',
      n: '0.00000000',
      N: 'USDT',
      T: 1700000000300
    });
    assert.strictEqual(stream.getOpenOrders('SOLUSDT').length, 1);

    // 4. Simulate TRADE fill executionReport + duplicate replay
    const fillPayload = {
      e: 'executionReport',
      E: 1700000000400,
      s: 'SOLUSDT',
      c: 'client_1',
      S: 'BUY',
      o: 'LIMIT',
      x: 'TRADE',
      X: 'FILLED',
      i: 88801,
      t: 99901,
      q: '10.00000000',
      p: '140.00000000',
      l: '10.00000000',
      z: '10.00000000',
      L: '140.00000000',
      Y: '1400.00000000',
      Z: '1400.00000000',
      n: '1.40000000',
      N: 'USDT',
      T: 1700000000400
    };
    stream.handleStreamEvent(fillPayload);
    // Replay identical fill event - must be ignored by idempotency filter
    stream.handleStreamEvent(fillPayload);

    assert.strictEqual(stream.getOpenOrders('SOLUSDT').length, 0, 'Filled order must be removed from openOrders');
    assert.strictEqual(stream.getLedgerEvents().length, 1, 'Idempotency key must block duplicate fill executionReport');
    assert.strictEqual(stream.getLedgerEvents()[0].idempotencyKey, 'SOL_ORD88801_TRD99901');
  });
});
