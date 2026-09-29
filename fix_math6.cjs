const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const targetResponse = `      res.json({
        status: "success",
        symbol,
        currentPrice,
        openBuys: {
          count: buyCountFinal,
          totalQty: buyTotalQty,
          avgEntryPrice: buyTotalQty > 0 ? (buyTotalCost / buyTotalQty) : 0,
          totalCost: buyTotalCost,
          feesUsd: buyTotalFees,
          time: latestBuyTime || null
        },
        recentSells: {
          count: sellCountFinal,
          totalQty: sellTotalQty,
          avgExitPrice: sellTotalQty > 0 ? (sellTotalProceeds / sellTotalQty) : 0,
          totalProceeds: sellTotalProceeds,
          feesUsd: sellTotalFees,
          time: latestSellTime || null
        },
        allTradesCount: trades.length`;
          
const replaceResponse = `      res.json({
        status: "success",
        symbol,
        currentPrice,
        openBuys: {
          count: openBuys.length,
          totalQty: buyTotalQty,
          avgEntryPrice: buyTotalQty > 0 ? (buyTotalCost / buyTotalQty) : 0,
          totalCost: buyTotalCost,
          feesUsd: buyTotalFees,
          time: latestBuyTime || null
        },
        recentSells: {
          count: exitSells.length,
          totalQty: sellTotalQty,
          avgExitPrice: sellTotalQty > 0 ? (sellTotalProceeds / sellTotalQty) : 0,
          totalProceeds: sellTotalProceeds,
          feesUsd: sellTotalFees,
          time: latestSellTime || null
        },
        allTradesCount: trades.length`;

code = code.replace(targetResponse, replaceResponse);

fs.writeFileSync('server.ts', code);
console.log("Fixed algorithm bounds in server.ts");
