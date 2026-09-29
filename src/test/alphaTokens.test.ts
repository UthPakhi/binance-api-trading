import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { 
  isAlphaTradeOrSymbol, 
  getTradeEffectiveRisk 
} from '../lib/tradeUtils';
import { shouldProtectFromSpotSync } from '../lib/tradeIngestion';
import { createMockTrade } from './testHelpers';

describe('Test Suite 2: Binance Alpha / Web3 Tokens', () => {
  // TC-2.1: Accurate price and token calculation for Alpha/Web3 tokens
  test('TC-2.1: Calculates correct coins amount from USD investment and Alpha token price', () => {
    const tokenSymbol = 'GRASSUSDT';
    const mockPrice = 0.4522; // $0.4522 per GRASS
    const investedUsd = 90.00;

    const coinsCalculated = investedUsd / mockPrice;
    assert.equal(Math.round(coinsCalculated * 100) / 100, 199.03); // ~199.03 GRASS

    const alphaTrade = createMockTrade({
      id: 'grass_alpha_1',
      symbol: tokenSymbol,
      entryPrice: mockPrice,
      positionSizeCoins: coinsCalculated,
      totalBuyUsd: investedUsd,
      type: 'HOLDING',
      market: 'ALPHA',
      isAlpha: true,
      status: 'ACTIVE'
    });

    assert.equal(isAlphaTradeOrSymbol(alphaTrade), true);
    assert.equal(alphaTrade.market, 'ALPHA');
  });

  // TC-2.2: Alpha trades must never be auto-closed by Spot balance sync
  test('TC-2.2: shouldProtectFromSpotSync guards Alpha and Web3 trades from Spot balance auto-close', () => {
    const grassTrade = createMockTrade({
      id: 'grass_alpha_1',
      symbol: 'GRASSUSDT',
      entryPrice: 0.45,
      positionSizeCoins: 200,
      totalBuyUsd: 90,
      market: 'ALPHA',
      isAlpha: true,
      status: 'ACTIVE'
    });

    const fartcoinTrade = createMockTrade({
      id: 'fartcoin_alpha_1',
      symbol: 'FARTCOINUSDT',
      entryPrice: 0.28,
      positionSizeCoins: 300,
      totalBuyUsd: 84,
      status: 'ACTIVE'
    });

    const spotBtcTrade = createMockTrade({
      id: 'btc_spot_1',
      symbol: 'BTCUSDT',
      entryPrice: 65000,
      positionSizeCoins: 0.01,
      totalBuyUsd: 650,
      market: 'SPOT',
      status: 'ACTIVE',
      notes: 'Imported from Binance Spot'
    });

    // Both GRASS (explicit market: 'ALPHA') and FARTCOIN (catalog recognized symbol) are protected
    assert.equal(shouldProtectFromSpotSync(grassTrade), true);
    assert.equal(shouldProtectFromSpotSync(fartcoinTrade), true);

    // Regular Spot trade without HOLDING flag is NOT guarded if sold on Binance Spot
    assert.equal(shouldProtectFromSpotSync(spotBtcTrade), false);
  });

  // TC-2.3: Switching an Alpha position between HOLDING and ACTIVE updates risk calculations without mutating entry data
  test('TC-2.3: Switching between HOLDING and ACTIVE preserves entry parameters and updates risk', () => {
    const initialHolding = createMockTrade({
      id: 'ai16z_trade_1',
      symbol: 'AI16ZUSDT',
      entryPrice: 0.85,
      positionSizeCoins: 100,
      totalBuyUsd: 85,
      type: 'HOLDING',
      market: 'ALPHA',
      isAlpha: true,
      status: 'ACTIVE',
      portfolioSize: 2500,
      stopLoss: 0,
      riskAmount: 0,
      riskPercent: 0
    });

    // A passive holding has 0 defined risk
    assert.equal(getTradeEffectiveRisk(initialHolding), 0);

    // Switch to active trade with a stop loss
    const switchedToActive = {
      ...initialHolding,
      type: 'TRADE' as const,
      stopLoss: 0.75, // $0.10 risk per coin * 100 coins = $10 risk
      riskAmount: 10
    };

    // Entry price and size remain completely unmutated
    assert.equal(switchedToActive.entryPrice, 0.85);
    assert.equal(switchedToActive.positionSizeCoins, 100);
    assert.equal(switchedToActive.totalBuyUsd, 85);

    // Risk is now active: $10 risk
    assert.equal(getTradeEffectiveRisk(switchedToActive), 10);
  });
});
