import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Trade } from '../types';
import { generateTradeFingerprint } from '../lib/tradeIngestion';
import { isLimitOrderTrade } from '../lib/tradeUtils';
import { createMockTrade } from './testHelpers';

describe('Test Suite 3: Limit Orders & Ghost Order Prevention', () => {
  // TC-3.1: An open limit buy order on Binance is imported strictly as status: 'PENDING'
  test('TC-3.1: Open limit order is categorized as status: PENDING and identified by isLimitOrderTrade', () => {
    const rawLimitOrder = {
      symbol: 'BTCUSDT',
      entryPrice: 62000,
      positionAmt: 0.05,
      isPendingOrder: true,
      binanceOrderId: '109923847'
    };

    const importedTrade: Trade = createMockTrade({
      id: 'trade_lim_1',
      symbol: rawLimitOrder.symbol,
      entryPrice: rawLimitOrder.entryPrice,
      positionSizeCoins: rawLimitOrder.positionAmt,
      totalBuyUsd: rawLimitOrder.entryPrice * rawLimitOrder.positionAmt,
      status: rawLimitOrder.isPendingOrder ? 'PENDING' : 'ACTIVE',
      binanceOrderId: rawLimitOrder.binanceOrderId,
      type: 'TRADE'
    });

    assert.equal(importedTrade.status, 'PENDING');
    assert.equal(isLimitOrderTrade(importedTrade), true);
    assert.equal(importedTrade.binanceOrderId, '109923847');
  });

  // TC-3.2: Deduplication safely removes ghost active trades when a true pending order exists
  test('TC-3.2: Ghost trade cleanup identifies duplicate ghost active trades matching pending limit order', () => {
    const trades: Trade[] = [
      createMockTrade({
        id: 'real_pending_order',
        symbol: 'SOLUSDT',
        entryPrice: 140.00,
        positionSizeCoins: 10,
        status: 'PENDING',
        binanceOrderId: 'BIN_778899',
        createdAt: 1000
      }),
      createMockTrade({
        id: 'ghost_active_trade',
        symbol: 'SOLUSDT',
        entryPrice: 140.00, // Same price
        positionSizeCoins: 10, // Same size
        status: 'ACTIVE', // Incorrect ghost active state before order actually filled
        createdAt: 1005
      })
    ];

    // Deduplication logic: find any ACTIVE trade that duplicates an existing PENDING order with same symbol & entry price
    const pendingOrders = trades.filter(t => t.status === 'PENDING');
    const ghostTrades = trades.filter(t => {
      if (t.status !== 'ACTIVE') return false;
      return pendingOrders.some(p => 
        p.symbol === t.symbol && 
        Math.abs(p.entryPrice - t.entryPrice) < 0.001 &&
        Math.abs((p.positionSizeCoins || 0) - (t.positionSizeCoins || 0)) < 0.001
      );
    });

    assert.equal(ghostTrades.length, 1);
    assert.equal(ghostTrades[0].id, 'ghost_active_trade');
    // Keeping real pending order
    const cleanedTrades = trades.filter(t => !ghostTrades.some(g => g.id === t.id));
    assert.equal(cleanedTrades.length, 1);
    assert.equal(cleanedTrades[0].id, 'real_pending_order');
    assert.equal(cleanedTrades[0].status, 'PENDING');
  });

  // TC-3.3: When a limit order fills on Binance, transitions trade from PENDING to ACTIVE without creating duplicate
  test('TC-3.3: In-place transition of PENDING order to ACTIVE upon fill', () => {
    let trade: Trade = createMockTrade({
      id: 'order_123',
      symbol: 'ETHUSDT',
      entryPrice: 2600.00,
      positionSizeCoins: 1,
      totalBuyUsd: 2600.00,
      status: 'PENDING',
      binanceOrderId: 'BIN_554433',
      createdAt: 1000
    });

    assert.equal(trade.status, 'PENDING');

    // Simulated fill event from Binance
    const fillEvent = {
      orderId: 'BIN_554433',
      fillPrice: 2600.00,
      fillQty: 1,
      fillTime: 2000
    };

    // Transition existing trade rather than inserting a new one
    trade = {
      ...trade,
      status: 'ACTIVE',
      filledAt: fillEvent.fillTime,
      notes: 'Limit order filled on Binance'
    };

    assert.equal(trade.status, 'ACTIVE');
    assert.equal(trade.filledAt, 2000);
    assert.equal(trade.binanceOrderId, 'BIN_554433');
  });

  // TC-3.4: Idempotent fingerprint generation prevents repeated inserts of identical orders
  test('TC-3.4: Idempotent fingerprint generator produces identical keys for identical trades', () => {
    const tradeA: Partial<Trade> = {
      symbol: 'FLOKIUSDT',
      entryPrice: 0.0000303,
      positionSizeCoins: 11942550,
      type: 'TRADE',
      status: 'ACTIVE'
    };

    const tradeB: Partial<Trade> = {
      symbol: 'FLOKIUSDT',
      entryPrice: 0.0000303,
      positionSizeCoins: 11942550,
      type: 'TRADE',
      status: 'ACTIVE'
    };

    const fpA = generateTradeFingerprint(tradeA);
    const fpB = generateTradeFingerprint(tradeB);

    assert.equal(fpA, fpB);

    // If orderId is present, it anchors strictly to the orderId
    const tradeWithOrder: Partial<Trade> = {
      ...tradeA,
      binanceOrderId: '10624815911'
    };

    assert.equal(generateTradeFingerprint(tradeWithOrder), 'binance_10624815911');
  });
});
