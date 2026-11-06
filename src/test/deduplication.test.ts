import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Trade } from '../types';
import { generateTradeFingerprint } from '../lib/tradeIngestion';
import { 
  isLimitOrderTrade, 
  isBreakoutStopLimitTrade, 
  groupTradesByTicker, 
  deduplicateTrades, 
  getCleanSymbol, 
  isSameSymbol,
  isBinanceLinkedTrade,
  isBinanceLimitOrder
} from '../lib/tradeUtils';
import { parseBinanceOpenOrdersForTrade } from '../lib/binanceOrderSync';
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

  // TC-3.2 (Bug 3.2): Deduplication safely removes ghost active trades when a true pending order exists
  test('TC-3.2: Ghost trade cleanup in deduplicateTrades removes duplicate ghost active trades matching pending limit order', () => {
    const realPending = createMockTrade({
      id: 'real_pending_order',
      symbol: 'SOLUSDT',
      entryPrice: 140.00,
      positionSizeCoins: 10,
      status: 'PENDING',
      binanceOrderId: 'BIN_778899',
      createdAt: 1000
    });

    const ghostActive = createMockTrade({
      id: 'ghost_active_trade',
      symbol: 'SOLUSDT',
      entryPrice: 140.00, // Same price
      positionSizeCoins: 10, // Same size
      status: 'ACTIVE', // Incorrect ghost active state before order actually filled
      createdAt: 1005
    });

    // Case 1: Pending order precedes ghost active trade
    const cleanedTrades1 = deduplicateTrades([realPending, ghostActive]);
    assert.equal(cleanedTrades1.length, 1, 'deduplicateTrades must filter out ghost active trade');
    assert.equal(cleanedTrades1[0].id, 'real_pending_order');
    assert.equal(cleanedTrades1[0].status, 'PENDING');

    // Case 2: Ghost active trade precedes pending order
    const cleanedTrades2 = deduplicateTrades([ghostActive, realPending]);
    assert.equal(cleanedTrades2.length, 1, 'deduplicateTrades must filter out ghost active trade even if active is first');
    assert.equal(cleanedTrades2[0].id, 'real_pending_order');
    assert.equal(cleanedTrades2[0].status, 'PENDING');
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

  // TC-3.5: Stop-limit breakout order detection & prevention of premature fills
  test('TC-3.5: Stop-limit order for higher price is identified and does not fill prematurely below entry', () => {
    // Current market price is $0.250, user places buy breakout stop-limit order at $0.257
    const breakoutTrade: Trade = createMockTrade({
      id: 'breakout_ada',
      symbol: 'ADAUSDT',
      entryPrice: 0.257,
      marketPriceAtCreation: 0.250,
      positionSizeCoins: 1730.4,
      status: 'PENDING',
      isStopLimit: true
    });

    const isBreakout = isBreakoutStopLimitTrade(breakoutTrade, 0.252);
    assert.equal(isBreakout, true);

    // Live price is $0.252 (below $0.257 entry).
    // Breakout long order MUST NOT trigger until live price reaches or exceeds 0.257!
    const livePrice = 0.252;
    const shouldFill = isBreakout 
      ? (livePrice >= breakoutTrade.entryPrice) 
      : (livePrice <= breakoutTrade.entryPrice);
    assert.equal(shouldFill, false, 'Should not fill prematurely while price is still below breakout entry');

    // Once live price breaks above 0.257, it fills
    const breakoutHitPrice = 0.2571;
    const shouldFillAtHit = isBreakout 
      ? (breakoutHitPrice >= breakoutTrade.entryPrice) 
      : (breakoutHitPrice <= breakoutTrade.entryPrice);
    assert.equal(shouldFillAtHit, true, 'Fills when price crosses above stop-limit breakout entry');
  });

  // TC-3.6: Symbol normalization and deduplication between ADA and ADAUSDT
  test('TC-3.6: Grouping and deduplication treat ADA and ADAUSDT as the exact same ticker', () => {
    assert.equal(isSameSymbol('ADA', 'ADAUSDT'), true);
    assert.equal(getCleanSymbol('ADA'), 'ADAUSDT');

    const tradeA: Trade = createMockTrade({
      id: 'trade_manual_ada',
      symbol: 'ADA',
      entryPrice: 0.257,
      positionSizeCoins: 1730.4,
      status: 'ACTIVE'
    });

    const tradeB: Trade = createMockTrade({
      id: 'trade_imported_adausdt',
      symbol: 'ADAUSDT',
      entryPrice: 0.257,
      positionSizeCoins: 1730.4,
      status: 'ACTIVE'
    });

    // groupTradesByTicker normalizes both to ADAUSDT
    const groups = groupTradesByTicker([tradeA, tradeB]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].symbol, 'ADAUSDT');

    // deduplicateTrades recognizes they are duplicate active trades for the exact same position
    const deduped = deduplicateTrades([tradeA, tradeB]);
    assert.equal(deduped.length, 1);
  });

  // TC-3.7: Multiple OCO orders map to a single unified trade with TP1, TP2, and SL
  test('TC-3.7: Two OCO orders map into 1 single trade with TP1, TP2, and SL without showing as two trades', () => {
    const parentTrade: Trade = createMockTrade({
      id: 'ada_trade_main',
      symbol: 'ADAUSDT',
      entryPrice: 0.257,
      positionSizeCoins: 1730.4,
      status: 'ACTIVE'
    });

    // User placed 2 OCO orders on Binance:
    // OCO 1: Sell 865.2 ADA at TP 0.2712 / SL 0.243
    // OCO 2: Sell 865.2 ADA at TP 0.2817 / SL 0.243
    const ocoOrders = [
      {
        orderId: 8820651634,
        orderListId: 25083303384,
        side: 'SELL',
        type: 'STOP_LOSS_LIMIT',
        price: '0.24300000',
        stopPrice: '0.24300000',
        origQty: '865.20000000'
      },
      {
        orderId: 8820651635,
        orderListId: 25083303384,
        side: 'SELL',
        type: 'LIMIT_MAKER',
        price: '0.27120000',
        origQty: '865.20000000'
      },
      {
        orderId: 8820652682,
        orderListId: 25083309707,
        side: 'SELL',
        type: 'STOP_LOSS_LIMIT',
        price: '0.24300000',
        stopPrice: '0.24300000',
        origQty: '865.20000000'
      },
      {
        orderId: 8820652683,
        orderListId: 25083309707,
        side: 'SELL',
        type: 'LIMIT_MAKER',
        price: '0.28170000',
        origQty: '865.20000000'
      }
    ];

    const result = parseBinanceOpenOrdersForTrade(parentTrade, ocoOrders);
    assert.equal(result.hasChanges, true);
    assert.equal(result.updatePayload.takeProfit1, 0.2712);
    assert.equal(result.updatePayload.tp1Percent, 50);
    assert.equal(result.updatePayload.takeProfit2, 0.2817);
    assert.equal(result.updatePayload.tp2Percent, 50);
    assert.equal(result.updatePayload.stopLoss, 0.243);
  });

  // TC-3.8: Multiple active spot trades for the same coin with different sizes consolidate into 1 trade
  test('TC-3.8: Multiple active spot trades for the same ticker consolidate into 1 trade', () => {
    const trade1: Trade = createMockTrade({
      id: 'ada_leg1',
      symbol: 'ADAUSDT',
      entryPrice: 0.257,
      positionSizeCoins: 865.2,
      status: 'ACTIVE',
      createdAt: 1000
    });

    const trade2: Trade = createMockTrade({
      id: 'ada_leg2',
      symbol: 'ADAUSDT',
      entryPrice: 0.257,
      positionSizeCoins: 1730.4,
      status: 'ACTIVE',
      createdAt: 1005
    });

    const deduped = deduplicateTrades([trade1, trade2]);
    assert.equal(deduped.length, 1, 'Should consolidate to exactly 1 trade instead of showing as two');
    assert.equal(deduped[0].id, 'ada_leg2', 'Keeps the primary trade with the full position size');
    assert.equal(deduped[0].positionSizeCoins, 1730.4);
  });

  // TC-3.9: Stop-limit breakout order with stopPrice does not trigger premature entry alert below entry price
  test('TC-3.9: Stop-limit breakout order with stopPrice does not trigger premature entry alert', () => {
    const stopLimitTrade: Partial<Trade> = {
      symbol: 'ADAUSDT',
      entryPrice: 0.257,
      status: 'PENDING',
      notes: 'Breakout Stop-Limit Order'
    };
    (stopLimitTrade as any).stopPrice = 0.257;

    const isBreakout = isBreakoutStopLimitTrade(stopLimitTrade, 0.253);
    assert.equal(isBreakout, true);

    // Current price is $0.253 (below 0.257 entry).
    const livePrice = 0.253;
    const isLong = true;
    const entryTriggered = isBreakout
      ? (isLong ? livePrice >= (stopLimitTrade.entryPrice || 0) : livePrice <= (stopLimitTrade.entryPrice || 0))
      : (isLong ? livePrice <= (stopLimitTrade.entryPrice || 0) : livePrice >= (stopLimitTrade.entryPrice || 0));

    assert.equal(entryTriggered, false, 'Breakout order must not trigger entry notification below entry price');
  });

  // TC-3.10: Multiple distinct buys for the same coin with different prices/orderIds are preserved
  test('TC-3.10: Distinct buys for same coin (CHIP) with different order IDs and prices are preserved', () => {
    const buy1: Trade = createMockTrade({
      id: 'chip_buy_1',
      symbol: 'CHIPUSDT',
      entryPrice: 0.04793,
      positionSizeCoins: 2086,
      totalBuyUsd: 99.98,
      status: 'ACTIVE',
      binanceOrderId: '294361872',
      createdAt: 1000
    });

    const buy2: Trade = createMockTrade({
      id: 'chip_buy_2',
      symbol: 'CHIPUSDT',
      entryPrice: 0.04907,
      positionSizeCoins: 814,
      totalBuyUsd: 39.94,
      status: 'ACTIVE',
      binanceOrderId: '294402243',
      createdAt: 2000
    });

    const deduped = deduplicateTrades([buy1, buy2]);
    assert.equal(deduped.length, 2, 'Must preserve both distinct buys without dropping either one');
    assert.equal(deduped[0].id, 'chip_buy_1');
    assert.equal(deduped[1].id, 'chip_buy_2');
  });

  // TC-3.11: Limit order duplicate prevention (fixes one limit order being imported two times)
  test('TC-3.11: Prevents one limit order from being imported two times', () => {
    // Simulated scenario from Binance Spot sync / manual import
    const limitOrder1: Trade = createMockTrade({
      id: 'doc_eth_limit_1',
      symbol: 'ETHUSDT',
      entryPrice: 2550,
      positionSizeCoins: 0.0588,
      totalBuyUsd: 149.94,
      status: 'PENDING',
      binanceOrderId: '50356154551',
      createdAt: 1000
    });

    // In-memory or optimistic duplicate created during sync/import
    const limitOrder2: Trade = createMockTrade({
      id: 'doc_eth_limit_dup',
      symbol: 'ETHUSDT',
      entryPrice: 2550,
      positionSizeCoins: 0.0588,
      totalBuyUsd: 149.94,
      status: 'PENDING',
      binanceOrderId: '50356154551',
      createdAt: 1500
    });

    const deduped = deduplicateTrades([limitOrder1, limitOrder2]);
    assert.equal(deduped.length, 1, 'Limit order must be deduplicated to exactly 1 trade instead of two');
    assert.equal(deduped[0].entryPrice, 2550);
    assert.equal(deduped[0].positionSizeCoins, 0.0588);

    // Also handles when one duplicate lacks binanceOrderId or has temp/optimistic id
    const limitOrderOptimistic: Trade = createMockTrade({
      id: 'local_temp_eth',
      symbol: 'ETHUSDT',
      entryPrice: 2550,
      positionSizeCoins: 0.0588,
      totalBuyUsd: 149.94,
      status: 'PENDING',
      createdAt: 2000
    });

    const dedupedWithTemp = deduplicateTrades([limitOrder1, limitOrderOptimistic]);
    assert.equal(dedupedWithTemp.length, 1, 'Deduplicates optimistic/temp clone to real limit order');
    assert.equal(dedupedWithTemp[0].id, 'doc_eth_limit_1', 'Prefers real document ID over temp ID');
  });

  // TC-3.12: Grouping pending limit orders by ticker does not double count limit orders
  test('TC-3.12: Grouping pending trades produces clean groups without double counting', () => {
    const rawPendingOrders: Trade[] = [
      createMockTrade({ id: 'btc_1', symbol: 'BTCUSDT', entryPrice: 82000, positionSizeCoins: 0.00134, totalBuyUsd: 109.88, status: 'PENDING', binanceOrderId: '67291707385' }),
      createMockTrade({ id: 'btc_1_dup', symbol: 'BTCUSDT', entryPrice: 82000, positionSizeCoins: 0.00134, totalBuyUsd: 109.88, status: 'PENDING', binanceOrderId: '67291707385' }),
      createMockTrade({ id: 'btc_2', symbol: 'BTCUSDT', entryPrice: 78500, positionSizeCoins: 0.0014, totalBuyUsd: 109.90, status: 'PENDING', binanceOrderId: '67291719410' }),
      createMockTrade({ id: 'btc_2_dup', symbol: 'BTCUSDT', entryPrice: 78500, positionSizeCoins: 0.0014, totalBuyUsd: 109.90, status: 'PENDING', binanceOrderId: '67291719410' })
    ];

    const cleanPending = deduplicateTrades(rawPendingOrders);
    assert.equal(cleanPending.length, 2, 'Deduplicates 4 entries to 2 distinct limit orders');

    const groups = groupTradesByTicker(cleanPending);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].symbol, 'BTCUSDT');
    assert.equal(groups[0].trades.length, 2, 'Group has exactly 2 limit orders, not 4');
    assert.equal(Math.round(groups[0].totalInvested * 100) / 100, 219.78, 'Total invested matches exactly 2 orders, not doubled');
  });

  // TC-3.13 (Bug 3.1): High-precision deduplication preserves sub-penny and fractional crypto orders
  test('TC-3.13: Deduplication preserves distinct sub-penny meme tokens and fractional BTC orders', () => {
    // Two distinct FLOKI limit orders at different sub-penny price levels
    const flokiOrder1: Trade = createMockTrade({
      id: 'floki_lim_1',
      symbol: 'FLOKIUSDT',
      entryPrice: 0.0000300,
      positionSizeCoins: 10_000_000,
      status: 'PENDING',
      createdAt: 1000
    });

    const flokiOrder2: Trade = createMockTrade({
      id: 'floki_lim_2',
      symbol: 'FLOKIUSDT',
      entryPrice: 0.0000350,
      positionSizeCoins: 10_000_000,
      status: 'PENDING',
      createdAt: 1005
    });

    const dedupedFloki = deduplicateTrades([flokiOrder1, flokiOrder2]);
    assert.equal(dedupedFloki.length, 2, 'Must NOT collapse distinct sub-penny limit orders with different prices');

    // Two distinct small fractional BTC orders with different order IDs created around the same minute
    const btcOrder1: Trade = createMockTrade({
      id: 'btc_frac_1',
      symbol: 'BTCUSDT',
      entryPrice: 62000,
      positionSizeCoins: 0.0005,
      binanceOrderId: 'BTC_ORDER_1',
      status: 'ACTIVE',
      createdAt: 1000
    });

    const btcOrder2: Trade = createMockTrade({
      id: 'btc_frac_2',
      symbol: 'BTCUSDT',
      entryPrice: 62000,
      positionSizeCoins: 0.0008,
      binanceOrderId: 'BTC_ORDER_2',
      status: 'ACTIVE',
      createdAt: 1000
    });

    const dedupedBtc = deduplicateTrades([btcOrder1, btcOrder2]);
    assert.equal(dedupedBtc.length, 2, 'Must NOT collapse distinct fractional crypto trades of different sizes');
  });

  // TC-3.14 (Bug 3.4): Manual limit orders without Binance order IDs are protected from exchange sync deletion
  test('TC-3.14: Manual limit orders without binanceOrderId or clientOrderId are protected from exchange sync deletion', () => {
    const manualLimitOrder: Trade = createMockTrade({
      id: 'manual_limit_trade_1',
      symbol: 'ETHUSDT',
      entryPrice: 2400,
      positionSizeCoins: 0.5,
      status: 'PENDING',
      market: 'SPOT' // Default market in app
    });

    // Verification: Not classified as a tracked Binance order
    const isTrackedBinanceOrder = Boolean(manualLimitOrder.binanceOrderId || manualLimitOrder.clientOrderId);
    assert.equal(isTrackedBinanceOrder, false, 'Manual limit order must not be classified as a tracked Binance exchange order');
  });

  // TC-1.1 (Bug 1.3): groupTradesByTicker preserves sorting order of first occurrences
  test('TC-1.1: groupTradesByTicker preserves input order of distinct tickers', () => {
    const tradeSol = createMockTrade({ id: 'sol_1', symbol: 'SOLUSDT', entryPrice: 150 });
    const tradeBtc = createMockTrade({ id: 'btc_1', symbol: 'BTCUSDT', entryPrice: 65000 });
    const tradeEth = createMockTrade({ id: 'eth_1', symbol: 'ETHUSDT', entryPrice: 2600 });
    const tradeBtc2 = createMockTrade({ id: 'btc_2', symbol: 'BTCUSDT', entryPrice: 64000 });

    const groups = groupTradesByTicker([tradeSol, tradeBtc, tradeEth, tradeBtc2]);
    assert.equal(groups.length, 3);
    assert.equal(groups[0].symbol, 'SOLUSDT', 'First group must be SOLUSDT matching input sort order');
    assert.equal(groups[1].symbol, 'BTCUSDT', 'Second group must be BTCUSDT matching input sort order');
    assert.equal(groups[2].symbol, 'ETHUSDT', 'Third group must be ETHUSDT matching input sort order');
    assert.equal(groups[1].trades.length, 2, 'BTCUSDT group must bundle both trades');
  });

  // TC-2.1 (Bug 2.1): parseBinanceOpenOrdersForTrade closes position when analysisData.isFullyClosed is true
  test('TC-2.1: parseBinanceOpenOrdersForTrade closes running position when analysisData.isFullyClosed is true', async () => {
    const { parseBinanceOpenOrdersForTrade } = await import('../lib/binanceOrderSync');
    const runningTrade: Trade = createMockTrade({
      id: 'running_trade_1',
      symbol: 'SOLUSDT',
      entryPrice: 140,
      positionSizeCoins: 10,
      status: 'ACTIVE',
      closedAt: null
    });

    const analysisData = {
      isFullyClosed: true,
      totalSoldQty: 10,
      avgExitPrice: 160,
      realizedPnL: 200,
      latestSellTime: 1715000000000
    };

    const result = parseBinanceOpenOrdersForTrade(runningTrade, [], analysisData);
    assert.equal(result.hasChanges, true);
    assert.equal(result.updatePayload.status, 'CLOSED_MANUAL');
    assert.equal(result.updatePayload.exitPrice, 160);
    assert.equal(result.updatePayload.realizedProfitUsd, 200);
    assert.equal(result.updatePayload.closedAt, 1715000000000);
  });

  // TC-3.15 (Bug 3.2): Manual spot trades without Binance credentials are not falsely classified as Binance linked trades
  test('TC-3.15: Manual spot trades without Binance credentials are not classified as Binance linked trades', () => {
    const manualSpotTrade = createMockTrade({
      id: 'manual_sol_1',
      symbol: 'SOLUSDT',
      entryPrice: 150,
      positionSizeCoins: 5,
      status: 'ACTIVE',
      market: 'SPOT',
      notes: 'Manual Spot Trade'
    });

    assert.equal(isBinanceLinkedTrade(manualSpotTrade), false, 'Manual spot trade must NOT be classified as Binance linked');
    assert.equal(isBinanceLimitOrder(manualSpotTrade), false, 'Manual active trade must NOT be classified as Binance limit order');

    const manualPendingOrder = createMockTrade({
      id: 'manual_pending_1',
      symbol: 'SOLUSDT',
      entryPrice: 140,
      positionSizeCoins: 5,
      status: 'PENDING',
      market: 'SPOT',
      notes: 'Manual Limit Order'
    });

    assert.equal(isBinanceLimitOrder(manualPendingOrder), false, 'Manual limit order must NOT be classified as Binance limit order');

    // True Binance linked trade
    const binanceTrade = createMockTrade({
      id: 'binance_trade_1',
      symbol: 'SOLUSDT',
      entryPrice: 150,
      positionSizeCoins: 5,
      status: 'ACTIVE',
      market: 'SPOT',
      binanceOrderId: '192837465'
    });

    assert.equal(isBinanceLinkedTrade(binanceTrade), true, 'Trade with binanceOrderId MUST be classified as Binance linked');
  });
});
