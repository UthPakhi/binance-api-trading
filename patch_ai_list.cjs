const fs = require('fs');
let code = fs.readFileSync('src/components/AiSignals.tsx', 'utf-8');

const target = `      {loading && signals.length === 0 ? (`;

const replace = `      {viewMode === 'log' ? (
        <div className="flex-1 overflow-y-auto mt-2 space-y-4">
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
                  {t.pnl >= 0 ? '+' : ''}\${t.pnl.toFixed(2)} PnL
                </span>
              </div>
              <div className="text-xs text-neutral-400 space-y-1">
                <div className="flex justify-between"><span>Status:</span> <span className="text-white font-mono">{t.status}</span></div>
                <div className="flex justify-between"><span>Entry:</span> <span className="text-white font-mono">{t.entry}</span></div>
                {t.closedAt && <div className="flex justify-between"><span>Closed:</span> <span className="text-white font-mono">{new Date(t.closedAt).toLocaleTimeString()}</span></div>}
              </div>
            </div>
          )) : (
            <div className="text-center text-neutral-500 text-xs py-8 bg-neutral-900 rounded-xl border border-neutral-800">No closed simulated trades yet.</div>
          )}
          
          <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-widest border-b border-neutral-800 pb-2 mt-6">Active Virtual Scans</h3>
          {aiPerf?.active?.length > 0 ? aiPerf.active.map((t: any, i: number) => (
            <div key={i} className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 opacity-70">
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white">{t.symbol}</span>
                </div>
                <span className="text-[10px] font-bold text-amber-500 animate-pulse uppercase tracking-wider">{t.status}</span>
              </div>
              <div className="text-xs text-neutral-400 space-y-1">
                <div className="flex justify-between"><span>Target Entry:</span> <span className="text-white font-mono">{t.entry}</span></div>
              </div>
            </div>
          )) : (
            <div className="text-center text-neutral-500 text-xs py-8 bg-neutral-900 rounded-xl border border-neutral-800">No active scans.</div>
          )}
        </div>
      ) : loading && signals.length === 0 ? (`

code = code.replace(target, replace);
fs.writeFileSync('src/components/AiSignals.tsx', code);
console.log("Patched AiSignals viewMode list");
