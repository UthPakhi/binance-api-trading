const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const target = `            let entryPrice = currentPrice; 
            let feeUsd = 0;
            try {
               const ts = Date.now();
               const qs = \`symbol=\${symbol}&limit=1000&timestamp=\${ts}\`;
               const sig = crypto.createHmac('sha256', apiSecret).update(qs).digest('hex');
               const tradesRes = await fetch(\`https://api.binance.com/api/v3/myTrades?\${qs}&signature=\${sig}\`, {
                  headers: { 'X-MBX-APIKEY': apiKey }
               });
               if (tradesRes.ok) {
                  const trades: any = await tradesRes.json();
                  const sorted = [...trades].sort((a: any, b: any) => a.time - b.time);
                  
                  let currentQty = 0;
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
                  }
               }
            } catch (e) {
               console.warn(\`Could not fetch trades for \${symbol}\`);
            }
            positions.push({
               symbol: symbol,
               positionAmt: totalAmt,
               entryPrice: entryPrice,
               feeUsd: feeUsd,
               isLong: true,
               unRealizedProfit: (currentPrice - entryPrice) * totalAmt,
               leverage: 1, // Spot is 1x
               currentPrice: currentPrice,
               usdValue: usdValue
            });`;

const replacement = `            let entryPrice = currentPrice; 
            let feeUsd = 0;
            let realizedProfitUsd = 0;
            try {
               const ts = Date.now();
               const qs = \`symbol=\${symbol}&limit=1000&timestamp=\${ts}\`;
               const sig = crypto.createHmac('sha256', apiSecret).update(qs).digest('hex');
               const tradesRes = await fetch(\`https://api.binance.com/api/v3/myTrades?\${qs}&signature=\${sig}\`, {
                  headers: { 'X-MBX-APIKEY': apiKey }
               });
               if (tradesRes.ok) {
                  const trades: any = await tradesRes.json();
                  const sorted = [...trades].sort((a: any, b: any) => a.time - b.time);
                  
                  let currentQty = 0;
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
                     realizedProfitUsd = currentRealized;
                  }
               }
            } catch (e) {
               console.warn(\`Could not fetch trades for \${symbol}\`);
            }
            positions.push({
               symbol: symbol,
               positionAmt: totalAmt,
               entryPrice: entryPrice,
               feeUsd: feeUsd,
               realizedProfitUsd: realizedProfitUsd,
               isLong: true,
               unRealizedProfit: (currentPrice - entryPrice) * totalAmt,
               leverage: 1, // Spot is 1x
               currentPrice: currentPrice,
               usdValue: usdValue
            });`;

code = code.replace(target, replacement);
fs.writeFileSync('server.ts', code);
