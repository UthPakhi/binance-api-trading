import React, { useState } from 'react';
import { auth, db } from '../lib/firebase';
import { deleteDoc, doc, collection, addDoc } from 'firebase/firestore';
import { Trade } from '../types';
import { Trash2, Edit2, Activity, RefreshCw, Settings, Wallet, List, LayoutGrid, CloudDownload, ChevronDown, ChevronUp, Wand2, LineChart } from 'lucide-react';
import { updateDoc } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { Button } from './Button';
import { EditTradeModal } from './EditTradeModal';
import { calculateLivePnL, calculateLivePnLPercent, calculatePortfolioStats, calculateRemainingCoins, formatPrice } from '../lib/tradeUtils';
import { useTradeContext } from '../lib/TradeContext';
import { Input } from './Input';
import { ImportTradeModal } from './ImportTradeModal';
import { ChartModal } from './ChartModal';

export function History() {
  const { trades, loading, livePrices, refreshTrades, isRefreshing, baseCapital, setBaseCapital } = useTradeContext();
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const [isEditingBase, setIsEditingBase] = useState(false);
  const [tempBaseCapital, setTempBaseCapital] = useState(baseCapital.toString());
  const [isSyncing, setIsSyncing] = useState(false);
  const [compactView, setCompactView] = useState(() => localStorage.getItem('history_compact') === 'true');
  const [showImportModal, setShowImportModal] = useState(false);
  const [chartTrade, setChartTrade] = useState<Trade | null>(null);
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
    const toastId = toast.loading(`Checking Binance trades for ${trade.symbol}...`);
    try {
      const res = await fetch(`/api/binance/analyze-trade?symbol=${encodeURIComponent(trade.symbol.trim())}`);
      const data = await res.json();
      
      if (data.status !== 'success') {
        throw new Error(data.message || 'Failed to analyze trade from Binance');
      }

      const { openBuys, recentSells } = data;

      // 1. If trade is currently active or pending:
      if (trade.status === 'ACTIVE' || trade.status === 'PENDING') {
        let updatePayload: any = {};
        let syncMessages: string[] = [];
        let modified = false;

        // Did the user close/sell this position on Binance?
        if (openBuys.count === 0 && recentSells.count > 0) {
          const realizedPnL = recentSells.totalProceeds - (recentSells.totalQty * trade.entryPrice) - recentSells.feesUsd;
          await updateDoc(doc(db, 'trades', trade.id), {
            status: 'CLOSED_MANUAL',
            realizedProfitUsd: realizedPnL,
            feeUsd: (trade.feeUsd || 0) + recentSells.feesUsd,
            closedAt: recentSells.time || Date.now(),
            notes: (trade.notes ? trade.notes + '\n' : '') + `Synced: Exited ${recentSells.totalQty.toFixed(4)} @ ~$${recentSells.avgExitPrice.toFixed(4)}`
          });
          toast.success(`Closed on Binance! Exited at $${recentSells.avgExitPrice.toFixed(4)} (PnL: $${realizedPnL.toFixed(2)})`, { id: toastId });
          return;
        }

        // Otherwise, sync the BUY data (running trade buy fills & fees)
        if (openBuys.count > 0) {
          updatePayload.status = 'ACTIVE';
          updatePayload.entryPrice = openBuys.avgEntryPrice;
          updatePayload.positionSizeCoins = openBuys.totalQty;
          updatePayload.totalBuyUsd = openBuys.totalCost;
          updatePayload.feeUsd = openBuys.feesUsd;
          updatePayload.filledAt = openBuys.time || trade.filledAt || Date.now();
          updatePayload.notes = (trade.notes ? trade.notes + '\n' : '') + `Synced ${openBuys.count} buy fill(s): Avg $${openBuys.avgEntryPrice.toFixed(4)}`;
          syncMessages.push(`Buys: ${openBuys.totalQty.toFixed(4)} @ $${openBuys.avgEntryPrice.toFixed(4)}`);
          modified = true;
        }

        // FETCH OPEN ORDERS FOR TP/SL SYNC
        try {
          const ordersRes = await fetch(`/api/binance/openOrders?symbol=${encodeURIComponent(trade.symbol.trim())}`);
          const ordersData = await ordersRes.json();
          if (ordersData.status === 'success' && Array.isArray(ordersData.orders)) {
             const sellOrders = ordersData.orders.filter((o: any) => o.side === 'SELL');
             const limitOrders = sellOrders.filter((o: any) => o.type === 'LIMIT' || o.type === 'LIMIT_MAKER');
             const stopOrders = sellOrders.filter((o: any) => o.type.includes('STOP'));
             
             const totalCoins = updatePayload.positionSizeCoins || trade.positionSizeCoins;
             
             if (totalCoins > 0 && sellOrders.length > 0) {
               // We will just replace TPs exactly as they appear in Binance open limit orders.
               let tps: number[] = [];
               let tpPcts: number[] = [];
               
               // Sort so lower prices are TP1, higher are TP2/3
               const sortedLimits = [...limitOrders].sort((a: any, b: any) => parseFloat(a.price) - parseFloat(b.price));
               
               sortedLimits.slice(0, 3).forEach((o: any) => {
                 tps.push(parseFloat(o.price));
                 tpPcts.push(Math.round((parseFloat(o.origQty) / totalCoins) * 100));
               });
               
               updatePayload.takeProfit1 = tps[0] || null;
               updatePayload.tp1Percent = tpPcts[0] || null;
               updatePayload.takeProfit2 = tps[1] || null;
               updatePayload.tp2Percent = tpPcts[1] || null;
               updatePayload.takeProfit3 = tps[2] || null;
               updatePayload.tp3Percent = tpPcts[2] || null;
               
               if (limitOrders.length > 0) {
                 modified = true;
                 syncMessages.push('TPs');
               }
               
               if (stopOrders.length > 0) {
                 const slPrice = parseFloat(stopOrders[0].stopPrice || stopOrders[0].price);
                 if (slPrice > 0) {
                   updatePayload.stopLoss = slPrice;
                 }
               }
             }
          }
        } catch (err) {
           console.warn('Open orders fetch failed', err);
        }

        if (modified) {
          await updateDoc(doc(db, 'trades', trade.id), updatePayload);
          toast.success(`Synced: ${syncMessages.join(', ')}`, { id: toastId });
        } else {
          toast.error(`No recent executions or open orders found on Binance for ${trade.symbol}.`, { id: toastId });
        }
        return;
      }

      // 2. If trade is already CLOSED or manual close sync:
      if (recentSells.count > 0) {
        const realizedPnL = recentSells.totalProceeds - (recentSells.totalQty * trade.entryPrice) - recentSells.feesUsd;
        await updateDoc(doc(db, 'trades', trade.id), {
          status: 'CLOSED_MANUAL',
          realizedProfitUsd: realizedPnL,
          feeUsd: recentSells.feesUsd,
          closedAt: recentSells.time || trade.closedAt || Date.now(),
          notes: (trade.notes ? trade.notes + '\n' : '') + `Synced Exit: ${recentSells.totalQty.toFixed(4)} @ ~$${recentSells.avgExitPrice.toFixed(4)}`
        });
        toast.success(`Synced exit: ${recentSells.totalQty.toFixed(4)} @ $${recentSells.avgExitPrice.toFixed(4)} (PnL: $${realizedPnL.toFixed(2)}, Fee: $${recentSells.feesUsd.toFixed(4)})`, { id: toastId });
        return;
      }

      toast.error(`No sell executions found on Binance for ${trade.symbol}.`, { id: toastId });
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Failed to sync trade executions.', { id: toastId });
    } finally {
      setSyncingExecutions(prev => ({ ...prev, [trade.id]: false }));
    }
  };

  const handleUpdateRunningFromBinance = async (tradeId: string, entry: number, size: number, feeUsd?: number) => {
    try {
      await updateDoc(doc(db, 'trades', tradeId), {
        entryPrice: entry,
        positionSizeCoins: Math.abs(size),
        totalBuyUsd: Math.abs(size) * entry,
        feeUsd: feeUsd !== undefined ? feeUsd : 0,
        notes: 'Updated & synced from Binance Spot holdings'
      });
      setShowImportModal(false);
      toast.success('Successfully synced running trade with Binance!');
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Failed to update running trade');
    }
  };


  const toggleCompact = () => {
    const newVal = !compactView;
    setCompactView(newVal);
    // When clicking the master toggle, wipe out ALL local overrides so they follow the master state
    setLocalCompact({});
    localStorage.setItem('history_compact', newVal.toString());
  };

  const syncBinance = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch('/api/binance/balance');
      const data = await res.json();
      if (data.status === 'success') {
        const bal = data.balance; // this is pure USDT available cash
        // We want availableCapital = bal
        // availableCapital = baseCapital + totalRealizedPnL - activeInitialCost
        // baseCapital = bal - totalRealizedPnL + activeInitialCost
        const newBaseCapital = bal - stats.totalRealizedPnL + stats.activeInitialCost;
        setTempBaseCapital(newBaseCapital.toFixed(2));
        setBaseCapital(newBaseCapital);
        setIsEditingBase(false);
        toast.success(`Synced successfully: $${bal.toFixed(2)} Available Cash`);
      } else {
        toast.error(data.message || 'Failed to sync with Binance');
      }
    } catch (e) {
      toast.error('Network error syncing with Binance');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSaveBaseCapital = () => {
    const val = parseFloat(tempBaseCapital);
    if (!isNaN(val) && val > 0) {
      setBaseCapital(val);
      setIsEditingBase(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'trades', id));
    } catch (error) {
      console.error("Error deleting trade:", error);
    }
  };

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
  const formatPkr = (val: number) => `₨${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(val)}`;

  if (loading) {
    return <div className="p-8 text-center text-neutral-400">Loading history...</div>;
  }

  const pkrRate = 285;
  const stats = calculatePortfolioStats(trades, baseCapital, livePrices);

  const isTradeClosed = (trade: Trade) => {
    const s = trade.status || 'ACTIVE';
    if (['CLOSED_MANUAL', 'HIT_SL', 'CLOSED_BREAK_EVEN', 'BREAK_EVEN', 'HIT_TP3'].includes(s)) {
      return true;
    }
    if (s === 'ACTIVE' || s === 'PENDING' || s === 'TARGET_BREAK_EVEN') {
      return false;
    }
    const remainingCoins = calculateRemainingCoins(trade);
    return remainingCoins <= 0;
  };

  const openTrades = trades.filter(t => !isTradeClosed(t));
  const activeTrades = openTrades.filter(t => t.status !== 'PENDING');
  const pendingTrades = openTrades.filter(t => t.status === 'PENDING');
  const closedTrades = trades
    .filter(t => isTradeClosed(t))
    .sort((a, b) => (b.closedAt || b.createdAt) - (a.closedAt || a.createdAt));

  const renderTradeCard = (trade: Trade, isClosedCard: boolean = false) => {
    const isLong = trade.entryPrice > trade.stopLoss;
    
    const getProfit = (tp?: number, pct?: number) => {
      if (!tp || !pct || !trade.entryPrice || !trade.positionSizeCoins) return null;
      const profitPerCoin = isLong ? (tp - trade.entryPrice) : (trade.entryPrice - tp);
      const soldCoins = trade.positionSizeCoins * (pct / 100);
      return soldCoins * profitPerCoin;
    };
    
    const getRR = (tp?: number) => {
      if (!tp || !trade.entryPrice || !trade.stopLoss) return null;
      const riskPerCoin = Math.abs(trade.entryPrice - trade.stopLoss);
      if (riskPerCoin === 0) return null;
      const profitPerCoin = isLong ? (tp - trade.entryPrice) : (trade.entryPrice - tp);
      return (profitPerCoin / riskPerCoin).toFixed(2);
    };
    const date = new Date(trade.createdAt).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const trPkrRate = trade.pkrRate || 285;
    const totalProfitUsd = trade.totalProfitUsd !== undefined ? trade.totalProfitUsd : (trade.tp1Profit || 0);

    const statusLabels: Record<string, string> = {
      PENDING: 'LIMIT/PENDING',
      ACTIVE: 'ACTIVE',
      TARGET_BREAK_EVEN: 'TARGET BE',
      HIT_TP1: 'HIT TP1',
      HIT_TP2: 'HIT TP2',
      HIT_TP3: 'HIT TP3',
      HIT_SL: 'HIT SL',
      CLOSED_MANUAL: 'CLOSED',
      CLOSED_BREAK_EVEN: 'BREAK EVEN',
      BREAK_EVEN: 'BREAK EVEN'
    };
    
    const statusColors: Record<string, string> = {
      PENDING: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      ACTIVE: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',
      TARGET_BREAK_EVEN: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      HIT_TP1: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      HIT_TP2: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      HIT_TP3: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      HIT_SL: 'bg-red-500/20 text-red-400 border-red-500/30',
      CLOSED_MANUAL: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      CLOSED_BREAK_EVEN: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',
      BREAK_EVEN: 'bg-neutral-500/20 text-neutral-300 border-neutral-500/30'
    };
    
    const tStatus = trade.status || 'ACTIVE';

    return (
      <div 
        key={trade.id} 
        className={`rounded-xl border shadow-sm relative transition-all ${
          isClosedCard 
            ? 'bg-neutral-900/75 border-neutral-800/80 hover:border-neutral-700/80' 
            : 'bg-neutral-900 border-neutral-800 hover:border-neutral-700'
        } ${
          isTradeCompact(trade.id || '') ? 'p-3 flex justify-between items-center' : 'p-4'
        }`}
      >
        {isTradeCompact(trade.id || '') ? (
          <>
            <div className="flex items-center gap-3">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-neutral-100">{trade.symbol || 'UNNAMED'}</h3>
                  <span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full border ${statusColors[tStatus]}`}>
                    {statusLabels[tStatus] || tStatus}
                  </span>
                </div>
                <div className="text-xs text-neutral-500 flex items-center gap-2">
                  <span>Ent: <strong className="text-neutral-300">{formatPrice(trade.entryPrice)}</strong></span>
                  <span>Size: <strong className="text-blue-400">{formatCurrency(trade.totalBuyUsd || 0)}</strong></span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="text-right flex flex-col items-end justify-center">
                {tStatus !== 'ACTIVE' && tStatus !== 'PENDING' ? (
                  <>
                    <span className="text-[10px] text-neutral-500 uppercase font-semibold">Realized PnL</span>
                    <span className={`text-sm font-bold ${trade.realizedProfitUsd && trade.realizedProfitUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {(trade.realizedProfitUsd !== undefined && trade.realizedProfitUsd >= 0) ? '+' : ''}{formatCurrency(trade.realizedProfitUsd || 0)}
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
                     const currentPnL = calculateLivePnL(trade, currentPrice);
                     return (
                       <>
                         <span className="text-[10px] text-neutral-500 uppercase font-semibold">Live PnL</span>
                         <span className={`text-sm font-bold ${currentPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {currentPnL >= 0 ? '+' : ''}{formatCurrency(currentPnL)}
                         </span>
                       </>
                     );
                  })()
                )}
              </div>
              
              <div className="flex items-center gap-1 ml-2 pl-2 border-l border-neutral-800">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={(e) => {
                    e.stopPropagation();
                    setChartTrade(trade);
                  }} 
                  className="text-neutral-500 hover:text-blue-400 h-6 w-6" 
                  title="View Chart"
                >
                  <LineChart className="w-3.5 h-3.5" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSyncExecutions(trade);
                  }} 
                  disabled={syncingExecutions[trade.id || '']} 
                  className="text-neutral-500 hover:text-blue-400 h-6 w-6" 
                  title="Sync Executions from Binance"
                >
                  <Wand2 className={`w-3.5 h-3.5 ${syncingExecutions[trade.id || ''] ? 'animate-pulse text-blue-400' : ''}`} />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => toggleLocalCompact(trade.id || '')} className="text-neutral-500 hover:text-white h-6 w-6" title="Toggle Expand">
                  <ChevronDown className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
        <div className="flex justify-between items-start mb-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-neutral-100">{trade.symbol || 'UNNAMED'}</h3>
              <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${statusColors[tStatus]}`}>
                {statusLabels[tStatus] || tStatus}
              </span>
            </div>
            <div className="text-xs text-neutral-500 mt-1 flex flex-col gap-0.5">
              <div>Placed: {date}</div>
              {trade.filledAt && tStatus !== 'PENDING' && (
                <div className="text-blue-400/80 text-[11px]">
                  Filled: {new Date(trade.filledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
              {trade.closedAt && ['HIT_SL', 'HIT_TP1', 'HIT_TP2', 'HIT_TP3', 'CLOSED_MANUAL', 'BREAK_EVEN'].includes(tStatus) && (
                <div className="text-neutral-400 text-[11px]">
                  Closed: {new Date(trade.closedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => setChartTrade(trade)} className="text-neutral-500 hover:text-blue-400 h-8 w-8" title="View Chart">
              <LineChart className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => handleSyncExecutions(trade)} disabled={syncingExecutions[trade.id || '']} className="text-neutral-500 hover:text-blue-400 h-8 w-8" title="Sync Executions from Binance">
              <Wand2 className={`w-4 h-4 ${syncingExecutions[trade.id || ''] ? 'animate-pulse text-blue-400' : ''}`} />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setEditingTrade(trade)} className="text-neutral-500 hover:text-emerald-400 h-8 w-8" title="Edit">
              <Edit2 className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => trade.id && handleDelete(trade.id)} className="text-neutral-500 hover:text-red-400 h-8 w-8" title="Delete">
              <Trash2 className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => toggleLocalCompact(trade.id || '')} className="text-neutral-400 hover:text-white h-8 w-8" title="Collapse">
              <ChevronUp className="w-5 h-5" />
            </Button>
          </div>
        </div>

        {tStatus !== 'ACTIVE' && tStatus !== 'PENDING' ? (
          <div className="bg-neutral-950 rounded-lg p-3 border border-neutral-800 mb-3 flex justify-between items-center">
             <div className="flex flex-col gap-0.5">
               <span className="text-xs text-neutral-400 font-semibold uppercase">Realized Net PnL</span>
             </div>
             <div className="text-right">
               <div className="flex items-center justify-end gap-2">
                 <div className={`text-sm font-bold ${trade.realizedProfitUsd && trade.realizedProfitUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                   {formatCurrency(trade.realizedProfitUsd || 0)}
                   {trade.portfolioSize ? (
                     <span className="text-xs font-normal ml-1 text-neutral-400">
                       {trade.realizedProfitUsd && trade.realizedProfitUsd >= 0 ? '+' : ''}{(((trade.realizedProfitUsd || 0) / trade.portfolioSize) * 100).toFixed(2)}%
                     </span>
                   ) : null}
                 </div>
                 <div className={`text-xs px-1.5 py-0.5 rounded font-bold ${(trade.realizedProfitUsd !== undefined && trade.realizedProfitUsd >= 0) ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                   {trade.riskAmount > 0 ? ((trade.realizedProfitUsd || 0) / trade.riskAmount).toFixed(2) : 0}R
                 </div>
               </div>
               <div className="text-[10px] text-neutral-500 mt-0.5 flex items-center justify-end gap-2">
                 {trade.feeUsd ? <span className="text-red-400/80">Fee: ${trade.feeUsd.toFixed(4)}</span> : null}
                 <span>{formatPkr((trade.realizedProfitUsd || 0) * trPkrRate)}</span>
               </div>
             </div>
          </div>
        ) : null}

        {tStatus !== 'CLOSED_MANUAL' && tStatus !== 'BREAK_EVEN' && tStatus !== 'HIT_SL' && tStatus !== 'HIT_TP3' && livePrices[trade.symbol] && (
          <div className="bg-blue-900/10 rounded-lg p-3 border border-blue-500/20 mb-3 flex flex-col gap-2">
             <div className="flex justify-between items-center border-b border-blue-500/20 pb-2">
               <span className="text-[10px] text-blue-400/80 font-semibold uppercase tracking-wider">Live Price</span>
               <span className="text-sm font-bold text-neutral-200">{livePrices[trade.symbol]}</span>
             </div>
             <div className="flex justify-between items-center pt-1">
               <div className="flex items-center gap-1.5">
                 <Activity className="w-4 h-4 text-blue-400 animate-pulse" />
                 <span className="text-[10px] text-blue-400/80 font-semibold uppercase tracking-wider">Live PnL</span>
               </div>
               <div className="text-right">
                 {(() => {
                    const currentPnL = calculateLivePnL(trade, livePrices[trade.symbol]);
                    const pnlPercent = calculateLivePnLPercent(trade, livePrices[trade.symbol]);
                    return (
                      <>
                        <div className="flex items-center justify-end gap-2">
                          <div className={`text-sm font-bold ${currentPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {formatCurrency(currentPnL)} <span className="text-xs font-normal">({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%)</span>
                          </div>
                        </div>
                        <div className="text-[10px] text-neutral-500 mt-0.5">{formatPkr(currentPnL * trPkrRate)}</div>
                      </>
                    );
                 })()}
               </div>
             </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-y-4 gap-x-2 text-sm mt-2">
          <div>
            {(() => {
              const currentPrice = livePrices[trade.symbol];
              if (tStatus === 'ACTIVE' && currentPrice) {
                const currentPnL = calculateLivePnL(trade, currentPrice);
                return (
                  <>
                    <span className="text-neutral-500 text-[11px] uppercase font-semibold block mb-1">Live PnL</span>
                    <span className={`font-bold flex items-center gap-2 ${currentPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {currentPnL >= 0 ? '+' : ''}{formatCurrency(currentPnL)}
                      <span className={`text-xs font-normal px-1 rounded ${currentPnL >= 0 ? 'text-emerald-500/70 bg-emerald-500/10' : 'text-red-500/70 bg-red-500/10'}`}>
                        {trade.riskAmount > 0 ? (currentPnL / trade.riskAmount).toFixed(2) : 0}R
                      </span>
                    </span>
                  </>
                );
              }
              return (
                <>
                  <span className="text-neutral-500 text-[11px] uppercase font-semibold block mb-1">Net Profit (Est)</span>
                  <span className="text-emerald-400 font-bold flex items-center gap-2">
                    {formatCurrency(totalProfitUsd)} 
                    <span className="text-emerald-500/70 text-xs font-normal bg-emerald-500/10 px-1 rounded">
                      {trade.riskAmount > 0 ? (totalProfitUsd / trade.riskAmount).toFixed(2) : 0}R
                    </span>
                  </span>
                </>
              );
            })()}
          </div>
          <div>
            <span className="text-neutral-500 text-[11px] uppercase font-semibold block mb-1">Risk (Loss)</span>
            <span className="text-red-400 font-bold flex flex-wrap items-center gap-1.5">
              {formatCurrency(trade.riskAmount)}
              <span className="text-red-500/70 text-xs font-normal bg-red-500/10 px-1 rounded">
                -1.00R
              </span>
              {trade.portfolioSize ? (
                <span className="text-neutral-500 text-[10px]">
                  ({((trade.riskAmount / trade.portfolioSize) * 100).toFixed(2)}%)
                </span>
              ) : null}
            </span>
          </div>
          <div>
            <span className="text-neutral-500 text-[11px] uppercase font-semibold block mb-1">Total Buy Size</span>
            <span className="text-blue-400 font-bold block">{formatCurrency(trade.totalBuyUsd || 0)}</span>
            <span className="text-blue-500/70 text-[9px] block">{trade.positionSizeCoins ? trade.positionSizeCoins.toFixed(4) : 0} coins</span>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-neutral-800 grid grid-cols-2 gap-y-2 text-xs">
          <div><span className="text-neutral-500">Entry:</span> <span className="text-neutral-300">{formatPrice(trade.entryPrice)}</span></div>
          <div><span className="text-neutral-500">Stop:</span> <span className="text-neutral-300">{formatPrice(trade.stopLoss)}</span></div>
          {trade.takeProfit1 ? (
            <div>
              <span className="text-neutral-500">TP1:</span> <span className="text-neutral-300">{formatPrice(trade.takeProfit1)} ({trade.tp1Percent || 0}%) {getRR(trade.takeProfit1) ? <span className="text-emerald-500/70 text-[10px] ml-1">[{getRR(trade.takeProfit1)}R]</span> : ''} {getProfit(trade.takeProfit1, trade.tp1Percent || 0) ? <span className="text-emerald-500/70 text-[10px] ml-1">({formatCurrency(getProfit(trade.takeProfit1, trade.tp1Percent || 0) as number)})</span> : ''}</span>
            </div>
          ) : <div/>}
          {trade.takeProfit2 ? (
            <div>
              <span className="text-neutral-500">TP2:</span> <span className="text-neutral-300">{formatPrice(trade.takeProfit2)} ({trade.tp2Percent || 0}%) {getRR(trade.takeProfit2) ? <span className="text-emerald-500/70 text-[10px] ml-1">[{getRR(trade.takeProfit2)}R]</span> : ''} {getProfit(trade.takeProfit2, trade.tp2Percent || 0) ? <span className="text-emerald-500/70 text-[10px] ml-1">({formatCurrency(getProfit(trade.takeProfit2, trade.tp2Percent || 0) as number)})</span> : ''}</span>
            </div>
          ) : <div/>}
          {trade.takeProfit3 ? (
            <div>
              <span className="text-neutral-500">TP3:</span> <span className="text-neutral-300">{formatPrice(trade.takeProfit3)} ({trade.tp3Percent || 0}%) {getRR(trade.takeProfit3) ? <span className="text-emerald-500/70 text-[10px] ml-1">[{getRR(trade.takeProfit3)}R]</span> : ''} {getProfit(trade.takeProfit3, trade.tp3Percent || 0) ? <span className="text-emerald-500/70 text-[10px] ml-1">({formatCurrency(getProfit(trade.takeProfit3, trade.tp3Percent || 0) as number)})</span> : ''}</span>
            </div>
          ) : <div/>}
        </div>

        {trade.notes && (
          <div className="mt-3 pt-3 border-t border-neutral-800">
            <span className="text-xs text-neutral-500 uppercase font-semibold block mb-1">Notes</span>
            <p className="text-sm text-neutral-300 italic bg-neutral-950 p-2 rounded border border-neutral-800/50">
              {trade.notes}
            </p>
          </div>
        )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4 pb-20">
      
      {/* Live Portfolio Dashboard */}
      <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-emerald-500"></div>
        <div className="flex justify-between items-center mb-4 mt-1">
          <h2 className="text-sm font-semibold text-neutral-100 uppercase tracking-wider">Live Portfolio</h2>
          <Button variant="ghost" size="icon" onClick={() => setIsEditingBase(!isEditingBase)} className="h-6 w-6 text-neutral-500 hover:text-white">
            <Settings className="w-4 h-4" />
          </Button>
        </div>

        {isEditingBase && (
          <div className="mb-4 bg-neutral-950 p-3 rounded-lg border border-neutral-800 flex gap-2 items-end">
            <div className="flex-1">
              <label className="text-[10px] text-neutral-400 mb-1 block uppercase font-semibold">Initial Base Capital ($)</label>
              <Input 
                type="number" 
                value={tempBaseCapital} 
                onChange={e => setTempBaseCapital(e.target.value)} 
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    handleSaveBaseCapital();
                  }
                }}
                className="h-9 text-sm"
              />
            </div>
            <Button variant="outline" size="icon" onClick={syncBinance} disabled={isSyncing} className="h-9 w-9 shrink-0 text-blue-400 border-blue-500/30 hover:bg-blue-500/10">
              <Wallet className={`w-4 h-4 ${isSyncing ? 'animate-pulse' : ''}`} />
            </Button>
            <Button size="sm" onClick={handleSaveBaseCapital} className="h-9">Save</Button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-y-6 gap-x-4">
          <div>
             <div className="text-xs text-neutral-500 mb-1 font-semibold uppercase">Total Equity</div>
             <div className="text-2xl font-bold text-white">
               {formatCurrency(stats.totalEquity)}
             </div>
             <div className="text-xs text-neutral-500 mt-1">{formatPkr(stats.totalEquity * pkrRate)}</div>
          </div>
          <div>
             <div className="text-xs text-neutral-500 mb-1 font-semibold uppercase">Available Cash</div>
             <div className="text-2xl font-bold text-emerald-400">
               {formatCurrency(stats.availableCapital)}
             </div>
             <div className="text-xs text-neutral-500 mt-1">{formatPkr(stats.availableCapital * pkrRate)}</div>
          </div>
        </div>
        
        <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-neutral-800">
          <div>
             <div className="text-[10px] text-neutral-500 mb-1 uppercase font-semibold">Total Active Risk</div>
             <div className="text-sm font-bold text-red-400">
               {formatCurrency(stats.totalActiveRisk || 0)}
               <span className="text-xs font-normal ml-1 text-neutral-400">
                 ({(((stats.totalActiveRisk || 0) / stats.totalEquity) * 100).toFixed(2)}%)
               </span>
             </div>
          </div>
          <div>
             <div className="text-[10px] text-neutral-500 mb-1 uppercase font-semibold">Net Realized PnL</div>
             <div className={`text-sm font-bold ${stats.totalRealizedPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
               {stats.totalRealizedPnL > 0 ? '+' : ''}{formatCurrency(stats.totalRealizedPnL)}
             </div>
          </div>
          <div>
             <div className="text-[10px] text-neutral-500 mb-1 uppercase font-semibold">Live Unrealized PnL</div>
             <div className={`text-sm font-bold ${stats.totalLiveUnrealizedPnL >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
               {stats.totalLiveUnrealizedPnL > 0 ? '+' : ''}{formatCurrency(stats.totalLiveUnrealizedPnL)}
             </div>
          </div>
        </div>
      </div>

      {/* Active Trades Header & Controls */}
      <div className="flex justify-between items-center px-1 mt-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-neutral-200">Open Trades ({openTrades.length})</h2>
          {activeTrades.length > 0 && (
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          )}
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={() => setShowImportModal(true)} className="text-neutral-500 hover:text-blue-400 h-8 w-8" title="Sync Live Position">
            <CloudDownload className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={toggleCompact} className="text-neutral-500 hover:text-blue-400 h-8 w-8" title="Toggle Compact View">
            {compactView ? <LayoutGrid className="w-4 h-4" /> : <List className="w-4 h-4" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={refreshTrades} className="text-neutral-500 hover:text-blue-400 h-8 w-8" title="Refresh Trades">
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-blue-400' : ''}`} />
          </Button>
        </div>
      </div>

      {trades.length === 0 ? (
        <div className="p-8 text-center bg-neutral-900 rounded-xl border border-neutral-800 shadow-sm">
          <p className="text-neutral-400">No trades saved yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Active Trades List */}
          {activeTrades.length > 0 && (
            activeTrades.map(t => renderTradeCard(t, false))
          )}
          
          {/* Pending Trades Section */}
          {pendingTrades.length > 0 && (
            <div className="flex flex-col gap-3 pt-2">
              <div className="relative mt-2 mb-1 flex items-center justify-center">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-yellow-500/20" />
                </div>
                <div className="relative bg-black px-3 text-[11px] font-bold uppercase tracking-wider text-yellow-500/80 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-500/50" />
                  <span>Limit Orders ({pendingTrades.length})</span>
                </div>
              </div>
              {pendingTrades.map(t => renderTradeCard(t, false))}
            </div>
          )}

          {openTrades.length === 0 && (
            <div className="p-4 text-center bg-neutral-900/60 rounded-xl border border-neutral-800/80 text-xs text-neutral-500">
              No active trades or limit orders running
            </div>
          )}

          {/* Separator Line & Closed Trades Section */}
          {closedTrades.length > 0 && (
            <div className="flex flex-col gap-3 pt-2">
              <div className="relative my-2 flex items-center justify-center">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-neutral-800" />
                </div>
                <div className="relative bg-black px-3 text-[11px] font-bold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-neutral-500" />
                  <span>Closed Trades ({closedTrades.length})</span>
                </div>
              </div>

              {closedTrades.map(t => renderTradeCard(t, true))}
            </div>
          )}
        </div>
      )}

      {editingTrade && (
        <EditTradeModal trade={editingTrade} onClose={() => setEditingTrade(null)} />
      )}
      {showImportModal && (
        <ImportTradeModal 
          onClose={() => setShowImportModal(false)}
          activeTrades={trades.filter(t => t.status === 'ACTIVE' || t.status === 'PENDING')}
          onUpdateRunning={handleUpdateRunningFromBinance}
          onSelect={async (sym, importedEntry, size, feeUsd, isPending) => {
            try {
              if (!auth.currentUser) {
                toast.error("Not logged in");
                return;
              }
              const newTrade = {
                userId: auth.currentUser.uid,
                symbol: sym,
                portfolioSize: stats.totalEquity || baseCapital,
                riskPercent: 1,
                entryPrice: importedEntry,
                stopLoss: 0,
                takeProfit1: 0,
                tp1Percent: 100,
                riskAmount: 0,
                positionSizeCoins: size,
                totalBuyUsd: size * importedEntry,
                feeUsd: feeUsd || 0,
                status: isPending ? 'PENDING' : 'ACTIVE',
                notes: isPending ? 'Imported Limit Order from Binance Spot' : 'Imported from Binance Spot',
                createdAt: Date.now(),
                pkrRate: 285
              };
              await addDoc(collection(db, 'trades'), newTrade);
              setShowImportModal(false);
              toast.success(`Imported ${sym}`);
            } catch (e) {
              console.error(e);
              toast.error("Failed to import trade");
            }
          }}
        />
      )}
      {chartTrade && (
        <ChartModal 
          trade={chartTrade}
          onClose={() => setChartTrade(null)}
        />
      )}
    </div>
  );
}
