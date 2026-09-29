import { calculateRemainingCoins } from './src/lib/tradeUtils.ts';
const trade = { status: 'HIT_TP1', positionSizeCoins: 10, takeProfit1: 105 };
console.log('remaining:', calculateRemainingCoins(trade as any));
