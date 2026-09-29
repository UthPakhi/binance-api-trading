const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const targetPositions = `               const qs = \`symbol=\${symbol}&limit=50&timestamp=\${ts}\`;
               const sig = crypto.createHmac('sha256', apiSecret).update(qs).digest('hex');
               const tradesRes = await fetch(\`https://api.binance.com/api/v3/myTrades?\${qs}&signature=\${sig}\`, {
                  headers: { 'X-MBX-APIKEY': apiKey }
               });
               if (tradesRes.ok) {
                  const trades: any = await tradesRes.json();
                  const sorted = [...trades].sort((a: any, b: any) => a.time - b.time);
                  let lastSellIdx = -1;
                  for (let i = sorted.length - 1; i >= 0; i--) {
                    if (!sorted[i].isBuyer) {
                      lastSellIdx = i;
                      break;
                    }
                  }
                  const openBuys = sorted.slice(lastSellIdx + 1).filter((t: any) => t.isBuyer);
                  if (openBuys.length > 0) {
                     let totalBuyQty = 0;
                     let totalBuyCost = 0;
                     let totalBuyFee = 0;
                     const bnbPrice: number = Number(priceMap.get("BNBUSDT") || 600);
                     for (const b of openBuys) {
                        const q = parseFloat(b.qty);
                        const p = parseFloat(b.price);
                        totalBuyQty += q;
                        totalBuyCost += (q * p);
                        const comm = parseFloat(b.commission);
                        if (b.commissionAsset === 'USDT') {
                           totalBuyFee += comm;
                        } else if (b.commissionAsset === 'BNB') {
                           totalBuyFee += (comm * bnbPrice);
                        } else if (symbol.startsWith(b.commissionAsset)) {
                           totalBuyFee += (comm * p);
                        }
                     }
                     if (totalBuyQty > 0) {
                        entryPrice = totalBuyCost / totalBuyQty;
                        feeUsd = totalBuyFee;
                     }
                  }
               }`;

const replacePositions = `               const qs = \`symbol=\${symbol}&limit=1000&timestamp=\${ts}\`;
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
               }`;

code = code.replace(targetPositions, replacePositions);
fs.writeFileSync('server.ts', code);
console.log("Updated positions logic in server.ts");
