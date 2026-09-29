const fs = require('fs');
let code = fs.readFileSync('src/components/History.tsx', 'utf-8');

const realizedBannerSearch = `
                   <div className="text-right">
                     <div className={\`text-sm font-bold \${trade.realizedProfitUsd && trade.realizedProfitUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}\`}>
                       {formatCurrency(trade.realizedProfitUsd || 0)}
                     </div>
                     <div className="text-[10px] text-neutral-500">{formatPkr((trade.realizedProfitUsd || 0) * trPkrRate)}</div>
                   </div>
`;

const realizedBannerReplace = `
                   <div className="text-right">
                     <div className="flex items-center justify-end gap-2">
                       <div className={\`text-sm font-bold \${trade.realizedProfitUsd && trade.realizedProfitUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}\`}>
                         {formatCurrency(trade.realizedProfitUsd || 0)}
                       </div>
                       <div className={\`text-xs px-1.5 py-0.5 rounded font-bold \${trade.realizedProfitUsd && trade.realizedProfitUsd >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}\`}>
                         {trade.riskAmount > 0 ? ((trade.realizedProfitUsd || 0) / trade.riskAmount).toFixed(2) : 0}R
                       </div>
                     </div>
                     <div className="text-[10px] text-neutral-500 mt-0.5">{formatPkr((trade.realizedProfitUsd || 0) * trPkrRate)}</div>
                   </div>
`;

code = code.replace(realizedBannerSearch.trim(), realizedBannerReplace.trim());

const liveBannerSearch = `
                              <div className={\`text-sm font-bold \${currentPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}\`}>
                                {formatCurrency(currentPnL)} <span className="text-xs font-normal">({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%)</span>
                              </div>
                              <div className="text-[10px] text-neutral-500">{formatPkr(currentPnL * trPkrRate)}</div>
`;

const liveBannerReplace = `
                              <div className="flex items-center justify-end gap-2">
                                <div className={\`text-sm font-bold \${currentPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}\`}>
                                  {formatCurrency(currentPnL)} <span className="text-xs font-normal">({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%)</span>
                                </div>
                                <div className={\`text-xs px-1.5 py-0.5 rounded font-bold \${currentPnL >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}\`}>
                                  {trade.riskAmount > 0 ? (currentPnL / trade.riskAmount).toFixed(2) : 0}R
                                </div>
                              </div>
                              <div className="text-[10px] text-neutral-500 mt-0.5">{formatPkr(currentPnL * trPkrRate)}</div>
`;

code = code.replace(liveBannerSearch.trim(), liveBannerReplace.trim());

const gridSearch = `
              <div className="grid grid-cols-2 gap-y-4 gap-x-4 text-sm mt-2">
                <div>
                  <span className="text-neutral-500 text-xs block mb-1">Expected Net Profit</span>
                  <span className="text-emerald-400 font-bold block">{formatCurrency(totalProfitUsd)}</span>
                  <span className="text-emerald-500/70 text-[10px] block">{formatPkr(totalProfitUsd * trPkrRate)}</span>
                  {trade.feeUsd ? <span className="text-neutral-500/70 text-[10px] block mt-0.5">Est. Fees: {formatCurrency(trade.feeUsd)}</span> : null}
                </div>
                <div>
                  <span className="text-neutral-500 text-xs block mb-1">Risk (Max Loss)</span>
                  <span className="text-red-400 font-bold block">{formatCurrency(trade.riskAmount)}</span>
                  <span className="text-red-500/70 text-[10px] block">{formatPkr(trade.riskAmount * trPkrRate)}</span>
                </div>
              </div>
`;

const gridReplace = `
              <div className="grid grid-cols-3 gap-y-4 gap-x-2 text-sm mt-2">
                <div>
                  <span className="text-neutral-500 text-[11px] uppercase font-semibold block mb-1">Net Profit (Est)</span>
                  <span className="text-emerald-400 font-bold block">
                    {formatCurrency(totalProfitUsd)} 
                  </span>
                  {trade.feeUsd ? <span className="text-neutral-500/70 text-[9px] block mt-0.5">Fees: {formatCurrency(trade.feeUsd)}</span> : null}
                </div>
                <div>
                  <span className="text-neutral-500 text-[11px] uppercase font-semibold block mb-1">Risk (Loss)</span>
                  <span className="text-red-400 font-bold block">{formatCurrency(trade.riskAmount)}</span>
                  <span className="text-red-500/70 text-[9px] block">1.00R</span>
                </div>
                <div>
                  <span className="text-neutral-500 text-[11px] uppercase font-semibold block mb-1">Total Buy Size</span>
                  <span className="text-blue-400 font-bold block">{formatCurrency(trade.totalBuyUsd || 0)}</span>
                  <span className="text-blue-500/70 text-[9px] block">{trade.positionSizeCoins ? trade.positionSizeCoins.toFixed(4) : 0} coins</span>
                </div>
              </div>
`;

code = code.replace(gridSearch.trim(), gridReplace.trim());

fs.writeFileSync('src/components/History.tsx', code);
