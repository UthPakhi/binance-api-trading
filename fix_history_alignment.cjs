const fs = require('fs');
let code = fs.readFileSync('src/components/History.tsx', 'utf-8');

const targetStats = `<div className="text-xs text-neutral-500 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>Ent: <strong className="text-neutral-300">{formatPrice(trade.entryPrice, true)}</strong></span>
                  {tStatus === 'ACTIVE' && livePrices[trade.symbol] && (
                    <span>Live: <strong className="text-blue-300">{formatPrice(livePrices[trade.symbol])}</strong></span>
                  )}
                  <span>Size: <strong className="text-blue-400">{formatCurrency(trade.totalBuyUsd || (trade as any).positionSize || 0)}</strong></span>
                </div>`;

const replaceStats = `<div className="text-[11px] text-neutral-500 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 mt-0.5 whitespace-nowrap">
                  <span>Ent: <strong className="text-neutral-300">{formatPrice(trade.entryPrice, true)}</strong></span>
                  {tStatus === 'ACTIVE' && livePrices[trade.symbol] ? (
                    <span>Live: <strong className="text-blue-300">{formatPrice(livePrices[trade.symbol])}</strong></span>
                  ) : <span />}
                  <span className="col-span-2">Size: <strong className="text-blue-400">{formatCurrency(trade.totalBuyUsd || (trade as any).positionSize || 0)}</strong></span>
                </div>`;

code = code.replace(targetStats, replaceStats);

const targetRight = `<div className="text-right flex flex-col items-end justify-center">`;
const replaceRight = `<div className="text-right flex flex-col items-end justify-center min-w-[90px]">`;

code = code.replace(targetRight, replaceRight);

fs.writeFileSync('src/components/History.tsx', code);
