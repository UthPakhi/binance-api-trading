import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { 
  calculateUnassignedBalance, 
  groupFillsByOrder, 
  calculateMergedDCA,
  BinancePositionItem,
  TradeFill
} from '../lib/tradeIngestion';
import { Trade } from '../types';
import { 
  calculateLivePnL, calculatePortfolioStats, calculateExecutionFeeInUsd, 
  getTradeConsolidatedFees 
} from '../lib/tradeUtils';
import { createMockTrade } from './testHelpers';

describe('Test Suite 1: Multi-Trade Ingestion for Same Ticker', () => {
  // TC-1.1: When a user holds 10M FLOKI in Trade #1 and buys another 5M FLOKI on Binance,
  // the calculation engine must show 5M FLOKI as unassigned with option to import as New Trade or DCA.
  test('TC-1.1: Correctly calculates unassigned balance when user owns more coins than tracked in Trade #1', () => {
    const binancePosition: BinancePositionItem = {
      symbol: 'FLOKIUSDT',
      positionAmt: 15_000_000,
      entryPrice: 0.0000300,
      currentPrice: 0.0000320,
      usdValue: 480.00,
      feeUsd: 0.48
    };

    const activeTrades: Trade[] = [
      createMockTrade({
        id: 'floki_trade_1',
        symbol: 'FLOKIUSDT',
        entryPrice: 0.0000280,
        positionSizeCoins: 10_000_000,
        totalBuyUsd: 280.00,
        status: 'ACTIVE',
        riskPercent: 1,
        portfolioSize: 2500
      })
    ];

    const analysis = calculateUnassignedBalance(binancePosition, activeTrades);

    assert.equal(analysis.totalBinanceCoins, 15_000_000);
    assert.equal(analysis.trackedCoins, 10_000_000);
    assert.equal(analysis.unassignedCoins, 5_000_000);
    assert.equal(analysis.hasUnassigned, true);
    assert.equal(analysis.canDCA, true);
    assert.equal(analysis.canCreateNewTrade, true);
    assert.equal(analysis.unassignedUsdValue, 5_000_000 * 0.0000320); // $160.00
  });

  // TC-1.2: Selecting "Import as New Trade" allows creating an independent trade record with its own entry price and size.
  test('TC-1.2: Supports independent multi-trade creation and DCA merge calculation', () => {
    const existingTrade: Trade = createMockTrade({
      id: 'floki_trade_1',
      symbol: 'FLOKIUSDT',
      entryPrice: 0.0000200,
      positionSizeCoins: 10_000_000,
      totalBuyUsd: 200.00,
      status: 'ACTIVE',
      feeUsd: 0.20
    });

    // Scenario A: User chooses DCA merge
    const addedCoins = 5_000_000;
    const addedPrice = 0.0000350; // Bought higher
    const merged = calculateMergedDCA(existingTrade, addedCoins, addedPrice, 0.15);

    // Total coins = 15,000,000
    assert.equal(merged.newPositionSizeCoins, 15_000_000);
    // Total cost basis = (10M * 0.00002) + (5M * 0.000035) = 200 + 175 = $375
    assert.equal(merged.newTotalBuyUsd, 375.00);
    // Blended entry price = 375 / 15,000,000 = 0.0000250
    assert.equal(merged.newEntryPrice, 0.0000250);
    assert.equal(merged.newFeeUsd, 0.35);

    // Scenario B: User chooses "Import as New Trade" (Trade #2)
    const trade2: Trade = createMockTrade({
      id: 'floki_trade_2',
      symbol: 'FLOKIUSDT',
      entryPrice: addedPrice,
      positionSizeCoins: addedCoins,
      totalBuyUsd: addedCoins * addedPrice,
      status: 'ACTIVE',
      feeUsd: 0.15
    });

    assert.equal(trade2.entryPrice, 0.0000350);
    assert.equal(trade2.positionSizeCoins, 5_000_000);
    assert.notEqual(trade2.id, existingTrade.id);
  });

  // TC-1.3: The Portfolio and Trade view renders multiple trades for the same ticker side-by-side with separate PnLs.
  test('TC-1.3: Multi-trade PnL isolation: both trades calculate independent PnL at current market price', () => {
    const trade1: Trade = createMockTrade({
      id: 'floki_trade_1',
      symbol: 'FLOKIUSDT',
      entryPrice: 0.0000200,
      positionSizeCoins: 10_000_000,
      totalBuyUsd: 200.00,
      status: 'ACTIVE'
    });

    const trade2: Trade = createMockTrade({
      id: 'floki_trade_2',
      symbol: 'FLOKIUSDT',
      entryPrice: 0.0000350,
      positionSizeCoins: 5_000_000,
      totalBuyUsd: 175.00,
      status: 'ACTIVE'
    });

    const currentMarketPrice = 0.0000300; // Between trade 1 and trade 2

    // Trade 1 entered at 0.0000200, now 0.0000300 -> in profit
    const pnl1 = calculateLivePnL(trade1, currentMarketPrice, false);
    assert.equal(pnl1, 10_000_000 * (0.0000300 - 0.0000200)); // +$100.00

    // Trade 2 entered at 0.0000350, now 0.0000300 -> in loss
    const pnl2 = calculateLivePnL(trade2, currentMarketPrice, false);
    assert.equal(pnl2, 5_000_000 * (0.0000300 - 0.0000350)); // -$25.00

    // Portfolio aggregate gross unrealized
    const stats = calculatePortfolioStats([trade1, trade2], 2500, { 'FLOKIUSDT': currentMarketPrice });
    assert.equal(Math.round(stats.totalGrossUnrealizedPnL), 75); // $100 - $25 = +$75
  });

  test('TC-1.4: Grouping granular Binance trade fills into clean order execution batches', () => {
    const rawFills: TradeFill[] = [
      {
        tradeId: 101,
        orderId: 'ORD_999',
        symbol: 'FLOKIUSDT',
        price: 0.0000300,
        qty: 8_000_000,
        quoteQty: 240,
        commission: 8000,
        commissionAsset: 'FLOKI',
        feeUsd: 0.24,
        time: 1700000001000,
        isBuyer: true
      },
      {
        tradeId: 102,
        orderId: 'ORD_999',
        symbol: 'FLOKIUSDT',
        price: 0.0000310,
        qty: 2_000_000,
        quoteQty: 62,
        commission: 2000,
        commissionAsset: 'FLOKI',
        feeUsd: 0.062,
        time: 1700000002000,
        isBuyer: true
      }
    ];

    const batches = groupFillsByOrder(rawFills);
    assert.equal(batches.length, 1);
    assert.equal(batches[0].orderId, 'ORD_999');
    assert.equal(batches[0].totalQty, 10_000_000);
    assert.equal(batches[0].totalUsd, 240 + 62); // $302
    assert.equal(batches[0].fillCount, 2);
    // Weighted average price: 302 / 10,000,000 = 0.0000302
    assert.equal(batches[0].avgPrice, 0.0000302);
  });

  // TC-1.5: Accurate fee calculation when fees are in specific coins vs USDT
  test('TC-1.5: Converts coin fees at exact trade price and USDT fees 1:1', () => {
    // Buy order with fee in base coin BTC at execution price $65,000
    const btcFeeUsd = calculateExecutionFeeInUsd('BTC', 0.0001, 65000, 'BTCUSDT');
    assert.equal(btcFeeUsd, 0.0001 * 65000); // 6.50 USDT

    // Sell order with fee in USDT
    const usdtFeeUsd = calculateExecutionFeeInUsd('USDT', 7.20, 68000, 'BTCUSDT');
    assert.equal(usdtFeeUsd, 7.20); // 7.20 USDT

    // BNB fee discount
    const bnbFeeUsd = calculateExecutionFeeInUsd('BNB', 0.01, 65000, 'BTCUSDT', 600);
    assert.equal(bnbFeeUsd, 0.01 * 600); // 6.00 USDT
  });

  // TC-1.6: Closed trade combines both buy and sell fees into correct total
  test('TC-1.6: Closed trade correctly consolidates mixed coin and USDT fees', () => {
    const closedTrade: Partial<Trade> = {
      buyFeeUsd: 6.50, // Extracted from BTC coin fee at buy price
      sellFeeUsd: 7.20, // Extracted from USDT fee on sell order
      soldCoins: 1.0,
      entryPrice: 65000,
      exitPrice: 68000
    };

    const fees = getTradeConsolidatedFees(closedTrade);
    assert.equal(fees.buyFee, 6.50);
    assert.equal(fees.sellFee, 7.20);
    assert.equal(fees.totalFees, 13.70); // Combined exact USDT fee
  });
});
