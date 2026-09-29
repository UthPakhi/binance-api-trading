const fs = require('fs');
let code = fs.readFileSync('src/components/Calculator.tsx', 'utf-8');

const t1 = `<Button 
                size="sm" 
                variant="secondary" 
                className="bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 h-7 text-[10px] px-2 flex items-center gap-1"
                onClick={() => handleSuggestTrade('day')}
                disabled={isSuggesting !== null}
              >
                {isSuggesting === 'day' ? <RefreshCw className="w-3 h-3 animate-spin" /> : "☀️"} Day Trade
              </Button>
              <Button 
                size="sm" 
                variant="secondary" 
                className="bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 h-7 text-[10px] px-2 flex items-center gap-1"
                onClick={() => handleSuggestTrade('swing')}
                disabled={isSuggesting !== null}
              >
                {isSuggesting === 'swing' ? <RefreshCw className="w-3 h-3 animate-spin" /> : "🌊"} Swing
              </Button>`;

code = code.replace(t1, "");

// Modify the 'Scalp' button slightly so it just says "AI Auto-Setup (Scalp)" or something, but "⚡ Scalp" is fine.
const t2 = `{isSuggesting === 'scalp' ? <RefreshCw className="w-3 h-3 animate-spin" /> : "⚡"} Scalp`;
const r2 = `{isSuggesting === 'scalp' ? <RefreshCw className="w-3 h-3 animate-spin" /> : "⚡"} Generate Scalp Setup`;
code = code.replace(t2, r2);

fs.writeFileSync('src/components/Calculator.tsx', code);
console.log("Enforced UI scalp only");
