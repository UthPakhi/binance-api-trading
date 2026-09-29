const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const target = "4. DIRECTIONAL SANITY: If market regime is STRONG_BEAR_TREND and funding is high positive, reject the trade (set tradeFound = false).";
const replace = "4. DIRECTIONAL SANITY: SPOT LONG TRADES ONLY! No shorting! If market regime is STRONG_BEAR_TREND and funding is high positive, reject the trade (set tradeFound = false).";

code = code.replace(target, replace);
fs.writeFileSync('server.ts', code);
console.log("Enforced longs pass 2");
