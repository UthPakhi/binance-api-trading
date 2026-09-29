const fs = require('fs');
let code = fs.readFileSync('src/components/History.tsx', 'utf-8');

const targetCompactHeader = `                  {(() => {
                    const currentPrice = livePrices[trade.symbol];
                    let symbolColor = "text-neutral-100";
                    if (tStatus === 'ACTIVE' && currentPrice) {
                       const currentPnL = calculateLivePnL(trade, currentPrice);
                       symbolColor = currentPnL >= 0 ? "text-emerald-400" : "text-red-400";
                    }
                    return <h3 className={\`text-sm font-bold \${symbolColor}\`}>{trade.symbol || 'UNNAMED'}</h3>;
                  })()}
                  <span className={\`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full border \${statusColors[tStatus]}\`}>
                    {statusLabels[tStatus] || tStatus}
                  </span>`;

const replaceCompactHeader = `                  <h3 className="text-sm font-bold text-neutral-100">{trade.symbol || 'UNNAMED'}</h3>
                  {(() => {
                    const currentPrice = livePrices[trade.symbol];
                    let badgeClass = statusColors[tStatus];
                    if (tStatus === 'ACTIVE' && currentPrice) {
                       const currentPnL = calculateLivePnL(trade, currentPrice);
                       badgeClass = currentPnL >= 0 ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-red-500/20 text-red-400 border-red-500/30";
                    }
                    return (
                      <span className={\`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full border \${badgeClass}\`}>
                        {statusLabels[tStatus] || tStatus}
                      </span>
                    );
                  })()}`;

const targetExpandedHeader = `              {(() => {
                const currentPrice = livePrices[trade.symbol];
                let symbolColor = "text-neutral-100";
                if (tStatus === 'ACTIVE' && currentPrice) {
                   const currentPnL = calculateLivePnL(trade, currentPrice);
                   symbolColor = currentPnL >= 0 ? "text-emerald-400" : "text-red-400";
                }
                return <h3 className={\`text-sm font-bold \${symbolColor}\`}>{trade.symbol || 'UNNAMED'}</h3>;
              })()}
              <span className={\`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border \${statusColors[tStatus]}\`}>
                {statusLabels[tStatus] || tStatus}
              </span>`;

const replaceExpandedHeader = `              <h3 className="text-sm font-bold text-neutral-100">{trade.symbol || 'UNNAMED'}</h3>
              {(() => {
                const currentPrice = livePrices[trade.symbol];
                let badgeClass = statusColors[tStatus];
                if (tStatus === 'ACTIVE' && currentPrice) {
                   const currentPnL = calculateLivePnL(trade, currentPrice);
                   badgeClass = currentPnL >= 0 ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-red-500/20 text-red-400 border-red-500/30";
                }
                return (
                  <span className={\`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border \${badgeClass}\`}>
                    {statusLabels[tStatus] || tStatus}
                  </span>
                );
              })()}`;

code = code.replace(targetCompactHeader, replaceCompactHeader);
code = code.replace(targetExpandedHeader, replaceExpandedHeader);

fs.writeFileSync('src/components/History.tsx', code);
console.log("Updated History UI components!");
