const fs = require('fs');
let code = fs.readFileSync('src/components/Calculator.tsx', 'utf-8');

code = code.replace(/text-sm text-neutral-400 mb-1\.5 block font-medium/g, 'text-xs text-neutral-400 mb-1.5 block font-medium');
code = code.replace(/text-sm text-neutral-400 mb-1\.5 flex items-center font-medium/g, 'text-xs text-neutral-400 mb-1.5 flex items-center font-medium');
code = code.replace(/text-\[10px\] text-neutral-400 mb-1 flex items-center uppercase font-semibold/g, 'text-xs text-neutral-400 mb-1 flex items-center font-medium');
code = code.replace(/text-\[10px\] text-neutral-400 mb-1 block uppercase font-semibold/g, 'text-xs text-neutral-400 mb-1 block font-medium');

// Targets inputs layout
code = code.replace(/<div className="w-16">/g, '<div className="w-20">');

// Total equity "avail" label:
code = code.replace(/<span className="text-\[10px\] text-emerald-400 font-medium"/g, '<span className="text-xs text-emerald-400 font-medium"');

fs.writeFileSync('src/components/Calculator.tsx', code);
