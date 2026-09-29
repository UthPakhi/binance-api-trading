const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const t1 = "generate 3 high-probability trade setups (1 Scalp, 1 Day Trade, 1 Swing Trade).";
const r1 = "generate 3 high-probability SCALP trade setups.";

const t2 = "Identify 3 distinct trading opportunities (prefer BTC, ETH, SOL).\\nCRITICAL: SPOT LONG TRADES ONLY! Do not generate SHORT trades. (isLong must be true, tp1 > entry, sl < entry).";
const r2 = "Identify 3 distinct SCALP trading opportunities (prefer BTC, ETH, SOL).\\nCRITICAL: SPOT LONG TRADES ONLY! Do not generate SHORT trades. (isLong must be true, tp1 > entry, sl < entry).\\nCRITICAL: Minimum Risk/Reward (R:R) must be strictly 1:1.5 or better.";

const t3 = "Use this feedback to self-correct. If your win rate is dropping, tighten your invalidation levels and wait for deeper pullbacks before suggesting entries.";
const r3 = "Use this backtesting feedback to self-correct your strategy. The system autonomously executes these virtual trades and records the PnL. If your win rate is dropping, actively tighten your invalidation levels, optimize entry zones, and wait for deeper pullbacks to improve R:R.";

code = code.replace(t1, r1);
code = code.replace(t2, r2);
code = code.replace(t3, r3);

fs.writeFileSync('server.ts', code);
console.log("Enforced scalp only and improved feedback loop");
