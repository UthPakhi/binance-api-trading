const fs = require('fs');
let code = fs.readFileSync('src/components/Calculator.tsx', 'utf-8');

// 1. Add states for reverse calculation
code = code.replace(
  "const [notes, setNotes] = useState<string>(() => localStorage.getItem('calc_notes') || '');",
  `const [notes, setNotes] = useState<string>(() => localStorage.getItem('calc_notes') || '');
  const [customRiskAmount, setCustomRiskAmount] = useState<string>('');
  const [customTotalBuy, setCustomTotalBuy] = useState<string>('');
  const [customProfit1, setCustomProfit1] = useState<string>('');
  const [customProfit2, setCustomProfit2] = useState<string>('');
  const [customProfit3, setCustomProfit3] = useState<string>('');`
);

// 2. Add % calc helpers and reverse handlers
const beforeDerived = `
  const totalPct = t1Pct + t2Pct + t3Pct;
  const isPctValid = totalPct === 100;

  const getPctChange = (price: number) => {
    if (ent === 0 || price === 0) return 0;
    const isLong = ent > stop;
    const change = ((price - ent) / ent) * 100;
    return isLong ? change : -change;
  };

  const renderPctChange = (price: number) => {
    const pct = getPctChange(price);
    if (pct === 0) return null;
    const isPos = pct > 0;
    return (
      <span className={\`text-[10px] ml-2 \${isPos ? 'text-emerald-400' : 'text-red-400'}\`}>
        {isPos ? '+' : ''}{pct.toFixed(2)}%
      </span>
    );
  };
`;
code = code.replace(
  "const totalPct = t1Pct + t2Pct + t3Pct;\n  const isPctValid = totalPct === 100;",
  beforeDerived
);

const derivedUpdates = `
  const FEE_RATE = 0.001; // 0.1% Binance spot fee
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

  const totalProfitUsd = profit1 + profit2 + profit3;
  const totalSellFeeUsd = sellFee1 + sellFee2 + sellFee3;
  const totalFeeUsd = buyFeeUsd + totalSellFeeUsd;
  
  const totalNetProfitUsd = totalProfitUsd - totalFeeUsd;
  const totalProfitPkr = totalNetProfitUsd * PKR_RATE;

  const expectedPortfolioWin = pSize + totalNetProfitUsd;
  
  const stopSellFeeUsd = (coins * stop) * FEE_RATE;
  const expectedStopFeeUsd = buyFeeUsd + stopSellFeeUsd;
  const expectedPortfolioLoss = Math.max(0, pSize - riskAmount - expectedStopFeeUsd);
`;

code = code.replace(
  /const calculateRR = \([\s\S]*?const expectedPortfolioLoss = Math\.max\(0, pSize - riskAmount\);/,
  derivedUpdates
);

// 3. Update handleSave
code = code.replace(
  "totalProfitUsd,",
  "totalProfitUsd: totalNetProfitUsd,\n        feeUsd: totalFeeUsd,"
);

// 4. Add UI for SL and %
code = code.replace(
  `<label className="text-xs text-neutral-400 mb-1 block uppercase font-semibold">Stop Loss</label>`,
  `<label className="text-xs text-neutral-400 mb-1 block uppercase font-semibold">Stop Loss {renderPctChange(stop)}</label>`
);

// Add UI for TPs
code = code.replace(
  `<label className="text-[10px] text-neutral-400 mb-1 block uppercase font-semibold">TP 1</label>`,
  `<label className="text-[10px] text-neutral-400 mb-1 block uppercase font-semibold">TP 1 {renderPctChange(t1)}</label>`
);
code = code.replace(
  `<label className="text-[10px] text-neutral-400 mb-1 block uppercase font-semibold">TP 2</label>`,
  `<label className="text-[10px] text-neutral-400 mb-1 block uppercase font-semibold">TP 2 {renderPctChange(t2)}</label>`
);
code = code.replace(
  `<label className="text-[10px] text-neutral-400 mb-1 block uppercase font-semibold">TP 3</label>`,
  `<label className="text-[10px] text-neutral-400 mb-1 block uppercase font-semibold">TP 3 {renderPctChange(t3)}</label>`
);

// Update Total Profit Area to show fees
code = code.replace(
  `<div className="text-sm text-neutral-300 font-semibold">Total Expected Profit</div>`,
  `<div className="flex flex-col">
    <div className="text-sm text-neutral-300 font-semibold">Total Expected Net Profit</div>
    <div className="text-[10px] text-neutral-500 mt-0.5">Est. Fees: {formatCurrency(totalFeeUsd)}</div>
  </div>`
);
code = code.replace(
  `{formatCurrency(totalProfitUsd)}`,
  `{formatCurrency(totalNetProfitUsd)}`
);

// Risk Amount Input
code = code.replace(
  `<div className="text-xl font-bold text-red-400">{formatCurrency(riskAmount)}</div>`,
  `<Input 
    type="number"
    className="text-lg font-bold text-red-400 h-9 px-2"
    value={customRiskAmount !== '' ? customRiskAmount : (riskAmount > 0 ? riskAmount.toFixed(2) : '')}
    onChange={(e) => setCustomRiskAmount(e.target.value)}
    onBlur={() => {
       if (customRiskAmount !== '') {
         const val = parseFloat(customRiskAmount);
         if (!isNaN(val) && pSize > 0) {
           setRiskPercent(((val / pSize) * 100).toFixed(3));
         }
         setCustomRiskAmount('');
       }
    }}
  />`
);

// Total Buy Input
code = code.replace(
  `<div className="text-xl font-bold text-blue-400">{formatCurrency(totalBuy)}</div>`,
  `<Input 
    type="number"
    className="text-lg font-bold text-blue-400 h-9 px-2"
    value={customTotalBuy !== '' ? customTotalBuy : (totalBuy > 0 ? totalBuy.toFixed(2) : '')}
    onChange={(e) => setCustomTotalBuy(e.target.value)}
    onBlur={() => {
       if (customTotalBuy !== '') {
         const val = parseFloat(customTotalBuy);
         if (!isNaN(val) && ent > 0 && pSize > 0) {
           const c = val / ent;
           const rp = Math.abs(ent - stop);
           const newRisk = c * rp;
           setRiskPercent(((newRisk / pSize) * 100).toFixed(3));
         }
         setCustomTotalBuy('');
       }
    }}
  />`
);

// TP Profits Inputs
const tp1Replace = `<div className="text-sm font-medium text-emerald-400">{formatCurrency(profit1)}</div>`;
const tp1New = `<Input 
  type="number" 
  className="text-sm font-medium text-emerald-400 h-7 px-2 text-right"
  value={customProfit1 !== '' ? customProfit1 : (profit1 > 0 ? profit1.toFixed(2) : '')}
  onChange={(e) => setCustomProfit1(e.target.value)}
  onBlur={() => {
    if (customProfit1 !== '') {
      const p = parseFloat(customProfit1);
      if (!isNaN(p) && coins > 0 && t1Pct > 0) {
        const isL = ent > stop;
        const sC = coins * (t1Pct / 100);
        const pPC = p / sC;
        setTp1((isL ? ent + pPC : ent - pPC).toFixed(4));
      }
      setCustomProfit1('');
    }
  }}
/>`;
code = code.replace(tp1Replace, tp1New);

const tp2Replace = `<div className="text-sm font-medium text-emerald-400">{formatCurrency(profit2)}</div>`;
const tp2New = `<Input 
  type="number" 
  className="text-sm font-medium text-emerald-400 h-7 px-2 text-right"
  value={customProfit2 !== '' ? customProfit2 : (profit2 > 0 ? profit2.toFixed(2) : '')}
  onChange={(e) => setCustomProfit2(e.target.value)}
  onBlur={() => {
    if (customProfit2 !== '') {
      const p = parseFloat(customProfit2);
      if (!isNaN(p) && coins > 0 && t2Pct > 0) {
        const isL = ent > stop;
        const sC = coins * (t2Pct / 100);
        const pPC = p / sC;
        setTp2((isL ? ent + pPC : ent - pPC).toFixed(4));
      }
      setCustomProfit2('');
    }
  }}
/>`;
code = code.replace(tp2Replace, tp2New);

const tp3Replace = `<div className="text-sm font-medium text-emerald-400">{formatCurrency(profit3)}</div>`;
const tp3New = `<Input 
  type="number" 
  className="text-sm font-medium text-emerald-400 h-7 px-2 text-right"
  value={customProfit3 !== '' ? customProfit3 : (profit3 > 0 ? profit3.toFixed(2) : '')}
  onChange={(e) => setCustomProfit3(e.target.value)}
  onBlur={() => {
    if (customProfit3 !== '') {
      const p = parseFloat(customProfit3);
      if (!isNaN(p) && coins > 0 && t3Pct > 0) {
        const isL = ent > stop;
        const sC = coins * (t3Pct / 100);
        const pPC = p / sC;
        setTp3((isL ? ent + pPC : ent - pPC).toFixed(4));
      }
      setCustomProfit3('');
    }
  }}
/>`;
code = code.replace(tp3Replace, tp3New);

fs.writeFileSync('src/components/Calculator.tsx', code);
