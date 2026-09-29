const fs = require('fs');
let code = fs.readFileSync('src/components/History.tsx', 'utf-8');

// 1. Add List icon import
code = code.replace(
  `import { Trash2, Edit2, Activity, RefreshCw, Settings, Wallet } from 'lucide-react';`,
  `import { Trash2, Edit2, Activity, RefreshCw, Settings, Wallet, List, LayoutGrid } from 'lucide-react';`
);

// 2. Add state
code = code.replace(
  `const [isSyncing, setIsSyncing] = useState(false);`,
  `const [isSyncing, setIsSyncing] = useState(false);\n  const [compactView, setCompactView] = useState(() => localStorage.getItem('history_compact') === 'true');`
);

// 3. Persist compact view state logic (just use useEffect, wait let's just use inline or simple toggle)
const toggleCompact = `
  const toggleCompact = () => {
    const val = !compactView;
    setCompactView(val);
    localStorage.setItem('history_compact', val.toString());
  };
`;
code = code.replace(`  const syncBinance`, toggleCompact + `\n  const syncBinance`);

// 4. Update the header
const headerOld = `<div className="flex justify-between items-center px-1 mt-2">
        <h2 className="text-sm font-bold text-neutral-300">All Trades ({trades.length})</h2>
        <Button variant="ghost" size="icon" onClick={refreshTrades} className="text-neutral-500 hover:text-blue-400 h-8 w-8">
          <RefreshCw className={\`w-4 h-4 \${isRefreshing ? 'animate-spin text-blue-400' : ''}\`} />
        </Button>
      </div>`;
const headerNew = `<div className="flex justify-between items-center px-1 mt-2">
        <h2 className="text-sm font-bold text-neutral-300">All Trades ({trades.length})</h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={toggleCompact} className="text-neutral-500 hover:text-blue-400 h-8 w-8" title="Toggle Compact View">
            {compactView ? <LayoutGrid className="w-4 h-4" /> : <List className="w-4 h-4" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={refreshTrades} className="text-neutral-500 hover:text-blue-400 h-8 w-8" title="Refresh Trades">
            <RefreshCw className={\`w-4 h-4 \${isRefreshing ? 'animate-spin text-blue-400' : ''}\`} />
          </Button>
        </div>
      </div>`;
code = code.replace(headerOld, headerNew);

// 5. Add compact view rendering
const renderOld = `return (
            <div key={trade.id} className="bg-neutral-900 rounded-xl p-4 border border-neutral-800 shadow-sm relative">
              <div className="flex justify-between items-start mb-3">`;

const renderNew = `return (
            <div key={trade.id} className={\`bg-neutral-900 rounded-xl border border-neutral-800 shadow-sm relative \${compactView ? 'p-3 flex justify-between items-center' : 'p-4'}\`}>
              {compactView ? (
                <>
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-neutral-100">{trade.symbol || 'UNNAMED'}</h3>
                        <span className={\`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded-sm \${isLong ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}\`}>
                          {isLong ? 'LONG' : 'SHORT'}
                        </span>
                        <span className={\`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full border \${statusColors[tStatus]}\`}>
                          {statusLabels[tStatus] || tStatus}
                        </span>
                      </div>
                      <div className="text-xs text-neutral-500 flex items-center gap-2">
                        <span>Ent: <strong className="text-neutral-300">{trade.entryPrice}</strong></span>
                        <span>Size: <strong className="text-blue-400">{formatCurrency(trade.totalBuyUsd || 0)}</strong></span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <div className="text-right flex flex-col items-end justify-center">
                      {tStatus !== 'ACTIVE' && tStatus !== 'PENDING' ? (
                        <>
                          <span className="text-[10px] text-neutral-500 uppercase font-semibold">Realized PnL</span>
                          <span className={\`text-sm font-bold \${trade.realizedProfitUsd && trade.realizedProfitUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}\`}>
                            {trade.realizedProfitUsd && trade.realizedProfitUsd >= 0 ? '+' : ''}{formatCurrency(trade.realizedProfitUsd || 0)}
                          </span>
                        </>
                      ) : (
                        (() => {
                           const currentPrice = livePrices[trade.symbol];
                           if (!currentPrice || tStatus === 'PENDING') {
                              return (
                                <>
                                  <span className="text-[10px] text-neutral-500 uppercase font-semibold">Net Profit (Est)</span>
                                  <span className="text-emerald-400 text-sm font-bold">{formatCurrency(totalProfitUsd)}</span>
                                </>
                              );
                           }
                           const remainingCoins = (trade.positionSizeCoins || 0) * (1 - (trade.percentSold || 0)/100);
                           if (remainingCoins <= 0) return <span className="text-neutral-500 text-xs">Closed</span>;
                           const unrealizedPerCoin = isLong ? (currentPrice - trade.entryPrice) : (trade.entryPrice - currentPrice);
                           const currentPnL = remainingCoins * unrealizedPerCoin;
                           return (
                             <>
                               <span className="text-[10px] text-neutral-500 uppercase font-semibold">Live PnL</span>
                               <span className={\`text-sm font-bold \${currentPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}\`}>
                                  {currentPnL >= 0 ? '+' : ''}{formatCurrency(currentPnL)}
                               </span>
                             </>
                           );
                        })()
                      )}
                    </div>
                    
                    <div className="flex flex-col gap-1 ml-2 pl-2 border-l border-neutral-800">
                      <Button variant="ghost" size="icon" onClick={() => setEditingTrade(trade)} className="text-neutral-500 hover:text-blue-400 h-6 w-6">
                        <Edit2 className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => trade.id && handleDelete(trade.id)} className="text-neutral-500 hover:text-red-400 h-6 w-6">
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <>
              <div className="flex justify-between items-start mb-3">`;

code = code.replace(renderOld, renderNew);

const closeDivOld = `            </div>
          );
        })
      )}
      {editingTrade && (`;
const closeDivNew = `                </>
              )}
            </div>
          );
        })
      )}
      {editingTrade && (`;
code = code.replace(closeDivOld, closeDivNew);

fs.writeFileSync('src/components/History.tsx', code);
