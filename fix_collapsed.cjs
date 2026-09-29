const fs = require('fs');
let code = fs.readFileSync('src/components/History.tsx', 'utf-8');

const targetCollapsedInfo = `                <div className="text-xs text-neutral-500 flex items-center gap-2">
                  <span>Ent: <strong className="text-neutral-300">{formatPrice(trade.entryPrice, true)}</strong></span>
                  <span>Size: <strong className="text-blue-400">{formatCurrency(trade.totalBuyUsd || trade.positionSize || 0)}</strong></span>
                </div>`;
                
const replaceCollapsedInfo = `                <div className="text-xs text-neutral-500 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>Ent: <strong className="text-neutral-300">{formatPrice(trade.entryPrice, true)}</strong></span>
                  {tStatus === 'ACTIVE' && livePrices[trade.symbol] && (
                    <span>Live: <strong className="text-blue-300">{formatPrice(livePrices[trade.symbol])}</strong></span>
                  )}
                  <span>Size: <strong className="text-blue-400">{formatCurrency(trade.totalBuyUsd || trade.positionSize || 0)}</strong></span>
                </div>`;

code = code.replace(targetCollapsedInfo, replaceCollapsedInfo);

fs.writeFileSync('src/components/History.tsx', code);
console.log("Added live price to collapsed view");
