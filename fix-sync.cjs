const fs = require('fs');
let code = fs.readFileSync('src/components/History.tsx', 'utf8');

const targetBlock = `      // 1. If trade is currently active or pending:
      if (trade.status === 'ACTIVE' || trade.status === 'PENDING') {
        // Did the user close/sell this position on Binance?
        if (openBuys.count === 0 && recentSells.count > 0) {
          const realizedPnL = recentSells.totalProceeds - (recentSells.totalQty * trade.entryPrice) - recentSells.feesUsd;
          await updateDoc(doc(db, 'trades', trade.id), {
            status: 'CLOSED_MANUAL',
            realizedProfitUsd: realizedPnL,
            feeUsd: (trade.feeUsd || 0) + recentSells.feesUsd,
            closedAt: recentSells.time || Date.now(),
            notes: (trade.notes ? trade.notes + '\\n' : '') + \`Synced: Exited \${recentSells.totalQty.toFixed(4)} @ ~$\${recentSells.avgExitPrice.toFixed(4)}\`
          });
          toast.success(\`Closed on Binance! Exited at $\${recentSells.avgExitPrice.toFixed(4)} (PnL: $\${realizedPnL.toFixed(2)})\`, { id: toastId });
          return;
        }

        // Otherwise, sync the BUY data (running trade buy fills & fees)
        if (openBuys.count > 0) {
          await updateDoc(doc(db, 'trades', trade.id), {
            status: 'ACTIVE',
            entryPrice: openBuys.avgEntryPrice,
            positionSizeCoins: openBuys.totalQty,
            totalBuyUsd: openBuys.totalCost,
            feeUsd: openBuys.feesUsd,
            filledAt: openBuys.time || trade.filledAt || Date.now(),
            notes: (trade.notes ? trade.notes + '\\n' : '') + \`Synced \${openBuys.count} buy fill(s): Avg $\${openBuys.avgEntryPrice.toFixed(4)}\`
          });
          toast.success(\`Synced Running Trade: \${openBuys.totalQty.toFixed(4)} coins @ $\${openBuys.avgEntryPrice.toFixed(4)} (Fee: $\${openBuys.feesUsd.toFixed(4)})\`, { id: toastId });
          return;
        }

        toast.error(\`No recent executions found on Binance for \${trade.symbol}.\`, { id: toastId });
        return;
      }`;

const replacementBlock = `      // 1. If trade is currently active or pending:
      if (trade.status === 'ACTIVE' || trade.status === 'PENDING') {
        let updatePayload: any = {};
        let syncMessages: string[] = [];
        let modified = false;

        // Did the user close/sell this position on Binance?
        if (openBuys.count === 0 && recentSells.count > 0) {
          const realizedPnL = recentSells.totalProceeds - (recentSells.totalQty * trade.entryPrice) - recentSells.feesUsd;
          await updateDoc(doc(db, 'trades', trade.id), {
            status: 'CLOSED_MANUAL',
            realizedProfitUsd: realizedPnL,
            feeUsd: (trade.feeUsd || 0) + recentSells.feesUsd,
            closedAt: recentSells.time || Date.now(),
            notes: (trade.notes ? trade.notes + '\\n' : '') + \`Synced: Exited \${recentSells.totalQty.toFixed(4)} @ ~$\${recentSells.avgExitPrice.toFixed(4)}\`
          });
          toast.success(\`Closed on Binance! Exited at $\${recentSells.avgExitPrice.toFixed(4)} (PnL: $\${realizedPnL.toFixed(2)})\`, { id: toastId });
          return;
        }

        // Sync open buys
        if (openBuys.count > 0) {
          updatePayload.status = 'ACTIVE';
          updatePayload.entryPrice = openBuys.avgEntryPrice;
          updatePayload.positionSizeCoins = openBuys.totalQty;
          updatePayload.totalBuyUsd = openBuys.totalCost;
          updatePayload.feeUsd = openBuys.feesUsd;
          updatePayload.filledAt = openBuys.time || trade.filledAt || Date.now();
          updatePayload.notes = (trade.notes ? trade.notes + '\\n' : '') + \`Synced \${openBuys.count} buy fill(s): Avg $\${openBuys.avgEntryPrice.toFixed(4)}\`;
          syncMessages.push(\`Buys: \${openBuys.totalQty.toFixed(4)} @ $\${openBuys.avgEntryPrice.toFixed(4)}\`);
          modified = true;
        }

        // FETCH OPEN ORDERS FOR TP/SL SYNC
        try {
          const ordersRes = await fetch(\`/api/binance/openOrders?symbol=\${encodeURIComponent(trade.symbol.trim())}\`);
          const ordersData = await ordersRes.json();
          if (ordersData.status === 'success' && Array.isArray(ordersData.orders)) {
             const sellOrders = ordersData.orders.filter((o: any) => o.side === 'SELL');
             const limitOrders = sellOrders.filter((o: any) => o.type === 'LIMIT' || o.type === 'LIMIT_MAKER');
             const stopOrders = sellOrders.filter((o: any) => o.type.includes('STOP'));
             
             const totalCoins = updatePayload.positionSizeCoins || trade.positionSizeCoins;
             
             if (totalCoins > 0 && sellOrders.length > 0) {
               let tp1Pct = 0, tp2Pct = 0, tp3Pct = 0;
               let tp1 = trade.takeProfit1 || 0;
               let tp2 = trade.takeProfit2 || 0;
               let tp3 = trade.takeProfit3 || 0;
               
               let matchedOrders = new Set();
               
               limitOrders.forEach((o: any) => {
                 const price = parseFloat(o.price);
                 const qty = parseFloat(o.origQty);
                 const pct = Math.round((qty / totalCoins) * 100);
                 
                 const diff1 = tp1 ? Math.abs(price - tp1) / tp1 : 1;
                 const diff2 = tp2 ? Math.abs(price - tp2) / tp2 : 1;
                 const diff3 = tp3 ? Math.abs(price - tp3) / tp3 : 1;
                 
                 if (tp1 && diff1 < 0.02) { tp1Pct += pct; tp1 = price; matchedOrders.add(o.orderId); }
                 else if (tp2 && diff2 < 0.02) { tp2Pct += pct; tp2 = price; matchedOrders.add(o.orderId); }
                 else if (tp3 && diff3 < 0.02) { tp3Pct += pct; tp3 = price; matchedOrders.add(o.orderId); }
               });
               
               limitOrders.forEach((o: any) => {
                 if (matchedOrders.has(o.orderId)) return;
                 const price = parseFloat(o.price);
                 const qty = parseFloat(o.origQty);
                 const pct = Math.round((qty / totalCoins) * 100);
                 
                 if (!tp1 || tp1Pct === 0) { tp1 = price; tp1Pct = pct; }
                 else if (!tp2 || tp2Pct === 0) { tp2 = price; tp2Pct = pct; }
                 else if (!tp3 || tp3Pct === 0) { tp3 = price; tp3Pct = pct; }
               });
               
               updatePayload.takeProfit1 = tp1;
               updatePayload.tp1Percent = Math.min(tp1Pct, 100);
               updatePayload.takeProfit2 = tp2;
               updatePayload.tp2Percent = Math.min(tp2Pct, 100);
               updatePayload.takeProfit3 = tp3;
               updatePayload.tp3Percent = Math.min(tp3Pct, 100);
               modified = true;
               syncMessages.push('TPs/SL');
               
               if (stopOrders.length > 0) {
                 const slPrice = parseFloat(stopOrders[0].stopPrice || stopOrders[0].price);
                 if (slPrice > 0) {
                   updatePayload.stopLoss = slPrice;
                 }
               }
             }
          }
        } catch (err) {
           console.warn('Open orders fetch failed', err);
        }

        if (modified) {
          await updateDoc(doc(db, 'trades', trade.id), updatePayload);
          toast.success(\`Synced: \${syncMessages.join(', ')}\`, { id: toastId });
        } else {
          toast.error(\`No recent executions or open orders found on Binance for \${trade.symbol}.\`, { id: toastId });
        }
        return;
      }`;

code = code.replace(targetBlock, replacementBlock);
if (code.includes(replacementBlock)) {
  fs.writeFileSync('src/components/History.tsx', code);
  console.log('Successfully replaced logic');
} else {
  console.log('Failed to match target block');
}
