const fs = require('fs');
let code = fs.readFileSync('src/components/AiSignals.tsx', 'utf-8');

const target1 = `  const [aiPerf, setAiPerf] = useState<any>(null);`;
const replace1 = `  const [aiPerf, setAiPerf] = useState<any>(null);
  const [viewMode, setViewMode] = useState<'signals'|'log'>('signals');`;
if (!code.includes("viewMode")) code = code.replace(target1, replace1);

const target2 = `    <div className="flex flex-col gap-6 pb-20">
      <div className="flex justify-between items-center mb-1">
        <div>
          <h2 className="text-xl font-bold text-neutral-100 flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-500" />
            AI Trading Desk
          </h2>
          {aiPerf && (
            <div className="flex gap-3 mt-1.5 text-[10px] uppercase font-bold tracking-wider">
              <span className="text-neutral-500">
                Win Rate: <span className={Number(aiPerf.winRate) >= 50 ? 'text-emerald-400' : 'text-neutral-300'}>{aiPerf.winRate}%</span>
              </span>
              <span className="text-neutral-500">
                PnL: <span className={aiPerf.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{aiPerf.totalPnl >= 0 ? '+' : ''}$\{aiPerf.totalPnl.toFixed(2)}</span>
              </span>
            </div>
          )}
          <div className="flex items-center gap-3 mt-2">
            <span className="text-xs text-neutral-500">Simulate Risk:</span>`;

const replace2 = `    <div className="flex flex-col gap-4 pb-20">
      <div className="flex justify-between items-center mb-1">
        <div className="w-full">
          <div className="flex items-center justify-between w-full">
            <h2 className="text-xl font-bold text-neutral-100 flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-500" />
              AI Trading Desk
            </h2>
            <button 
              onClick={() => fetchSignals(true)}
              className="p-2 bg-neutral-900 border border-neutral-800 rounded-lg text-emerald-500 hover:bg-emerald-500/10 transition-colors"
            >
              <RefreshCw className={\`w-4 h-4 \${loading ? 'animate-spin' : ''}\`} />
            </button>
          </div>
          
          {/* TABS */}
          <div className="flex bg-neutral-900 p-1 rounded-lg mt-4 w-full">
            <button
              onClick={() => setViewMode('signals')}
              className={\`flex-1 py-1.5 text-xs font-bold rounded-md transition-all \${viewMode === 'signals' ? 'bg-neutral-800 text-white' : 'text-neutral-500 hover:text-neutral-300'}\`}
            >
              Live Scans
            </button>
            <button
              onClick={() => setViewMode('log')}
              className={\`flex-1 py-1.5 text-xs font-bold rounded-md transition-all \${viewMode === 'log' ? 'bg-neutral-800 text-white' : 'text-neutral-500 hover:text-neutral-300'}\`}
            >
              Simulated Performance
            </button>
          </div>

          {viewMode === 'log' && aiPerf && (
            <div className="flex justify-between mt-4 p-3 bg-neutral-900/50 border border-neutral-800 rounded-lg text-[10px] uppercase font-bold tracking-wider">
              <span className="text-neutral-500 flex flex-col items-center">
                <span className="mb-1">Win Rate</span>
                <span className={\`text-lg \${Number(aiPerf.winRate) >= 50 ? 'text-emerald-400' : 'text-neutral-300'}\`}>{aiPerf.winRate}%</span>
              </span>
              <span className="text-neutral-500 flex flex-col items-center">
                <span className="mb-1">Total PnL</span>
                <span className={\`text-lg \${aiPerf.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}\`}>{aiPerf.totalPnl >= 0 ? '+' : ''}\${aiPerf.totalPnl.toFixed(2)}</span>
              </span>
            </div>
          )}

          {viewMode === 'signals' && (
          <div className="flex items-center justify-between gap-3 mt-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-500">Simulate Risk:</span>`;

code = code.replace(target2, replace2);
fs.writeFileSync('src/components/AiSignals.tsx', code);
console.log("Patched tabs into AiSignals");
