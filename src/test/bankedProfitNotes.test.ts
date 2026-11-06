import test from 'node:test';
import assert from 'node:assert';
import { 
  formatPartialExitNote, 
  parseStructuredTradeNotes, 
  getTradeBankedProfit 
} from '../lib/tradeUtils.js';
import { Trade } from '../types.js';

test('Banked Profit & Loss Cut Along The Way Suite', async (t) => {
  await t.test('TC-BP1: formatPartialExitNote records profit banked at exit price with positive dollar amount and return %', () => {
    const trade: Partial<Trade> = {
      symbol: 'SOLUSDT',
      entryPrice: 100,
      positionSizeCoins: 10,
      type: 'TRADE'
    };

    const noteLine = formatPartialExitNote({
      trade,
      exitPrice: 150,
      exitCoins: 5,
      exitPercent: 50,
      reason: 'Profit Banked'
    });

    assert.ok(noteLine.includes('Profit Banked'));
    assert.ok(noteLine.includes('@ $150'));
    assert.ok(noteLine.includes('+$250.00'));
    assert.ok(noteLine.includes('5 coins'));
    assert.ok(noteLine.includes('+50.0%'));
  });

  await t.test('TC-BP2: formatPartialExitNote records loss cut when selling below entry price', () => {
    const trade: Partial<Trade> = {
      symbol: 'BTCUSDT',
      entryPrice: 60000,
      positionSizeCoins: 0.1,
      type: 'TRADE'
    };

    const noteLine = formatPartialExitNote({
      trade,
      exitPrice: 54000,
      exitCoins: 0.05,
      exitPercent: 50,
      reason: 'Loss Cut'
    });

    assert.ok(noteLine.includes('Loss Cut'));
    assert.ok(noteLine.includes('@ $54000') || noteLine.includes('@ $54,000'));
    assert.ok(noteLine.includes('-$300.00'));
    assert.ok(noteLine.includes('-10.0%'));
  });

  await t.test('TC-BP3: parseStructuredTradeNotes calculates profit banked at each price across multiple partial exits', () => {
    const trade: Partial<Trade> = {
      symbol: 'ETHUSDT',
      entryPrice: 2000,
      positionSizeCoins: 10,
      type: 'TRADE',
      notes: [
        '🎯 Profit Banked 50% @ $2500: +$2500.00 (5 coins · +25.0%)',
        'Trimmed 25% @ $3000'
      ].join('\n')
    };

    const items = parseStructuredTradeNotes(trade.notes, trade);
    assert.strictEqual(items.length, 2);

    // Item 1
    assert.strictEqual(items[0].type, 'PROFIT_BANKED');
    assert.strictEqual(items[0].price, 2500);
    assert.strictEqual(items[0].profitUsd, 2500);
    assert.strictEqual(items[0].returnPct, 25);

    // Item 2: Legacy note enriched with calculated profit at $3000
    assert.strictEqual(items[1].type, 'PROFIT_BANKED');
    assert.strictEqual(items[1].price, 3000);
    assert.strictEqual(items[1].coins, 2.5); // 25% of 10 coins
    assert.strictEqual(items[1].profitUsd, 2500); // 2.5 coins * ($3000 - $2000) = +$2500
    assert.strictEqual(items[1].returnPct, 50); // (3000 - 2000)/2000 = +50%
    assert.ok(items[1].displayText.includes('+$2500.00'));
  });

  await t.test('TC-BP4: parseStructuredTradeNotes calculates loss cut when partial exit is executed at a loss', () => {
    const trade: Partial<Trade> = {
      symbol: 'ADAUSDT',
      entryPrice: 1.00,
      positionSizeCoins: 1000,
      type: 'TRADE',
      notes: '✂️ Loss Cut 50% @ $0.80: -$100.00 (500 coins · -20.0%)'
    };

    const items = parseStructuredTradeNotes(trade.notes, trade);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].type, 'LOSS_CUT');
    assert.strictEqual(items[0].price, 0.8);
    assert.strictEqual(items[0].profitUsd, -100);
    assert.strictEqual(items[0].returnPct, -20);
    assert.strictEqual(items[0].label, 'Loss Cut');
  });

  await t.test('TC-BP5: getTradeBankedProfit aggregates total banked profit and provides list of each exit price point', () => {
    const trade: Partial<Trade> = {
      symbol: 'BNBUSDT',
      entryPrice: 300,
      positionSizeCoins: 10,
      soldCoins: 7.5,
      realizedProfitUsd: 1250,
      notes: [
        '🎯 Profit Banked 50% @ $400: +$500.00 (5 coins · +33.3%)',
        '🎯 Profit Banked 25% @ $600: +$750.00 (2.5 coins · +100.0%)'
      ].join('\n')
    };

    const info = getTradeBankedProfit(trade);
    assert.strictEqual(info.hasBankedProfit, true);
    assert.strictEqual(info.hasLossCut, false);
    assert.strictEqual(info.bankedAmountUsd, 1250);
    assert.strictEqual(info.soldPercent, 75);
    assert.strictEqual(info.exits.length, 2);

    assert.strictEqual(info.exits[0].price, 400);
    assert.strictEqual(info.exits[0].profitUsd, 500);
    assert.strictEqual(info.exits[1].price, 600);
    assert.strictEqual(info.exits[1].profitUsd, 750);
  });

  await t.test('TC-BP6: getTradeBankedProfit handles both profit banked and loss cut executions on same trade', () => {
    const trade: Partial<Trade> = {
      symbol: 'LINKUSDT',
      entryPrice: 10,
      positionSizeCoins: 100,
      notes: [
        '🎯 Profit Banked 50% @ $15: +$250.00 (50 coins · +50.0%)',
        '✂️ Loss Cut 25% @ $8: -$50.00 (25 coins · -20.0%)'
      ].join('\n')
    };

    const info = getTradeBankedProfit(trade);
    assert.strictEqual(info.hasBankedProfit, true);
    assert.strictEqual(info.hasLossCut, true);
    assert.strictEqual(info.bankedAmountUsd, 200); // 250 - 50 = +200 net
    assert.strictEqual(info.totalProfitBankedUsd, 250);
    assert.strictEqual(info.totalLossCutUsd, 50);
    assert.strictEqual(info.exits.length, 2);
  });

  await t.test('TC-BP7: parseBinanceOpenOrdersForTrade transitions ACTIVE trade to PARTIAL_EXIT and creates structured banked profit notes when coins were sold on Binance', async () => {
    const { parseBinanceOpenOrdersForTrade } = await import('../lib/binanceOrderSync.js');

    const activeTrade: Trade = {
      id: 'trade_cfx_1',
      userId: 'user1',
      symbol: 'CFXUSDT',
      entryPrice: 0.05,
      positionSizeCoins: 1000,
      totalBuyUsd: 50,
      status: 'ACTIVE',
      createdAt: Date.now() - 3600000,
      portfolioSize: 1000,
      riskPercent: 1,
      stopLoss: 0.04,
      takeProfit1: 0.08,
      riskAmount: 10
    };

    const analysisData = {
      status: 'success',
      isPartialExit: true,
      isFullyClosed: false,
      totalSoldQty: 500,
      avgExitPrice: 0.08,
      realizedPnL: 15.00,
      soldPercent: 50,
      remainingQty: 500,
      partialSells: [
        { qty: 500, price: 0.08, proceeds: 40, costBasis: 25, grossPnl: 15, pnl: 15, time: Date.now() - 1800000, orderId: 991122 }
      ],
      openOrders: []
    };

    const result = parseBinanceOpenOrdersForTrade(activeTrade, [], analysisData);

    assert.strictEqual(result.hasChanges, true);
    assert.strictEqual(result.updatePayload.status, 'PARTIAL_EXIT');
    assert.strictEqual(result.updatePayload.soldCoins, 500);
    assert.strictEqual(result.updatePayload.realizedProfitUsd, 15.00);
    assert.strictEqual(result.updatePayload.positionSizeCoins, 1000); // Preserves initial 1000 coins!
    assert.ok(result.updatePayload.notes?.includes('Profit Banked'));
    assert.ok(result.updatePayload.notes?.includes('+$15.00'));
    assert.ok(result.updatePayload.notes?.includes('@ $0.08'));
    assert.ok(result.syncSummary.includes('Banked: +$15.00'));
  });

  await t.test('TC-BP8: getTradeBankedProfit extracts profit banked from Binance partial sell note', () => {
    const tradeWithSyncNote: Partial<Trade> = {
      symbol: 'CFXUSDT',
      entryPrice: 0.05,
      positionSizeCoins: 1000,
      soldCoins: 500,
      realizedProfitUsd: 15.00,
      status: 'PARTIAL_EXIT',
      notes: '🎯 Profit Banked: +$15.00 (@ $0.08000000 · 500 coins · +60.0%)'
    };

    const info = getTradeBankedProfit(tradeWithSyncNote);
    assert.strictEqual(info.hasBankedProfit, true);
    assert.strictEqual(info.bankedAmountUsd, 15.00);
    assert.strictEqual(info.soldCoins, 500);
    assert.strictEqual(info.soldPercent, 50);
    assert.strictEqual(info.exits.length, 1);
    assert.strictEqual(info.exits[0].price, 0.08);
    assert.strictEqual(info.exits[0].profitUsd, 15.00);
    assert.strictEqual(info.exits[0].returnPct, 60.0);
  });
});
