const fs = require('fs');
let code = fs.readFileSync('src/lib/tradeUtils.ts', 'utf-8');

const replacement = `
const FEE_RATE = 0.001;

export const calculateLivePnL = (trade: Trade, currentPrice: number) => {
  const status = trade.status || 'ACTIVE';
  if (status === 'PENDING') return 0; // No PnL for pending orders

  const remainingCoins = calculateRemainingCoins(trade);
  let realized = trade.realizedProfitUsd || 0;
  
  // Dynamic fee deduction for older trades
  if (trade.feeUsd === undefined) {
      const buyFee = (trade.totalBuyUsd || 0) * FEE_RATE;
      realized -= buyFee;
  }
  
  if (remainingCoins <= 0) return realized; // fully closed trade
  
  const isLong = trade.entryPrice > trade.stopLoss;
  const unrealizedPerCoin = isLong ? (currentPrice - trade.entryPrice) : (trade.entryPrice - currentPrice);
  const unrealized = remainingCoins * unrealizedPerCoin;
  
  // Deduct exit fee on unrealized
  const unrealizedFee = remainingCoins * currentPrice * FEE_RATE;
  
  return realized + unrealized - unrealizedFee;
};
`;

code = code.replace(/export const calculateLivePnL = \([\s\S]*?return realized \+ unrealized;\n\};/, replacement.trim());

fs.writeFileSync('src/lib/tradeUtils.ts', code);
