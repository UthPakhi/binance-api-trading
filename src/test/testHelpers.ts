import { Trade } from '../types';

export function createMockTrade(overrides: Partial<Trade> = {}): Trade {
  const entryPrice = overrides.entryPrice ?? 50000;
  const stopLoss = overrides.stopLoss !== undefined ? overrides.stopLoss : (entryPrice * 0.95);
  return {
    id: `mock_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    userId: 'user_test',
    symbol: 'BTCUSDT',
    entryPrice,
    stopLoss,
    portfolioSize: 2500,
    riskPercent: 1,
    riskAmount: 25,
    positionSizeCoins: 1,
    totalBuyUsd: entryPrice,
    status: 'ACTIVE',
    type: 'TRADE',
    market: 'SPOT',
    createdAt: Date.now(),
    ...overrides
  };
}
