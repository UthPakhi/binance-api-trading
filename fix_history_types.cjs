const fs = require('fs');
let code = fs.readFileSync('src/components/History.tsx', 'utf-8');

code = code.replace(/trade\.totalBuyUsd \|\| trade\.positionSize \|\| 0/g, 'trade.totalBuyUsd || (trade as any).positionSize || 0');
fs.writeFileSync('src/components/History.tsx', code);
console.log("Fixed History.tsx types");
