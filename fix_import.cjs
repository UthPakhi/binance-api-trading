const fs = require('fs');
let code = fs.readFileSync('src/lib/TradeContext.tsx', 'utf-8');

code = code.replace(
`            entryPrice: bp.entryPrice,
            stopLoss: bp.entryPrice * 0.85, // Default 15% SL placeholder
            positionSize: bp.usdValue,
            positionSizeCoins: bp.positionAmt,
            riskAmount: bp.usdValue * 0.15,`,
`            entryPrice: bp.entryPrice,
            stopLoss: 0, 
            positionSize: bp.usdValue,
            positionSizeCoins: bp.positionAmt,
            riskAmount: 0,`
);

fs.writeFileSync('src/lib/TradeContext.tsx', code);
console.log("Fixed default stop loss on import");
