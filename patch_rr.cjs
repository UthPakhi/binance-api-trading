const fs = require('fs');
let code = fs.readFileSync('src/components/History.tsx', 'utf-8');

const riskSearch = `                <div>
                  <span className="text-neutral-500 text-[11px] uppercase font-semibold block mb-1">Risk (Loss)</span>
                  <span className="text-red-400 font-bold block">{formatCurrency(trade.riskAmount)}</span>
                  <span className="text-red-500/70 text-[9px] block">1.00R</span>
                </div>`;

const riskReplace = `                <div>
                  <span className="text-neutral-500 text-[11px] uppercase font-semibold block mb-1">Risk (Loss)</span>
                  <span className="text-red-400 font-bold flex items-center gap-2">
                    {formatCurrency(trade.riskAmount)}
                    <span className="text-red-500/70 text-xs font-normal bg-red-500/10 px-1 rounded">
                      -1.00R
                    </span>
                  </span>
                </div>`;

code = code.replace(riskSearch, riskReplace);

fs.writeFileSync('src/components/History.tsx', code);
