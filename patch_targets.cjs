const fs = require('fs');
let code = fs.readFileSync('src/components/Calculator.tsx', 'utf-8');

code = code.replace(/className="text-\[10px\] text-emerald-500\/70">\{formatPkr/g, 'className="text-[10px] text-emerald-500/70 text-right mt-1">{formatPkr');

fs.writeFileSync('src/components/Calculator.tsx', code);
