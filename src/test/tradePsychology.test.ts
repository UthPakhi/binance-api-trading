import test from 'node:test';
import assert from 'node:assert/strict';
import { 
  calculateRMultiple, 
  formatPnlDisplay, 
  isTp1Reached, 
  isStopLossAtBreakeven, 
  calculateDisciplineStats,
  DISCIPLINE_TAGS
} from '../lib/tradeUtils';
import { Trade } from '../types';

test('Test Suite 5: Trading Psychology & Discipline Engine', async (t) => {
  
  await t.test('TP-1: calculateRMultiple correctly normalizes PnL to initial dollar risk', () => {
    // 2.0R win
    assert.equal(calculateRMultiple(200, 100), 2.0);
    // 1.5R win
    assert.equal(calculateRMultiple(75, 50), 1.5);
    // -1.0R loss
    assert.equal(calculateRMultiple(-100, 100), -1.0);
    // -0.5R loss
    assert.equal(calculateRMultiple(-25, 50), -0.5);
    // Zero risk edge case returns null
    assert.equal(calculateRMultiple(50, 0), null);
    assert.equal(calculateRMultiple(50, null), null);
  });

  await t.test('TP-2: formatPnlDisplay formats accurately across DOLLAR, R_MULTIPLE, PERCENT, and ZEN modes', () => {
    const pnl = 150;
    const riskAmount = 50;
    const pnlPercent = 15;

    // Dollar mode
    assert.equal(
      formatPnlDisplay({ pnl, riskAmount, pnlPercent, viewMode: 'DOLLAR' }),
      '+$150.00'
    );

    // R-Multiple mode
    assert.equal(
      formatPnlDisplay({ pnl, riskAmount, pnlPercent, viewMode: 'R_MULTIPLE' }),
      '+3.00R'
    );

    // Negative R-Multiple
    assert.equal(
      formatPnlDisplay({ pnl: -50, riskAmount: 50, pnlPercent: -5, viewMode: 'R_MULTIPLE' }),
      '-1.00R'
    );

    // Percent mode
    assert.equal(
      formatPnlDisplay({ pnl, riskAmount, pnlPercent, viewMode: 'PERCENT' }),
      '+15.00%'
    );

    // Zen stealth mode: completely masks fluctuating amounts
    assert.equal(
      formatPnlDisplay({ pnl, riskAmount, pnlPercent, viewMode: 'ZEN' }),
      '••••••'
    );

    // Privacy mode fallback
    assert.equal(
      formatPnlDisplay({ pnl, riskAmount, pnlPercent, viewMode: 'DOLLAR', privacyMode: true }),
      '••••••'
    );
  });

  await t.test('TP-3: isTp1Reached accurately identifies when price reaches take profit 1', () => {
    const longTrade: Partial<Trade> = {
      entryPrice: 100,
      takeProfit1: 110,
      isLong: true
    };

    assert.equal(isTp1Reached(longTrade, 105), false);
    assert.equal(isTp1Reached(longTrade, 110), true);
    assert.equal(isTp1Reached(longTrade, 115), true);

    const shortTrade: Partial<Trade> = {
      entryPrice: 100,
      takeProfit1: 90,
      isLong: false
    };

    assert.equal(isTp1Reached(shortTrade, 95), false);
    assert.equal(isTp1Reached(shortTrade, 90), true);
    assert.equal(isTp1Reached(shortTrade, 85), true);
  });

  await t.test('TP-4: isStopLossAtBreakeven detects when stop loss protects entry price', () => {
    const longTrade: Partial<Trade> = {
      entryPrice: 100,
      stopLoss: 95,
      isLong: true
    };
    // Not at BE
    assert.equal(isStopLossAtBreakeven(longTrade), false);

    // Moved to Entry
    longTrade.stopLoss = 100;
    assert.equal(isStopLossAtBreakeven(longTrade), true);

    // Trailed above Entry
    longTrade.stopLoss = 105;
    assert.equal(isStopLossAtBreakeven(longTrade), true);

    const shortTrade: Partial<Trade> = {
      entryPrice: 100,
      stopLoss: 105,
      isLong: false
    };
    // Not at BE
    assert.equal(isStopLossAtBreakeven(shortTrade), false);

    // Moved to Entry
    shortTrade.stopLoss = 100;
    assert.equal(isStopLossAtBreakeven(shortTrade), true);

    // Trailed below Entry
    shortTrade.stopLoss = 95;
    assert.equal(isStopLossAtBreakeven(shortTrade), true);
  });

  await t.test('TP-5: calculateDisciplineStats aggregates plan adherence score and compares edge', () => {
    const trades: Trade[] = [
      {
        id: '1',
        userId: 'user1',
        symbol: 'BTCUSDT',
        portfolioSize: 10000,
        riskPercent: 1,
        entryPrice: 60000,
        stopLoss: 59000,
        riskAmount: 100,
        positionSizeCoins: 0.1,
        totalBuyUsd: 6000,
        realizedProfitUsd: 200,
        disciplineTag: 'PLAN_FOLLOWED',
        createdAt: 1000,
        closedAt: 2000
      },
      {
        id: '2',
        userId: 'user1',
        symbol: 'ETHUSDT',
        portfolioSize: 10000,
        riskPercent: 1,
        entryPrice: 3000,
        stopLoss: 2900,
        riskAmount: 100,
        positionSizeCoins: 1,
        totalBuyUsd: 3000,
        realizedProfitUsd: 300,
        disciplineTag: 'PLAN_FOLLOWED',
        createdAt: 1100,
        closedAt: 2100
      },
      {
        id: '3',
        userId: 'user1',
        symbol: 'SOLUSDT',
        portfolioSize: 10000,
        riskPercent: 1,
        entryPrice: 150,
        stopLoss: 140,
        riskAmount: 100,
        positionSizeCoins: 10,
        totalBuyUsd: 1500,
        realizedProfitUsd: -100,
        disciplineTag: 'FOMO_CHASED',
        createdAt: 1200,
        closedAt: 2200
      },
      {
        id: '4',
        userId: 'user1',
        symbol: 'DOGEUSDT',
        portfolioSize: 10000,
        riskPercent: 1,
        entryPrice: 0.15,
        stopLoss: 0.14,
        riskAmount: 100,
        positionSizeCoins: 10000,
        totalBuyUsd: 1500,
        realizedProfitUsd: -150,
        disciplineTag: 'REVENGE_TRADE',
        createdAt: 1300,
        closedAt: 2300
      }
    ];

    const stats = calculateDisciplineStats(trades);
    assert.equal(stats.totalClosed, 4);
    assert.equal(stats.taggedCount, 4);
    // 2 out of 4 followed plan = 50%
    assert.equal(stats.disciplineScore, 50);

    // Planned execution stats
    assert.equal(stats.planned.count, 2);
    assert.equal(stats.planned.wins, 2);
    assert.equal(stats.planned.winRate, 100);
    assert.equal(stats.planned.totalPnL, 500);
    assert.equal(stats.planned.totalR, 5.0); // +2R + +3R = 5R

    // Deviated stats
    assert.equal(stats.deviated.count, 2);
    assert.equal(stats.deviated.losses, 2);
    assert.equal(stats.deviated.winRate, 0);
    assert.equal(stats.deviated.totalPnL, -250);
    assert.equal(stats.deviated.totalR, -2.5); // -1.0R + -1.5R

    // By tag breakdown
    assert.equal(stats.byTag.FOMO_CHASED.count, 1);
    assert.equal(stats.byTag.REVENGE_TRADE.count, 1);
    assert.equal(stats.byTag.PLAN_FOLLOWED.count, 2);
  });
});
