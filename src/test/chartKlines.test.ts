import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getCleanSymbol } from '../lib/tradeUtils';

describe('Chart Klines Formatting & Symbol Normalization', () => {
  it('normalizes symbols to include correct quote currency (USDT, USDC, etc.)', () => {
    assert.strictEqual(getCleanSymbol('BTC'), 'BTCUSDT');
    assert.strictEqual(getCleanSymbol('BTCUSDT'), 'BTCUSDT');
    assert.strictEqual(getCleanSymbol('BTCUSDC'), 'BTCUSDC');
    assert.strictEqual(getCleanSymbol('eth'), 'ETHUSDT');
    assert.strictEqual(getCleanSymbol('solusdt'), 'SOLUSDT');
  });

  it('correctly maps and sorts raw exchange kline arrays to lightweight-charts candle objects', () => {
    // Binance kline format: [openTime, open, high, low, close, volume, closeTime, ...]
    const rawKlines = [
      [1700003600000, "100.5", "105.0", "99.0", "103.2"],
      [1700000000000, "98.0", "101.0", "97.5", "100.5"],
      [1700007200000, "103.2", "104.0", "101.5", "102.0"]
    ];

    const formatted = rawKlines.map((d: any) => ({
      time: Math.floor(d[0] / 1000),
      open: parseFloat(d[1]),
      high: parseFloat(d[2]),
      low: parseFloat(d[3]),
      close: parseFloat(d[4]),
    }));

    formatted.sort((a, b) => a.time - b.time);

    assert.strictEqual(formatted.length, 3);
    assert.strictEqual(formatted[0].time, 1700000000);
    assert.strictEqual(formatted[0].open, 98.0);
    assert.strictEqual(formatted[1].time, 1700003600);
    assert.strictEqual(formatted[2].time, 1700007200);
    assert.strictEqual(formatted[2].close, 102.0);
  });
});
