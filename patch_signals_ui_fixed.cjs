const fs = require('fs');
let code = fs.readFileSync('src/components/AiSignals.tsx', 'utf-8');

const stateHook = `  const [lastGeneratedAt, setLastGeneratedAt] = useState<number>(0);`;
const perfHook = `  const [lastGeneratedAt, setLastGeneratedAt] = useState<number>(0);
  const [aiPerf, setAiPerf] = useState<any>(null);`;
code = code.replace(stateHook, perfHook);

const fetchPerf = `
        if (data.isStale && forceRefresh) {
          toast.error("Failed to reach AI Engine. Showing cached signals.", { id: 'stale-signals' });
        } else if (forceRefresh) {
          toast.success("AI Desk refreshed!");
        }
        
        // Fetch performance
        fetch('/api/ai-performance').then(r => r.json()).then(setAiPerf).catch(console.error);
`;
code = code.replace(/if \(data\.isStale && forceRefresh\) \{[\s\S]*?toast\.success\("AI Desk refreshed!"\);\n        \}/, fetchPerf);

const headerEnd = `          <h2 className="text-xl font-bold text-neutral-100 flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-500" />
            AI Trading Desk
          </h2>`;

const newHeaderPerf = `          <h2 className="text-xl font-bold text-neutral-100 flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-500" />
            AI Trading Desk
          </h2>
          {aiPerf && (
            <div className="flex gap-3 mt-1.5 text-[10px] uppercase font-bold tracking-wider">
              <span className="text-neutral-500">
                Win Rate: <span className={Number(aiPerf.winRate) >= 50 ? 'text-emerald-400' : 'text-neutral-300'}>{aiPerf.winRate}%</span>
              </span>
              <span className="text-neutral-500">
                PnL: <span className={aiPerf.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{aiPerf.totalPnl >= 0 ? '+' : ''}$\\{aiPerf.totalPnl.toFixed(2)}</span>
              </span>
            </div>
          )}`;
          
code = code.replace(headerEnd, newHeaderPerf);

fs.writeFileSync('src/components/AiSignals.tsx', code);
console.log("Patched AiSignals.tsx for performance dashboard");
