const fs = require('fs');

let code = fs.readFileSync('src/components/Calculator.tsx', 'utf-8');

// Find the start and end of the Targets section
const startPattern = /<div className="space-y-4">/;
const endPattern = /\{\!isPctValid && \(/;

const startIndex = code.indexOf('<div className="space-y-4">');
const endIndex = code.indexOf('{!isPctValid && (');

if (startIndex === -1 || endIndex === -1) {
  console.log("Could not find targets section");
  process.exit(1);
}

function generateTargetRow(num) {
  return `          <div className="flex items-start gap-3">
            <div className="flex-1">
              <div className="flex items-center mb-2 h-4">
                <label className="text-xs text-neutral-400 font-medium flex items-center">TP ${num} {renderPctChange(t${num})}</label>
              </div>
              <Input type="number" step="0.0001" value={tp${num}} onChange={(e) => setTp${num}(e.target.value)} className="px-3" />
            </div>
            
            <div className="w-20 shrink-0">
              <div className="flex items-center justify-center mb-2 h-4">
                <label className="text-xs text-neutral-400 font-medium">Sell %</label>
              </div>
              <Input type="number" step="1" value={tp${num}Pct} onChange={(e) => setTp${num}Pct(e.target.value)} className="px-2 text-center" />
              <div className="text-[10px] text-neutral-500 text-center mt-1.5 whitespace-nowrap overflow-visible">
                {coins > 0 && t${num}Pct > 0 ? formatNumber(coins * (t${num}Pct / 100)) + " coins" : '\\u00A0'}
              </div>
            </div>
            
            <div className="w-24 shrink-0">
              <div className="flex items-center justify-end mb-2 h-4">
                <label className="text-xs text-neutral-400 font-medium">Profit ($)</label>
              </div>
              <Input 
                type="number" 
                className="font-medium text-emerald-400 text-right px-2"
                value={customProfit${num} !== '' ? customProfit${num} : (profit${num} > 0 ? profit${num}.toFixed(2) : '')}
                onChange={(e) => setCustomProfit${num}(e.target.value)}
                onBlur={() => {
                  if (customProfit${num} !== '') {
                    const p = parseFloat(customProfit${num});
                    if (!isNaN(p) && coins > 0 && t${num}Pct > 0) {
                      const isL = ent > stop;
                      const sC = coins * (t${num}Pct / 100);
                      const pPC = p / sC;
                      setTp${num}((isL ? ent + pPC : ent - pPC).toFixed(4));
                    }
                    setCustomProfit${num}('');
                  }
                }}
              />
              <div className="text-[10px] text-emerald-500/70 text-right mt-1.5">{formatPkr(profit${num} * PKR_RATE)}</div>
            </div>

            <div className="w-12 shrink-0 flex flex-col items-end">
              <div className="flex items-center justify-end mb-2 h-4">
                <label className="text-xs text-neutral-400 font-medium">R/R</label>
              </div>
              <div className="h-11 flex items-center justify-end w-full bg-neutral-900/30 rounded-lg border border-transparent">
                <span className="text-xs font-bold text-blue-400">{calculateRR(t${num}).toFixed(1)}</span>
              </div>
            </div>
          </div>
`;
}

const replacement = `<div className="space-y-4">
${generateTargetRow(1)}
${generateTargetRow(2)}
${generateTargetRow(3)}
        </div>
        `;

const before = code.substring(0, startIndex);
const after = code.substring(endIndex);

fs.writeFileSync('src/components/Calculator.tsx', before + replacement + after);
console.log("Targets patched");
