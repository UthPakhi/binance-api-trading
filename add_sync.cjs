const fs = require('fs');
let code = fs.readFileSync('src/lib/TradeContext.tsx', 'utf-8');

const target1 = `  // Fetch trades
  const fetchTrades = () => {`;

const insert1 = `
  const syncBinanceSpotPositions = useCallback(async () => {
    if (!auth.currentUser) return;
    try {
      const res = await fetch('/api/binance/positions');
      if (!res.ok) return;
      const data = await res.json();
      if (data.status !== 'success' || !Array.isArray(data.positions)) return;

      const binancePositions = data.positions; // [{ symbol, positionAmt, entryPrice, currentPrice, usdValue, isPendingOrder }]
      const activeOrPendingLocal = tradesRef.current.filter(t => !['CLOSED_MANUAL', 'HIT_SL', 'HIT_TP3'].includes(t.status || 'ACTIVE'));
      
      let promises = [];

      // 1. Sync existing local trades
      for (const trade of activeOrPendingLocal) {
        if (!trade.id) continue;
        
        const bp = binancePositions.find((p: any) => p.symbol === trade.symbol && !p.isPendingOrder);
        
        if (!bp || bp.usdValue < 5) {
          if (trade.status === 'ACTIVE') {
            // It was active but Binance says we have 0 balance, so it's fully closed
            promises.push(updateDoc(doc(db, 'trades', trade.id), {
              status: 'CLOSED_MANUAL',
              closedAt: Date.now(),
              notes: (trade.notes ? trade.notes + '\n' : '') + 'Auto-synced: Position fully closed on Binance'
            }).then(() => {
              toast.success(\`\${trade.symbol} Auto-Closed via Binance sync.\`);
            }));
          }
          continue;
        }

        // It is still active on Binance
        if (bp) {
           let updates: any = {};
           if (trade.status === 'PENDING') {
              updates.status = 'ACTIVE';
              updates.filledAt = Date.now();
           }
           
           const newQty = bp.positionAmt;
           const localQty = trade.positionSizeCoins || (trade.positionSize / trade.entryPrice);
           
           if (localQty > 0 && newQty < localQty * 0.99) {
             // Partial close!
             const closedQty = localQty - newQty;
             const pnlAdded = (bp.currentPrice - trade.entryPrice) * closedQty;
             updates.realizedProfitUsd = (trade.realizedProfitUsd || 0) + pnlAdded;
             updates.notes = (trade.notes ? trade.notes + '\n' : '') + \`Auto-synced: Partially closed \${closedQty.toFixed(4)} at ~$\${bp.currentPrice.toFixed(2)}\`;
             toast.success(\`\${trade.symbol} Auto-synced partial exit!\`, { icon: '📉' });
           }
           
           if (localQty > 0 && Math.abs(newQty - localQty) > localQty * 0.01) {
              updates.positionSizeCoins = newQty;
              updates.positionSize = newQty * trade.entryPrice; 
           }

           if (Object.keys(updates).length > 0) {
             promises.push(updateDoc(doc(db, 'trades', trade.id), updates));
           }
        }
      }

      // 2. Auto-import NEW active spot positions from Binance
      for (const bp of binancePositions) {
        if (bp.isPendingOrder || bp.usdValue < 5) continue;
        
        const existsLocally = activeOrPendingLocal.find(t => t.symbol === bp.symbol);
        if (!existsLocally) {
          // It's a new spot bag we don't have locally
          const newTrade = {
            userId: auth.currentUser.uid,
            symbol: bp.symbol,
            entryPrice: bp.entryPrice,
            stopLoss: bp.entryPrice * 0.85, // Default 15% SL placeholder
            positionSize: bp.usdValue,
            positionSizeCoins: bp.positionAmt,
            riskAmount: bp.usdValue * 0.15,
            status: 'ACTIVE',
            isLong: true,
            createdAt: Date.now(),
            filledAt: Date.now(),
            feeUsd: bp.feeUsd || 0,
            notes: 'Auto-imported from Binance Spot'
          };
          promises.push(
            addDoc(collection(db, 'trades'), newTrade).then(() => {
              toast.success(\`Auto-imported live position: \${bp.symbol}\`, { icon: '🔄' });
            })
          );
        }
      }
      
      await Promise.all(promises);
    } catch (e) {
      console.warn("Auto-sync error:", e);
    }
  }, []);

  // Fetch trades
  const fetchTrades = () => {`;

code = code.replace(target1, insert1);

const target2 = `    // Periodic check every 45 seconds for active/pending trades
    const interval = setInterval(() => {
      const hasActiveOrPending = tradesRef.current.some(t => 
        !['CLOSED_MANUAL', 'HIT_SL', 'HIT_TP3'].includes(t.status || 'ACTIVE')
      );
      if (hasActiveOrPending) {
        reconcileAll();
      }
    }, 45000);`;

const insert2 = `    // Periodic check every 15 seconds for real-time spot auto-sync
    const interval = setInterval(() => {
      syncBinanceSpotPositions();
      
      const hasActiveOrPending = tradesRef.current.some(t => 
        !['CLOSED_MANUAL', 'HIT_SL', 'HIT_TP3'].includes(t.status || 'ACTIVE')
      );
      if (hasActiveOrPending) {
        reconcileAll();
      }
    }, 15000);
    
    // Run an immediate spot sync on mount/visibility
    syncBinanceSpotPositions();`;

code = code.replace(target2, insert2);

fs.writeFileSync('src/lib/TradeContext.tsx', code);
console.log("Injected auto-sync into TradeContext!");
