const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const targetAnalyzeTrade = `      let buyTotalQty = 0;
      let buyTotalCost = 0;
      let buyTotalFees = 0;
      let latestBuyTime = 0;
      for (const b of openBuys) {
        const q = parseFloat(b.qty);
        const p = parseFloat(b.price);
        buyTotalQty += q;
        buyTotalCost += (q * p);
        if (b.time > latestBuyTime) latestBuyTime = b.time;
        const comm = parseFloat(b.commission);
        if (b.commissionAsset === 'USDT') {
          buyTotalFees += comm;
        } else if (b.commissionAsset === 'BNB') {
          buyTotalFees += (comm * bnbPrice);
        } else if (String(cleanSymbol).startsWith(b.commissionAsset)) {
          buyTotalFees += (comm * p);
        }
      }

      const exitSells = sorted.slice(lastBuyIdx + 1).filter((t: any) => !t.isBuyer);
      let sellTotalQty = 0;
      let sellTotalProceeds = 0;
      let sellTotalFees = 0;
      let latestSellTime = 0;
      for (const s of exitSells) {
        const q = parseFloat(s.qty);
        const p = parseFloat(s.price);
        sellTotalQty += q;
        sellTotalProceeds += (q * p);
        if (s.time > latestSellTime) latestSellTime = s.time;
        const comm = parseFloat(s.commission);
        if (s.commissionAsset === 'USDT') {
          sellTotalFees += comm;
        } else if (s.commissionAsset === 'BNB') {
          sellTotalFees += (comm * bnbPrice);
        } else if (String(symbol).startsWith(s.commissionAsset)) {
          sellTotalFees += (comm * p);
        }
      }`;

const replaceAnalyzeTrade = `      let currentQty = 0;
      let currentCost = 0;
      let currentFees = 0;
      let latestBuyTime = 0;
      let recentSellQty = 0;
      let recentSellProceeds = 0;
      let recentSellFees = 0;
      let latestSellTime = 0;
      let buyCount = 0;
      let sellCount = 0;

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
            sellCount = 0;
            currentQty = 0;
            currentCost = 0;
            currentFees = 0;
            buyCount = 0;
          }
          currentQty += q;
          currentCost += (q * p);
          currentFees += feeInUsd;
          if (t.time > latestBuyTime) latestBuyTime = t.time;
          buyCount++;
        } else {
          recentSellQty += q;
          recentSellProceeds += (q * p);
          recentSellFees += feeInUsd;
          if (t.time > latestSellTime) latestSellTime = t.time;
          sellCount++;

          if (currentQty > 0) {
            const avgPrice = currentCost / currentQty;
            currentQty -= q;
            
            const proportion = Math.max(0, currentQty / (currentQty + q));
            currentFees = currentFees * proportion;

            if (currentQty <= 0) {
              currentQty = 0;
              currentCost = 0;
              currentFees = 0;
              buyCount = 0; 
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
      const sellTotalFees = recentSellFees;`;

code = code.replace(targetAnalyzeTrade, replaceAnalyzeTrade);

fs.writeFileSync('server.ts', code);
console.log("Fixed algorithm bounds in server.ts");
