const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const oldPrompt = "Calculate realistic Risk/Reward. Be highly precise with prices.`";
const newPrompt = "Calculate realistic Risk/Reward. Be highly precise with prices. CRITICAL EXIT PERCENTAGES: You MUST set tp1Pct, tp2Pct, and tp3Pct to integers (e.g. 50, 30, 20 or 60, 25, 15) so that they sum EXACTLY to 100.`";

code = code.replace(oldPrompt, newPrompt);
fs.writeFileSync('server.ts', code);
console.log("Patched server.ts AI signals prompt");
