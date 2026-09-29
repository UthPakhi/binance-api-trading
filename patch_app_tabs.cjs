const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

// Imports
code = code.replace(
  "import { Calculator as CalcIcon, History as HistIcon, LogOut, TrendingUp } from 'lucide-react';",
  "import { Calculator as CalcIcon, History as HistIcon, LogOut, TrendingUp, Radar } from 'lucide-react';\nimport { AiSignals, Signal } from './components/AiSignals';"
);

// State
code = code.replace(
  "const [activeTab, setActiveTab] = useState<'calc' | 'hist'>('calc');",
  "const [activeTab, setActiveTab] = useState<'calc' | 'hist' | 'signals'>('calc');\n  const [loadedSignal, setLoadedSignal] = useState<Signal | null>(null);"
);

// Content Area
code = code.replace(
  "{activeTab === 'calc' ? <Calculator /> : <History />}",
  "{activeTab === 'calc' ? <Calculator loadedSignal={loadedSignal} /> : activeTab === 'hist' ? <History /> : <AiSignals onLoadSignal={(sig) => { setLoadedSignal(sig); setActiveTab('calc'); }} />}"
);

// Bottom nav
const newNav = `
          <div className="flex justify-around items-center p-2 max-w-md mx-auto">
            <button 
              onClick={() => setActiveTab('signals')}
              className={cn(
                "flex flex-col items-center justify-center w-full py-2 gap-1 rounded-lg transition-colors relative",
                activeTab === 'signals' ? "text-emerald-400" : "text-neutral-500 hover:text-neutral-300"
              )}
            >
              <Radar className="w-5 h-5" />
              <span className="text-[10px] font-medium">AI Desk</span>
              <span className="absolute top-1.5 right-6 w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
            </button>
            <button 
              onClick={() => setActiveTab('calc')}
              className={cn(
                "flex flex-col items-center justify-center w-full py-2 gap-1 rounded-lg transition-colors",
                activeTab === 'calc' ? "text-emerald-400" : "text-neutral-500 hover:text-neutral-300"
              )}
            >
              <CalcIcon className="w-5 h-5" />
              <span className="text-[10px] font-medium">Calculator</span>
            </button>
            
            <button 
              onClick={() => setActiveTab('hist')}
              className={cn(
                "flex flex-col items-center justify-center w-full py-2 gap-1 rounded-lg transition-colors",
                activeTab === 'hist' ? "text-emerald-400" : "text-neutral-500 hover:text-neutral-300"
              )}
            >
              <HistIcon className="w-5 h-5" />
              <span className="text-[10px] font-medium">History</span>
            </button>
          </div>
`;

code = code.replace(/<div className="flex justify-around items-center p-2 max-w-md mx-auto">[\s\S]*?<\/div>/, newNav);

fs.writeFileSync('src/App.tsx', code);
console.log("Patched App.tsx tabs");
