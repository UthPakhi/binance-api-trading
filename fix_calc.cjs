const fs = require('fs');
let code = fs.readFileSync('src/lib/tradeUtils.ts', 'utf-8');

code = code.replace(
`  if (tp === 0 || pct === 0 || !trade.entryPrice || !trade.stopLoss || !trade.positionSizeCoins) return 0;`,
`  if (tp === 0 || pct === 0 || !trade.entryPrice || !trade.positionSizeCoins) return 0;`
);

fs.writeFileSync('src/lib/tradeUtils.ts', code);
console.log("Fixed calc function in tradeUtils");
