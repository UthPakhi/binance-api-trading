const fs = require('fs');
let code = fs.readFileSync('src/components/AiSignals.tsx', 'utf-8');
const target = `<button 
          onClick={() => fetchSignals(true)} 
          disabled={loading}
          className="text-xs bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-emerald-400 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={\`w-3 h-3 \${loading ? 'animate-spin' : ''}\`} />
          {loading ? 'Analyzing...' : 'Refresh'}
        </button>`;

code = code.replace(target, '');
fs.writeFileSync('src/components/AiSignals.tsx', code);
console.log("Removed old refresh button");
