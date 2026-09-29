const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const targetAnalyzeTrade = `      for (const t of sorted) {
        const q = parseFloat(t.qty);
        const p = parseFloat(t.price);
        const comm = parseFloat(t.commission);
        let feeInUsd = 0;
        if (t.commissionAsset === 'USDT') feeInUsd = comm;
        else if (t.commissionAsset === 'BNB') feeInUsd = comm * bnbPrice;
        else if (String(cleanSymbol).startsWith(t.commissionAsset)) feeInUsd = comm * p;

        if (t.isBuyer) {
          if (currentQty === 0) {
            // Reset recent sells if we are starting a fresh position
            recentSellQty = 0;
            recentSellProceeds = 0;
            recentSellFees = 0;
            sellCount = 0;
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
      }`;

const replaceAnalyzeTrade = `      for (const t of sorted) {
        const q = parseFloat(t.qty);
        const p = parseFloat(t.price);
        const comm = parseFloat(t.commission);
        let feeInUsd = 0;
        if (t.commissionAsset === 'USDT') feeInUsd = comm;
        else if (t.commissionAsset === 'BNB') feeInUsd = comm * bnbPrice;
        else if (String(cleanSymbol).startsWith(t.commissionAsset)) feeInUsd = comm * p;

        if (t.isBuyer) {
          if (currentQty <= 0) {
            // Reset recent sells if we are starting a fresh position
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
      }`;
code = code.replace(targetAnalyzeTrade, replaceAnalyzeTrade);

const targetPositions = `                  for (const b of sorted) {
                     const q = parseFloat(b.qty);
                     const p = parseFloat(b.price);
                     const comm = parseFloat(b.commission);
                     
                     if (b.isBuyer) {
                        currentQty += q;
                        currentCost += (q * p);
                        
                        let feeInUsd = 0;
                        if (b.commissionAsset === 'USDT') feeInUsd = comm;
                        else if (b.commissionAsset === 'BNB') feeInUsd = comm * bnbPrice;
                        else if (symbol.startsWith(b.commissionAsset)) feeInUsd = comm * p;
                        
                        currentFee += feeInUsd;
                     } else {
                        if (currentQty > 0) {
                           const avgPrice = currentCost / currentQty;
                           currentQty -= q;
                           
                           const proportion = Math.max(0, currentQty / (currentQty + q));
                           currentFee = currentFee * proportion;

                           if (currentQty <= 0) {
                              currentQty = 0;
                              currentCost = 0;
                              currentFee = 0;
                           } else {
                              currentCost = currentQty * avgPrice;
                           }
                        }
                     }
                  }`;
                  
const replacePositions = `                  for (const b of sorted) {
                     const q = parseFloat(b.qty);
                     const p = parseFloat(b.price);
                     const comm = parseFloat(b.commission);
                     
                     if (b.isBuyer) {
                        if (currentQty <= 0) {
                           currentQty = 0;
                           currentCost = 0;
                           currentFee = 0;
                        }
                        currentQty += q;
                        currentCost += (q * p);
                        
                        let feeInUsd = 0;
                        if (b.commissionAsset === 'USDT') feeInUsd = comm;
                        else if (b.commissionAsset === 'BNB') feeInUsd = comm * bnbPrice;
                        else if (symbol.startsWith(b.commissionAsset)) feeInUsd = comm * p;
                        
                        currentFee += feeInUsd;
                     } else {
                        if (currentQty > 0) {
                           const avgPrice = currentCost / currentQty;
                           currentQty -= q;
                           
                           const proportion = Math.max(0, currentQty / (currentQty + q));
                           currentFee = currentFee * proportion;

                           if (currentQty <= 0) {
                              currentQty = 0;
                              currentCost = 0;
                              currentFee = 0;
                           } else {
                              currentCost = currentQty * avgPrice;
                           }
                        }
                     }
                  }`;
code = code.replace(targetPositions, replacePositions);

fs.writeFileSync('server.ts', code);
console.log("Fixed algorithm bounds in server.ts");
