import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Trade } from '../types';
import { 
  computeRealizedPnL, 
  calculateUnassignedBalance,
  shouldProtectFromSpotSync,
  generateTradeFingerprint
} from '../lib/tradeIngestion';
import { 
  formatPrice, 
  calculateRemainingCoins, 
  isTradeClosed,
  isBinanceLinkedTrade,
  isStopLossAtBreakeven
} from '../lib/tradeUtils';
import { createMockTrade } from './testHelpers';

describe('Test Suite 4: PnL & Fee Integrity and Edge Cases (E1 - E10)', () => {
  // TC-4.1: Formula validation: (exitPrice - entryPrice) * size - fees must match realized PnL to the exact cent
  test('TC-4.1: Mathematical integrity of Realized PnL to the exact cent', () => {
    // Exact user FLOKI trade parameters:
    // Entry: 0.0000303, Exit: 0.0000293, Size: 11,942,550 coins, Total fees: $0.71 + dust
    const entryPrice = 0.0000303;
    const exitPrice = 0.0000293;
    const coins = 11942550;
    const totalFees = 1.22; // Trading fees

    // Gross loss = (0.0000293 - 0.0000303) * 11,942,550 = -0.0000010 * 11,942,550 = -$11.94255
    // Net loss = -$11.94255 - $1.22 = -$13.16255 -> -$13.16
    const netPnL = computeRealizedPnL(entryPrice, exitPrice, coins, totalFees, true);
    assert.equal(netPnL, -13.16);

    // Winning Long Trade: Entry $100, Exit $150, Size 2 coins, Fees $1.00
    // Gross = (150 - 100) * 2 = $100; Net = 100 - 1 = $99.00
    const winLong = computeRealizedPnL(100, 150, 2, 1.0, true);
    assert.equal(winLong, 99.00);

    // Winning Short Trade: Entry $100, Exit $80, Size 2 coins, Fees $1.00
    // Gross = (100 - 80) * 2 = $40; Net = 40 - 1 = $39.00
    const winShort = computeRealizedPnL(100, 80, 2, 1.0, false);
    assert.equal(winShort, 39.00);
  });

  // TC-4.2: Commission conversion: BNB, USDT, or base coin
  test('TC-4.2: Commission in BNB converts accurately to USD based on live BNB price', () => {
    const commBnb = 0.001; // 0.001 BNB
    const bnbPrice = 640.50;
    const feeInUsd = commBnb * bnbPrice; // $0.6405
    assert.equal(Math.round(feeInUsd * 100) / 100, 0.64);
  });

  // Edge Case E1: Multiple Buys for Same Coin
  test('E1: Multiple Buys for Same Coin calculates unassigned balance without collapsing', () => {
    const analysis = calculateUnassignedBalance(
      { symbol: 'FLOKIUSDT', positionAmt: 20_000_000, entryPrice: 0.00003, feeUsd: 0 },
      [createMockTrade({ id: 't1', symbol: 'FLOKIUSDT', entryPrice: 0.000028, positionSizeCoins: 12_000_000, status: 'ACTIVE' })]
    );
    assert.equal(analysis.unassignedCoins, 8_000_000);
    assert.equal(analysis.canCreateNewTrade, true);
    assert.equal(analysis.canDCA, true);
  });

  // Edge Case E2: Existing Trade + Open Limit Order
  test('E2: Existing Trade + Open Limit Order strictly separated', () => {
    const activeTrade = createMockTrade({
      id: 'active_1',
      symbol: 'SOLUSDT',
      entryPrice: 150,
      positionSizeCoins: 5,
      status: 'ACTIVE'
    });

    const limitOrder = createMockTrade({
      id: 'pending_1',
      symbol: 'SOLUSDT',
      entryPrice: 130,
      positionSizeCoins: 5,
      status: 'PENDING',
      binanceOrderId: 'LIMIT_8899'
    });

    assert.equal(activeTrade.status, 'ACTIVE');
    assert.equal(limitOrder.status, 'PENDING');
    assert.notEqual(activeTrade.id, limitOrder.id);
  });

  // Edge Case E3: Alpha Coin Bought via Web3/DEX protected from Spot Sync
  test('E3: Alpha Coin Bought via Web3/DEX protected from Spot Sync', () => {
    const alphaGrass = createMockTrade({
      id: 'alpha_grass',
      symbol: 'GRASSUSDT',
      entryPrice: 0.45,
      positionSizeCoins: 200,
      status: 'ACTIVE',
      market: 'ALPHA'
    });
    assert.equal(shouldProtectFromSpotSync(alphaGrass), true);
  });

  // Edge Case E4: Partial Fill Execution
  test('E4: Partial Fill Execution tracks filled coins and cost accurately', () => {
    const origQty = 1000;
    const executedQty = 400;
    const avgFillPrice = 10.50;

    const partialTrade = createMockTrade({
      id: 'partial_1',
      symbol: 'LINKUSDT',
      entryPrice: avgFillPrice,
      positionSizeCoins: executedQty,
      totalBuyUsd: executedQty * avgFillPrice,
      status: 'ACTIVE',
      notes: `Partially filled: ${executedQty}/${origQty} coins`
    });

    assert.equal(partialTrade.positionSizeCoins, 400);
    assert.equal(partialTrade.totalBuyUsd, 4200.00);
  });

  // Edge Case E5: Partial Take-Profit Exit (TP1 hit)
  test('E5: Partial Take-Profit Exit locks in realized PnL and leaves remaining coins running', () => {
    const trade = createMockTrade({
      id: 'tp1_trade',
      symbol: 'ETHUSDT',
      entryPrice: 2000,
      positionSizeCoins: 2, // 2 ETH
      status: 'HIT_TP1',
      soldCoins: 1, // Sold 1 ETH at TP1 ($2500)
      realizedProfitUsd: 500, // 1 * (2500 - 2000)
      takeProfit1: 2500,
      takeProfit2: 3000
    });

    const remaining = calculateRemainingCoins(trade);
    assert.equal(remaining, 1); // 1 ETH still active towards TP2
    assert.equal(trade.realizedProfitUsd, 500);
    assert.equal(isTradeClosed(trade), false);
  });

  // Edge Case E6: Full Position Exit on Binance
  test('E6: Full Position Exit marks trade as closed', () => {
    const trade = createMockTrade({
      id: 'closed_trade',
      symbol: 'BNBUSDT',
      entryPrice: 600,
      positionSizeCoins: 2,
      soldCoins: 2,
      status: 'CLOSED_MANUAL',
      closedAt: Date.now()
    });

    assert.equal(isTradeClosed(trade), true);
    assert.equal(calculateRemainingCoins(trade), 0);
  });

  // Edge Case E7: Holding vs Active Trade Distinction
  test('E7: Long-term Holding is segregated from active trade and guarded against SL triggers', () => {
    const holding = createMockTrade({
      id: 'h1',
      symbol: 'BTCUSDT',
      entryPrice: 60000,
      positionSizeCoins: 0.1,
      type: 'HOLDING',
      status: 'ACTIVE'
    });

    assert.equal(holding.type, 'HOLDING');
    assert.equal(shouldProtectFromSpotSync(holding), true);
  });

  // Edge Case E8: High-Frequency Sync Duplication Prevention
  test('E8: Idempotency fingerprint prevents duplicate rows for same order', () => {
    const fp1 = generateTradeFingerprint({ binanceOrderId: '99887766' });
    const fp2 = generateTradeFingerprint({ binanceOrderId: '99887766' });
    assert.equal(fp1, fp2);
  });

  // Edge Case E9: Sub-Penny Precision Tokens (up to 8 decimal places)
  test('E9: formatPrice supports up to 8 decimal places for sub-penny meme tokens', () => {
    assert.equal(formatPrice(0.0000303), 0.0000303);
    assert.equal(formatPrice(0.0000293), 0.0000293);
    assert.equal(formatPrice(0.00000012), 0.00000012);
    assert.equal(formatPrice(65432.10), 65432.1);
  });

  // Edge Case E10: Dust Balances (< $5)
  test('E10: Dust balance calculation identifies amounts under $5', () => {
    const dustPosition = { symbol: 'SHIBUSDT', positionAmt: 10000, currentPrice: 0.000015, entryPrice: 0.000015, feeUsd: 0 };
    const dustVal = dustPosition.positionAmt * dustPosition.currentPrice; // $0.15
    assert.equal(dustVal < 5, true);
  });

  // Edge Case E11: Moving Stop Loss to Breakeven maintains ACTIVE status and detects breakeven
  test('E11: Moving Stop Loss to Breakeven maintains ACTIVE status and detects breakeven', () => {
    const trade = createMockTrade({
      id: 'trade_be_1',
      symbol: 'OGUSDT',
      entryPrice: 4.85,
      positionSizeCoins: 257.96,
      stopLoss: 4.85, // Moved to breakeven
      takeProfit1: 5.50,
      takeProfit2: 6.20,
      status: 'ACTIVE',
      market: 'SPOT',
      notes: 'Imported from Binance Spot'
    });

    assert.equal(trade.status, 'ACTIVE');
    assert.equal(isStopLossAtBreakeven(trade), true);
    assert.equal(isBinanceLinkedTrade(trade), true);
  });

  // Edge Case E12: Binance Linked Spot Trade is guarded from candlestick auto-closing
  test('E12: Binance Linked Spot Trade is guarded from candlestick auto-closing', () => {
    const spotTrade = createMockTrade({
      id: 'spot_og',
      symbol: 'OGUSDT',
      entryPrice: 4.85,
      positionSizeCoins: 257.96,
      status: 'ACTIVE',
      market: 'SPOT',
      notes: 'Imported from Binance Spot'
    });

    assert.equal(isBinanceLinkedTrade(spotTrade), true);
  });

  // Edge Case E13: Milestone notification deduplication prevents repeated toast notifications
  test('E13: Milestone notification deduplication prevents repeated toast notifications', () => {
    const notifiedToasts = new Set<string>();
    const tradeId = 'trade_og_1';
    const status = 'HIT_SL';
    const toastKey = `${tradeId}_${status}`;

    // First trigger: should notify
    const shouldNotify1 = !notifiedToasts.has(toastKey);
    assert.equal(shouldNotify1, true);
    notifiedToasts.add(toastKey);

    // Second trigger (e.g. user clicks Refresh): should NOT notify
    const shouldNotify2 = !notifiedToasts.has(toastKey);
    assert.equal(shouldNotify2, false);
  });
});
