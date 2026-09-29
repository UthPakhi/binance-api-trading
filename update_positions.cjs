const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const targetLoop = `                  let currentQty = 0;
                  let currentCost = 0;
                  let currentFee = 0;
                  const bnbPrice: number = Number(priceMap.get("BNBUSDT") || 600);

                  for (const b of sorted) {
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
                  }

                  if (currentQty > 0) {
                     entryPrice = currentCost / currentQty;
                     feeUsd = currentFee;
                  }`;

const replacementLoop = `                  let currentQty = 0;
                  let currentCost = 0;
                  let currentFee = 0;
                  let currentRealized = 0;
                  const bnbPrice: number = Number(priceMap.get("BNBUSDT") || 600);

                  for (const b of sorted) {
                     const q = parseFloat(b.qty);
                     const p = parseFloat(b.price);
                     const comm = parseFloat(b.commission);
                     
                     let feeInUsd = 0;
                     if (b.commissionAsset === 'USDT') feeInUsd = comm;
                     else if (b.commissionAsset === 'BNB') feeInUsd = comm * bnbPrice;
                     else if (symbol.startsWith(b.commissionAsset)) feeInUsd = comm * p;

                     if (b.isBuyer) {
                        if (currentQty <= 0) {
                           currentQty = 0;
                           currentCost = 0;
                           currentFee = 0;
                           currentRealized = 0;
                        }
                        currentQty += q;
                        currentCost += (q * p);
                        currentFee += feeInUsd;
                     } else {
                        if (currentQty > 0) {
                           const avgPrice = currentCost / currentQty;
                           const soldQty = Math.min(q, currentQty);
                           const profitPerCoin = p - avgPrice;
                           
                           currentRealized += (soldQty * profitPerCoin) - feeInUsd;
                           
                           currentQty -= q;
                           
                           const proportion = Math.max(0, currentQty / (currentQty + q));
                           currentFee = currentFee * proportion;

                           if (currentQty <= 0) {
                              currentQty = 0;
                              currentCost = 0;
                              currentFee = 0;
                              currentRealized = 0;
                           } else {
                              currentCost = currentQty * avgPrice;
                           }
                        }
                     }
                  }

                  if (currentQty > 0) {
                     entryPrice = currentCost / currentQty;
                     feeUsd = currentFee;
                  }`;

code = code.replace(targetLoop, replacementLoop);

const targetPush = `            positions.push({
               symbol: symbol,
               positionAmt: totalAmt,
               entryPrice: entryPrice,
               feeUsd: feeUsd,
               isLong: true,
               unRealizedProfit: (currentPrice - entryPrice) * totalAmt,
               leverage: 1, // Spot is 1x
               currentPrice,
               usdValue
            });`;

const replacementPush = `            positions.push({
               symbol: symbol,
               positionAmt: totalAmt,
               entryPrice: entryPrice,
               feeUsd: feeUsd,
               realizedProfitUsd: currentRealized || 0,
               isLong: true,
               unRealizedProfit: (currentPrice - entryPrice) * totalAmt,
               leverage: 1, // Spot is 1x
               currentPrice,
               usdValue
            });`;

// Because currentRealized is scoped inside the try block, we need to declare it before try block if we push it outside.
// Let's modify the code carefully.
