const fs = require('fs');
let code = fs.readFileSync('src/components/History.tsx', 'utf-8');

// The Realized Net PNL display for expanded view
// Add a fallback condition: if trade.status === 'CLOSED_MANUAL', display realizedProfitUsd even if it's 0.
const realizedPnlDisplayOld = `{trade.realizedProfitUsd && trade.realizedProfitUsd >= 0 ? '+' : ''}{formatCurrency(trade.realizedProfitUsd || 0)}`;
const realizedPnlDisplayNew = `{(trade.realizedProfitUsd !== undefined && trade.realizedProfitUsd >= 0) ? '+' : ''}{formatCurrency(trade.realizedProfitUsd || 0)}`;
code = code.split(realizedPnlDisplayOld).join(realizedPnlDisplayNew);

// Add fee display if feeUsd exists
const pnlBlockOld = `                       <div className={\`text-xs px-1.5 py-0.5 rounded font-bold \${trade.realizedProfitUsd && trade.realizedProfitUsd >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}\`}>
                         {trade.riskAmount > 0 ? ((trade.realizedProfitUsd || 0) / trade.riskAmount).toFixed(2) : 0}R
                       </div>
                     </div>
                     <div className="text-[10px] text-neutral-500 mt-0.5">{formatPkr((trade.realizedProfitUsd || 0) * trPkrRate)}</div>
                   </div>`;

const pnlBlockNew = `                       <div className={\`text-xs px-1.5 py-0.5 rounded font-bold \${(trade.realizedProfitUsd !== undefined && trade.realizedProfitUsd >= 0) ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}\`}>
                         {trade.riskAmount > 0 ? ((trade.realizedProfitUsd || 0) / trade.riskAmount).toFixed(2) : 0}R
                       </div>
                     </div>
                     <div className="text-[10px] text-neutral-500 mt-0.5 flex items-center justify-end gap-2">
                       {trade.feeUsd ? <span className="text-red-400/80">Fee: ${'$'}{trade.feeUsd.toFixed(4)}</span> : null}
                       <span>{formatPkr((trade.realizedProfitUsd || 0) * trPkrRate)}</span>
                     </div>
                   </div>`;
code = code.replace(pnlBlockOld, pnlBlockNew);

fs.writeFileSync('src/components/History.tsx', code);
