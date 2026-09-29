const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

const targetToRemove = `            <button 
              onClick={() => setActiveTab('signals')}
              className={cn(
                "flex flex-col items-center justify-center w-full py-2 gap-1 rounded-lg transition-colors relative",
                activeTab === 'signals' ? "text-emerald-400" : "text-neutral-500 hover:text-neutral-300"
              )}
            >
              <Radar className="w-5 h-5" />
              <span className="text-[10px] font-medium">AI Desk</span>
              <span className="absolute top-1.5 right-6 w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
            </button>`;

code = code.replace(targetToRemove, "");
fs.writeFileSync('src/App.tsx', code);
console.log("Removed AI desk tab");
