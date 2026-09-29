const fs = require('fs');
let code = fs.readFileSync('src/components/Calculator.tsx', 'utf-8');

code = code.replace(
  /<div className="text-xs text-neutral-400 mb-1\.5 block font-medium">Risk \(Max Loss\)<\/div>/,
  `<div className="flex items-center justify-between mb-2 h-4">
              <label className="text-xs text-neutral-400 font-medium">Risk (Max Loss)</label>
            </div>`
);

code = code.replace(
  /<div className="text-xs text-neutral-400 uppercase font-semibold mb-1">Total Buy Size<\/div>/,
  `<div className="flex items-center justify-between mb-2 h-4">
              <label className="text-xs text-neutral-400 font-medium">Total Buy Size</label>
            </div>`
);

fs.writeFileSync('src/components/Calculator.tsx', code);
