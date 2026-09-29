const fs = require('fs');
let code = fs.readFileSync('src/components/Calculator.tsx', 'utf-8');

// Replace all simple labels in the grid with consistent flex headers so inputs align exactly.
// Replace Total Equity label block
code = code.replace(
  /<div className="flex items-center justify-between mb-1">\s*<label className="text-xs text-neutral-400 mb-1\.5 block font-medium">Total Equity \(\$\)<\/label>[\s\S]*?<\/div>/,
  `<div className="flex items-center justify-between mb-2 h-4">
              <label className="text-xs text-neutral-400 font-medium">Total Equity ($)</label>
              {availableCapital > 0 && (
                <span className="text-xs text-emerald-400 font-medium" title="Trade-able cash currently available in USDT">
                  Avail: {formatCurrency(availableCapital)}
                </span>
              )}
            </div>`
);

// Risk %
code = code.replace(
  /<label className="text-xs text-neutral-400 mb-1\.5 block font-medium">Risk %<\/label>/,
  `<div className="flex items-center justify-between mb-2 h-4">
              <label className="text-xs text-neutral-400 font-medium">Risk %</label>
            </div>`
);

// Entry
code = code.replace(
  /<label className="text-xs text-neutral-400 mb-1\.5 block font-medium">Entry<\/label>/,
  `<div className="flex items-center justify-between mb-2 h-4">
              <label className="text-xs text-neutral-400 font-medium">Entry</label>
            </div>`
);

// Stop Loss
code = code.replace(
  /<label className="text-xs text-neutral-400 mb-1\.5 flex items-center font-medium">Stop Loss \{renderPctChange\(stop\)\}<\/label>/,
  `<div className="flex items-center justify-between mb-2 h-4">
              <label className="text-xs text-neutral-400 font-medium flex items-center">Stop Loss {renderPctChange(stop)}</label>
            </div>`
);

// Coin symbol
code = code.replace(
  /<label className="text-xs text-neutral-400 mb-1\.5 block font-medium">Coin Symbol \(Binance Spot\)<\/label>/,
  `<div className="flex items-center justify-between mb-2 h-4">
              <label className="text-xs text-neutral-400 font-medium">Coin Symbol (Binance Spot)</label>
            </div>`
);


// Notes
code = code.replace(
  /<label className="text-xs text-neutral-400 mb-1\.5 block font-medium">Notes \(Optional\)<\/label>/,
  `<div className="flex items-center justify-between mb-2 h-4">
              <label className="text-xs text-neutral-400 font-medium">Notes (Optional)</label>
            </div>`
);

fs.writeFileSync('src/components/Calculator.tsx', code);
