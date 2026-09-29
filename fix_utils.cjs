const fs = require('fs');
let code = fs.readFileSync('src/lib/tradeUtils.ts', 'utf-8');

code = code.replace(
`export const formatPrice = (price: number | string | undefined | null): string | number => {
  if (price === undefined || price === null || price === '') return '';
  const num = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(num)) return price;
  
  // Keep up to 6 decimals, but strip trailing zeroes
  return parseFloat(num.toFixed(6));
};`,
`export const formatPrice = (price: number | string | undefined | null, isEntry: boolean = false): string | number => {
  if (price === undefined || price === null || price === '') return '';
  const num = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(num)) return price;
  
  if (num === 0) return 0;
  
  if (isEntry) {
    if (num >= 10) return parseFloat(num.toFixed(2));
    if (num >= 1) return parseFloat(num.toFixed(3));
    if (num >= 0.01) return parseFloat(num.toFixed(4));
    return parseFloat(num.toFixed(6));
  }
  
  if (num >= 1000) return parseFloat(num.toFixed(2));
  if (num >= 10) return parseFloat(num.toFixed(3));
  if (num >= 1) return parseFloat(num.toFixed(4));
  return parseFloat(num.toFixed(6));
};`
);

code = code.replace(
`  const isLong = trade.entryPrice > trade.stopLoss;`,
`  const isLong = trade.isLong !== undefined ? trade.isLong : (trade.stopLoss ? trade.entryPrice > trade.stopLoss : true);`
);
code = code.replace(
`  const isLong = trade.entryPrice > trade.stopLoss;`,
`  const isLong = trade.isLong !== undefined ? trade.isLong : (trade.stopLoss ? trade.entryPrice > trade.stopLoss : true);`
);
code = code.replace(
`  const isLong = trade.entryPrice > trade.stopLoss;`,
`  const isLong = trade.isLong !== undefined ? trade.isLong : (trade.stopLoss ? trade.entryPrice > trade.stopLoss : true);`
);
code = code.replace(
`        const isLong = t.entryPrice > t.stopLoss;`,
`        const isLong = t.isLong !== undefined ? t.isLong : (t.stopLoss ? t.entryPrice > t.stopLoss : true);`
);

fs.writeFileSync('src/lib/tradeUtils.ts', code);
