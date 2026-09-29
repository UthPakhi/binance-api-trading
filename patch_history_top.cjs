const fs = require('fs');
let code = fs.readFileSync('src/components/History.tsx', 'utf-8');

const statsHtmlOld = `<div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-neutral-800">
          <div>
             <div className="text-[10px] text-neutral-500 mb-1 uppercase font-semibold">Net Realized PnL</div>`;
const statsHtmlNew = `<div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-neutral-800">
          <div>
             <div className="text-[10px] text-neutral-500 mb-1 uppercase font-semibold">Total Active Risk</div>
             <div className="text-sm font-bold text-red-400">
               {formatCurrency(stats.totalActiveRisk || 0)}
               <span className="text-xs font-normal ml-1 text-neutral-400">
                 ({(((stats.totalActiveRisk || 0) / stats.totalEquity) * 100).toFixed(2)}%)
               </span>
             </div>
          </div>
          <div>
             <div className="text-[10px] text-neutral-500 mb-1 uppercase font-semibold">Net Realized PnL</div>`;

code = code.replace(statsHtmlOld, statsHtmlNew);
fs.writeFileSync('src/components/History.tsx', code);
