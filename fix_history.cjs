const fs = require('fs');
let code = fs.readFileSync('src/components/History.tsx', 'utf-8');

code = code.replace(/trade\.totalBuyUsd \|\| 0/g, 'trade.totalBuyUsd || trade.positionSize || 0');
code = code.replace(/formatPrice\(trade\.entryPrice\)/g, 'formatPrice(trade.entryPrice, true)');
code = code.replace(/formatPrice\(trade\.stopLoss\)/g, 'trade.stopLoss ? formatPrice(trade.stopLoss, true) : "None"');

// Fix live PnL R multiple
const riskUiTarget1 = `              {formatCurrency(trade.riskAmount)}
              <span className="text-red-500/70 text-xs font-normal bg-red-500/10 px-1 rounded">
                -1.00R
              </span>`;
const riskUiReplacement1 = `              {formatCurrency(trade.riskAmount)}
              {trade.stopLoss > 0 && trade.riskAmount > 0 && (
                <span className="text-red-500/70 text-xs font-normal bg-red-500/10 px-1 rounded">
                  -1.00R
                </span>
              )}`;
code = code.replace(riskUiTarget1, riskUiReplacement1);

const riskUiTarget2 = `              <span className="text-neutral-500 text-[11px] uppercase font-semibold block mb-1">Risk (Loss)</span>
            <span className="text-red-400 font-bold flex flex-wrap items-center gap-1.5">
              {formatCurrency(trade.riskAmount)}
              {trade.stopLoss > 0 && trade.riskAmount > 0 && (
                <span className="text-red-500/70 text-xs font-normal bg-red-500/10 px-1 rounded">
                  -1.00R
                </span>
              )}
              {trade.portfolioSize ? (`;
              
const riskUiReplacement2 = `              <span className="text-neutral-500 text-[11px] uppercase font-semibold block mb-1">Risk (Loss)</span>
            <span className="text-red-400 font-bold flex flex-wrap items-center gap-1.5">
              {trade.stopLoss > 0 ? formatCurrency(trade.riskAmount) : "N/A"}
              {trade.stopLoss > 0 && trade.riskAmount > 0 && (
                <span className="text-red-500/70 text-xs font-normal bg-red-500/10 px-1 rounded">
                  -1.00R
                </span>
              )}
              {trade.portfolioSize && trade.stopLoss > 0 ? (`;
              
code = code.replace(riskUiTarget2, riskUiReplacement2);

const livePriceTarget = `               <span className="text-sm font-bold text-neutral-200">{livePrices[trade.symbol]}</span>`;
const livePriceReplacement = `               <span className="text-sm font-bold text-neutral-200">{formatPrice(livePrices[trade.symbol])}</span>`;
code = code.replace(livePriceTarget, livePriceReplacement);

const rMultipleTarget1 = `                      <span className={\`text-xs font-normal px-1 rounded \${currentPnL >= 0 ? 'text-emerald-500/70 bg-emerald-500/10' : 'text-red-500/70 bg-red-500/10'}\`}>
                        {trade.riskAmount > 0 ? (currentPnL / trade.riskAmount).toFixed(2) : 0}R
                      </span>`;
const rMultipleReplacement1 = `                      {trade.riskAmount > 0 && trade.stopLoss > 0 && (
                        <span className={\`text-xs font-normal px-1 rounded \${currentPnL >= 0 ? 'text-emerald-500/70 bg-emerald-500/10' : 'text-red-500/70 bg-red-500/10'}\`}>
                          {(currentPnL / trade.riskAmount).toFixed(2)}R
                        </span>
                      )}`;
code = code.replace(rMultipleTarget1, rMultipleReplacement1);

const rMultipleTarget2 = `                     <span className="text-emerald-500/70 text-xs font-normal bg-emerald-500/10 px-1 rounded">
                      {trade.riskAmount > 0 ? (totalProfitUsd / trade.riskAmount).toFixed(2) : 0}R
                    </span>`;
const rMultipleReplacement2 = `                     {trade.riskAmount > 0 && trade.stopLoss > 0 && (
                       <span className="text-emerald-500/70 text-xs font-normal bg-emerald-500/10 px-1 rounded">
                         {(totalProfitUsd / trade.riskAmount).toFixed(2)}R
                       </span>
                     )}`;
code = code.replace(rMultipleTarget2, rMultipleReplacement2);

fs.writeFileSync('src/components/History.tsx', code);
console.log("Fixed History formatting");
