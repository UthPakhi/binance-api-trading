const fs = require('fs');
let code = fs.readFileSync('src/components/Calculator.tsx', 'utf-8');

// Stop loss pct
code = code.replace(
  '<label className="text-xs text-neutral-400 mb-1 block uppercase font-semibold">Stop Loss</label>',
  '<label className="text-xs text-neutral-400 mb-1 flex items-center uppercase font-semibold">Stop Loss {renderPctChange(stop)}</label>'
);

// TPs pct
code = code.replace(
  '<label className="text-[10px] text-neutral-400 mb-1 block uppercase font-semibold">TP 1</label>',
  '<label className="text-[10px] text-neutral-400 mb-1 flex items-center uppercase font-semibold">TP 1 {renderPctChange(t1)}</label>'
);
code = code.replace(
  '<label className="text-[10px] text-neutral-400 mb-1 block uppercase font-semibold">TP 2</label>',
  '<label className="text-[10px] text-neutral-400 mb-1 flex items-center uppercase font-semibold">TP 2 {renderPctChange(t2)}</label>'
);
code = code.replace(
  '<label className="text-[10px] text-neutral-400 mb-1 block uppercase font-semibold">TP 3</label>',
  '<label className="text-[10px] text-neutral-400 mb-1 flex items-center uppercase font-semibold">TP 3 {renderPctChange(t3)}</label>'
);

// Total Profit Area
code = code.replace(
  '<div className="text-sm text-neutral-300 font-semibold">Total Expected Profit</div>',
  `<div className="flex flex-col">
            <div className="text-sm text-neutral-300 font-semibold">Total Expected Net Profit</div>
            <div className="text-[10px] text-neutral-500 mt-0.5">Est. Fees: {formatCurrency(totalFeeUsd)}</div>
          </div>`
);
code = code.replace(
  '<div className="text-lg font-bold text-emerald-400">{formatCurrency(totalProfitUsd)}</div>',
  '<div className="text-lg font-bold text-emerald-400">{formatCurrency(totalNetProfitUsd)}</div>'
);

// Custom Profit inputs
const tp1New = `<Input 
                type="number" 
                className="text-sm font-medium text-emerald-400 h-8 px-2 text-right"
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
code = code.replace('<div className="text-sm font-medium text-emerald-400">{formatCurrency(profit1)}</div>', tp1New);

const tp2New = `<Input 
                type="number" 
                className="text-sm font-medium text-emerald-400 h-8 px-2 text-right"
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
code = code.replace('<div className="text-sm font-medium text-emerald-400">{formatCurrency(profit2)}</div>', tp2New);

const tp3New = `<Input 
                type="number" 
                className="text-sm font-medium text-emerald-400 h-8 px-2 text-right"
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
code = code.replace('<div className="text-sm font-medium text-emerald-400">{formatCurrency(profit3)}</div>', tp3New);

// Custom Risk / Buy inputs
const riskInput = `<div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 font-bold">$</span>
              <Input 
                type="number"
                className="text-lg font-bold text-red-400 h-10 pl-7 px-2 bg-neutral-950"
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
              />
            </div>`;
code = code.replace('<div className="text-xl font-bold text-red-400">{formatCurrency(riskAmount)}</div>', riskInput);

const buyInput = `<div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 font-bold">$</span>
              <Input 
                type="number"
                className="text-lg font-bold text-blue-400 h-10 pl-7 px-2 bg-neutral-950"
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
              />
            </div>`;
code = code.replace('<div className="text-xl font-bold text-blue-400">{formatCurrency(totalBuy)}</div>', buyInput);

fs.writeFileSync('src/components/Calculator.tsx', code);
