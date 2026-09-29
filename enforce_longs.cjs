const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

// Modify background prompt
const oldBg = "Identify 3 distinct trading opportunities (prefer BTC, ETH, SOL).";
const newBg = "Identify 3 distinct trading opportunities (prefer BTC, ETH, SOL).\nCRITICAL: SPOT LONG TRADES ONLY! Do not generate SHORT trades. (isLong must be true, tp1 > entry, sl < entry).";
code = code.replace(oldBg, newBg);

// Let's also check if the background JSON schema allows isLong to be false and forcefully change it to always be true.
code = code.replace('isLong: { type: Type.BOOLEAN },', 'isLong: { type: Type.BOOLEAN, description: "Must ALWAYS be true. Spot long trades only." },');

// Let's modify the Calculator trade suggest PASS 1 to be even stricter, just in case.
const oldPass1 = "1. SPOT LONG ONLY. Entry price < Take Profit 1. Stop loss < Entry price.";
const newPass1 = "1. SPOT LONG TRADES ONLY. NO SHORTS. Entry price < Take Profit 1. Stop loss < Entry price.";
code = code.replace(oldPass1, newPass1);

fs.writeFileSync('server.ts', code);
console.log("Enforced longs only");
