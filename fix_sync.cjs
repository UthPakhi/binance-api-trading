const fs = require('fs');
let code = fs.readFileSync('src/lib/TradeContext.tsx', 'utf-8');

const target = `          if (localQty > 0 && newQty < localQty * 0.99) {
             // Partial close!
             const closedQty = localQty - newQty;
             const pnlAdded = (bp.currentPrice - trade.entryPrice) * closedQty;
             updates.realizedProfitUsd = (trade.realizedProfitUsd || 0) + pnlAdded;
             updates.notes = (trade.notes ? trade.notes + '\\n' : '') + \`Auto-synced: Partially closed \${closedQty.toFixed(4)} at ~\${bp.currentPrice.toFixed(2)}\`;
             toast.success(\`\${trade.symbol} Auto-synced partial exit!\`, { icon: '📉' });
           }`;

const replacement = `          if (bp.realizedProfitUsd !== undefined && Math.abs((trade.realizedProfitUsd || 0) - bp.realizedProfitUsd) > 0.1) {
             updates.realizedProfitUsd = bp.realizedProfitUsd;
          }

          if (localQty > 0 && newQty < localQty * 0.99) {
             // Partial close!
             const closedQty = localQty - newQty;
             updates.notes = (trade.notes ? trade.notes + '\\n' : '') + \`Auto-synced: Partially closed \${closedQty.toFixed(4)}\`;
             toast.success(\`\${trade.symbol} Auto-synced partial exit!\`, { icon: '📉' });
           }`;

code = code.replace(target, replacement);
fs.writeFileSync('src/lib/TradeContext.tsx', code);
