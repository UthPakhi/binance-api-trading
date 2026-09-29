const fs = require('fs');
let code = fs.readFileSync('src/components/History.tsx', 'utf-8');

const activeTradesAnchor = `<div className="space-y-4">
            {activeTrades.length === 0 ? (
              <div className="text-center p-8 bg-neutral-900 rounded-xl border border-neutral-800">
                <Clock className="w-8 h-8 text-neutral-600 mx-auto mb-3" />
                <p className="text-neutral-400">No active trades</p>
                <p className="text-xs text-neutral-600 mt-1">Open positions will appear here</p>
              </div>
            ) : (`;

const newTabsHeader = `
          {/* History Mode Tabs */}
          <div className="flex bg-neutral-900 rounded-xl p-1 mb-6 border border-neutral-800">
            <button 
              onClick={() => setHistoryMode('personal')}
              className={\`flex-1 py-2 text-sm font-bold rounded-lg transition-colors \${historyMode === 'personal' ? 'bg-neutral-800 text-white' : 'text-neutral-500'}\`}
            >
              My Trades
            </button>
            <button 
              onClick={() => setHistoryMode('ai')}
              className={\`flex-1 py-2 text-sm font-bold rounded-lg transition-colors flex items-center justify-center gap-2 \${historyMode === 'ai' ? 'bg-emerald-900/30 text-emerald-400 border-emerald-500/20' : 'text-neutral-500'}\`}
            >
              <Activity className="w-4 h-4" />
              AI Backtest
            </button>
          </div>

          {historyMode === 'personal' ? (
            <>
`;

const stateHooks = `  const [activeTab, setActiveTab] = useState<'active' | 'closed'>('active');`;
const newStateHooks = `  const [activeTab, setActiveTab] = useState<'active' | 'closed'>('active');
  const [historyMode, setHistoryMode] = useState<'personal'|'ai'>('personal');
  const [aiHistory, setAiHistory] = useState<any>(null);

  useEffect(() => {
    if (historyMode === 'ai') {
      fetch('/api/ai-performance').then(r => r.json()).then(setAiHistory).catch(console.error);
    }
  }, [historyMode]);
`;

code = code.replace(stateHooks, newStateHooks);


const mainContainerAnchor = `<div className="flex gap-4 mb-6">`;
code = code.replace(mainContainerAnchor, newTabsHeader + mainContainerAnchor);

const endOfPersonal = `        </main>`;

const aiRenderLogic = `
            </>
          ) : (
            <div className="space-y-6">
              {!aiHistory ? (
                <div className="text-center p-8 bg-neutral-900 rounded-xl animate-pulse">Loading AI simulation data...</div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-neutral-900 p-4 rounded-xl border border-neutral-800">
                      <div className="text-xs text-neutral-500 mb-1 font-bold tracking-wide">SIMULATED WIN RATE</div>
                      <div className={\`text-2xl font-black \${parseFloat(aiHistory.winRate) >= 50 ? 'text-emerald-400' : 'text-red-400'}\`}>
                        {aiHistory.winRate}%
                      </div>
                      <div className="text-[10px] text-neutral-600 mt-1">Based on {aiHistory.totalTrades} closed trades</div>
                    </div>
                    
                    <div className="bg-neutral-900 p-4 rounded-xl border border-neutral-800">
                      <div className="text-xs text-neutral-500 mb-1 font-bold tracking-wide">NET VIRTUAL PNL</div>
                      <div className={\`text-2xl font-black \${aiHistory.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}\`}>
                        {aiHistory.totalPnl >= 0 ? '+' : ''}$\\{aiHistory.totalPnl.toFixed(2)}
                      </div>
                      <div className="text-[10px] text-neutral-600 mt-1">1% Risk ($100) per trade</div>
                    </div>
                  </div>
                  
                  <div className="bg-neutral-900 rounded-xl border border-neutral-800 overflow-hidden">
                    <div className="p-4 border-b border-neutral-800 bg-neutral-950/50 flex justify-between items-center">
                      <h3 className="font-bold text-neutral-300">Live Active Scans</h3>
                      <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-bold">
                        {aiHistory.active.length} ACTIVE
                      </span>
                    </div>
                    {aiHistory.active.length === 0 ? (
                       <div className="p-6 text-center text-sm text-neutral-500">No active limit orders pending.</div>
                    ) : (
                      <div className="divide-y divide-neutral-800">
                        {aiHistory.active.map((t: any, i: number) => (
                          <div key={i} className="p-4 flex justify-between items-center">
                            <div>
                              <div className="font-bold text-neutral-200">{t.symbol}</div>
                              <div className="text-[10px] text-neutral-500">{t.type} • {t.status}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm text-blue-400">Entry: {t.entry}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="bg-neutral-900 rounded-xl border border-neutral-800 overflow-hidden">
                    <div className="p-4 border-b border-neutral-800 bg-neutral-950/50">
                      <h3 className="font-bold text-neutral-300">Recent Backtest Log</h3>
                    </div>
                    <div className="divide-y divide-neutral-800">
                      {aiHistory.history.length === 0 ? (
                        <div className="p-6 text-center text-sm text-neutral-500">Waiting for trades to resolve...</div>
                      ) : (
                        aiHistory.history.map((t: any, i: number) => (
                          <div key={i} className="p-4 flex justify-between items-center">
                            <div>
                              <div className="font-bold text-neutral-200 flex items-center gap-2">
                                {t.symbol}
                                <span className={\`text-[10px] px-1.5 py-0.5 rounded uppercase \${t.pnl > 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}\`}>
                                  {t.status.replace('CLOSED_', '')}
                                </span>
                              </div>
                              <div className="text-[10px] text-neutral-500 mt-1">{t.type} • {new Date(t.closedAt).toLocaleString()}</div>
                            </div>
                            <div className={\`text-right font-bold \${t.pnl > 0 ? 'text-emerald-400' : 'text-red-400'}\`}>
                              {t.pnl > 0 ? '+' : ''}$\\{t.pnl.toFixed(2)}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </main>`;

code = code.replace(endOfPersonal, aiRenderLogic);

// Add Activity icon import
const importAnchor = `import { Trash2, AlertCircle, Clock, ExternalLink, Calendar, RefreshCw, RefreshCcw } from 'lucide-react';`;
code = code.replace(importAnchor, `import { Trash2, AlertCircle, Clock, ExternalLink, Calendar, RefreshCw, RefreshCcw, Activity } from 'lucide-react';`);

fs.writeFileSync('src/components/History.tsx', code);
console.log("Patched History.tsx to include AI Backtest tab");
