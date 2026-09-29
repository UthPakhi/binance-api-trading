const fs = require('fs');
let code = fs.readFileSync('src/components/AiSignals.tsx', 'utf-8');

const t = `      {viewMode === 'signals' && (
        <>
          <div className="flex items-center gap-3">
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
      {viewMode === 'log' ? (`;

const r = `      {viewMode === 'signals' && (
        <div className="flex items-center gap-3 mb-4">
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
      )}

      {viewMode === 'log' ? (`;

code = code.replace(t, r);
fs.writeFileSync('src/components/AiSignals.tsx', code);
console.log("Fixed tab viewMode logic!");
