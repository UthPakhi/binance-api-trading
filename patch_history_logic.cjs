const fs = require('fs');
let code = fs.readFileSync('src/components/History.tsx', 'utf-8');

// Update imports
code = code.replace(
  `import { Trash2, Edit2, Activity, RefreshCw, Settings, Wallet, List, LayoutGrid, CloudDownload } from 'lucide-react';`,
  `import { Trash2, Edit2, Activity, RefreshCw, Settings, Wallet, List, LayoutGrid, CloudDownload, ChevronDown, ChevronUp, Wand2 } from 'lucide-react';\nimport { updateDoc } from 'firebase/firestore';`
);

// Add local compact state and isCompact helper
const stateHookStr = `  const [showImportModal, setShowImportModal] = useState(false);`;
const stateHookReplacement = `  const [showImportModal, setShowImportModal] = useState(false);
  const [localCompact, setLocalCompact] = useState<Record<string, boolean>>({});
  const [syncingExecutions, setSyncingExecutions] = useState<Record<string, boolean>>({});

  const isTradeCompact = (tradeId: string) => {
    if (localCompact[tradeId] !== undefined) return localCompact[tradeId];
    return compactView;
  };

  const toggleLocalCompact = (tradeId: string) => {
    setLocalCompact(prev => ({ ...prev, [tradeId]: !isTradeCompact(tradeId) }));
  };

  const handleSyncExecutions = async (trade: Trade) => {
    if (!trade.id) return;
    setSyncingExecutions(prev => ({ ...prev, [trade.id]: true }));
    const toastId = toast.loading(\`Syncing executions for \${trade.symbol}...\`);
    try {
      const res = await fetch(\`/api/binance/myTrades?symbol=\${trade.symbol}&startTime=\${trade.createdAt}\`);
      const data = await res.json();
      
      if (data.status !== 'success') throw new Error(data.message);
      
      const tradesFromBinance = data.trades || [];
      if (tradesFromBinance.length === 0) {
         toast.error('No recent executions found on Binance.', { id: toastId });
         return;
      }

      // Find closing trades (Sells since this is Spot long mostly)
      const closingTrades = tradesFromBinance.filter((t: any) => !t.isBuyer);
      
      if (closingTrades.length === 0) {
         toast.error('No sell orders found since trade was opened.', { id: toastId });
         return;
      }

      let totalQty = 0;
      let totalValue = 0;
      let totalFeeUsd = 0;
      let lastTradeTime = trade.createdAt;

      closingTrades.forEach((t: any) => {
         const qty = parseFloat(t.qty);
         const price = parseFloat(t.price);
         totalQty += qty;
         totalValue += (qty * price);
         if (t.time > lastTradeTime) lastTradeTime = t.time;
         if (t.commissionAsset === 'USDT') {
            totalFeeUsd += parseFloat(t.commission);
         }
      });

      const avgExitPrice = totalValue / totalQty;
      const realizedPnL = totalValue - (totalQty * trade.entryPrice) - totalFeeUsd;
      
      await updateDoc(doc(db, 'trades', trade.id), {
         status: 'CLOSED_MANUAL',
         realizedProfitUsd: realizedPnL,
         feeUsd: totalFeeUsd,
         closedAt: lastTradeTime,
         notes: (trade.notes ? trade.notes + '\\n' : '') + \`Synced: Exited \${totalQty.toFixed(4)} at ~$\${avgExitPrice.toFixed(4)}\`
      });

      toast.success(\`Synced! Exited at $\${avgExitPrice.toFixed(4)}\`, { id: toastId });
    } catch (e) {
      console.error(e);
      toast.error('Failed to sync trade executions.', { id: toastId });
    } finally {
      setSyncingExecutions(prev => ({ ...prev, [trade.id]: false }));
    }
  };`;

code = code.replace(stateHookStr, stateHookReplacement);
fs.writeFileSync('src/components/History.tsx', code);
