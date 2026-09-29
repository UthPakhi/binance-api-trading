const fs = require('fs');
let code = fs.readFileSync('src/lib/TradeContext.tsx', 'utf-8');

const targetImport = `          const newTrade = {
            userId: auth.currentUser.uid,
            symbol: bp.symbol,
            entryPrice: bp.entryPrice,
            stopLoss: 0, 
            totalBuyUsd: bp.usdValue,
            positionSizeCoins: bp.positionAmt,
            riskAmount: 0,
            status: 'ACTIVE',
            isLong: true,
            createdAt: Date.now(),
            filledAt: Date.now(),
            feeUsd: bp.feeUsd || 0,
            notes: 'Auto-imported from Binance Spot'
          };`;

const replaceImport = `          const newTrade = {
            userId: auth.currentUser.uid,
            symbol: bp.symbol,
            entryPrice: bp.entryPrice,
            stopLoss: 0, 
            totalBuyUsd: bp.usdValue,
            positionSizeCoins: bp.positionAmt,
            riskAmount: 0,
            status: 'ACTIVE',
            isLong: true,
            realizedProfitUsd: bp.realizedProfitUsd || 0,
            createdAt: Date.now(),
            filledAt: Date.now(),
            feeUsd: bp.feeUsd || 0,
            notes: 'Auto-imported from Binance Spot'
          };`;

code = code.replace(targetImport, replaceImport);
fs.writeFileSync('src/lib/TradeContext.tsx', code);
console.log("Fixed new import realized pnl");
