const fs = require('fs');
let code = fs.readFileSync('src/components/History.tsx', 'utf-8');

// 1. Add getProfit
const getRRStr = `          const getRR = (tp?: number) => {`;
const getProfitStr = `          const getProfit = (tp?: number, pct?: number) => {
            if (!tp || !pct || !trade.entryPrice || !trade.positionSizeCoins) return null;
            const profitPerCoin = isLong ? (tp - trade.entryPrice) : (trade.entryPrice - tp);
            const soldCoins = trade.positionSizeCoins * (pct / 100);
            return soldCoins * profitPerCoin;
          };
          
          const getRR = (tp?: number) => {`;
code = code.replace(getRRStr, getProfitStr);

// 2. Update Realized PnL rendering
const realizedOld = `<div className={\`text-sm font-bold \${trade.realizedProfitUsd && trade.realizedProfitUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}\`}>
                         {formatCurrency(trade.realizedProfitUsd || 0)}
                       </div>`;
                       
const realizedNew = `<div className={\`text-sm font-bold \${trade.realizedProfitUsd && trade.realizedProfitUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}\`}>
                         {formatCurrency(trade.realizedProfitUsd || 0)}
                         {trade.portfolioSize ? (
                           <span className="text-xs font-normal ml-1 text-neutral-400">
                             {trade.realizedProfitUsd && trade.realizedProfitUsd >= 0 ? '+' : ''}{(((trade.realizedProfitUsd || 0) / trade.portfolioSize) * 100).toFixed(2)}%
                           </span>
                         ) : null}
                       </div>`;
code = code.replace(realizedOld, realizedNew);

// 3. Update TP renderings
const tp1Old = `<span className="text-neutral-500">TP1:</span> <span className="text-neutral-300">{trade.takeProfit1} ({trade.tp1Percent || 100}%) {getRR(trade.takeProfit1) ? <span className="text-emerald-500/70 text-[10px] ml-1">[{getRR(trade.takeProfit1)}R]</span> : ''}</span>`;
const tp1New = `<span className="text-neutral-500">TP1:</span> <span className="text-neutral-300">{trade.takeProfit1} ({trade.tp1Percent || 100}%) {getRR(trade.takeProfit1) ? <span className="text-emerald-500/70 text-[10px] ml-1">[{getRR(trade.takeProfit1)}R]</span> : ''} {getProfit(trade.takeProfit1, trade.tp1Percent || 100) ? <span className="text-emerald-500/70 text-[10px] ml-1">({formatCurrency(getProfit(trade.takeProfit1, trade.tp1Percent || 100) as number)})</span> : ''}</span>`;
code = code.replace(tp1Old, tp1New);

const tp2Old = `<span className="text-neutral-500">TP2:</span> <span className="text-neutral-300">{trade.takeProfit2} ({trade.tp2Percent || 0}%) {getRR(trade.takeProfit2) ? <span className="text-emerald-500/70 text-[10px] ml-1">[{getRR(trade.takeProfit2)}R]</span> : ''}</span>`;
const tp2New = `<span className="text-neutral-500">TP2:</span> <span className="text-neutral-300">{trade.takeProfit2} ({trade.tp2Percent || 0}%) {getRR(trade.takeProfit2) ? <span className="text-emerald-500/70 text-[10px] ml-1">[{getRR(trade.takeProfit2)}R]</span> : ''} {getProfit(trade.takeProfit2, trade.tp2Percent || 0) ? <span className="text-emerald-500/70 text-[10px] ml-1">({formatCurrency(getProfit(trade.takeProfit2, trade.tp2Percent || 0) as number)})</span> : ''}</span>`;
code = code.replace(tp2Old, tp2New);

const tp3Old = `<span className="text-neutral-500">TP3:</span> <span className="text-neutral-300">{trade.takeProfit3} ({trade.tp3Percent || 0}%) {getRR(trade.takeProfit3) ? <span className="text-emerald-500/70 text-[10px] ml-1">[{getRR(trade.takeProfit3)}R]</span> : ''}</span>`;
const tp3New = `<span className="text-neutral-500">TP3:</span> <span className="text-neutral-300">{trade.takeProfit3} ({trade.tp3Percent || 0}%) {getRR(trade.takeProfit3) ? <span className="text-emerald-500/70 text-[10px] ml-1">[{getRR(trade.takeProfit3)}R]</span> : ''} {getProfit(trade.takeProfit3, trade.tp3Percent || 0) ? <span className="text-emerald-500/70 text-[10px] ml-1">({formatCurrency(getProfit(trade.takeProfit3, trade.tp3Percent || 0) as number)})</span> : ''}</span>`;
code = code.replace(tp3Old, tp3New);

fs.writeFileSync('src/components/History.tsx', code);
console.log('Success');
