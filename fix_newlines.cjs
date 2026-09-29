const fs = require('fs');
let code = fs.readFileSync('src/lib/TradeContext.tsx', 'utf-8');

code = code.replace(/trade\.notes \+ '' : ''\) \+ 'Auto-synced/g, "trade.notes + '\\n' : '') + 'Auto-synced");
code = code.replace(/trade\.notes \+ '' : ''\) \+ \`Auto-synced/g, "trade.notes + '\\n' : '') + \`Auto-synced");

fs.writeFileSync('src/lib/TradeContext.tsx', code);
console.log("Fixed newlines");
