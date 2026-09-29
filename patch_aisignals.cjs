const fs = require('fs');
let code = fs.readFileSync('src/components/AiSignals.tsx', 'utf-8');

const stateTarget = `  const [aiPerf, setAiPerf] = useState<any>(null);`;
const stateReplacement = `  const [aiPerf, setAiPerf] = useState<any>(null);
  const [viewMode, setViewMode] = useState<'signals' | 'log'>('signals');`;
code = code.replace(stateTarget, stateReplacement);

const headerTarget = `              <span className="text-neutral-500">
                PnL: <span className={aiPerf.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{aiPerf.totalPnl >= 0 ? '+' : ''}$\{aiPerf.totalPnl.toFixed(2)}</span>
              </span>
            </div>
          )}
          <div className="flex items-center gap-3 mt-2">`;
const headerReplacement = `              <span className="text-neutral-500">
                PnL: <span className={aiPerf.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{aiPerf.totalPnl >= 0 ? '+' : ''}$\{aiPerf.totalPnl.toFixed(2)}</span>
              </span>
              <button onClick={() => setViewMode(v => v === 'signals' ? 'log' : 'signals')} className="ml-auto text-emerald-500 hover:text-emerald-400 underline lowercase">
                {viewMode === 'signals' ? 'view log' : 'back to signals'}
              </button>
            </div>
          )}
          <div className="flex items-center gap-3 mt-2">`;
code = code.replace(headerTarget, headerReplacement);

const listTarget = `      {loading ? (`;
const listReplacement = `      {viewMode === 'log' ? (
        <div className="flex-1 overflow-y-auto mt-4 p-4 space-y-4">
          <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-widest border-b border-neutral-800 pb-2">Recent AI Simulated Trades</h3>
          {aiPerf?.history?.length > 0 ? aiPerf.history.map((t: any, i: number) => (
            <div key={i} className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2">
                  <span className={\`text-xs font-bold px-2 py-0.5 rounded \${t.isLong ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}\`}>
                    {t.isLong ? 'LONG' : 'SHORT'}
                  </span>
                  <span className="font-bold text-white">{t.symbol}</span>
                </div>
                <span className={\`text-xs font-bold \${t.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}\`}>
                  {t.pnl >= 0 ? '+' : ''}{t.pnl.toFixed(2)} PnL
                </span>
              </div>
              <div className="text-xs text-neutral-400 space-y-1">
                <div className="flex justify-between"><span>Status:</span> <span className="text-white">{t.status}</span></div>
                <div className="flex justify-between"><span>Entry:</span> <span className="text-white">{t.entry}</span></div>
                {t.exitPrice && <div className="flex justify-between"><span>Exit:</span> <span className="text-white">{t.exitPrice.toFixed(4)}</span></div>}
              </div>
            </div>
          )) : (
            <div className="text-center text-neutral-500 text-xs py-8">No closed simulated trades yet.</div>
          )}
          <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-widest border-b border-neutral-800 pb-2 mt-6">Active Virtual Scans</h3>
          {aiPerf?.active?.length > 0 ? aiPerf.active.map((t: any, i: number) => (
            <div key={i} className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 opacity-70">
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white">{t.symbol}</span>
                </div>
                <span className="text-xs font-bold text-amber-500 animate-pulse">{t.status}</span>
              </div>
            </div>
          )) : (
            <div className="text-center text-neutral-500 text-xs py-8">No active scans.</div>
          )}
        </div>
      ) : loading ? (`

code = code.replace(listTarget, listReplacement);

fs.writeFileSync('src/components/AiSignals.tsx', code);
console.log("Patched AiSignals.tsx view mode");
