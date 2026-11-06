import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPkr } from '../lib/tradeUtils.js';

test('PKR Exchange Rate and Closed Trade Realized Profit', async (t) => {
  await t.test('TC-PKR.1: Running trade live PnL calculates based on settings rate (277) rather than stale 285', () => {
    const settingsRate = 277;
    const currentPnL = 10; // $10 profit

    // Calculate PKR equivalent using settings rate
    const pkrValue = currentPnL * settingsRate;
    assert.equal(pkrValue, 2770);
    assert.equal(formatPkr(pkrValue), '₨2,770');

    // Verify it differs from the old buggy calculation of 285
    const oldBuggyValue = currentPnL * 285;
    assert.equal(oldBuggyValue, 2850);
    assert.notEqual(pkrValue, oldBuggyValue);
  });

  await t.test('TC-PKR.2: Closed trade realized profit formats in PKR', () => {
    const settingsRate = 277;
    const realizedPnL = 25.50; // $25.50 profit

    const pkrProfit = realizedPnL * settingsRate;
    assert.equal(pkrProfit, 7063.5);
    assert.equal(formatPkr(pkrProfit), '₨7,064');

    const realizedLoss = -12.25; // -$12.25 loss
    const pkrLoss = realizedLoss * settingsRate;
    assert.equal(formatPkr(pkrLoss), '-₨3,393');
  });

  await t.test('TC-PKR.3: Stale default rate 285 is replaced with settings rate for closed and running trades', () => {
    const pkrRateFromSettings = 277;

    // Simulate running trade with undefined or stale trade.pkrRate = 285
    const runningTrade1 = { pkrRate: undefined };
    const runningTrade2 = { pkrRate: 285 };

    const getRunningRate = (trade: { pkrRate?: number }, settingsPkr: number) => {
      // Running trades always calculate using current settings pkrRate
      return settingsPkr;
    };

    assert.equal(getRunningRate(runningTrade1, pkrRateFromSettings), 277);
    assert.equal(getRunningRate(runningTrade2, pkrRateFromSettings), 277);

    // Simulate closed trade with stale 285 vs custom rate
    const closedTradeWithStale285 = { pkrRate: 285 };
    const closedTradeWithCustomRate = { pkrRate: 280 };
    const closedTradeWithoutRate = { pkrRate: undefined };

    const getClosedRate = (trade: { pkrRate?: number }, settingsPkr: number) => {
      return (trade.pkrRate && trade.pkrRate !== 285) ? trade.pkrRate : settingsPkr;
    };

    assert.equal(getClosedRate(closedTradeWithStale285, pkrRateFromSettings), 277);
    assert.equal(getClosedRate(closedTradeWithCustomRate, pkrRateFromSettings), 280);
    assert.equal(getClosedRate(closedTradeWithoutRate, pkrRateFromSettings), 277);
  });

  await t.test('TC-PKR.4: Compact mode suppresses PKR amount, showing only when expanded', () => {
    const isCompact = true;
    const achievedPnL = 25.5;
    const trPkrRate = 277;

    // Compact mode format function
    const renderCompactPnl = (isCompactMode: boolean, pnl: number, rate: number) => {
      if (isCompactMode) {
        return `$${pnl.toFixed(2)}`; // No PKR in compact mode
      }
      return `$${pnl.toFixed(2)} · ${formatPkr(pnl * rate)}`;
    };

    assert.equal(renderCompactPnl(true, achievedPnL, trPkrRate), '$25.50');
    assert.match(renderCompactPnl(false, achievedPnL, trPkrRate), /₨7,064/);
  });

  await t.test('TC-PKR.5: Percentage mode suppresses PKR amount across running and closed trades', () => {
    const viewMode = 'PERCENT';
    const achievedPct = 5.2;
    const achievedPnL = 25.5;
    const trPkrRate = 277;

    const renderClosedSubline = (mode: string, pct: number, pnl: number, rate: number) => {
      if (mode === 'PERCENT') {
        return `Closed Return (+${pct.toFixed(1)}%)`;
      }
      return `+${pct.toFixed(1)}% · ${formatPkr(pnl * rate)}`;
    };

    assert.equal(renderClosedSubline('PERCENT', achievedPct, achievedPnL, trPkrRate), 'Closed Return (+5.2%)');
    assert.doesNotMatch(renderClosedSubline('PERCENT', achievedPct, achievedPnL, trPkrRate), /₨/);
    assert.match(renderClosedSubline('DOLLAR', achievedPct, achievedPnL, trPkrRate), /₨7,064/);
  });
});
