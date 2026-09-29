const fs = require('fs');
let code = fs.readFileSync('src/lib/tradeUtils.ts', 'utf-8');

code = code.replace(
  "if (status === 'HIT_SL' || status === 'CLOSED_MANUAL' || status === 'HIT_TP3') return 0;",
  "if (status === 'HIT_SL' || status === 'CLOSED_MANUAL' || status === 'BREAK_EVEN' || status === 'HIT_TP3') return 0;"
);

fs.writeFileSync('src/lib/tradeUtils.ts', code);
