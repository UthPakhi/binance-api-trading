const fs = require('fs');
let code = fs.readFileSync('src/components/History.tsx', 'utf-8');

// Replace the handleSyncExecutions logic that closes the trade erroneously.
const target = `        // Did the user close/sell this position on Binance?
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
        }`;

const insert = `        // Note: We no longer auto-close the trade based purely on recentSells because it breaks partial closures. 
        // Real-time spot syncing handles closures via exact Spot Balances automatically every 15s.`;

code = code.replace(target, insert);
fs.writeFileSync('src/components/History.tsx', code);
console.log("Fixed History.tsx wand bug!");
