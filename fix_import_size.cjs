const fs = require('fs');
let code = fs.readFileSync('src/lib/TradeContext.tsx', 'utf-8');

code = code.replace(
`            stopLoss: 0, 
            positionSize: bp.usdValue,`,
`            stopLoss: 0, 
            totalBuyUsd: bp.usdValue,`
);
fs.writeFileSync('src/lib/TradeContext.tsx', code);
console.log("Fixed positionSize -> totalBuyUsd in TradeContext");
