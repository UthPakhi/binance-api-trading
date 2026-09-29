const fs = require('fs');
let code = fs.readFileSync('src/components/Calculator.tsx', 'utf-8');

// Replace pl-7 px-2 with pl-8 pr-3
code = code.replace(/pl-7 px-2/g, 'pl-8 pr-3');

fs.writeFileSync('src/components/Calculator.tsx', code);
