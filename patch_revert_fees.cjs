const fs = require('fs');

// 1. Revert tradeUtils.ts
let utilsCode = fs.readFileSync('src/lib/tradeUtils.ts', 'utf-8');

const newUtilsCode = utilsCode.replace(/const FEE_RATE = 0.001;[\s\S]*?export const calculatePortfolioStats/, `export const calculateLivePnL = (trade: Trade, currentPrice: number) => {
  const status = trade.status || 'ACTIVE';
  if (status === 'PENDING') return 0;

  const remainingCoins = calculateRemainingCoins(trade);
  const realized = trade.realizedProfitUsd || 0;
  
  if (remainingCoins <= 0) return realized;
  
  const isLong = trade.entryPrice > trade.stopLoss;
  const unrealizedPerCoin = isLong ? (currentPrice - trade.entryPrice) : (trade.entryPrice - currentPrice);
  const unrealized = remainingCoins * unrealizedPerCoin;
  
  return realized + unrealized;
};

export const calculateLivePnLPercent = (trade: Trade, currentPrice: number) => {
  const status = trade.status || 'ACTIVE';
  if (status === 'PENDING') return 0;
  if (!trade.entryPrice) return 0;
  const isLong = trade.entryPrice > trade.stopLoss;
  const percent = isLong 
    ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100
    : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
  return percent;
};

export const calculatePortfolioStats`);

fs.writeFileSync('src/lib/tradeUtils.ts', newUtilsCode);

// 2. Revert History.tsx
let historyCode = fs.readFileSync('src/components/History.tsx', 'utf-8');

historyCode = historyCode.replace(/{trade\.feeUsd \? <span className="text-\[10px\] text-neutral-500">Fees deducted: {formatCurrency\(trade\.feeUsd\)}<\/span> : null}/g, '');
historyCode = historyCode.replace(/{trade\.feeUsd \? <span className="text-neutral-500\/70 text-\[9px\] block mt-0\.5">Fees: {formatCurrency\(trade\.feeUsd\)}<\/span> : null}/g, '');

fs.writeFileSync('src/components/History.tsx', historyCode);
