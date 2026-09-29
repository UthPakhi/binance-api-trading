const fs = require('fs');
let code = fs.readFileSync('src/components/History.tsx', 'utf-8');

const searchStr = `                  <span className="text-emerald-400 font-bold block">
                    {formatCurrency(totalProfitUsd)} 
                  </span>`;

const replaceStr = `                  <span className="text-emerald-400 font-bold flex items-center gap-2">
                    {formatCurrency(totalProfitUsd)} 
                    <span className="text-emerald-500/70 text-xs font-normal bg-emerald-500/10 px-1 rounded">
                      {trade.riskAmount > 0 ? (totalProfitUsd / trade.riskAmount).toFixed(2) : 0}R
                    </span>
                  </span>`;

code = code.replace(searchStr, replaceStr);

fs.writeFileSync('src/components/History.tsx', code);
