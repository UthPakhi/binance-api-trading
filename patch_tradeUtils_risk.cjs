const fs = require('fs');
let code = fs.readFileSync('src/lib/tradeUtils.ts', 'utf-8');

const statsOld = `  let activeInitialCost = 0;

  trades.forEach(t => {`;
  
const statsNew = `  let activeInitialCost = 0;
  let totalActiveRisk = 0;

  trades.forEach(t => {
    if (t.status === 'ACTIVE' || t.status === 'PENDING' || t.status === 'TARGET_BREAK_EVEN' || !t.status) {
      totalActiveRisk += t.riskAmount || 0;
    }`;

code = code.replace(statsOld, statsNew);

const returnOld = `return { totalEquity, availableCapital, totalRealizedPnL, totalLiveUnrealizedPnL, activeInitialCost };`;
const returnNew = `return { totalEquity, availableCapital, totalRealizedPnL, totalLiveUnrealizedPnL, activeInitialCost, totalActiveRisk };`;
code = code.replace(returnOld, returnNew);

fs.writeFileSync('src/lib/tradeUtils.ts', code);
