import test from 'node:test';
import assert from 'node:assert/strict';
import { 
  getTradeRiskFramework, 
  calculateNormalizedRMultiple,
  calculateDisciplineStats
} from '../lib/tradeUtils';
import { Trade } from '../types';

test('Test Suite 6: Institutional No-SL Risk & R:R Framework', async (t) => {

  await t.test('FR-1: Trade with defined Hard Stop calculates standard risk and R-multiple', () => {
    const trade: Partial<Trade> = {
      id: 'trade-hard-sl',
      symbol: 'BTCUSDT',
      entryPrice: 60000,
      stopLoss: 58000, // $2,000 risk per coin
      positionSizeCoins: 0.1, // 0.1 * 2000 = $200 risk
      takeProfit1: 64000, // $4,000 gain per coin -> 0.1 * 4000 = $400 gain
      totalBuyUsd: 6000,
      portfolioSize: 10000,
      type: 'TRADE'
    };

    const fw = getTradeRiskFramework(trade as Trade, 10000);
    assert.equal(fw.riskType, 'HARD_STOP');
    assert.equal(fw.isUnprotected, false);
    assert.equal(fw.isBreakeven, false);
    assert.equal(fw.effectiveRiskAmount, 200);
    assert.equal(fw.portfolioRiskUnit, 100); // 1% of $10,000 equity
    assert.equal(fw.impliedRiskReward, 2.0); // 400 gain / 200 risk = 2.0

    // Standard +2.0R calculation
    const norm = calculateNormalizedRMultiple(400, trade as Trade, 10000);
    assert.equal(norm.r, 2.0);
    assert.equal(norm.isNormalized, false);
  });

  await t.test('FR-2: Trade at Breakeven eliminates active risk', () => {
    const trade: Partial<Trade> = {
      id: 'trade-be',
      symbol: 'ETHUSDT',
      entryPrice: 3000,
      stopLoss: 3000, // Breakeven
      positionSizeCoins: 1,
      totalBuyUsd: 3000,
      portfolioSize: 10000,
      type: 'TRADE'
    };

    const fw = getTradeRiskFramework(trade as Trade, 10000);
    assert.equal(fw.riskType, 'BREAKEVEN');
    assert.equal(fw.isUnprotected, false);
    assert.equal(fw.isBreakeven, true);
    assert.equal(fw.effectiveRiskAmount, 0);

    // If closed at breakeven ($0 PnL), r = 0
    const normZero = calculateNormalizedRMultiple(0, trade as Trade, 10000);
    assert.equal(normZero.r, 0);
    assert.equal(normZero.isNormalized, false);

    // If trade running in profit with Breakeven SL, normalized risk-free R is calculated against 1R unit ($100 unit -> +1.5R)
    const normProfit = calculateNormalizedRMultiple(150, trade as Trade, 10000);
    assert.equal(normProfit.r, 1.5);
    assert.equal(normProfit.isNormalized, true);
  });

  await t.test('FR-3: Unprotected Trade (No-SL) calculates exposure, benchmark 1R, and implied 1:2 SL', () => {
    // 0.5 BTC bought at $60,000 = $30,000 position
    // TP1 is set at $66,000 (+10% gain = $3,000 target profit)
    // No Stop Loss is set!
    const trade: Partial<Trade> = {
      id: 'trade-no-sl',
      symbol: 'BTCUSDT',
      entryPrice: 60000,
      stopLoss: 0, // NO STOP LOSS
      takeProfit1: 66000, // +10% target
      positionSizeCoins: 0.5,
      totalBuyUsd: 30000,
      portfolioSize: 20000, // $20,000 total portfolio
      type: 'TRADE'
    };

    const fw = getTradeRiskFramework(trade as Trade, 20000);
    assert.equal(fw.riskType, 'PORTFOLIO_UNIT');
    assert.equal(fw.isUnprotected, true);
    assert.equal(fw.isBreakeven, false);
    
    // Catastrophic downside is 100% of position ($30,000)
    assert.equal(fw.maxDownsideExposure, 30000);

    // Standard 1R benchmark unit is 1% of portfolio equity ($200)
    assert.equal(fw.portfolioRiskUnit, 200);

    // Implied 1:2 R:R Stop Loss:
    // Target is +10% ($60k -> $66k). Half target distance is -5% ($3,000).
    // Implied Stop Loss level: $60,000 * (1 - 0.05) = $57,000!
    assert.ok(fw.impliedStopLoss !== undefined);
    assert.equal(fw.impliedStopLoss, 57000);

    // Recommended stops
    assert.ok(fw.recommendedStops);
    assert.equal(fw.recommendedStops?.conservative, 58000); // 1:3 RR stop
    assert.equal(fw.recommendedStops?.balanced, 57000); // 1:2 RR stop
    assert.equal(fw.recommendedStops?.aggressive, 56000); // 1:1.5 RR stop

    // Normalized R-Multiple: if position gained +$400 profit, normalized against $200 1R = +2.0R!
    const norm = calculateNormalizedRMultiple(400, trade as Trade, 20000);
    assert.equal(norm.r, 2.0);
    assert.equal(norm.isNormalized, true);
    assert.match(norm.note, /normalized against 1R portfolio risk unit/i);
  });

  await t.test('FR-4: Unprotected Short Trade without SL calculates correct inverted implied stops', () => {
    // Short entry at $100, Take Profit at $80 (-20% gain)
    // No Stop Loss
    const shortTrade: Partial<Trade> = {
      id: 'short-no-sl',
      symbol: 'SOLUSDT',
      isLong: false,
      entryPrice: 100,
      stopLoss: 0,
      takeProfit1: 80, // Target +20% gain for short
      positionSizeCoins: 10,
      totalBuyUsd: 1000,
      portfolioSize: 10000,
      type: 'TRADE'
    };

    const fw = getTradeRiskFramework(shortTrade as Trade, 10000);
    assert.equal(fw.isUnprotected, true);
    
    // For short: TP is $80 (20 delta). Implied 1:2 stop is entry + 10 = $110!
    assert.ok(fw.impliedStopLoss !== undefined);
    assert.equal(fw.impliedStopLoss, 110);

    // Recommended stops for Short (above entry price)
    assert.equal(fw.recommendedStops?.balanced, 110);
    assert.equal(fw.recommendedStops?.conservative, parseFloat((100 + 20 / 3).toFixed(6)));
  });

  await t.test('FR-5: Discipline Stats incorporates normalized R-Multiples for trades without Stop Loss', () => {
    const closedTrades: Partial<Trade>[] = [
      {
        id: 't1',
        symbol: 'BTCUSDT',
        entryPrice: 50000,
        stopLoss: 49000, // $1000 risk
        positionSizeCoins: 0.1, // $100 dollar risk
        realizedProfitUsd: 250, // +2.5R
        disciplineTag: 'PLAN_FOLLOWED'
      },
      {
        id: 't2-no-sl',
        symbol: 'SOLUSDT',
        entryPrice: 100,
        stopLoss: 0, // No SL
        positionSizeCoins: 5, // $500 invested
        portfolioSize: 10000, // 1R unit = $100
        realizedProfitUsd: 150, // +1.5R normalized
        disciplineTag: 'FOMO_CHASED'
      }
    ];

    const stats = calculateDisciplineStats(closedTrades as Trade[]);
    assert.equal(stats.planned.count, 1);
    assert.equal(stats.deviated.count, 1);
    // Followed plan total R: +2.5R
    assert.equal(stats.planned.totalR, 2.5);
    // Deviated plan total R: +1.5R (from normalized framework instead of 0 or NaN!)
    assert.equal(stats.deviated.totalR, 1.5);
    assert.equal(stats.disciplineScore, 50); // 1 out of 2 = 50%
  });
});
