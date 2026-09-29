const fs = require('fs');
let code = fs.readFileSync('src/components/Calculator.tsx', 'utf-8');

code = code.replace(
  /<div className="flex items-center justify-between mt-1 text-\[10px\] text-neutral-500">[\s\S]*?<span>Account Bankroll<\/span>[\s\S]*?className="text-neutral-400 hover:text-emerald-400 transition-colors underline"[\s\S]*?>[\s\S]*?Use Avail USDT \(\$\{availableCapital\.toFixed\(0\)\}\)[\s\S]*?<\/button>[\s\S]*?\)\}[\s\S]*?<\/div>/,
  `<div className="flex items-center justify-between mt-1.5 px-1 text-xs text-neutral-500">
              <span>Account Bankroll</span>
              {availableCapital > 0 && Math.abs(pSize - availableCapital) > 0.01 && (
                <button 
                  type="button" 
                  onClick={() => {
                    const newVal = availableCapital;
                    const pnl = (totalRealizedPnL || 0);
                    const unrealized = (totalLiveUnrealizedPnL || 0);
                    setBaseCapital(newVal - pnl - unrealized);
                    setPortfolioSize(newVal.toFixed(2));
                    hasUserEditedEquity.current = false;
                    toast.success(\`Total equity set to available cash!\`);
                  }}
                  className="text-emerald-500/80 hover:text-emerald-400 transition-colors font-medium"
                >
                  Use Avail (\${availableCapital.toFixed(0)})
                </button>
              )}
            </div>`
);

fs.writeFileSync('src/components/Calculator.tsx', code);
