const fs = require('fs');
let code = fs.readFileSync('src/components/AiSignals.tsx', 'utf-8');

// 1. Add capital state & sorting
code = code.replace(
  "const { livePrices } = useTradeContext();",
  "const { livePrices, baseCapital } = useTradeContext();\n  const [riskSelection, setRiskSelection] = useState<0.5 | 1.0>(1.0);"
);

// 2. Sort signals by confidence
code = code.replace(
  "if (data.status === 'success' && data.signals) {",
  "if (data.status === 'success' && data.signals) {\n        // Sort highest confidence first\n        data.signals.sort((a: any, b: any) => b.confidence - a.confidence);"
);

// 3. Add Risk Selector to Header
const newHeader = `
      <div className="flex justify-between items-center mb-1">
        <div>
          <h2 className="text-xl font-bold text-neutral-100 flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-500" />
            AI Trading Desk
          </h2>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-xs text-neutral-500">Simulate Risk:</span>
            <div className="flex bg-neutral-900 rounded-lg p-0.5 border border-neutral-800">
              <button 
                onClick={() => setRiskSelection(0.5)}
                className={\`px-2 py-0.5 text-[10px] rounded-md transition-colors \${riskSelection === 0.5 ? 'bg-neutral-800 text-white font-bold' : 'text-neutral-500 hover:text-neutral-300'}\`}
              >
                0.5%
              </button>
              <button 
                onClick={() => setRiskSelection(1.0)}
                className={\`px-2 py-0.5 text-[10px] rounded-md transition-colors \${riskSelection === 1.0 ? 'bg-neutral-800 text-white font-bold' : 'text-neutral-500 hover:text-neutral-300'}\`}
              >
                1.0%
              </button>
            </div>
          </div>
        </div>
        <button 
          onClick={() => fetchSignals(true)} 
          disabled={loading}
          className="text-xs bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-emerald-400 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={\`w-3 h-3 \${loading ? 'animate-spin' : ''}\`} />
          {loading ? 'Analyzing...' : 'Refresh'}
        </button>
      </div>
`.trim();

code = code.replace(/<div className="flex justify-between items-center mb-1">[\s\S]*?<\/button>\s*<\/div>/, newHeader);


// 4. Add the math overlay for each card
const oldCardGrid = `
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-neutral-950 p-2 rounded-lg border border-neutral-800">
                      <div className="text-[10px] text-neutral-500 font-semibold mb-0.5">ENTRY</div>
                      <div className="text-sm font-bold text-blue-400">{formatPrice(sig.entry)}</div>
                    </div>
                    <div className="bg-neutral-950 p-2 rounded-lg border border-neutral-800">
                      <div className="text-[10px] text-neutral-500 font-semibold mb-0.5">STOP LOSS</div>
                      <div className="text-sm font-bold text-red-400">{formatPrice(sig.sl)}</div>
                    </div>
                    <div className="bg-neutral-950 p-2 rounded-lg border border-neutral-800">
                      <div className="text-[10px] text-neutral-500 font-semibold mb-0.5">TARGET (TP1)</div>
                      <div className="text-sm font-bold text-emerald-400">{formatPrice(sig.tp1)}</div>
                    </div>
                  </div>
`;

const newCardGrid = `
                  <div className="grid grid-cols-3 gap-2 text-center mb-3">
                    <div className="bg-neutral-950 p-2 rounded-lg border border-neutral-800">
                      <div className="text-[10px] text-neutral-500 font-semibold mb-0.5">ENTRY</div>
                      <div className="text-sm font-bold text-blue-400">{formatPrice(sig.entry)}</div>
                    </div>
                    <div className="bg-neutral-950 p-2 rounded-lg border border-neutral-800">
                      <div className="text-[10px] text-neutral-500 font-semibold mb-0.5">STOP LOSS</div>
                      <div className="text-sm font-bold text-red-400">{formatPrice(sig.sl)}</div>
                    </div>
                    <div className="bg-neutral-950 p-2 rounded-lg border border-neutral-800">
                      <div className="text-[10px] text-neutral-500 font-semibold mb-0.5">TARGET (TP1)</div>
                      <div className="text-sm font-bold text-emerald-400">{formatPrice(sig.tp1)}</div>
                    </div>
                  </div>
                  
                  {/* Simulated Math */}
                  {(() => {
                     const riskAmount = baseCapital * (riskSelection / 100);
                     const slDistPct = Math.abs(sig.entry - sig.sl) / sig.entry;
                     const tp1DistPct = Math.abs(sig.tp1 - sig.entry) / sig.entry;
                     
                     // If Stop loss distance is 0 to avoid Infinity
                     const posSizeUsd = slDistPct > 0 ? (riskAmount / slDistPct) : 0;
                     const potentialProfit = posSizeUsd * tp1DistPct;
                     
                     return (
                       <div className="flex items-center justify-between px-3 py-2 bg-neutral-950 rounded-lg border border-neutral-800/50">
                         <div className="flex flex-col">
                           <span className="text-[9px] text-neutral-500 font-bold uppercase tracking-wider">Risk ({riskSelection}%)</span>
                           <span className="text-xs font-bold text-red-400">-{formatCurrency(riskAmount)}</span>
                         </div>
                         
                         <div className="flex flex-col items-center">
                           <span className="text-[9px] text-neutral-500 font-bold uppercase tracking-wider">Position Size</span>
                           <span className="text-xs font-bold text-neutral-300">{formatCurrency(posSizeUsd)}</span>
                         </div>
                         
                         <div className="flex flex-col items-end">
                           <span className="text-[9px] text-neutral-500 font-bold uppercase tracking-wider">Reward (TP1)</span>
                           <span className="text-xs font-bold text-emerald-400">+{formatCurrency(potentialProfit)}</span>
                         </div>
                       </div>
                     );
                  })()}
`;

code = code.replace(oldCardGrid, newCardGrid);

// 5. Add Live price to the footer
const oldFooterDist = `
                    {livePrice && !isExpired && (
                      <span className="ml-2 pl-2 border-l border-neutral-800">
                        Dist: <span className={Math.abs(livePrice - sig.entry) / sig.entry < 0.005 ? 'text-emerald-400' : 'text-neutral-400'}>
                          {((Math.abs(livePrice - sig.entry) / sig.entry) * 100).toFixed(2)}%
                        </span>
                      </span>
                    )}
`;

const newFooterDist = `
                    {livePrice && !isExpired && (
                      <span className="ml-2 pl-2 border-l border-neutral-800 flex items-center gap-2">
                        <span>Live: <span className="text-neutral-300">{formatPrice(livePrice)}</span></span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">
                          {((Math.abs(livePrice - sig.entry) / sig.entry) * 100).toFixed(2)}% away
                        </span>
                      </span>
                    )}
`;

code = code.replace(oldFooterDist, newFooterDist);


fs.writeFileSync('src/components/AiSignals.tsx', code);
console.log("Patched AiSignals.tsx");
