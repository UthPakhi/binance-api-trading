const fs = require('fs');
let code = fs.readFileSync('src/components/History.tsx', 'utf-8');

const targetCompactSymbol = `                  <h3 className="text-sm font-bold text-neutral-100">{trade.symbol || 'UNNAMED'}</h3>`;
const replaceCompactSymbol = `                  {(() => {
                    const currentPrice = livePrices[trade.symbol];
                    let symbolColor = "text-neutral-100";
                    if (tStatus === 'ACTIVE' && currentPrice) {
                       const currentPnL = calculateLivePnL(trade, currentPrice);
                       symbolColor = currentPnL >= 0 ? "text-emerald-400" : "text-red-400";
                    }
                    return <h3 className={\`text-sm font-bold \${symbolColor}\`}>{trade.symbol || 'UNNAMED'}</h3>;
                  })()}`;

const targetExpandedSymbol = `              <h3 className="text-sm font-bold text-neutral-100">{trade.symbol || 'UNNAMED'}</h3>`;
const replaceExpandedSymbol = `              {(() => {
                const currentPrice = livePrices[trade.symbol];
                let symbolColor = "text-neutral-100";
                if (tStatus === 'ACTIVE' && currentPrice) {
                   const currentPnL = calculateLivePnL(trade, currentPrice);
                   symbolColor = currentPnL >= 0 ? "text-emerald-400" : "text-red-400";
                }
                return <h3 className={\`text-sm font-bold \${symbolColor}\`}>{trade.symbol || 'UNNAMED'}</h3>;
              })()}`;

code = code.replace(targetCompactSymbol, replaceCompactSymbol);
code = code.replace(targetExpandedSymbol, replaceExpandedSymbol);

const targetCompactLivePnl = `                     const currentPnL = calculateLivePnL(trade, currentPrice);
                     return (
                       <>
                         <span className="text-[10px] text-neutral-500 uppercase font-semibold">Live PnL</span>
                         <span className={\`text-sm font-bold \${currentPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}\`}>
                            {currentPnL >= 0 ? '+' : ''}{formatCurrency(currentPnL)}
                         </span>
                       </>`;

const replaceCompactLivePnl = `                     const currentPnL = calculateLivePnL(trade, currentPrice);
                     const pnlPercent = calculateLivePnLPercent(trade, currentPrice);
                     return (
                       <>
                         <span className="text-[10px] text-neutral-500 uppercase font-semibold">Live PnL</span>
                         <span className={\`text-sm font-bold whitespace-nowrap flex items-center gap-1 \${currentPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}\`}>
                            {currentPnL >= 0 ? '+' : '-'}{formatCurrency(Math.abs(currentPnL))}
                            <span className="text-[10px] font-normal opacity-80">
                               ({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%)
                            </span>
                         </span>
                       </>`;

code = code.replace(targetCompactLivePnl, replaceCompactLivePnl);

const targetExpandedLivePnl = `                        <div className="flex items-center justify-end gap-2">
                          <div className={\`text-sm font-bold \${currentPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}\`}>
                            {formatCurrency(currentPnL)} <span className="text-xs font-normal">({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%)</span>
                          </div>
                        </div>`;

const replaceExpandedLivePnl = `                        <div className="flex items-center justify-end gap-2">
                          <div className={\`text-sm font-bold whitespace-nowrap \${currentPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}\`}>
                            {currentPnL >= 0 ? '+' : '-'}{formatCurrency(Math.abs(currentPnL))} <span className="text-xs font-normal">({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%)</span>
                          </div>
                        </div>`;

code = code.replace(targetExpandedLivePnl, replaceExpandedLivePnl);

const targetGridLivePnl = `                    <span className="text-neutral-500 text-[11px] uppercase font-semibold block mb-1">Live PnL</span>
                    <span className={\`font-bold flex items-center gap-2 \${currentPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}\`}>
                      {currentPnL >= 0 ? '+' : ''}{formatCurrency(currentPnL)}`;

const replaceGridLivePnl = `                    <span className="text-neutral-500 text-[11px] uppercase font-semibold block mb-1">Live PnL</span>
                    <span className={\`font-bold flex items-center gap-2 whitespace-nowrap \${currentPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}\`}>
                      {currentPnL >= 0 ? '+' : '-'}{formatCurrency(Math.abs(currentPnL))}`;

code = code.replace(targetGridLivePnl, replaceGridLivePnl);

fs.writeFileSync('src/components/History.tsx', code);
console.log("Updated History UI components!");
