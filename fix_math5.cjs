const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const targetResponse = `      let buyTotalQty = 0;
      let buyTotalCost = 0;
      let buyTotalFees = 0;
      let latestBuyTime = 0;
      for (const b of openBuys) {`;
          
const replaceResponse = `      let currentQty = 0;
      let currentCost = 0;
      let currentFees = 0;
      let latestBuyTime = 0;
      let recentSellQty = 0;
      let recentSellProceeds = 0;
      let recentSellFees = 0;
      let latestSellTime = 0;
      let buyCountInternal = 0;
      let sellCountInternal = 0;

      for (const t of sorted) {
        const q = parseFloat(t.qty);
        const p = parseFloat(t.price);
        const comm = parseFloat(t.commission);
        let feeInUsd = 0;
        if (t.commissionAsset === 'USDT') feeInUsd = comm;
        else if (t.commissionAsset === 'BNB') feeInUsd = comm * bnbPrice;
        else if (String(cleanSymbol).startsWith(t.commissionAsset)) feeInUsd = comm * p;

        if (t.isBuyer) {
          if (currentQty <= 0) {
            recentSellQty = 0;
            recentSellProceeds = 0;
            recentSellFees = 0;
            sellCountInternal = 0;
            currentQty = 0;
            currentCost = 0;
            currentFees = 0;
            buyCountInternal = 0;
          }
          currentQty += q;
          currentCost += (q * p);
          currentFees += feeInUsd;
          if (t.time > latestBuyTime) latestBuyTime = t.time;
          buyCountInternal++;
        } else {
          recentSellQty += q;
          recentSellProceeds += (q * p);
          recentSellFees += feeInUsd;
          if (t.time > latestSellTime) latestSellTime = t.time;
          sellCountInternal++;

          if (currentQty > 0) {
            const avgPrice = currentCost / currentQty;
            currentQty -= q;
            
            const proportion = Math.max(0, currentQty / (currentQty + q));
            currentFees = currentFees * proportion;

            if (currentQty <= 0) {
              currentQty = 0;
              currentCost = 0;
              currentFees = 0;
              buyCountInternal = 0; 
            } else {
              currentCost = currentQty * avgPrice;
            }
          }
        }
      }
      
      const buyTotalQty = currentQty;
      const buyTotalCost = currentCost;
      const buyTotalFees = currentFees;
      const sellTotalQty = recentSellQty;
      const sellTotalProceeds = recentSellProceeds;
      const sellTotalFees = recentSellFees;
      const buyCountFinal = buyCountInternal;
      const sellCountFinal = sellCountInternal;
      
      let _buyTotalQty = 0;
      let _buyTotalCost = 0;
      let _buyTotalFees = 0;
      let _latestBuyTime = 0;
      for (const b of openBuys) {`;
          
code = code.replace(targetResponse, replaceResponse);

fs.writeFileSync('server.ts', code);
console.log("Fixed algorithm bounds in server.ts");
