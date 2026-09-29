const fs = require('fs');
let code = fs.readFileSync('src/components/History.tsx', 'utf-8');

const targetExpandedLivePnl = `                      <>
                        <div className="flex items-center justify-end gap-2">
                          <div className={\`text-sm font-bold \${currentPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}\`}>
                            {formatCurrency(currentPnL)} <span className="text-xs font-normal">({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%)</span>
                          </div>
                        </div>
                        <div className="text-[10px] text-neutral-500 mt-0.5">{formatPkr(currentPnL * trPkrRate)}</div>
                      </>`;
                      
const replaceExpandedLivePnl = `                      <>
                        <div className="flex items-center justify-end gap-2">
                          <div className={\`text-sm font-bold \${currentPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}\`}>
                            {formatCurrency(currentPnL)} <span className="text-xs font-normal">({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%)</span>
                          </div>
                        </div>
                        <div className="text-[10px] text-neutral-500 mt-0.5">{formatPkr(currentPnL * trPkrRate)}</div>
                        {(trade.realizedProfitUsd !== undefined && trade.realizedProfitUsd !== 0) && (
                          <div className="text-[9px] text-neutral-500 mt-1">
                            Includes {trade.realizedProfitUsd > 0 ? '+' : ''}{formatCurrency(trade.realizedProfitUsd)} realized
                          </div>
                        )}
                      </>`;

code = code.replace(targetExpandedLivePnl, replaceExpandedLivePnl);
fs.writeFileSync('src/components/History.tsx', code);
