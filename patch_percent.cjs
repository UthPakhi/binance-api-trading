const fs = require('fs');
let code = fs.readFileSync('src/lib/tradeUtils.ts', 'utf-8');

const oldPercentFn = `export const calculateLivePnLPercent = (trade: Trade, currentPrice: number) => {
  const status = trade.status || 'ACTIVE';
  if (status === 'PENDING') return 0;
  if (!trade.entryPrice) return 0;
  const isLong = trade.entryPrice > trade.stopLoss;
  const percent = isLong 
    ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100
    : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
  return percent;
};`;

const newPercentFn = `export const calculateLivePnLPercent = (trade: Trade, currentPrice: number) => {
  const status = trade.status || 'ACTIVE';
  if (status === 'PENDING') return 0;
  if (!trade.entryPrice) return 0;
  
  const netPnL = calculateLivePnL(trade, currentPrice);
  const totalBuy = trade.totalBuyUsd || (trade.entryPrice * trade.positionSizeCoins);
  
  if (totalBuy === 0) return 0;
  return (netPnL / totalBuy) * 100;
};`;

code = code.replace(oldPercentFn, newPercentFn);

// Also make sure calculateLivePnL correctly handles ACTIVE trades by always deducting buyFee
// just in case realizedProfitUsd is 0 but buyFee hasn't been deducted.
const calculateLivePnLSearch = `export const calculateLivePnL = (trade: Trade, currentPrice: number) => {
  const status = trade.status || 'ACTIVE';
  if (status === 'PENDING') return 0; // No PnL for pending orders

  const remainingCoins = calculateRemainingCoins(trade);
  let realized = trade.realizedProfitUsd || 0;
  
  // Dynamic fee deduction for older trades
  if (trade.feeUsd === undefined) {
      const buyFee = (trade.totalBuyUsd || 0) * FEE_RATE;
      realized -= buyFee;
  }`;

const calculateLivePnLReplace = `export const calculateLivePnL = (trade: Trade, currentPrice: number) => {
  const status = trade.status || 'ACTIVE';
  if (status === 'PENDING') return 0; // No PnL for pending orders

  const remainingCoins = calculateRemainingCoins(trade);
  
  const buyFee = (trade.totalBuyUsd || (trade.entryPrice * trade.positionSizeCoins)) * FEE_RATE;
  let realized = trade.realizedProfitUsd || 0;
  
  if (status === 'ACTIVE') {
      // For active trades, the only realized amount is the entry fee.
      // We overwrite realized to -buyFee to ensure it's not missing the deduction.
      realized = -buyFee;
  } else if (trade.feeUsd === undefined) {
      // Dynamic fee deduction for older partially/fully closed trades
      realized -= buyFee;
  }`;

code = code.replace(calculateLivePnLSearch, calculateLivePnLReplace);

fs.writeFileSync('src/lib/tradeUtils.ts', code);
