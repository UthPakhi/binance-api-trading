const fs = require('fs');

// 1. EditTradeModal.tsx
let modalCode = fs.readFileSync('src/components/EditTradeModal.tsx', 'utf-8');

const statusChangeOld = `  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newStatus = e.target.value;
    setStatus(newStatus);
    if (newStatus === 'ACTIVE') setRealizedProfit('0');
    else if (newStatus === 'HIT_SL') setRealizedProfit((-riskAmount - expectedStopFeeUsd).toString());
    else if (newStatus === 'HIT_TP1') setRealizedProfit((profit1 - buyFeeUsd - sellFee1).toString());
    else if (newStatus === 'HIT_TP2') setRealizedProfit((profit1 + profit2 - buyFeeUsd - sellFee1 - sellFee2).toString());
    else if (newStatus === 'HIT_TP3') setRealizedProfit((profit1 + profit2 + profit3).toString());
    else if (newStatus === 'CLOSED_BREAK_EVEN') setRealizedProfit('0');
  };`;

const statusChangeNew = `  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newStatus = e.target.value;
    setStatus(newStatus);
    if (newStatus === 'ACTIVE') setRealizedProfit('0');
    else if (newStatus === 'HIT_SL') setRealizedProfit((-riskAmount - expectedStopFeeUsd).toString());
    else if (newStatus === 'HIT_TP1') setRealizedProfit((profit1 - buyFeeUsd - sellFee1).toString());
    else if (newStatus === 'HIT_TP2') setRealizedProfit((profit1 + profit2 - buyFeeUsd - sellFee1 - sellFee2).toString());
    else if (newStatus === 'HIT_TP3') setRealizedProfit((profit1 + profit2 + profit3).toString());
    else if (newStatus === 'TARGET_BREAK_EVEN') {
      setRealizedProfit('0');
      setSl('');
      setTp1(entry);
      setTp1Pct('100');
      setTp2('');
      setTp2Pct('');
      setTp3('');
      setTp3Pct('');
    }
    else if (newStatus === 'CLOSED_BREAK_EVEN') {
      const sellFee = (coins * parseFloat(entry || '0')) * FEE_RATE;
      setRealizedProfit((-buyFeeUsd - sellFee).toString());
    }
  };`;

modalCode = modalCode.replace(statusChangeOld, statusChangeNew);
if (!modalCode.includes('TARGET_BREAK_EVEN')) {
  console.log("Failed to patch handleStatusChange!");
}

modalCode = modalCode.replace(
  '<option value="CLOSED_BREAK_EVEN">Closed at Break Even</option>',
  '<option value="TARGET_BREAK_EVEN">Target Break Even</option>\n                <option value="CLOSED_BREAK_EVEN">Hit Break Even</option>'
);

modalCode = modalCode.replace(
  `status !== 'CLOSED_BREAK_EVEN' && (`,
  `status !== 'CLOSED_BREAK_EVEN' && status !== 'TARGET_BREAK_EVEN' && (`
);

fs.writeFileSync('src/components/EditTradeModal.tsx', modalCode);

// 2. History.tsx
let historyCode = fs.readFileSync('src/components/History.tsx', 'utf-8');

historyCode = historyCode.replace(
  "ACTIVE: 'ACTIVE',",
  "ACTIVE: 'ACTIVE',\n            TARGET_BREAK_EVEN: 'TARGET BE',"
);

historyCode = historyCode.replace(
  "ACTIVE: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',",
  "ACTIVE: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',\n            TARGET_BREAK_EVEN: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',"
);

fs.writeFileSync('src/components/History.tsx', historyCode);

// 3. tradeUtils.ts
let utilsCode = fs.readFileSync('src/lib/tradeUtils.ts', 'utf-8');

utilsCode = utilsCode.replace(
  "if (status === 'HIT_SL' || status === 'CLOSED_MANUAL' || status === 'BREAK_EVEN' || status === 'HIT_TP3') return 0;",
  "if (status === 'HIT_SL' || status === 'CLOSED_MANUAL' || status === 'CLOSED_BREAK_EVEN' || status === 'HIT_TP3') return 0;"
);

utilsCode = utilsCode.replace(
  "if (status === 'HIT_SL' || status === 'CLOSED_MANUAL' || status === 'HIT_TP3' || status === 'CLOSED_BREAK_EVEN') return 0;",
  "if (status === 'HIT_SL' || status === 'CLOSED_MANUAL' || status === 'CLOSED_BREAK_EVEN' || status === 'HIT_TP3') return 0;"
);

fs.writeFileSync('src/lib/tradeUtils.ts', utilsCode);
console.log('Done!');
