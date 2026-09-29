const fs = require('fs');
let code = fs.readFileSync('src/components/History.tsx', 'utf-8');

const riskOld = `<span className="text-neutral-500 text-[11px] uppercase font-semibold block mb-1">Risk (Loss)</span>
                  <span className="text-red-400 font-bold flex items-center gap-2">
                    {formatCurrency(trade.riskAmount)}
                    <span className="text-red-500/70 text-xs font-normal bg-red-500/10 px-1 rounded">
                      -1.00R
                    </span>
                  </span>`;
                  
const riskNew = `<span className="text-neutral-500 text-[11px] uppercase font-semibold block mb-1">Risk (Loss)</span>
                  <span className="text-red-400 font-bold flex flex-wrap items-center gap-1.5">
                    {formatCurrency(trade.riskAmount)}
                    <span className="text-red-500/70 text-xs font-normal bg-red-500/10 px-1 rounded">
                      -1.00R
                    </span>
                    {trade.portfolioSize ? (
                      <span className="text-neutral-500 text-[10px]">
                        ({((trade.riskAmount / trade.portfolioSize) * 100).toFixed(2)}%)
                      </span>
                    ) : null}
                  </span>`;
code = code.replace(riskOld, riskNew);
fs.writeFileSync('src/components/History.tsx', code);
