const fs = require('fs');

// 1. EditTradeModal.tsx
let modalCode = fs.readFileSync('src/components/EditTradeModal.tsx', 'utf-8');

modalCode = modalCode.replace(
  `<option value="CLOSED_MANUAL">Closed Manually</option>`,
  `<option value="CLOSED_MANUAL">Closed Manually</option>\n                <option value="CLOSED_BREAK_EVEN">Closed at Break Even</option>`
);

modalCode = modalCode.replace(
  `else if (newStatus === 'HIT_TP3') setRealizedProfit((profit1 + profit2 + profit3).toString());`,
  `else if (newStatus === 'HIT_TP3') setRealizedProfit((profit1 + profit2 + profit3).toString());\n    else if (newStatus === 'CLOSED_BREAK_EVEN') setRealizedProfit('0');`
);

fs.writeFileSync('src/components/EditTradeModal.tsx', modalCode);

// 2. tradeUtils.ts
let utilsCode = fs.readFileSync('src/lib/tradeUtils.ts', 'utf-8');

utilsCode = utilsCode.replace(
  `if (status === 'HIT_SL' || status === 'CLOSED_MANUAL' || status === 'HIT_TP3') return 0;`,
  `if (status === 'HIT_SL' || status === 'CLOSED_MANUAL' || status === 'HIT_TP3' || status === 'CLOSED_BREAK_EVEN') return 0;`
);

fs.writeFileSync('src/lib/tradeUtils.ts', utilsCode);

// 3. History.tsx
let historyCode = fs.readFileSync('src/components/History.tsx', 'utf-8');

historyCode = historyCode.replace(
  `CLOSED_MANUAL: 'CLOSED'`,
  `CLOSED_MANUAL: 'CLOSED',\n            CLOSED_BREAK_EVEN: 'BREAK EVEN'`
);

historyCode = historyCode.replace(
  `CLOSED_MANUAL: 'bg-blue-500/20 text-blue-400 border-blue-500/30'`,
  `CLOSED_MANUAL: 'bg-blue-500/20 text-blue-400 border-blue-500/30',\n            CLOSED_BREAK_EVEN: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30'`
);

historyCode = historyCode.replace(
  `tStatus !== 'CLOSED_MANUAL' && tStatus !== 'HIT_SL' && tStatus !== 'HIT_TP3'`,
  `tStatus !== 'CLOSED_MANUAL' && tStatus !== 'HIT_SL' && tStatus !== 'HIT_TP3' && tStatus !== 'CLOSED_BREAK_EVEN'`
);

historyCode = historyCode.replace(
  `['HIT_SL', 'HIT_TP1', 'HIT_TP2', 'HIT_TP3', 'CLOSED_MANUAL'].includes(tStatus)`,
  `['HIT_SL', 'HIT_TP1', 'HIT_TP2', 'HIT_TP3', 'CLOSED_MANUAL', 'CLOSED_BREAK_EVEN'].includes(tStatus)`
);

fs.writeFileSync('src/components/History.tsx', historyCode);
