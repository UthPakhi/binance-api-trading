const fs = require('fs');
let code = fs.readFileSync('src/components/EditTradeModal.tsx', 'utf-8');

const calcProfitReplacement = `
  const FEE_RATE = 0.001;
  const buyFeeUsd = totalBuy * FEE_RATE;

  const calculateRR = (tp: number) => {
    if (riskPerCoin === 0 || tp === 0) return 0;
    const isLong = ent > stop;
    const profitPerCoin = isLong ? (tp - ent) : (ent - tp);
    return profitPerCoin / riskPerCoin;
  };

  const calculateProfit = (tp: number, pct: number) => {
    if (tp === 0 || pct === 0) return 0;
    const isLong = ent > stop;
    const profitPerCoin = isLong ? (tp - ent) : (ent - tp);
    const soldCoins = coins * (pct / 100);
    return soldCoins * profitPerCoin;
  };

  const calculateSellFee = (tp: number, pct: number) => {
    if (tp === 0 || pct === 0) return 0;
    const soldCoins = coins * (pct / 100);
    return soldCoins * tp * FEE_RATE;
  };

  const profit1 = calculateProfit(t1, t1Pct);
  const profit2 = calculateProfit(t2, t2Pct);
  const profit3 = calculateProfit(t3, t3Pct);

  const sellFee1 = calculateSellFee(t1, t1Pct);
  const sellFee2 = calculateSellFee(t2, t2Pct);
  const sellFee3 = calculateSellFee(t3, t3Pct);

  const totalProfitUsdRaw = profit1 + profit2 + profit3;
  const totalFeeUsd = buyFeeUsd + sellFee1 + sellFee2 + sellFee3;
  const totalNetProfitUsd = totalProfitUsdRaw - totalFeeUsd;
  const totalProfitPkr = totalNetProfitUsd * PKR_RATE;

  const stopSellFeeUsd = (coins * stop) * FEE_RATE;
  const expectedStopFeeUsd = buyFeeUsd + stopSellFeeUsd;
`;

code = code.replace(
  /const calculateRR = \([\s\S]*?const totalProfitPkr = totalProfitUsd \* PKR_RATE;/,
  calcProfitReplacement
);

code = code.replace(
  "else if (newStatus === 'HIT_SL') setRealizedProfit((-riskAmount).toString());",
  "else if (newStatus === 'HIT_SL') setRealizedProfit((-riskAmount - expectedStopFeeUsd).toString());"
);
code = code.replace(
  "else if (newStatus === 'HIT_TP1') setRealizedProfit(profit1.toString());",
  "else if (newStatus === 'HIT_TP1') setRealizedProfit((profit1 - buyFeeUsd - sellFee1).toString());"
);
code = code.replace(
  "else if (newStatus === 'HIT_TP2') setRealizedProfit((profit1 + profit2).toString());",
  "else if (newStatus === 'HIT_TP2') setRealizedProfit((profit1 + profit2 - buyFeeUsd - sellFee1 - sellFee2).toString());"
);
code = code.replace(
  "else if (newStatus === 'HIT_TP3') setRealizedProfit(totalProfitUsd.toString());",
  "else if (newStatus === 'HIT_TP3') setRealizedProfit(totalNetProfitUsd.toString());"
);

code = code.replace(
  "totalProfitUsd,",
  "totalProfitUsd: totalNetProfitUsd,\n        feeUsd: totalFeeUsd,"
);

fs.writeFileSync('src/components/EditTradeModal.tsx', code);
