import test from 'node:test';
import assert from 'node:assert';
import { runTradeIngestionPipeline } from '../lib/tradeIngestionPipeline';
import { ExecutionEvent } from '../lib/executionLedger';

test('Test Suite 3: Robust Trade Ingestion & Sync Pipeline', async (t) => {
  await t.test('TC-3.1: Pipeline successfully ingests valid fills and suppresses ancient closed orphans', () => {
    const events: ExecutionEvent[] = [
      {
        eventId: 'ev1',
        orderId: '5001',
        symbol: 'FETUSDT',
        side: 'BUY',
        price: 0.25,
        qty: 100,
        quoteQty: 25,
        feeUsd: 0.05,
        timestamp: Date.now(),
        isBuyer: true,
        fingerprint: 'FET_1'
      },
      {
        eventId: 'ev2',
        orderId: '5002',
        symbol: 'FETUSDT',
        side: 'SELL',
        price: 0.30,
        qty: 100,
        quoteQty: 30,
        feeUsd: 0.05,
        timestamp: Date.now() + 1000,
        isBuyer: false,
        fingerprint: 'FET_2'
      }
    ];

    const { result, processedTrades } = runTradeIngestionPipeline(events);
    assert.strictEqual(result.status, 'success');
    assert.strictEqual(processedTrades.length, 0, 'Ancient fully closed trade with zero position should be ignored as orphan');
  });

  await t.test('TC-3.2: Pipeline correctly retains active open positions', () => {
    const events: ExecutionEvent[] = [
      {
        eventId: 'ev3',
        orderId: '6001',
        symbol: 'ADAUSDT',
        side: 'BUY',
        price: 0.80,
        qty: 500,
        quoteQty: 400,
        feeUsd: 0.40,
        timestamp: Date.now(),
        isBuyer: true,
        fingerprint: 'ADA_1'
      }
    ];

    const { result, processedTrades } = runTradeIngestionPipeline(events);
    assert.strictEqual(result.status, 'success');
    assert.strictEqual(processedTrades.length, 1);
    assert.strictEqual(processedTrades[0].symbol, 'ADAUSDT');
    assert.strictEqual(processedTrades[0].status, 'ACTIVE');
  });

  await t.test('TC-3.3: Ingestion pipeline preserves historical fill timestamp instead of overwriting with Date.now()', () => {
    const historicalFillTime = 1710000000000; // Fixed historical timestamp
    const events: ExecutionEvent[] = [
      {
        eventId: 'ev4',
        orderId: '7001',
        symbol: 'SOLUSDT',
        side: 'BUY',
        price: 130.0,
        qty: 10,
        quoteQty: 1300,
        feeUsd: 1.3,
        timestamp: historicalFillTime,
        isBuyer: true,
        fingerprint: 'SOL_HIST_1'
      }
    ];

    const { result, processedTrades } = runTradeIngestionPipeline(events);
    assert.strictEqual(result.status, 'success');
    assert.strictEqual(processedTrades.length, 1);
    assert.strictEqual(processedTrades[0].createdAt, historicalFillTime, 'Must preserve original fill event timestamp as createdAt');
    assert.strictEqual(processedTrades[0].filledAt, historicalFillTime, 'Must preserve original fill event timestamp as filledAt');
  });
});
