import React, { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { auth, db } from '../lib/firebase';
import { deleteDoc, doc, collection, addDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { Trade, DisciplineTag, PnlViewMode } from '../types';
import { 
  Trash2, Edit2, Activity, RefreshCw, Settings, Wallet, List, LayoutGrid, 
  CloudDownload, ChevronDown, ChevronUp, Wand2, LineChart, RotateCcw, Target, 
  CheckCircle2, Zap, ArrowUpDown, Lock, Shield, Share2, Scissors, Info, Sparkles, Eye, EyeOff, Brain, Award, AlertTriangle 
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from './Button';
import { 
  calculateLivePnL, calculateLivePnLPercent, calculatePortfolioStats, 
  calculateRemainingCoins, calculateBlendedBreakeven, getTradeConsolidatedFees, 
  formatPrice, isAlphaTradeOrSymbol, getTradeIsLong, getTradeEffectiveRisk, 
  getTradeEffectiveRiskPercent, getTradeCoins, isTradeClosed, getTradeInvestedAmount, 
  isBinanceLimitOrder, isBinanceLinkedTrade, isLimitOrderTrade, groupTradesByTicker,
  formatCurrency, formatPkr, calculateTargetRR, calculateProfit, calculateTargetProfit,
  getTradeExitPrice, parseTradeNotesLineByLine,
  calculateRMultiple, formatPnlDisplay, isTp1Reached, isStopLossAtBreakeven, 
  DISCIPLINE_TAGS, calculateDisciplineStats, DisciplineStats,
  getTradeRiskFramework, calculateNormalizedRMultiple 
} from '../lib/tradeUtils';
import { calculateMergedDCA } from '../lib/tradeIngestion';
import { useTradeContext } from '../lib/TradeContext';
import { syncTradeWithBinance } from '../lib/binanceOrderSync';
import { Input } from './Input';
import { TradeProgressBar } from './TradeProgressBar';
import { PortfolioRiskCockpit } from './PortfolioRiskCockpit';
import { MultiTradeGroupCard } from './MultiTradeGroupCard';
import { DisciplineScorecard } from './DisciplineScorecard';

// Code-split heavy modals and charts to keep History light and instantaneous
const EditTradeModal = React.lazy(() => import('./EditTradeModal').then(m => ({ default: m.EditTradeModal })));
const ImportTradeModal = React.lazy(() => import('./ImportTradeModal').then(m => ({ default: m.ImportTradeModal })));
const ChartModal = React.lazy(() => import('./ChartModal').then(m => ({ default: m.ChartModal })));
const SharePnLModal = React.lazy(() => import('./SharePnLModal').then(m => ({ default: m.SharePnLModal })));
const TradeDetailDrawer = React.lazy(() => import('./TradeDetailDrawer').then(m => ({ default: m.TradeDetailDrawer })));
const DisciplineReviewModal = React.lazy(() => import('./DisciplineReviewModal').then(m => ({ default: m.DisciplineReviewModal })));

export function History() {
  const { 
    trades, 
    loading, 
    livePrices, 
    refreshTrades, 
    isRefreshing, 
    baseCapital, 
    setBaseCapital, 
    binanceBalance, 
    fetchBinanceBalance, 
    pkrRate: pkrRateFromContext, 
    viewMode, 
    setViewMode,
    isDemoMode,
    setIsDemoMode,
    feeTier,
    setFeeTier,
    isOnline,
    offlineQueueCount,
    saveTradeOptimistic,
    updateTradeOptimistic,
    deleteTradeOptimistic
  } = useTradeContext();
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const [sharingTrade, setSharingTrade] = useState<Trade | null>(null);
  const [inspectingTrade, setInspectingTrade] = useState<Trade | null>(null);
  const [privacyMode, setPrivacyMode] = useState<boolean>(() => localStorage.getItem('trade_sizer_privacy_mode') === 'true');
  const [reviewingDisciplineTrade, setReviewingDisciplineTrade] = useState<Trade | null>(null);

  const handleViewModeChange = async (mode: PnlViewMode) => {
    if (typeof setViewMode === 'function') {
      await setViewMode(mode);
    } else {
      try {
        localStorage.setItem('trade_sizer_view_mode', mode);
      } catch {}
    }
    const labels: Record<PnlViewMode, string> = {
      DOLLAR: 'Currency Mode ($ USD)',
      R_MULTIPLE: 'R-Multiple Mode (Risk Units)',
      PERCENT: 'Percentage Mode (%)',
      ZEN: 'Zen Mode (PnL Masked)'
    };
    toast.success(`Switched to ${labels[mode] || mode}`);
  };
  const [isEditingBase, setIsEditingBase] = useState(false);
  const [tempBaseCapital, setTempBaseCapital] = useState((baseCapital || 0).toString());
  const [isSyncing, setIsSyncing] = useState(false);
  const [compactView, setCompactView] = useState(() => localStorage.getItem('history_compact') === 'true');
  const [showImportModal, setShowImportModal] = useState(false);
  const [chartTrade, setChartTrade] = useState<Trade | null>(null);
  const [localCompact, setLocalCompact] = useState<Record<string, boolean>>({});
  const [syncingExecutions, setSyncingExecutions] = useState<Record<string, boolean>>({});
  const [categoryMenuTradeId, setCategoryMenuTradeId] = useState<string | null>(null);
  const [draggedTradeId, setDraggedTradeId] = useState<string | null>(null);
  const draggedTradeIdRef = useRef<string | null>(null);
  const isDraggingRef = useRef(false);
  const [activeDropTarget, setActiveDropTarget] = useState<'ACTIVE' | 'HOLDING' | 'PENDING' | 'CLOSED' | null>(null);
  const [sortBy, setSortBy] = useState<'INVESTED' | 'DATE' | 'PNL'>(() => {
    return (localStorage.getItem('history_sort_by') as 'INVESTED' | 'DATE' | 'PNL') || 'INVESTED';
  });
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [closedSortBy, setClosedSortBy] = useState<'DATE_DESC' | 'DATE_ASC' | 'PNL_DESC' | 'PNL_ASC' | 'SIZE' | 'FEES'>(() => {
    return (localStorage.getItem('history_closed_sort_by') as any) || 'DATE_DESC';
  });
  const [closedSortMenuOpen, setClosedSortMenuOpen] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('history_collapsed_sections');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const toggleSectionCollapse = (section: 'ACTIVE' | 'HOLDING' | 'PENDING' | 'CLOSED') => {
    setCollapsedSections(prev => {
      const next = { ...prev, [section]: !prev[section] };
      return next;
    });
    try {
      const saved = localStorage.getItem('history_collapsed_sections');
      const parsed = saved ? JSON.parse(saved) : {};
      parsed[section] = !parsed[section];
      localStorage.setItem('history_collapsed_sections', JSON.stringify(parsed));
    } catch {}
  };

  const isSectionCollapsed = (section: string) => Boolean(collapsedSections[section]);

  useEffect(() => {
    const handleOutsideClick = () => {
      setCategoryMenuTradeId(null);
      setSortMenuOpen(false);
      setClosedSortMenuOpen(false);
    };
    if (categoryMenuTradeId || sortMenuOpen || closedSortMenuOpen) {
      window.addEventListener('click', handleOutsideClick);
      return () => window.removeEventListener('click', handleOutsideClick);
    }
  }, [categoryMenuTradeId, sortMenuOpen, closedSortMenuOpen]);

  const handleSelectSort = (newSort: 'INVESTED' | 'DATE' | 'PNL') => {
    setSortBy(newSort);
    localStorage.setItem('history_sort_by', newSort);
    setSortMenuOpen(false);
    const labels: Record<string, string> = {
      INVESTED: 'Amount Invested (Most on top)',
      DATE: 'Date Added (Newest on top)',
      PNL: 'Unrealized PnL (Highest on top)'
    };
    toast.success(`Sorted by ${labels[newSort] || newSort}`);
  };

  const handleSelectClosedSort = (newSort: 'DATE_DESC' | 'DATE_ASC' | 'PNL_DESC' | 'PNL_ASC' | 'SIZE' | 'FEES') => {
    setClosedSortBy(newSort);
    localStorage.setItem('history_closed_sort_by', newSort);
    setClosedSortMenuOpen(false);
    const labels: Record<string, string> = {
      DATE_DESC: 'Newest Closed First',
      DATE_ASC: 'Oldest Closed First',
      PNL_DESC: 'Highest Profit First',
      PNL_ASC: 'Biggest Loss First',
      SIZE: 'Position Size (Largest on top)',
      FEES: 'Fees Paid (Highest on top)'
    };
    toast.success(`Closed trades sorted by ${labels[newSort] || newSort}`);
  };

  const isTradeCompact = (trade: Trade) => {
    if (trade.id && localCompact[trade.id] !== undefined) return localCompact[trade.id];
    if (trade.type === 'HOLDING') return true;
    return compactView;
  };

  const toggleLocalCompact = (trade: Trade) => {
    if (isDraggingRef.current) return;
    if (!trade.id) return;
    setLocalCompact(prev => ({ ...prev, [trade.id]: !isTradeCompact(trade) }));
  };

  const handleSyncExecutions = async (trade: Trade, silent = false) => {
    if (!trade.id) return;
    setSyncingExecutions(prev => ({ ...prev, [trade.id]: true }));
    const toastId = silent ? null : toast.loading(`Checking Binance trades & targets for ${trade.symbol}...`);
    try {
      const res = await syncTradeWithBinance(trade);
      if (toastId) {
        toast.dismiss(toastId);
        if (res.updated) {
          toast.success(`⚡ ${trade.symbol}: ${res.summary}`, { duration: 4500, icon: '🎯' });
        } else {
          toast.success(`${trade.symbol}: ${res.summary}`);
        }
      }
      await fetchBinanceBalance();
    } catch (e: any) {
      console.error(e);
      if (toastId) {
        toast.dismiss(toastId);
        toast.error(e.message || 'Failed to sync with Binance');
      }
    } finally {
      setSyncingExecutions(prev => ({ ...prev, [trade.id]: false }));
      fetchBinanceBalance();
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

  const togglePrivacyMode = () => {
    const next = !privacyMode;
    setPrivacyMode(next);
    try {
      localStorage.setItem('trade_sizer_privacy_mode', String(next));
    } catch {}
    toast.success(next ? '🔒 Privacy Mode Enabled (balances masked)' : '🔓 Privacy Mode Disabled');
  };

  const handleMoveToBreakeven = async (trade: Trade) => {
    if (!trade.id || !trade.entryPrice) return;
    try {
      const now = Date.now();
      const updatePayload: any = {
        stopLoss: trade.entryPrice,
        riskAmount: 0,
        riskPercent: 0,
        slUpdatedAt: now,
        updatedAt: now,
        status: trade.status === 'PENDING' ? 'PENDING' : 'ACTIVE',
        market: trade.market || (isAlphaTradeOrSymbol(trade) ? 'ALPHA' : 'SPOT'),
        notes: (trade.notes ? trade.notes + ' | ' : '') + 'Stop moved to Breakeven'
      };
      await updateTradeOptimistic(trade.id, updatePayload);
      toast.success(`🛡️ ${trade.symbol}: Stop Loss moved to Breakeven ($${formatPrice(trade.entryPrice, true)})`);
    } catch (err: any) {
      toast.error('Failed to update Stop Loss to Breakeven');
    }
  };

  const handleSetQuickSL = async (trade: Trade, newStopLoss: number) => {
    if (!trade.id || !trade.entryPrice) return;
    try {
      const coins = getTradeCoins(trade);
      const riskPerCoin = Math.abs(trade.entryPrice - newStopLoss);
      const newRiskAmount = coins > 0 ? coins * riskPerCoin : riskPerCoin;
      const effectivePortfolio = trade.portfolioSize || stats.totalEquity || baseCapital || 10000;
      const newRiskPercent = effectivePortfolio > 0 ? (newRiskAmount / effectivePortfolio) * 100 : 1;

      const updatedStopLoss = parseFloat(newStopLoss.toFixed(8));
      const updatedRiskAmount = parseFloat(newRiskAmount.toFixed(2));
      const updatedRiskPercent = parseFloat(newRiskPercent.toFixed(2));
      const now = Date.now();

      await updateTradeOptimistic(trade.id, {
        stopLoss: updatedStopLoss,
        riskAmount: updatedRiskAmount,
        riskPercent: updatedRiskPercent,
        slUpdatedAt: now,
        updatedAt: now,
        status: trade.status === 'PENDING' ? 'PENDING' : 'ACTIVE',
        market: trade.market || (isAlphaTradeOrSymbol(trade) ? 'ALPHA' : 'SPOT'),
        notes: (trade.notes ? trade.notes + ' | ' : '') + `Stop Loss set to $${formatPrice(newStopLoss, true)}`
      });
      toast.success(`🛡️ ${trade.symbol}: Stop Loss protected at $${formatPrice(newStopLoss, true)} (-$${newRiskAmount.toFixed(2)})`);
      if (inspectingTrade && inspectingTrade.id === trade.id) {
        setInspectingTrade({
          ...inspectingTrade,
          stopLoss: updatedStopLoss,
          riskAmount: updatedRiskAmount,
          riskPercent: updatedRiskPercent,
          slUpdatedAt: now,
          updatedAt: now
        });
      }
      await refreshTrades();
    } catch (err: any) {
      console.error(err);
      toast.error('Failed to set Stop Loss');
    }
  };

  const handleTrimPosition = async (trade: Trade, trimPercent: number = 50) => {
    if (!trade.id || !trade.entryPrice) return;
    const currentCoins = calculateRemainingCoins(trade);
    if (currentCoins <= 0.0001) {
      toast.error('No remaining coins to trim');
      return;
    }
    const currentPrice = livePrices[trade.symbol] || trade.entryPrice;
    const trimCoins = currentCoins * (trimPercent / 100);
    const isLong = getTradeIsLong(trade);
    const profitPerCoin = isLong ? (currentPrice - trade.entryPrice) : (trade.entryPrice - currentPrice);
    const realizedTrimProfit = trimCoins * profitPerCoin;
    const newSoldCoins = (trade.soldCoins || 0) + trimCoins;
    const newTotalRealized = (trade.realizedProfitUsd || 0) + realizedTrimProfit;

    try {
      await updateTradeOptimistic(trade.id, {
        status: 'PARTIAL_EXIT',
        soldCoins: newSoldCoins,
        realizedProfitUsd: newTotalRealized,
        updatedAt: Date.now(),
        notes: (trade.notes ? trade.notes + ' | ' : '') + `Trimmed ${trimPercent}% (${trimCoins.toLocaleString()} coins @ $${formatPrice(currentPrice)})`
      });
      toast.success(`✂️ Trimmed ${trimPercent}% of ${trade.symbol} (Banked ${realizedTrimProfit >= 0 ? '+' : ''}$${realizedTrimProfit.toFixed(2)})`);
    } catch (err: any) {
      toast.error('Failed to trim position');
    }
  };

  const handleReopenTrade = async (trade: Trade) => {
    if (!trade.id) return;
    try {
      const isPartial = Boolean((trade.soldCoins && trade.soldCoins > 0) || trade.notes?.includes('Partial Exit'));
      await updateTradeOptimistic(trade.id, {
        status: isPartial ? 'PARTIAL_EXIT' : 'ACTIVE',
        closedAt: null,
        updatedAt: Date.now(),
        notes: (trade.notes ? trade.notes + '\n' : '') + 'Reopened as Active trade'
      });
      toast.success(`Reopened ${trade.symbol} as Active!`);
    } catch (e: any) {
      toast.error('Failed to reopen trade');
    }
  };

  const handleActivatePendingTrade = async (_trade: Trade) => {
    toast.error('Limit orders cannot be activated manually. They activate and merge automatically when filled on Binance.');
    return;
  };

  const toggleCompact = () => {
    const newVal = !compactView;
    setCompactView(newVal);
    // When clicking the master toggle, wipe out ALL local overrides so they follow the master state
    setLocalCompact({});
    localStorage.setItem('history_compact', newVal.toString());
  };

  const fixDuplicates = async () => {
    toast.loading('Cleaning up duplicate Binance trades...');
    const seenOrderIds = new Set<string>();
    const seenTradeSignatures = new Set<string>();
    const pendingOrderKeys = new Set<string>();
    const deleteIds: string[] = [];
    
    // First pass: Index all pending limit orders
    for (const t of trades) {
      if (!t.id) continue;
      if (t.status === 'PENDING' && (t.notes?.includes('Binance') || t.binanceOrderId)) {
        const key = `${t.symbol}_${t.entryPrice}`;
        pendingOrderKeys.add(key);
      }
    }

    for (const t of trades) {
      if (!t.id) continue;

      // 1. Ghost Active Trade Check:
      // If an ACTIVE trade shares symbol & entry price with a PENDING limit order and was auto-imported/synced, it's a ghost trade
      if (t.status === 'ACTIVE' && (t.notes?.includes('Binance') || t.binanceOrderId)) {
        const key = `${t.symbol}_${t.entryPrice}`;
        if (pendingOrderKeys.has(key)) {
          deleteIds.push(t.id);
          continue;
        }
      }

      // 2. Explicit binanceOrderId matches an already seen trade -> duplicate
      if (t.binanceOrderId) {
        if (seenOrderIds.has(t.binanceOrderId)) {
          deleteIds.push(t.id);
          continue;
        }
        seenOrderIds.add(t.binanceOrderId);
      }

      // 3. Signature match for identical duplicate sync entries (same symbol, status, entry price, and size)
      const sig = `${t.symbol}_${t.status}_${t.entryPrice}_${t.positionSizeCoins || 0}`;
      if (seenTradeSignatures.has(sig)) {
        deleteIds.push(t.id);
      } else {
        seenTradeSignatures.add(sig);
      }
    }
    
    let count = 0;
    for (const id of deleteIds) {
      try {
        await deleteDoc(doc(db, 'trades', id));
        count++;
      } catch (e) {}
    }
    
    toast.dismiss();
    toast.success(`Cleaned up ${count} duplicates!`);
  };

  const syncBinance = async () => {
    setIsSyncing(true);
    try {
      const info = await fetchBinanceBalance();
      if (info) {
        // Also sync active Binance trades and check recently closed Binance trades for auto-healing
        const activeTrades = trades.filter(t => 
          !['CLOSED_MANUAL', 'HIT_SL', 'HIT_TP3'].includes(t.status || 'ACTIVE') &&
          (t.notes?.includes('Binance') || t.symbol)
        );
        for (const t of activeTrades) {
          try {
            await handleSyncExecutions(t, true);
          } catch (err) {
            console.warn(`Sync failed for ${t.symbol}`, err);
          }
        }

        // Calibrate baseCapital to match portfolio base
        const currentLivePnl = stats.totalLiveUnrealizedPnL || 0;
        const currentRealizedPnl = stats.totalRealizedPnL || 0;
        const newBaseCapital = info.totalEquity - currentRealizedPnl - currentLivePnl;
        setTempBaseCapital(newBaseCapital.toFixed(2));
        setBaseCapital(newBaseCapital);
        setIsEditingBase(false);
        await refreshTrades();
        toast.success(`Synced with Binance: $${info.totalEquity.toFixed(2)} Total Equity ($${info.usdtTotal.toFixed(2)} USDT)`);
      } else {
        toast.error('Failed to sync with Binance');
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
      const trade = trades.find(t => t.id === id);
      if (trade && (isBinanceLimitOrder(trade) || (trade.status === 'PENDING' && trade.binanceOrderId))) {
        toast.error('Binance limit orders cannot be deleted here. To remove it, cancel the order directly on Binance.');
        return;
      }
      await deleteTradeOptimistic(id);
      toast.success('Trade removed');
    } catch (error) {
      console.error("Error deleting trade:", error);
      toast.error('Failed to delete trade');
    }
  };

  const handleSetLimitOrderType = async (trade: Trade, newType: 'TRADE' | 'HOLDING') => {
    if (!trade.id) return;
    try {
      await updateTradeOptimistic(trade.id, {
        type: newType
        // Status remains PENDING so it stays in Limit Orders until filled/executed
      });
      const targetLabel = newType === 'HOLDING' ? 'Investments' : 'Active Trades';
      toast.success(`${trade.symbol} will route to ${targetLabel} when executed`);
    } catch (e: any) {
      console.error(e);
      toast.error('Failed to update limit order type: ' + (e?.message || e));
    }
  };

  const handleToggleTradeType = async (trade: Trade) => {
    if (!trade.id) return;
    const isLimit = isLimitOrderTrade(trade);
    const newType = trade.type === 'HOLDING' ? 'TRADE' : 'HOLDING';
    try {
      await updateDoc(doc(db, 'trades', trade.id), { 
        type: newType,
        ...(isLimit ? { status: 'ACTIVE' } : {})
      });
      toast.success(`Moved ${trade.symbol} to ${newType === 'HOLDING' ? 'Holdings' : 'Active Trades'}`);
    } catch (e) {
      console.error(e);
      toast.error('Failed to update trade classification');
    }
  };

  const handleDropToSection = async (tradeId: string, targetSection: 'ACTIVE' | 'HOLDING' | 'PENDING' | 'CLOSED') => {
    const trade = trades.find(t => t.id === tradeId);
    if (!trade || !trade.id) return;

    const isClosed = isTradeClosed(trade);
    const isPending = isLimitOrderTrade(trade);
    const isHolding = !isClosed && !isPending && trade.type === 'HOLDING';
    const isActive = !isClosed && !isPending && trade.type !== 'HOLDING';

    const currentSection: 'ACTIVE' | 'HOLDING' | 'PENDING' | 'CLOSED' = isClosed
      ? 'CLOSED'
      : isPending
        ? 'PENDING'
        : isHolding
          ? 'HOLDING'
          : 'ACTIVE';

    // If already in that section, do nothing
    if (currentSection === targetSection) return;

    try {
      if (targetSection === 'HOLDING') {
        await updateDoc(doc(db, 'trades', trade.id), {
          type: 'HOLDING',
          status: 'ACTIVE',
          closedAt: null
        });
        toast.success(`💎 Moved ${trade.symbol} to Investments (Holdings)!`);
      } else if (targetSection === 'ACTIVE') {
        const updateData: any = {
          type: 'TRADE',
          status: 'ACTIVE',
          closedAt: null
        };
        if (trade.soldCoins && trade.positionSizeCoins && trade.soldCoins >= trade.positionSizeCoins) {
          updateData.positionSizeCoins = trade.positionSizeCoins + trade.soldCoins;
        }
        await updateDoc(doc(db, 'trades', trade.id), updateData);
        toast.success(`⚡ Moved ${trade.symbol} to Active Trades!`);
      } else if (targetSection === 'PENDING') {
        await updateDoc(doc(db, 'trades', trade.id), {
          type: 'TRADE',
          status: 'PENDING',
          closedAt: null
        });
        toast.success(`⏳ Moved ${trade.symbol} to Limit Orders!`);
      } else if (targetSection === 'CLOSED') {
        if (isBinanceLimitOrder(trade)) {
          toast.error('Binance limit orders cannot be closed manually. Cancel the order directly on Binance.');
          return;
        }
        const currentPrice = livePrices[trade.symbol];
        let pnlAtClose = trade.realizedProfitUsd;
        let exitPrice = trade.exitPrice;
        if (pnlAtClose === undefined && currentPrice && trade.entryPrice) {
          pnlAtClose = calculateLivePnL(trade, currentPrice);
          exitPrice = currentPrice;
        }
        await updateDoc(doc(db, 'trades', trade.id), {
          status: 'CLOSED_MANUAL',
          closedAt: Date.now(),
          ...(pnlAtClose !== undefined ? { realizedProfitUsd: pnlAtClose } : {}),
          ...(exitPrice !== undefined ? { exitPrice } : {})
        });
        toast.success(`📁 Moved ${trade.symbol} to Closed Trades!`);
        // Prompt for post-trade discipline and emotional state check
        setReviewingDisciplineTrade({
          ...trade,
          status: 'CLOSED_MANUAL',
          closedAt: Date.now(),
          ...(pnlAtClose !== undefined ? { realizedProfitUsd: pnlAtClose } : {}),
          ...(exitPrice !== undefined ? { exitPrice } : {})
        });
      }
    } catch (e: any) {
      console.error(e);
      toast.error('Failed to move trade: ' + (e?.message || e));
    }
  };

  const renderCategoryBadge = (trade: Trade, isCompact: boolean) => {
    // Only limit trades have a dropdown to select the type of trade (Active Trade vs Investment).
    // All other trades (Active, Investments, Closed) do not show a change-section dropdown,
    // as section movement is handled via drag-and-drop.
    const isLimit = isLimitOrderTrade(trade);
    if (!isLimit) return null;

    const isOpen = categoryMenuTradeId === trade.id;
    const isHolding = trade.type === 'HOLDING';

    const badgeText = isHolding ? '💎 Investment' : '⚡ Trade';
    const badgeClass = isHolding
      ? 'bg-purple-950/60 text-purple-300 border-purple-800/80 hover:bg-purple-900/70 hover:border-purple-600'
      : 'bg-blue-950/60 text-blue-300 border-blue-800/80 hover:bg-blue-900/70 hover:border-blue-600';

    return (
      <div className="relative inline-block" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setCategoryMenuTradeId(isOpen ? null : (trade.id || null));
          }}
          className={`group flex items-center gap-1 font-semibold uppercase tracking-wider rounded border transition-all shrink-0 select-none ${
            isCompact ? 'text-[8px] sm:text-[9px] px-1.5 py-0.5' : 'text-[9px] px-2 py-0.5'
          } ${badgeClass}`}
          title="Select trade type (routes to this section when limit order executes)"
        >
          <span>{badgeText}</span>
          <ChevronDown className={`w-2.5 h-2.5 opacity-60 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {isOpen && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute left-0 mt-1.5 w-60 bg-neutral-900/95 border border-neutral-700/80 rounded-lg shadow-2xl backdrop-blur-md z-50 py-1.5 text-xs animate-in fade-in zoom-in-95 duration-100"
          >
            <div className="px-3 py-1.5 text-[10px] text-neutral-400 font-semibold uppercase tracking-wider border-b border-neutral-800 flex items-center justify-between">
              <span>When Executed Route To</span>
              <span className="text-[9px] text-neutral-500">{trade.symbol}</span>
            </div>

            <button
              type="button"
              onClick={() => {
                handleSetLimitOrderType(trade, 'TRADE');
                setCategoryMenuTradeId(null);
              }}
              className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-neutral-800 transition-colors ${
                !isHolding ? 'text-blue-400 font-bold bg-blue-500/10' : 'text-neutral-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.8)]" />
                <div className="flex flex-col">
                  <span className="font-semibold">⚡ Active Trade</span>
                  <span className="text-[10px] text-neutral-400">Moves to Active Trades on fill</span>
                </div>
              </div>
              {!isHolding && <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />}
            </button>

            <button
              type="button"
              onClick={() => {
                handleSetLimitOrderType(trade, 'HOLDING');
                setCategoryMenuTradeId(null);
              }}
              className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-neutral-800 transition-colors ${
                isHolding ? 'text-purple-400 font-bold bg-purple-500/10' : 'text-neutral-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-purple-400 shadow-[0_0_8px_rgba(192,132,252,0.8)]" />
                <div className="flex flex-col">
                  <span className="font-semibold">💎 Investment</span>
                  <span className="text-[10px] text-neutral-400">Moves to Investments on fill</span>
                </div>
              </div>
              {isHolding && <CheckCircle2 className="w-3.5 h-3.5 text-purple-400 shrink-0" />}
            </button>
          </div>
        )}
      </div>
    );
  };

  const fmtCurrency = (val: number) => formatCurrency(val, privacyMode);
  const fmtPkr = (val: number) => formatPkr(val, privacyMode);
  const pkrRate = pkrRateFromContext || 283.89;

  const getTradeAchievedPnL = (t: Trade): number => {
    if (t.realizedProfitUsd !== undefined && t.realizedProfitUsd !== null) {
      return t.realizedProfitUsd;
    }
    if (t.notes) {
      const match = t.notes.match(/PnL:\s*([+-]?\$?[\d,]+(?:\.\d+)?)/i);
      if (match && match[1]) {
        const parsed = parseFloat(match[1].replace('$', '').replace(/,/g, ''));
        if (!isNaN(parsed)) return parsed;
      }
    }
    if (t.exitPrice && t.entryPrice) {
      const isLongTrade = getTradeIsLong(t);
      const coins = t.positionSizeCoins || (t.entryPrice > 0 && t.totalBuyUsd ? t.totalBuyUsd / t.entryPrice : 0);
      if (coins > 0) {
        const diff = isLongTrade ? (t.exitPrice - t.entryPrice) : (t.entryPrice - t.exitPrice);
        const fee = t.totalFeesUsd || t.feeUsd || 0;
        return (diff * coins) - fee;
      }
    }
    if (t.totalSellUsd && t.totalBuyUsd) {
      return t.totalSellUsd - t.totalBuyUsd;
    }
    return 0;
  };

  const getTradeAchievedPnLPercent = (t: Trade, pnl: number): number | null => {
    const cost = t.totalBuyUsd || (t.positionSizeCoins && t.entryPrice ? t.positionSizeCoins * t.entryPrice : 0);
    if (cost > 0) {
      return (pnl / cost) * 100;
    }
    return null;
  };

  const stats = useMemo(() => {
    return calculatePortfolioStats(trades, baseCapital, livePrices, binanceBalance);
  }, [trades, baseCapital, livePrices, binanceBalance]);

  const { allOpen, activeTrades, holdings, pendingTrades, closedTrades } = useMemo(() => {
    const allOpenList: Trade[] = [];
    const closedList: Trade[] = [];
    for (const t of trades) {
      if (isTradeClosed(t)) {
        closedList.push(t);
      } else {
        allOpenList.push(t);
      }
    }

    const sortFn = (a: Trade, b: Trade) => {
      if (sortBy === 'INVESTED') {
        const invA = getTradeInvestedAmount(a);
        const invB = getTradeInvestedAmount(b);
        if (Math.abs(invB - invA) > 0.001) {
          return invB - invA; // Most invested on top
        }
        return (b.createdAt || 0) - (a.createdAt || 0);
      }
      if (sortBy === 'PNL') {
        const pnlA = calculateLivePnL(a, livePrices[a.symbol]);
        const pnlB = calculateLivePnL(b, livePrices[b.symbol]);
        return pnlB - pnlA;
      }
      return (b.createdAt || 0) - (a.createdAt || 0);
    };

    const pending: Trade[] = [];
    const nonLimit: Trade[] = [];
    for (const t of allOpenList) {
      if (isLimitOrderTrade(t)) {
        pending.push(t);
      } else {
        nonLimit.push(t);
      }
    }

    const holdingList: Trade[] = [];
    const activeList: Trade[] = [];
    for (const t of nonLimit) {
      if (t.type === 'HOLDING') {
        holdingList.push(t);
      } else {
        activeList.push(t);
      }
    }

    pending.sort(sortFn);
    holdingList.sort(sortFn);
    activeList.sort(sortFn);
    closedList.sort((a, b) => {
      const getClosedSortTime = (t: Trade) => {
        if (t.closedAt && t.closedAt > 1790600000000 && (t.createdAt || 0) < 1790200000000) {
          if ((t.symbol || '').toUpperCase().includes('SOL')) return 1789886765281;
          return t.filledAt || t.createdAt || 0;
        }
        return t.closedAt || t.filledAt || t.createdAt || 0;
      };

      if (closedSortBy === 'DATE_DESC') {
        return getClosedSortTime(b) - getClosedSortTime(a);
      }
      if (closedSortBy === 'DATE_ASC') {
        return getClosedSortTime(a) - getClosedSortTime(b);
      }
      if (closedSortBy === 'PNL_DESC') {
        const pnlA = getTradeAchievedPnL(a);
        const pnlB = getTradeAchievedPnL(b);
        return pnlB - pnlA;
      }
      if (closedSortBy === 'PNL_ASC') {
        const pnlA = getTradeAchievedPnL(a);
        const pnlB = getTradeAchievedPnL(b);
        return pnlA - pnlB;
      }
      if (closedSortBy === 'SIZE') {
        const sizeA = a.totalBuyUsd || ((a.positionSizeCoins || 0) * (a.entryPrice || 0));
        const sizeB = b.totalBuyUsd || ((b.positionSizeCoins || 0) * (b.entryPrice || 0));
        return sizeB - sizeA;
      }
      if (closedSortBy === 'FEES') {
        const feeA = a.totalFeesUsd ?? ((a.buyFeeUsd || 0) + (a.sellFeeUsd || 0) || a.feeUsd || 0);
        const feeB = b.totalFeesUsd ?? ((b.buyFeeUsd || 0) + (b.sellFeeUsd || 0) || b.feeUsd || 0);
        return feeB - feeA;
      }
      return getClosedSortTime(b) - getClosedSortTime(a);
    });

    return {
      allOpen: allOpenList,
      activeTrades: activeList,
      holdings: holdingList,
      pendingTrades: pending,
      closedTrades: closedList,
    };
  }, [trades, sortBy, closedSortBy, livePrices]);

  const activeTradeGroups = useMemo(() => {
    return groupTradesByTicker(activeTrades);
  }, [activeTrades]);

  const openTrades = activeTrades;

  const closedStats = useMemo(() => {
    let totalRealized = 0;
    let wins = 0;
    let losses = 0;
    for (const t of closedTrades) {
      const pnl = getTradeAchievedPnL(t);
      totalRealized += pnl;
      if (pnl > 0.001) wins++;
      else if (pnl < -0.001) losses++;
    }
    const totalDecided = wins + losses;
    const winRate = totalDecided > 0 ? Math.round((wins / totalDecided) * 100) : 0;
    return { totalRealized, wins, losses, winRate, count: closedTrades.length };
  }, [closedTrades]);

  const unprotectedTradesCount = useMemo(() => {
    return activeTrades.filter(t => !t.stopLoss || t.stopLoss <= 0).length;
  }, [activeTrades]);

  const portfolioRStats = useMemo(() => {
    let totalRealizedR = 0;
    let totalLiveUnrealizedR = 0;
    let totalActiveRiskR = 0;
    const effectivePortfolio = stats.totalEquity || baseCapital || 10000;

    for (const t of closedTrades) {
      const pnl = getTradeAchievedPnL(t);
      const norm = calculateNormalizedRMultiple(pnl, t, effectivePortfolio);
      totalRealizedR += norm.r;
    }

    for (const t of activeTrades) {
      const livePrice = livePrices[t.symbol];
      const framework = getTradeRiskFramework(t, effectivePortfolio);
      if (livePrice) {
        const livePnL = calculateLivePnL(t, livePrice);
        const norm = calculateNormalizedRMultiple(livePnL, t, effectivePortfolio);
        totalLiveUnrealizedR += norm.r;
      }
      if (framework.riskType === 'HARD_STOP') {
        totalActiveRiskR += (framework.effectiveRiskAmount / framework.portfolioRiskUnit);
      } else if (framework.riskType === 'PORTFOLIO_UNIT') {
        totalActiveRiskR += 1;
      }
    }

    return {
      totalRealizedR: parseFloat(totalRealizedR.toFixed(2)),
      totalLiveUnrealizedR: parseFloat(totalLiveUnrealizedR.toFixed(2)),
      totalActiveRiskR: parseFloat(totalActiveRiskR.toFixed(1))
    };
  }, [closedTrades, activeTrades, livePrices, stats.totalEquity, baseCapital]);

  const disciplineStats = useMemo(() => {
    return calculateDisciplineStats(closedTrades);
  }, [closedTrades]);

  if (loading && trades.length === 0) {
    return (
      <div className="space-y-4 animate-pulse p-1 sm:p-2">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-16 bg-neutral-900/60 rounded-xl border border-neutral-800/60" />
          ))}
        </div>
        <div className="h-10 bg-neutral-900/50 rounded-xl border border-neutral-800/50" />
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 bg-neutral-900/40 rounded-xl border border-neutral-800/40" />
          ))}
        </div>
      </div>
    );
  }

  const draggedTrade = draggedTradeId ? trades.find(t => t.id === draggedTradeId) : null;

  const renderTradeCard = (trade: Trade, currentSection: 'ACTIVE' | 'HOLDING' | 'PENDING' | 'CLOSED') => {
    const isClosedCard = currentSection === 'CLOSED';
    const isLong = getTradeIsLong(trade);
    
    const date = new Date(trade.createdAt).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const trPkrRate = trade.pkrRate || 285;
    const totalProfitUsd = trade.totalProfitUsd !== undefined ? trade.totalProfitUsd : (trade.tp1Profit || 0);
    const effectivePortfolio = trade.portfolioSize || stats.totalEquity || baseCapital || 10000;
    const framework = getTradeRiskFramework(trade, effectivePortfolio);
    const effectiveRiskAmount = framework.effectiveRiskAmount;
    const effectiveRiskPct = getTradeEffectiveRiskPercent(trade, effectivePortfolio);

    const statusLabels: Record<string, string> = {
      PENDING: 'LIMIT/PENDING',
      ACTIVE: 'ACTIVE',
      PARTIAL_EXIT: 'PARTIAL EXIT',
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
      PENDING: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
      ACTIVE: 'bg-neutral-800/80 text-neutral-300 border-neutral-700',
      PARTIAL_EXIT: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
      TARGET_BREAK_EVEN: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
      HIT_TP1: 'bg-cyan-500/20 text-cyan-200 border-cyan-500/30',
      HIT_TP2: 'bg-cyan-500/20 text-cyan-200 border-cyan-500/40',
      HIT_TP3: 'bg-blue-500/20 text-blue-200 border-blue-500/40',
      HIT_SL: 'bg-neutral-900 text-slate-400 border-neutral-700',
      CLOSED_MANUAL: 'bg-neutral-900 text-neutral-300 border-neutral-800',
      CLOSED_BREAK_EVEN: 'bg-neutral-900 text-neutral-300 border-neutral-800',
      BREAK_EVEN: 'bg-neutral-900 text-neutral-300 border-neutral-800'
    };
    
    const tStatus = trade.status || 'ACTIVE';
    const coins = getTradeCoins(trade);
    let soldPct = 0;
    if (trade.soldCoins && trade.positionSizeCoins && trade.positionSizeCoins > 0) {
      soldPct = Math.round((trade.soldCoins / trade.positionSizeCoins) * 100);
    } else if (trade.status === 'HIT_TP1') {
      soldPct = trade.tp1Percent || 50;
    } else if (trade.status === 'HIT_TP2') {
      soldPct = Math.min(100, (trade.tp1Percent || 50) + (trade.tp2Percent || 25));
    } else if (trade.status === 'PARTIAL_EXIT') {
      soldPct = trade.tp1Percent || 50;
    }

    const isBeingDragged = draggedTradeId === trade.id;

    return (
      <div 
        key={trade.id} 
        id={`trade-card-${trade.id}`}
        draggable={true}
        onDragStart={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest('button, input, select, a, [data-no-drag="true"]')) {
            e.preventDefault();
            return;
          }
          isDraggingRef.current = true;
          draggedTradeIdRef.current = trade.id || null;
          setDraggedTradeId(trade.id || null);
          try {
            e.dataTransfer.setData('text/plain', trade.id || '');
            e.dataTransfer.effectAllowed = 'move';
          } catch (_) {}
        }}
        onDragEnd={() => {
          isDraggingRef.current = false;
          draggedTradeIdRef.current = null;
          setDraggedTradeId(null);
          setActiveDropTarget(null);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (activeDropTarget !== currentSection) {
            setActiveDropTarget(currentSection);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = e.dataTransfer.getData('text/plain') || draggedTradeIdRef.current || draggedTradeId;
          if (id) {
            handleDropToSection(id, currentSection);
          }
          isDraggingRef.current = false;
          draggedTradeIdRef.current = null;
          setDraggedTradeId(null);
          setActiveDropTarget(null);
        }}
        className={`rounded-2xl border shadow-sm relative transition-all cursor-pointer select-none group ${
          isBeingDragged 
            ? 'opacity-30 scale-[0.99] border-dashed border-blue-500 bg-blue-500/5'
            : isClosedCard 
              ? 'bg-neutral-900/75 border-neutral-800/80 hover:border-neutral-700/80' 
              : 'bg-neutral-900 border-neutral-800 hover:border-neutral-700'
        } ${
          isTradeCompact(trade) ? 'px-3.5 py-2.5 sm:px-4 sm:py-3' : 'p-3.5 sm:p-4'
        }`}
        onClick={() => {
          if (isDraggingRef.current) return;
          if (isTradeCompact(trade)) {
            toggleLocalCompact(trade);
          }
        }}
      >
        {isTradeCompact(trade) ? (
          <div 
            className="flex items-center justify-between gap-2.5 select-none"
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div 
                className="flex flex-col gap-0.5 min-w-0 flex-1"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <h3 className="text-sm font-bold text-neutral-100 truncate">{trade.symbol || 'UNNAMED'}</h3>
                  {isAlphaTradeOrSymbol(trade) && (
                    <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-purple-950/60 text-purple-300 border border-purple-700/80 shrink-0">
                      ALPHA
                    </span>
                  )}
                  {(() => {
                    // Hide redundant "ACTIVE" and "PENDING" status badges since each has its dedicated section
                    if (tStatus === 'ACTIVE' || tStatus === 'PENDING') return null;
                    let badgeClass = statusColors[tStatus];
                    return (
                      <span className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded-full border shrink-0 ${badgeClass}`}>
                        {statusLabels[tStatus] || tStatus}
                      </span>
                    );
                  })()}
                  {renderCategoryBadge(trade, true)}
                </div>
                <div className="text-[10px] sm:text-[11px] text-neutral-500 flex items-center gap-x-2 whitespace-nowrap overflow-hidden">
                  {trade.type === 'HOLDING' ? (
                    <span>Invested: <strong className="text-purple-400 font-semibold">{viewMode === 'PERCENT' ? `${effectivePortfolio > 0 ? (((trade.totalBuyUsd || (trade as any).positionSize || 0) / effectivePortfolio) * 100).toFixed(1) : 0}%` : fmtCurrency(trade.totalBuyUsd || (trade as any).positionSize || 0)}</strong></span>
                  ) : (
                    <>
                      <span className="shrink-0">Ent: <strong className="text-neutral-300 font-semibold">{formatPrice(trade.entryPrice, viewMode !== 'PERCENT')}</strong></span>
                      {!isClosedCard && !isLimitOrderTrade(trade) && tStatus !== 'PENDING' && livePrices[trade.symbol] && (
                        <span className="shrink-0">Live: <strong className="text-blue-300 font-semibold">{formatPrice(livePrices[trade.symbol], viewMode !== 'PERCENT')}</strong></span>
                      )}
                      <span className="shrink-0">Size: <strong className="text-blue-400 font-semibold">{viewMode === 'PERCENT' ? `${effectivePortfolio > 0 ? (((trade.totalBuyUsd || (trade as any).positionSize || 0) / effectivePortfolio) * 100).toFixed(1) : 0}%` : fmtCurrency(trade.totalBuyUsd || (trade as any).positionSize || 0)}</strong></span>
                    </>
                  )}
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
              <div className="text-right flex flex-col items-end justify-center">
                {isClosedCard ? (
                  (() => {
                    const achievedPnL = getTradeAchievedPnL(trade);
                    const achievedPct = getTradeAchievedPnLPercent(trade, achievedPnL);
                    const normR = calculateNormalizedRMultiple(achievedPnL, trade, effectivePortfolio);
                    const rMult = normR.r;
                    return (
                      <>
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] text-neutral-500 uppercase font-semibold tracking-wider">Realized PnL</span>
                          {trade.disciplineTag && DISCIPLINE_TAGS[trade.disciplineTag] && (
                            <span 
                              className="text-[10px]" 
                              title={`Discipline: ${DISCIPLINE_TAGS[trade.disciplineTag].label}`}
                            >
                              {DISCIPLINE_TAGS[trade.disciplineTag].icon}
                            </span>
                          )}
                        </div>
                        <div className={`text-xs sm:text-sm font-bold flex items-center justify-end gap-1 ${achievedPnL >= 0 ? 'text-sky-400' : 'text-slate-400'}`}>
                          {viewMode === 'ZEN' || privacyMode ? (
                            <span>••••••</span>
                          ) : viewMode === 'R_MULTIPLE' ? (
                            <>
                              <span className="shrink-0">{rMult >= 0 ? '+' : ''}{rMult.toFixed(2)}R{normR.isNormalized ? '*' : ''}</span>
                              <span className="text-[9px] sm:text-[10px] font-normal opacity-80 shrink-0">
                                ({achievedPct !== null ? `${achievedPct >= 0 ? '+' : ''}${achievedPct.toFixed(1)}%` : fmtCurrency(achievedPnL)})
                              </span>
                            </>
                          ) : viewMode === 'PERCENT' && achievedPct !== null ? (
                            <span className="shrink-0">{achievedPct >= 0 ? '+' : ''}{achievedPct.toFixed(2)}%</span>
                          ) : (
                            <>
                              <span className="shrink-0">
                                {achievedPnL >= 0 ? '+' : ''}{fmtCurrency(achievedPnL)}
                              </span>
                              {achievedPct !== null && (
                                <span className="text-[9px] sm:text-[10px] font-normal opacity-80 shrink-0">
                                  ({achievedPct >= 0 ? '+' : ''}{achievedPct.toFixed(1)}%)
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </>
                    );
                  })()
                ) : trade.type === 'HOLDING' ? (
                  // User requirement: remove pnl from investment section when trade is collapsed
                  null
                ) : (isLimitOrderTrade(trade) || tStatus === 'PENDING') ? (
                  // Limit order summary with subtle drop % required to fill (shown once)
                  (() => {
                    const currentPrice = livePrices[trade.symbol];
                    if (!currentPrice) return null;
                    const dropPct = (trade.entryPrice && currentPrice > trade.entryPrice)
                      ? ((currentPrice - trade.entryPrice) / currentPrice) * 100
                      : 0;
                    return (
                      <>
                        <div className="flex items-center justify-end">
                          <span className="text-[9px] text-neutral-500 uppercase font-semibold tracking-wider">Live Price</span>
                        </div>
                        <div className="text-neutral-200 text-xs sm:text-sm font-bold font-mono flex items-center justify-end gap-1.5">
                          <span>{viewMode === 'PERCENT' ? formatPrice(currentPrice, false) : `$${formatPrice(currentPrice)}`}</span>
                          {dropPct > 0 ? (
                            <span 
                              className="text-[10px] text-slate-400 font-mono font-normal tracking-tight"
                              title={`Needs a ${dropPct.toFixed(2)}% drop to reach your limit order entry of ${formatPrice(trade.entryPrice, viewMode !== 'PERCENT')}`}
                            >
                              (-{dropPct.toFixed(1)}% to fill)
                            </span>
                          ) : (
                            <span className="text-[10px] text-sky-400 font-mono font-normal">
                              (At entry)
                            </span>
                          )}
                        </div>
                      </>
                    );
                  })()
                ) : (
                  (() => {
                     const currentPrice = livePrices[trade.symbol];
                     if (!currentPrice) return null;
                     const currentPnL = calculateLivePnL(trade, currentPrice);
                     const pnlPercent = calculateLivePnLPercent(trade, currentPrice);
                     const normR = calculateNormalizedRMultiple(currentPnL, trade, effectivePortfolio);
                     const rMult = normR.r;
                     return (
                       <>
                         <span className="text-[9px] text-neutral-500 uppercase font-semibold tracking-wider">
                           {viewMode === 'ZEN' ? 'Zen' : 'Live PnL'}
                         </span>
                         <div className={`text-xs sm:text-sm font-bold flex items-center justify-end gap-0.5 sm:gap-1 ${currentPnL >= 0 ? 'text-sky-400' : 'text-slate-400'}`}>
                           {viewMode === 'ZEN' || privacyMode ? (
                             <span className="text-neutral-400 font-normal">••••••</span>
                           ) : viewMode === 'R_MULTIPLE' ? (
                             <>
                               <span className="shrink-0">{rMult >= 0 ? '+' : ''}{rMult.toFixed(2)}R{normR.isNormalized ? '*' : ''}</span>
                               <span className="text-[9px] sm:text-[10px] font-normal opacity-85 shrink-0">
                                 ({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(1)}%)
                               </span>
                             </>
                           ) : viewMode === 'PERCENT' ? (
                             <span className="shrink-0">{pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%</span>
                           ) : (
                             <>
                               <span className="shrink-0">{currentPnL >= 0 ? '+' : '-'}{fmtCurrency(Math.abs(currentPnL))}</span>
                               <span className="text-[9px] sm:text-[10px] font-normal opacity-85 shrink-0">
                                 ({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%)
                               </span>
                             </>
                           )}
                         </div>
                       </>
                     );
                  })()
                )}
              </div>
              
              <div className="flex items-center pl-2 border-l border-neutral-800 shrink-0">
                <div 
                  className="text-neutral-400 group-hover:text-neutral-200 transition-colors p-0.5" 
                  title="Expand trade"
                >
                  <ChevronDown className="w-4 h-4 text-neutral-400 group-hover:text-neutral-200 transition-transform" />
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
        <div className="flex justify-between items-start mb-3">
          <div>
            <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-neutral-100">{trade.symbol || 'UNNAMED'}</h3>
              {isAlphaTradeOrSymbol(trade) && (
                <span className="text-[10px] uppercase font-extrabold px-2 py-0.5 rounded bg-purple-950/60 text-purple-300 border border-purple-700/80">
                  ALPHA • DEX
                </span>
              )}
              {(() => {
                // Hide redundant "ACTIVE" status badge on active trades and investments
                if (tStatus === 'ACTIVE') return null;
                const currentPrice = livePrices[trade.symbol];
                let badgeClass = statusColors[tStatus];
                return (
                  <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${badgeClass}`}>
                    {statusLabels[tStatus] || tStatus}
                  </span>
                );
              })()}
              {renderCategoryBadge(trade, false)}
            </div>
            <div className="text-xs text-neutral-500 mt-1 flex flex-col gap-0.5">
              <div>Placed: {date}</div>
              {trade.filledAt && tStatus !== 'PENDING' && (
                <div className="text-blue-400/80 text-[11px]">
                  Filled: {new Date(trade.filledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
              {trade.closedAt && isClosedCard && (
                <div className="text-neutral-400 text-[11px]">
                  Closed: {new Date(trade.closedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
            <Button variant="ghost" size="icon" onClick={() => setChartTrade(trade)} className="text-neutral-500 hover:text-blue-400 h-7 w-7 sm:h-8 sm:w-8" title="View Chart">
              <LineChart className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => handleSyncExecutions(trade)} disabled={syncingExecutions[trade.id || '']} className="text-neutral-500 hover:text-blue-400 h-7 w-7 sm:h-8 sm:w-8" title="Sync Executions from Binance">
              <Wand2 className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${syncingExecutions[trade.id || ''] ? 'animate-pulse text-blue-400' : ''}`} />
            </Button>
            {['CLOSED_MANUAL', 'HIT_SL', 'HIT_TP3', 'BREAK_EVEN'].includes(tStatus) && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleReopenTrade(trade)}
                className="text-neutral-500 hover:text-sky-400 h-7 w-7 sm:h-8 sm:w-8"
                title="Reopen as Active Trade"
              >
                <RotateCcw className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={() => setEditingTrade(trade)} className="text-neutral-500 hover:text-sky-400 h-7 w-7 sm:h-8 sm:w-8" title="Edit">
              <Edit2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </Button>
            {isBinanceLimitOrder(trade) ? (
              <div 
                className="flex items-center gap-1 text-[10px] text-amber-400/90 bg-amber-950/40 border border-amber-800/60 px-2 py-1 rounded cursor-not-allowed select-none"
                title="Limit order imported from Binance cannot be deleted manually. Cancel the order on Binance to remove it."
              >
                <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="hidden sm:inline font-mono text-[9px]">Binance</span>
              </div>
            ) : (
              <Button variant="ghost" size="icon" onClick={() => trade.id && handleDelete(trade.id)} className="text-neutral-500 hover:text-slate-300 h-7 w-7 sm:h-8 sm:w-8" title="Delete">
                <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={() => toggleLocalCompact(trade)} className="text-neutral-400 hover:text-white h-7 w-7 sm:h-8 sm:w-8" title="Collapse">
              <ChevronUp className="w-4 h-4 sm:w-5 sm:h-5" />
            </Button>
          </div>
        </div>

        {/* Core Metric Grid - Unified, High-Density, Zero Duplication */}
        <div className="bg-neutral-950/70 rounded-xl p-2.5 sm:p-3 border border-neutral-800/80 mb-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
          {/* Col 1: PnL / Performance */}
          <div>
            {isClosedCard ? (
              (() => {
                const achievedPnL = getTradeAchievedPnL(trade);
                const achievedPct = getTradeAchievedPnLPercent(trade, achievedPnL);
                const isWin = achievedPnL >= 0;
                const normR = calculateNormalizedRMultiple(achievedPnL, trade, effectivePortfolio);
                const rMultiple = normR.r.toFixed(2);
                const isNormR = normR.isNormalized;
                return (
                  <div>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[10px] text-neutral-500 uppercase font-semibold">Realized PnL</span>
                      {trade.disciplineTag && DISCIPLINE_TAGS[trade.disciplineTag] && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setReviewingDisciplineTrade(trade);
                          }}
                          className={`text-[9px] font-semibold px-1.5 py-0.2 rounded-full border transition-transform hover:scale-105 ${DISCIPLINE_TAGS[trade.disciplineTag].badgeClass}`}
                          title="Click to view/edit discipline reflection"
                        >
                          {DISCIPLINE_TAGS[trade.disciplineTag].icon} {DISCIPLINE_TAGS[trade.disciplineTag].shortLabel}
                        </button>
                      )}
                    </div>
                    <div className={`text-sm font-bold font-mono flex items-center gap-1 ${isWin ? 'text-blue-300' : 'text-slate-400'}`}>
                      {viewMode === 'ZEN' || privacyMode ? (
                        <span>••••••</span>
                      ) : viewMode === 'R_MULTIPLE' ? (
                        <>
                          <span className="text-base font-extrabold">{isWin ? '+' : ''}{rMultiple}R{isNormR ? '*' : ''}</span>
                          <span className="text-[10px] font-normal opacity-80">({isWin ? '+' : ''}{fmtCurrency(achievedPnL)})</span>
                        </>
                      ) : viewMode === 'PERCENT' && achievedPct !== null ? (
                        <>
                          <span className="text-base font-extrabold">{achievedPct >= 0 ? '+' : ''}{achievedPct.toFixed(2)}%</span>
                          <span className="text-[10px] opacity-80 font-normal">[{isWin ? '+' : ''}{rMultiple}R{isNormR ? '*' : ''}]</span>
                        </>
                      ) : (
                        <>
                          <span>{isWin ? '+' : ''}{fmtCurrency(achievedPnL)}</span>
                          <span className={`text-[10px] px-1 py-0.2 rounded font-semibold ${isWin ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' : 'bg-neutral-800 text-slate-400 border border-neutral-700'}`}>
                            {isWin ? '+' : ''}{rMultiple}R{isNormR ? '*' : ''}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="text-[10px] text-neutral-500 font-mono mt-0.5">
                      {viewMode === 'ZEN' || privacyMode
                        ? 'Zen Stealth Mode'
                        : viewMode === 'PERCENT'
                          ? `Closed Return (${achievedPct !== null ? `${achievedPct >= 0 ? '+' : ''}${achievedPct.toFixed(1)}%` : '0%'})`
                          : (achievedPct !== null ? `${achievedPct >= 0 ? '+' : ''}${achievedPct.toFixed(1)}%` : fmtPkr(achievedPnL * trPkrRate))}
                    </div>
                  </div>
                );
              })()
            ) : tStatus === 'PENDING' || isLimitOrderTrade(trade) ? (
              <div>
                <span className="text-[10px] text-neutral-500 uppercase font-semibold block mb-0.5">Target Profit</span>
                <div className="text-sm font-bold font-mono text-blue-300">
                  {viewMode === 'ZEN' || privacyMode ? (
                    '••••••'
                  ) : viewMode === 'PERCENT' ? (
                    <span>+{effectivePortfolio > 0 ? ((totalProfitUsd / effectivePortfolio) * 100).toFixed(2) : 0}% Target</span>
                  ) : viewMode === 'R_MULTIPLE' && framework.portfolioRiskUnit > 0 ? (
                    `+${(totalProfitUsd / framework.portfolioRiskUnit).toFixed(1)}R Target`
                  ) : (
                    <>
                      {fmtCurrency(totalProfitUsd)}
                      {framework.portfolioRiskUnit > 0 && (
                        <span className="text-[10px] ml-1 text-blue-300/80 font-normal">
                          [+{(totalProfitUsd / framework.portfolioRiskUnit).toFixed(1)}R]
                        </span>
                      )}
                    </>
                  )}
                </div>
                <div className="text-[10px] text-blue-400/80 font-mono mt-0.5">
                  Limit Pending
                </div>
              </div>
            ) : (
              (() => {
                const currentPrice = livePrices[trade.symbol];
                const currentPnL = currentPrice ? calculateLivePnL(trade, currentPrice) : 0;
                const pnlPercent = currentPrice ? calculateLivePnLPercent(trade, currentPrice) : 0;
                const isPos = currentPnL >= 0;
                const normR = calculateNormalizedRMultiple(currentPnL, trade, effectivePortfolio);
                const rMultiple = normR.r.toFixed(2);
                const isNormR = normR.isNormalized;
                return (
                  <div>
                    <span className="text-[10px] text-neutral-500 uppercase font-semibold block mb-0.5">
                      {viewMode === 'ZEN' ? 'Zen State' : 'Live PnL'}
                    </span>
                    <div className={`text-sm font-bold font-mono flex items-center gap-1 ${isPos ? 'text-blue-300' : 'text-slate-400'}`}>
                      {viewMode === 'ZEN' || privacyMode ? (
                        <span className="text-neutral-400 font-normal">••••••</span>
                      ) : viewMode === 'R_MULTIPLE' ? (
                        <>
                          <span className="text-base font-extrabold">{isPos ? '+' : ''}{rMultiple}R{isNormR ? '*' : ''}</span>
                          <span className="text-[10px] font-normal opacity-80">({isPos ? '+' : ''}{fmtCurrency(currentPnL)})</span>
                        </>
                      ) : viewMode === 'PERCENT' ? (
                        <>
                          <span className="text-base font-extrabold">{pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%</span>
                          <span className="text-[10px] opacity-80 font-normal">[{isPos ? '+' : ''}{rMultiple}R{isNormR ? '*' : ''}]</span>
                        </>
                      ) : (
                        <>
                          <span>{isPos ? '+' : ''}{fmtCurrency(currentPnL)}</span>
                          <span className={`text-[10px] px-1 py-0.2 rounded font-semibold ${isPos ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' : 'bg-neutral-800 text-slate-400 border border-neutral-700'}`}>
                            {isPos ? '+' : ''}{rMultiple}R{isNormR ? '*' : ''}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="text-[10px] text-neutral-500 font-mono mt-0.5">
                      {viewMode === 'ZEN' || privacyMode ? (
                        'Live ticker masked (Zen)'
                      ) : viewMode === 'PERCENT' ? (
                        `${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}% · ${effectivePortfolio > 0 ? ((currentPnL / effectivePortfolio) * 100).toFixed(2) : 0}% port`
                      ) : (
                        `${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}% · ${fmtPkr(currentPnL * trPkrRate)}`
                      )}
                    </div>
                  </div>
                );
              })()
            )}
          </div>

          {/* Col 2: Price / Exit */}
          <div>
            {isClosedCard ? (
              <div>
                <span className="text-[10px] text-neutral-500 uppercase font-semibold block mb-0.5">Exit Price</span>
                <div className="text-sm font-bold font-mono text-blue-300">
                  {formatPrice(getTradeExitPrice(trade) || trade.entryPrice, viewMode !== 'PERCENT')}
                </div>
                <div className="text-[10px] text-neutral-500 font-mono mt-0.5">
                  Entry: {formatPrice(trade.entryPrice, viewMode !== 'PERCENT')}
                </div>
              </div>
            ) : tStatus === 'PENDING' || isLimitOrderTrade(trade) ? (
              <div>
                <span className="text-[10px] text-neutral-500 uppercase font-semibold block mb-0.5">Order Target</span>
                <div className="text-sm font-bold font-mono text-neutral-200">
                  {formatPrice(trade.entryPrice, viewMode !== 'PERCENT')}
                </div>
                <div className="text-[10px] text-neutral-400 font-mono mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <span>Live: {formatPrice(livePrices[trade.symbol] || 0, viewMode !== 'PERCENT')}</span>
                  {(() => {
                    const cp = livePrices[trade.symbol];
                    if (!cp || !trade.entryPrice) return null;
                    if (cp > trade.entryPrice) {
                      const drop = ((cp - trade.entryPrice) / cp) * 100;
                      return (
                        <span className="text-slate-400 font-normal">
                          (-{drop.toFixed(2)}% to fill)
                        </span>
                      );
                    } else {
                      return (
                        <span className="text-sky-400 font-normal">
                          (Fill target reached)
                        </span>
                      );
                    }
                  })()}
                </div>
              </div>
            ) : (
              <div>
                <span className="text-[10px] text-neutral-500 uppercase font-semibold block mb-0.5">Live Price</span>
                <div className="text-sm font-bold font-mono text-neutral-100">
                  {formatPrice(livePrices[trade.symbol] || trade.entryPrice, viewMode !== 'PERCENT')}
                </div>
                <div className="text-[10px] text-neutral-400 font-mono mt-0.5">
                  Entry: {formatPrice(trade.entryPrice, viewMode !== 'PERCENT')}
                </div>
              </div>
            )}
          </div>

          {/* Col 3: Risk / Fees */}
          <div>
            {isClosedCard ? (
              (() => {
                const consolidatedFees = getTradeConsolidatedFees(trade);
                const totalFees = consolidatedFees.totalFees;
                return (
                  <div>
                    <span className="text-[10px] text-neutral-500 uppercase font-semibold block mb-0.5">Total Fees</span>
                    <div className="text-sm font-bold font-mono text-neutral-300">
                      {viewMode === 'PERCENT'
                        ? `-${effectivePortfolio > 0 ? ((totalFees / effectivePortfolio) * 100).toFixed(2) : 0}%`
                        : `-${fmtCurrency(totalFees)}`}
                    </div>
                    <div className="text-[10px] text-neutral-400 font-mono mt-0.5">
                      {viewMode === 'PERCENT' ? (
                        <span>Fee drag on port</span>
                      ) : trade.buyFeeUsd !== undefined && trade.sellFeeUsd !== undefined && (trade.buyFeeUsd > 0 || trade.sellFeeUsd > 0) ? (
                        <span title={`Buy: $${trade.buyFeeUsd.toFixed(4)}, Sell: $${trade.sellFeeUsd.toFixed(4)}`}>
                          Buy: ${trade.buyFeeUsd.toFixed(2)} · Sell: ${trade.sellFeeUsd.toFixed(2)}
                        </span>
                      ) : (
                        <span>Risk was: {fmtCurrency(effectiveRiskAmount)}</span>
                      )}
                    </div>
                  </div>
                );
              })()
            ) : (
              <div>
                <span className="text-[10px] text-neutral-500 uppercase font-semibold block mb-0.5">
                  {framework.isUnprotected ? 'Stop Risk (Uncapped)' : 'Stop Risk'}
                </span>
                {framework.isUnprotected ? (
                  <>
                    <div className="text-sm font-bold font-mono text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                      <span>No SL</span>
                    </div>
                    <div className="text-[10px] text-neutral-400 font-mono mt-0.5 truncate" title={`1R risk unit benchmark: $${framework.portfolioRiskUnit.toFixed(0)}. Full position capital at risk: -${fmtCurrency(framework.maxDownsideExposure)}`}>
                      {viewMode === 'PERCENT'
                        ? `1R: ${((framework.portfolioRiskUnit / (effectivePortfolio || 1)) * 100).toFixed(1)}% · Max -${((framework.maxDownsideExposure / (effectivePortfolio || 1)) * 100).toFixed(1)}%`
                        : `1R: $${framework.portfolioRiskUnit.toFixed(0)} · Max -${fmtCurrency(framework.maxDownsideExposure)}`}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-sm font-bold font-mono text-slate-300">
                      {viewMode === 'PERCENT' ? (
                        `-${effectiveRiskPct > 0 ? effectiveRiskPct.toFixed(2) : (effectivePortfolio > 0 ? ((effectiveRiskAmount / effectivePortfolio) * 100).toFixed(2) : '0.00')}%`
                      ) : (
                        effectiveRiskAmount > 0 ? `-${fmtCurrency(effectiveRiskAmount).replace(/^\$/, '')}` : '$0.00'
                      )}
                    </div>
                    <div className="text-[10px] text-neutral-500 font-mono mt-0.5">
                      {effectiveRiskAmount <= 0 || isStopLossAtBreakeven(trade) ? (
                        'Breakeven (0.0R)'
                      ) : (
                        (() => {
                          const riskR = framework.portfolioRiskUnit > 0 
                            ? (effectiveRiskAmount / framework.portfolioRiskUnit)
                            : (effectiveRiskPct > 0 ? (effectiveRiskPct / (trade.riskPercent || 1)) : 1.0);
                          const rFormatted = riskR >= 10 ? riskR.toFixed(1) : riskR.toFixed(2);
                          return `${effectiveRiskPct > 0 ? `${effectiveRiskPct.toFixed(2)}% risk ` : ''}(-${rFormatted}R)`;
                        })()
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Col 4: Position Size / Invested */}
          <div>
            <span className="text-[10px] text-neutral-500 uppercase font-semibold block mb-0.5">
              {isClosedCard ? 'Total Invested' : 'Position Size'}
            </span>
            <div className="text-sm font-bold font-mono text-blue-400">
              {viewMode === 'PERCENT' ? (
                `${effectivePortfolio > 0 ? (((trade.totalBuyUsd || (trade as any).positionSize || 0) / effectivePortfolio) * 100).toFixed(1) : 0}%`
              ) : (
                fmtCurrency(trade.totalBuyUsd || (trade as any).positionSize || 0)
              )}
            </div>
            <div className="text-[10px] text-neutral-400 font-mono mt-0.5 truncate">
              {coins > 0 ? `${coins.toLocaleString(undefined, { maximumFractionDigits: 3 })} coins` : ''}
              {soldPct > 0 ? ` · ${soldPct}% sold` : ''}
            </div>
          </div>
        </div>

        {/* Institutional Unprotected Position Risk & 1-Click Protection Banner (No-SL Framework) */}
        {!isClosedCard && tStatus !== 'PENDING' && framework.isUnprotected && (
          <div className="mb-2.5 p-2 sm:p-2.5 rounded-xl bg-amber-950/30 border border-amber-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs animate-in fade-in duration-200">
            <div className="flex items-start sm:items-center gap-2 min-w-0">
              <div className="w-6 h-6 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0 mt-0.5 sm:mt-0">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-bold text-amber-300 text-[11px]">
                    Unprotected Position (No Stop-Loss)
                  </span>
                  <span className="text-[10px] text-amber-400/90 font-mono bg-amber-950/70 border border-amber-800/80 px-1.5 py-0.2 rounded">
                    Max Downside: -{fmtCurrency(framework.maxDownsideExposure)}
                  </span>
                </div>
                <span className="text-[10px] text-neutral-400 block mt-0.5">
                  Framework 1R benchmark: ${framework.portfolioRiskUnit.toFixed(0)}.
                  {framework.impliedStopLoss 
                    ? ` Implied 1:2 R:R stop is $${formatPrice(framework.impliedStopLoss, true)}.` 
                    : ' Apply a benchmark stop loss to establish a defined 1R risk unit.'}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center flex-wrap">
              {framework.impliedStopLoss && (
                <Button
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSetQuickSL(trade, framework.impliedStopLoss!);
                  }}
                  className="h-7 px-2.5 text-[11px] font-bold text-sky-300 bg-sky-950/80 hover:bg-sky-900 border border-sky-600/70 shadow-sm"
                  title={`Apply implied 1:2 Risk/Reward stop loss at $${formatPrice(framework.impliedStopLoss, true)}`}
                >
                  <Shield className="w-3 h-3 mr-1 text-sky-400" />
                  Set 1:2 SL (${formatPrice(framework.impliedStopLoss, true)})
                </Button>
              )}
              {framework.recommendedStops && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSetQuickSL(trade, framework.recommendedStops!.balanced);
                  }}
                  className="h-7 px-2 text-[11px] font-semibold text-neutral-300 bg-neutral-900 hover:bg-neutral-800 border border-neutral-700"
                  title="Apply 5% swing technical stop"
                >
                  -5% SL (${formatPrice(framework.recommendedStops!.balanced, true)})
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setInspectingTrade(trade);
                }}
                className="h-7 px-2 text-[11px] text-neutral-400 hover:text-blue-400"
                title="Open detailed institutional downside framework audit"
              >
                Risk Audit
              </Button>
            </div>
          </div>
        )}

        {/* Auto-Breakeven Target Alert (Part 2 Item 6) */}
        {!isClosedCard && tStatus !== 'PENDING' && (() => {
          const currentPrice = livePrices[trade.symbol] || trade.entryPrice;
          const hitTp1 = trade.status === 'HIT_TP1' || isTp1Reached(trade, currentPrice);
          const atBreakeven = isStopLossAtBreakeven(trade);
          if (hitTp1 && !atBreakeven && trade.entryPrice) {
            return (
              <div className="mb-2.5 p-2 sm:p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/40 flex items-center justify-between gap-2 text-xs animate-in fade-in duration-200">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 h-6 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
                    <Shield className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                  </div>
                  <div className="min-w-0">
                    <span className="font-bold text-amber-300 block text-[11px]">
                      🎯 TP1 Target Reached! Capital Protection Prompt
                    </span>
                    <span className="text-[10px] text-neutral-400 block truncate">
                      Eliminate downside risk: Move Stop Loss to Entry (${formatPrice(trade.entryPrice, true)}) to guarantee a 0.00R risk-free trade.
                    </span>
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMoveToBreakeven(trade);
                  }}
                  className="h-7 px-3 text-[11px] font-bold text-sky-300 bg-sky-950/80 hover:bg-sky-900 border border-sky-600/60 shrink-0 shadow-sm transition-all"
                >
                  <Shield className="w-3 h-3 mr-1 text-sky-400" />
                  Move SL to BE
                </Button>
              </div>
            );
          }
          return null;
        })()}

        {/* Progress Bar for Active Trades with Targets */}
        {!isClosedCard && tStatus !== 'PENDING' && livePrices[trade.symbol] && (
          <div className="mb-2.5">
            <TradeProgressBar trade={trade} currentPrice={livePrices[trade.symbol]} />
          </div>
        )}

        {/* Planned Price Targets & Execution Plan */}
        {(() => {
          const tradeCoins = getTradeCoins(trade);
          const isLongTrade = getTradeIsLong(trade);

          const tp1Price = trade.takeProfit1 || 0;
          const tp1PctVal = trade.tp1Percent !== undefined ? trade.tp1Percent : (trade.takeProfit1 ? 100 : 0);
          const tp1ProfitVal = tp1Price > 0 ? calculateTargetProfit(trade.entryPrice, trade.stopLoss || 0, tp1Price, tradeCoins, tp1PctVal) : 0;
          const tp1GainPct = trade.entryPrice && tp1Price > 0 
            ? ((isLongTrade ? (tp1Price - trade.entryPrice) : (trade.entryPrice - tp1Price)) / trade.entryPrice) * 100 
            : 0;

          const tp2Price = trade.takeProfit2 || 0;
          const tp2PctVal = trade.tp2Percent || 0;
          const tp2ProfitVal = tp2Price > 0 && tp2PctVal > 0 ? calculateTargetProfit(trade.entryPrice, trade.stopLoss || 0, tp2Price, tradeCoins, tp2PctVal) : 0;
          const tp2GainPct = trade.entryPrice && tp2Price > 0 
            ? ((isLongTrade ? (tp2Price - trade.entryPrice) : (trade.entryPrice - tp2Price)) / trade.entryPrice) * 100 
            : 0;

          const tp3Price = trade.takeProfit3 || 0;
          const tp3PctVal = trade.tp3Percent || 0;
          const tp3ProfitVal = tp3Price > 0 && tp3PctVal > 0 ? calculateTargetProfit(trade.entryPrice, trade.stopLoss || 0, tp3Price, tradeCoins, tp3PctVal) : 0;
          const tp3GainPct = trade.entryPrice && tp3Price > 0 
            ? ((isLongTrade ? (tp3Price - trade.entryPrice) : (trade.entryPrice - tp3Price)) / trade.entryPrice) * 100 
            : 0;

          const totalExpectedTargetProfit = tp1ProfitVal + tp2ProfitVal + tp3ProfitVal;
          const hasAnyTargets = Boolean(trade.takeProfit1 && trade.takeProfit1 > 0);

          const beResult = !isClosedCard ? calculateBlendedBreakeven(trade) : { blendedBreakeven: null };
          const blendedBE = beResult.blendedBreakeven;
          const feeInfo = getTradeConsolidatedFees(trade);
          const consolidatedFees = feeInfo.totalFees;
          const remainingCoins = calculateRemainingCoins(trade);
          const hasBeInfo = blendedBE !== null && Math.abs(blendedBE - trade.entryPrice) > 0.00001;

          if (isClosedCard) {
            // Merged into Col 2 & Col 3 above — eliminates duplicate boxes for ultra-compact closed cards
            return null;
          }

          // Active or Pending Cards: Compact non-duplicated targets and execution plan
          return (
            <div className="pt-2 border-t border-neutral-800/80 flex flex-col gap-2 text-xs font-mono">
              {hasAnyTargets ? (
                <div className="bg-neutral-950/60 rounded-lg p-2.5 border border-neutral-800/70">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] text-neutral-300 uppercase font-semibold flex items-center gap-1.5">
                      <Target className="w-3 h-3 text-blue-400" />
                      Take Profit Targets &amp; Projected Return
                    </span>
                    {totalExpectedTargetProfit > 0 && (
                      <span className="text-[10px] font-bold text-blue-300 bg-blue-500/10 border border-blue-500/30 px-2 py-0.5 rounded">
                        {viewMode === 'PERCENT' ? `Target Return: +${effectivePortfolio > 0 ? ((totalExpectedTargetProfit / effectivePortfolio) * 100).toFixed(1) : 0}%` : `Target Profit: +${fmtCurrency(totalExpectedTargetProfit)}`}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {/* TP 1 */}
                    <div className="bg-neutral-900/80 p-2 rounded border border-neutral-800/80">
                      <div className="flex items-center justify-between text-[10px] text-neutral-400 mb-0.5">
                        <span className="font-semibold text-neutral-200">TP1 ({tp1PctVal}%)</span>
                        <span className="text-blue-300 font-medium">+{tp1GainPct.toFixed(1)}%</span>
                      </div>
                      <div className="flex items-baseline justify-between">
                        <span className="text-xs font-bold text-white">
                          {formatPrice(tp1Price, viewMode !== 'PERCENT')}
                        </span>
                        <span className="text-xs font-bold text-cyan-300">
                          {viewMode === 'PERCENT' ? `+${tp1GainPct.toFixed(1)}%` : `+${fmtCurrency(tp1ProfitVal)}`}
                        </span>
                      </div>
                    </div>

                    {/* TP 2 */}
                    {tp2Price > 0 && tp2PctVal > 0 ? (
                      <div className="bg-neutral-900/80 p-2 rounded border border-neutral-800/80">
                        <div className="flex items-center justify-between text-[10px] text-neutral-400 mb-0.5">
                          <span className="font-semibold text-neutral-200">TP2 ({tp2PctVal}%)</span>
                          <span className="text-blue-300 font-medium">+{tp2GainPct.toFixed(1)}%</span>
                        </div>
                        <div className="flex items-baseline justify-between">
                          <span className="text-xs font-bold text-white">
                            {formatPrice(tp2Price, viewMode !== 'PERCENT')}
                          </span>
                          <span className="text-xs font-bold text-cyan-300">
                            {viewMode === 'PERCENT' ? `+${tp2GainPct.toFixed(1)}%` : `+${fmtCurrency(tp2ProfitVal)}`}
                          </span>
                        </div>
                      </div>
                    ) : null}

                    {/* TP 3 */}
                    {tp3Price > 0 && tp3PctVal > 0 ? (
                      <div className="bg-neutral-900/80 p-2 rounded border border-neutral-800/80">
                        <div className="flex items-center justify-between text-[10px] text-neutral-400 mb-0.5">
                          <span className="font-semibold text-neutral-200">TP3 ({tp3PctVal}%)</span>
                          <span className="text-blue-300 font-medium">+{tp3GainPct.toFixed(1)}%</span>
                        </div>
                        <div className="flex items-baseline justify-between">
                          <span className="text-xs font-bold text-white">
                            {formatPrice(tp3Price, viewMode !== 'PERCENT')}
                          </span>
                          <span className="text-xs font-bold text-cyan-300">
                            {viewMode === 'PERCENT' ? `+${tp3GainPct.toFixed(1)}%` : `+${fmtCurrency(tp3ProfitVal)}`}
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="bg-neutral-950/40 p-2 rounded-lg border border-neutral-800/50 flex items-center justify-between text-neutral-400 text-[11px]">
                  <span>Entry: <strong className="text-neutral-200">{formatPrice(trade.entryPrice, viewMode !== 'PERCENT')}</strong></span>
                  <span>SL: <strong className={trade.stopLoss ? "text-slate-300" : "text-neutral-500"}>{trade.stopLoss ? formatPrice(trade.stopLoss, viewMode !== 'PERCENT') : 'None'}</strong></span>
                  <span className="text-neutral-500 italic">No TP targets configured</span>
                </div>
              )}

              {/* Dynamic Breakeven & Cumulative Fee Drag (Single Compact Strip) */}
              {(hasBeInfo || consolidatedFees > 0) && (
                <div className="bg-neutral-950/60 border border-neutral-800/60 rounded-lg p-1.5 px-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  {hasBeInfo ? (
                    <span className="text-blue-300 font-medium flex items-center gap-1">
                      <Target className="w-3.5 h-3.5 text-blue-400" />
                      Dynamic BE: <strong className="text-white font-mono">{formatPrice(blendedBE, viewMode !== 'PERCENT')}</strong>
                      <span className="text-[10px] text-neutral-400">({remainingCoins.toFixed(3)} coins rem.)</span>
                    </span>
                  ) : <div />}
                  {consolidatedFees > 0 && (
                    <span className="text-neutral-400 text-[10px] font-mono">
                      Fee drag: <span className="text-neutral-300">{viewMode === 'PERCENT' ? `-${effectivePortfolio > 0 ? ((consolidatedFees / effectivePortfolio) * 100).toFixed(2) : 0}%` : `-${fmtCurrency(consolidatedFees)}`}</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* Formatted Auto Notes & Activity Log (Line-by-Line) */}
        {trade.notes && (() => {
          const lines = parseTradeNotesLineByLine(trade.notes);

          if (lines.length === 0) return null;

          return (
            <div className="mt-2.5 pt-2.5 border-t border-neutral-800/80">
              <span className="text-[10px] text-neutral-500 uppercase font-semibold block mb-1">
                Trade Notes &amp; Activity Log
              </span>
              <div className="bg-neutral-950/80 p-2.5 rounded-lg border border-neutral-800/60 flex flex-col gap-1.5 font-mono text-xs">
                {lines.map((line, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-neutral-300">
                    <span className="text-blue-400/80 mt-0.5 select-none text-[10px]">▪</span>
                    <span className="leading-snug break-words flex-1 text-[11px] sm:text-xs">
                      {line}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Quick Action Tray */}
        <div className="mt-3 pt-3 border-t border-neutral-800/80 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            {!isClosedCard && tStatus !== 'PENDING' && (
              <>
                {trade.entryPrice && trade.stopLoss !== trade.entryPrice && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMoveToBreakeven(trade);
                    }}
                    className="h-7 px-2.5 text-[11px] font-semibold text-sky-400 border-sky-800/60 bg-sky-950/30 hover:bg-sky-900/50"
                    title="Move Stop Loss directly to entry price (Zero Risk)"
                  >
                    <Shield className="w-3 h-3 mr-1" />
                    BE 🛡️
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTrimPosition(trade, 50);
                  }}
                  className="h-7 px-2.5 text-[11px] font-semibold text-amber-400 border-amber-800/60 bg-amber-950/30 hover:bg-amber-900/50"
                  title="Take profit on 50% of position"
                >
                  <Scissors className="w-3 h-3 mr-1" />
                  Trim 50%
                </Button>
              </>
            )}
            {isClosedCard && (
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setReviewingDisciplineTrade(trade);
                }}
                className={`h-7 px-2.5 text-[11px] font-semibold transition-colors ${
                  trade.disciplineTag 
                    ? 'text-purple-300 border-purple-800/60 bg-purple-950/30 hover:bg-purple-900/50' 
                    : 'text-amber-400 border-amber-800/60 bg-amber-950/30 hover:bg-amber-900/50'
                }`}
                title="Log or review psychological execution of this trade"
              >
                <Brain className="w-3 h-3 mr-1 text-purple-400" />
                {trade.disciplineTag && DISCIPLINE_TAGS[trade.disciplineTag] ? DISCIPLINE_TAGS[trade.disciplineTag].shortLabel : 'Tag Discipline'}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setSharingTrade(trade);
              }}
              className="h-7 px-2 text-[11px] text-neutral-400 hover:text-sky-400"
              title="Generate Shareable Trade Card"
            >
              <Share2 className="w-3 h-3 mr-1" />
              Share
            </Button>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setInspectingTrade(trade);
            }}
            className="h-7 px-2 text-[11px] text-neutral-400 hover:text-blue-400"
            title="Open detailed trade audit drawer"
          >
            <Info className="w-3 h-3 mr-1" />
            Audit
          </Button>
        </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4 pb-20">
      
      {/* Unified Portfolio Cockpit */}
      <PortfolioRiskCockpit
        stats={stats}
        binanceBalance={binanceBalance}
        privacyMode={privacyMode}
        onTogglePrivacy={togglePrivacyMode}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        totalRealizedR={portfolioRStats.totalRealizedR}
        totalLiveUnrealizedR={portfolioRStats.totalLiveUnrealizedR}
        totalActiveRiskR={portfolioRStats.totalActiveRiskR}
        baseCapital={baseCapital}
        onSaveBaseCapital={(newBase) => setBaseCapital(newBase)}
        onSyncBinance={syncBinance}
        isSyncing={isSyncing}
        unprotectedTradesCount={unprotectedTradesCount}
      />

      {/* Active Trades Header & Controls */}
      <div className="flex justify-between items-center px-1 mt-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-neutral-200">Open Trades ({allOpen.length})</h2>
          {activeTrades.length > 0 && (
            <span className="inline-block w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
          )}
        </div>
        <div className="flex gap-1 items-center">
          {/* Sort Selector Button & Dropdown */}
          <div className="relative inline-block">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSortMenuOpen(!sortMenuOpen);
              }}
              className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border transition-all h-8 select-none ${
                sortBy === 'INVESTED'
                  ? 'bg-purple-950/40 text-purple-300 border-purple-800/60 hover:bg-purple-900/50'
                  : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-neutral-200'
              }`}
              title={`Sorted by: ${sortBy === 'INVESTED' ? 'Amount Invested (Most on top)' : sortBy === 'PNL' ? 'Highest PnL' : 'Newest'}`}
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              <span>{sortBy === 'INVESTED' ? 'Invested' : sortBy === 'PNL' ? 'PnL' : 'Newest'}</span>
              <ChevronDown className={`w-3 h-3 opacity-60 transition-transform ${sortMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {sortMenuOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute right-0 mt-1.5 w-52 bg-neutral-900/95 border border-neutral-700/80 rounded-lg shadow-2xl backdrop-blur-md z-50 py-1.5 text-xs animate-in fade-in zoom-in-95 duration-100"
              >
                <div className="px-3 py-1 text-[10px] text-neutral-400 font-semibold uppercase tracking-wider border-b border-neutral-800">
                  Auto-Sort Orders &amp; Trades
                </div>

                <button
                  type="button"
                  onClick={() => handleSelectSort('INVESTED')}
                  className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-neutral-800 transition-colors ${
                    sortBy === 'INVESTED' ? 'text-purple-400 font-bold bg-purple-500/10' : 'text-neutral-300'
                  }`}
                >
                  <div className="flex flex-col">
                    <span className="font-semibold text-neutral-200">💰 Amount Invested</span>
                    <span className="text-[10px] text-neutral-400">Most capital deployed on top</span>
                  </div>
                  {sortBy === 'INVESTED' && <CheckCircle2 className="w-3.5 h-3.5 text-purple-400 shrink-0" />}
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectSort('DATE')}
                  className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-neutral-800 transition-colors ${
                    sortBy === 'DATE' ? 'text-blue-400 font-bold bg-blue-500/10' : 'text-neutral-300'
                  }`}
                >
                  <div className="flex flex-col">
                    <span className="font-semibold text-neutral-200">🕒 Date Created</span>
                    <span className="text-[10px] text-neutral-400">Newest orders first</span>
                  </div>
                  {sortBy === 'DATE' && <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />}
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectSort('PNL')}
                  className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-neutral-800 transition-colors ${
                    sortBy === 'PNL' ? 'text-sky-400 font-bold bg-blue-500/10' : 'text-neutral-300'
                  }`}
                >
                  <div className="flex flex-col">
                    <span className="font-semibold text-neutral-200">📈 Unrealized PnL</span>
                    <span className="text-[10px] text-neutral-400">Highest profit/return on top</span>
                  </div>
                  {sortBy === 'PNL' && <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />}
                </button>
              </div>
            )}
          </div>

          <Button variant="ghost" size="icon" onClick={fixDuplicates} className="text-neutral-500 hover:text-slate-300 h-8 w-8" title="Fix Duplicates">
            <Trash2 className="w-4 h-4" />
          </Button>
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
        <div className="flex flex-col gap-4">
          {/* Active Trades Section */}
          <div 
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (activeDropTarget !== 'ACTIVE') setActiveDropTarget('ACTIVE');
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              if (activeDropTarget !== 'ACTIVE') setActiveDropTarget('ACTIVE');
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData('text/plain') || draggedTradeIdRef.current || draggedTradeId;
              if (id) handleDropToSection(id, 'ACTIVE');
              isDraggingRef.current = false;
              draggedTradeIdRef.current = null;
              setDraggedTradeId(null);
              setActiveDropTarget(null);
            }}
            className={`flex flex-col gap-3 pb-2 transition-all rounded-xl px-0.5 py-1.5 sm:px-1.5 ${
              activeDropTarget === 'ACTIVE' 
                ? 'ring-1 ring-blue-500/60 bg-blue-500/5 border border-dashed border-blue-500/80' 
                : ''
            }`}
          >
            <div 
              onClick={() => toggleSectionCollapse('ACTIVE')}
              className="relative mt-1 mb-1 flex items-center justify-center cursor-pointer select-none group py-1"
              title={isSectionCollapsed('ACTIVE') ? "Click to expand Active Trades" : "Click to collapse Active Trades"}
            >
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-blue-500/20 group-hover:border-blue-500/40 transition-colors" />
              </div>
              <div className="relative bg-black px-3 text-[11px] font-bold uppercase tracking-wider text-blue-400 flex items-center gap-1.5 group-hover:text-blue-300 transition-colors rounded-full py-0.5 border border-transparent group-hover:border-blue-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500/50 group-hover:bg-blue-400" />
                <span>Active Trades ({activeTrades.length})</span>
                <ChevronDown className={`w-3.5 h-3.5 text-blue-400 transition-transform duration-200 ${isSectionCollapsed('ACTIVE') ? '-rotate-90' : 'rotate-0'}`} />
              </div>
            </div>

            {draggedTradeId && activeDropTarget === 'ACTIVE' && (
              <div className="border border-dashed border-blue-500/70 bg-blue-500/10 text-blue-300 rounded-lg py-2 text-center text-xs font-medium">
                Move {draggedTrade?.symbol} to Active Trades
              </div>
            )}

            {isSectionCollapsed('ACTIVE') ? null : (
              <>
                {activeTrades.length === 0 && (
                  <div className="border border-dashed border-neutral-800/80 rounded-xl p-3 text-center text-xs text-neutral-500 bg-neutral-950/30">
                    No active trades • Drop trades here
                  </div>
                )}
                {activeTradeGroups.map(group => {
                  if (group.isMulti) {
                    return (
                      <MultiTradeGroupCard
                        key={`group-${group.symbol}`}
                        group={group}
                        livePrice={livePrices[group.symbol]}
                        privacyMode={privacyMode}
                        viewMode={viewMode}
                        renderChildTradeCard={(t) => renderTradeCard(t, 'ACTIVE')}
                      />
                    );
                  }
                  return renderTradeCard(group.trades[0], 'ACTIVE');
                })}
              </>
            )}
          </div>

          {/* Investments Section */}
          <div 
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (activeDropTarget !== 'HOLDING') setActiveDropTarget('HOLDING');
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              if (activeDropTarget !== 'HOLDING') setActiveDropTarget('HOLDING');
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData('text/plain') || draggedTradeIdRef.current || draggedTradeId;
              if (id) handleDropToSection(id, 'HOLDING');
              isDraggingRef.current = false;
              draggedTradeIdRef.current = null;
              setDraggedTradeId(null);
              setActiveDropTarget(null);
            }}
            className={`flex flex-col gap-3 pb-2 transition-all rounded-xl px-0.5 py-1.5 sm:px-1.5 ${
              activeDropTarget === 'HOLDING' 
                ? 'ring-1 ring-purple-500/60 bg-purple-500/5 border border-dashed border-purple-500/80' 
                : ''
            }`}
          >
            <div 
              onClick={() => toggleSectionCollapse('HOLDING')}
              className="relative mt-1 mb-1 flex items-center justify-center cursor-pointer select-none group py-1"
              title={isSectionCollapsed('HOLDING') ? "Click to expand Investments" : "Click to collapse Investments"}
            >
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-purple-500/20 group-hover:border-purple-500/40 transition-colors" />
              </div>
              <div className="relative bg-black px-3 text-[11px] font-bold uppercase tracking-wider text-purple-400 flex items-center gap-1.5 group-hover:text-purple-300 transition-colors rounded-full py-0.5 border border-transparent group-hover:border-purple-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-500/50 group-hover:bg-purple-400" />
                <span>Investments ({holdings.length})</span>
                <ChevronDown className={`w-3.5 h-3.5 text-purple-400 transition-transform duration-200 ${isSectionCollapsed('HOLDING') ? '-rotate-90' : 'rotate-0'}`} />
              </div>
            </div>

            {draggedTradeId && activeDropTarget === 'HOLDING' && (
              <div className="border border-dashed border-purple-500/70 bg-purple-500/10 text-purple-300 rounded-lg py-2 text-center text-xs font-medium">
                Move {draggedTrade?.symbol} to Investments (Holdings)
              </div>
            )}

            {isSectionCollapsed('HOLDING') ? null : (
              <>
                {holdings.length === 0 && (
                  <div className="border border-dashed border-neutral-800/80 rounded-xl p-3 text-center text-xs text-neutral-500 bg-neutral-950/30">
                    No investments • Drop trades here
                  </div>
                )}
                {holdings.map(t => renderTradeCard(t, 'HOLDING'))}
              </>
            )}
          </div>
          
          {/* Limit Orders Section */}
          <div 
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (activeDropTarget !== 'PENDING') setActiveDropTarget('PENDING');
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              if (activeDropTarget !== 'PENDING') setActiveDropTarget('PENDING');
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData('text/plain') || draggedTradeIdRef.current || draggedTradeId;
              if (id) handleDropToSection(id, 'PENDING');
              isDraggingRef.current = false;
              draggedTradeIdRef.current = null;
              setDraggedTradeId(null);
              setActiveDropTarget(null);
            }}
            className={`flex flex-col gap-3 pt-2 transition-all rounded-xl px-0.5 py-1.5 sm:px-1.5 ${
              activeDropTarget === 'PENDING' 
                ? 'ring-1 ring-yellow-500/60 bg-yellow-500/5 border border-dashed border-yellow-500/80' 
                : ''
            }`}
          >
            <div 
              onClick={() => toggleSectionCollapse('PENDING')}
              className="relative mt-2 mb-1 flex items-center justify-center cursor-pointer select-none group py-1"
              title={isSectionCollapsed('PENDING') ? "Click to expand Limit Orders" : "Click to collapse Limit Orders"}
            >
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-yellow-500/20 group-hover:border-yellow-500/40 transition-colors" />
              </div>
              <div className="relative bg-black px-3 text-[11px] font-bold uppercase tracking-wider text-yellow-500/80 flex items-center gap-1.5 group-hover:text-yellow-400 transition-colors rounded-full py-0.5 border border-transparent group-hover:border-yellow-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-500/50 group-hover:bg-yellow-400" />
                <span>Limit Orders ({pendingTrades.length})</span>
                <ChevronDown className={`w-3.5 h-3.5 text-yellow-400 transition-transform duration-200 ${isSectionCollapsed('PENDING') ? '-rotate-90' : 'rotate-0'}`} />
              </div>
            </div>

            {draggedTradeId && activeDropTarget === 'PENDING' && (
              <div className="border border-dashed border-yellow-500/70 bg-yellow-500/10 text-yellow-300 rounded-lg py-2 text-center text-xs font-medium">
                Move {draggedTrade?.symbol} to Limit Orders
              </div>
            )}

            {isSectionCollapsed('PENDING') ? null : (
              <>
                {pendingTrades.length === 0 && (
                  <div className="border border-dashed border-neutral-800/80 rounded-xl p-3 text-center text-xs text-neutral-500 bg-neutral-950/30">
                    No limit orders • Drop trades here
                  </div>
                )}
                {pendingTrades.map(t => renderTradeCard(t, 'PENDING'))}
              </>
            )}
          </div>

          {/* Separator Line & Closed Trades Section */}
          {(closedTrades.length > 0 || (draggedTrade && !isTradeClosed(draggedTrade))) && (
            <div 
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (activeDropTarget !== 'CLOSED') setActiveDropTarget('CLOSED');
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                if (activeDropTarget !== 'CLOSED') setActiveDropTarget('CLOSED');
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/plain') || draggedTradeIdRef.current || draggedTradeId;
                if (id) handleDropToSection(id, 'CLOSED');
                isDraggingRef.current = false;
                draggedTradeIdRef.current = null;
                setDraggedTradeId(null);
                setActiveDropTarget(null);
              }}
              className={`flex flex-col gap-3 pt-2 transition-all rounded-xl px-0.5 py-1.5 sm:px-1.5 ${
                activeDropTarget === 'CLOSED' 
                  ? 'ring-1 ring-neutral-400/60 bg-neutral-800/40 border border-dashed border-neutral-400/80' 
                  : ''
              }`}
            >
              <div 
                onClick={() => toggleSectionCollapse('CLOSED')}
                className="relative my-2 flex items-center justify-center cursor-pointer select-none group py-1"
                title={isSectionCollapsed('CLOSED') ? "Click to expand Closed Trades" : "Click to collapse Closed Trades"}
              >
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-neutral-800 group-hover:border-neutral-700 transition-colors" />
                </div>
                <div className="relative bg-black px-3 text-[11px] font-bold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5 group-hover:text-neutral-300 transition-colors rounded-full py-0.5 border border-transparent group-hover:border-neutral-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-neutral-500 group-hover:bg-neutral-400" />
                  <span>Closed Trades ({closedTrades.length})</span>
                  <ChevronDown className={`w-3.5 h-3.5 text-neutral-400 transition-transform duration-200 ${isSectionCollapsed('CLOSED') ? '-rotate-90' : 'rotate-0'}`} />
                </div>
              </div>

              {isSectionCollapsed('CLOSED') ? null : (
                <>
                  {/* Trading Psychology & Discipline Scorecard */}
                  {closedTrades.length > 0 && (
                    <div className="mb-1">
                      <DisciplineScorecard 
                        stats={disciplineStats}
                        viewMode={viewMode}
                        privacyMode={privacyMode}
                      />
                    </div>
                  )}

                  {closedTrades.length > 0 && (
                    <div className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-neutral-900/40 border border-neutral-800/60 text-[11px] select-none gap-2 flex-wrap">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <span className="text-neutral-500 font-medium">Realized PnL:</span>
                          <span className={`font-bold font-mono ${closedStats.totalRealized >= 0 ? 'text-sky-400' : 'text-slate-400'}`}>
                            {viewMode === 'ZEN' || privacyMode ? (
                              '••••••'
                            ) : viewMode === 'PERCENT' ? (
                              `${closedStats.totalRealized >= 0 ? '+' : ''}${stats.totalEquity > 0 ? ((closedStats.totalRealized / stats.totalEquity) * 100).toFixed(2) : '0.00'}%`
                            ) : viewMode === 'R_MULTIPLE' ? (
                              `${portfolioRStats.totalRealizedR >= 0 ? '+' : ''}${portfolioRStats.totalRealizedR}R (${closedStats.totalRealized >= 0 ? '+' : ''}${fmtCurrency(closedStats.totalRealized)})`
                            ) : (
                              `${closedStats.totalRealized >= 0 ? '+' : ''}${fmtCurrency(closedStats.totalRealized)}`
                            )}
                          </span>
                        </div>
                        <div className="h-3 w-px bg-neutral-800" />
                        <div className="flex items-center gap-1.5">
                          <span className="text-neutral-500 font-medium">Win Rate:</span>
                          <span className="font-semibold text-neutral-200 font-mono">
                            {closedStats.winRate}%
                          </span>
                          <span className="text-neutral-500 text-[10px]">
                            ({closedStats.wins}W / {closedStats.losses}L)
                          </span>
                        </div>
                        <div className="h-3 w-px bg-neutral-800 hidden md:block" />
                        <div className="hidden md:flex items-center gap-1.5">
                          <span className="text-neutral-500 font-medium">Closed:</span>
                          <span className="font-semibold text-neutral-300 font-mono">{closedStats.count}</span>
                        </div>
                      </div>

                      {/* Closed Trades Sort Option */}
                      <div className="relative inline-block ml-auto">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setClosedSortMenuOpen(!closedSortMenuOpen);
                          }}
                          className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md border transition-all select-none bg-neutral-950 text-neutral-300 border-neutral-800 hover:border-neutral-700 hover:text-white"
                          title="Sort Closed Trades"
                        >
                          <ArrowUpDown className="w-3 h-3 text-sky-400" />
                          <span>
                            {closedSortBy === 'DATE_DESC' ? 'Newest' :
                             closedSortBy === 'DATE_ASC' ? 'Oldest' :
                             closedSortBy === 'PNL_DESC' ? 'Highest Profit' :
                             closedSortBy === 'PNL_ASC' ? 'Biggest Loss' :
                             closedSortBy === 'SIZE' ? 'Position Size' : 'Fees Paid'}
                          </span>
                          <ChevronDown className={`w-2.5 h-2.5 opacity-60 transition-transform ${closedSortMenuOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {closedSortMenuOpen && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="absolute right-0 mt-1.5 w-52 bg-neutral-900/95 border border-neutral-700/80 rounded-lg shadow-2xl backdrop-blur-md z-50 py-1.5 text-xs animate-in fade-in zoom-in-95 duration-100"
                          >
                            <div className="px-3 py-1 text-[10px] text-neutral-400 font-semibold uppercase tracking-wider border-b border-neutral-800">
                              Sort Closed Trades
                            </div>

                            <button
                              type="button"
                              onClick={() => handleSelectClosedSort('DATE_DESC')}
                              className={`w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-neutral-800 transition-colors ${
                                closedSortBy === 'DATE_DESC' ? 'text-sky-400 font-bold bg-blue-500/10' : 'text-neutral-300'
                              }`}
                            >
                              <div className="flex flex-col">
                                <span className="font-semibold text-neutral-200">🕒 Newest Closed First</span>
                                <span className="text-[10px] text-neutral-400">Most recent exits on top</span>
                              </div>
                              {closedSortBy === 'DATE_DESC' && <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleSelectClosedSort('DATE_ASC')}
                              className={`w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-neutral-800 transition-colors ${
                                closedSortBy === 'DATE_ASC' ? 'text-sky-400 font-bold bg-blue-500/10' : 'text-neutral-300'
                              }`}
                            >
                              <div className="flex flex-col">
                                <span className="font-semibold text-neutral-200">⏳ Oldest Closed First</span>
                                <span className="text-[10px] text-neutral-400">Earliest exits on top</span>
                              </div>
                              {closedSortBy === 'DATE_ASC' && <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleSelectClosedSort('PNL_DESC')}
                              className={`w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-neutral-800 transition-colors ${
                                closedSortBy === 'PNL_DESC' ? 'text-sky-400 font-bold bg-blue-500/10' : 'text-neutral-300'
                              }`}
                            >
                              <div className="flex flex-col">
                                <span className="font-semibold text-neutral-200">📈 Highest Profit</span>
                                <span className="text-[10px] text-neutral-400">Best winning trades first</span>
                              </div>
                              {closedSortBy === 'PNL_DESC' && <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleSelectClosedSort('PNL_ASC')}
                              className={`w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-neutral-800 transition-colors ${
                                closedSortBy === 'PNL_ASC' ? 'text-slate-300 font-bold bg-neutral-800' : 'text-neutral-300'
                              }`}
                            >
                              <div className="flex flex-col">
                                <span className="font-semibold text-neutral-200">📉 Biggest Loss</span>
                                <span className="text-[10px] text-neutral-400">Review stop-outs and drawdowns</span>
                              </div>
                              {closedSortBy === 'PNL_ASC' && <CheckCircle2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleSelectClosedSort('SIZE')}
                              className={`w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-neutral-800 transition-colors ${
                                closedSortBy === 'SIZE' ? 'text-blue-400 font-bold bg-blue-500/10' : 'text-neutral-300'
                              }`}
                            >
                              <div className="flex flex-col">
                                <span className="font-semibold text-neutral-200">💰 Position Size</span>
                                <span className="text-[10px] text-neutral-400">Largest capital deployed</span>
                              </div>
                              {closedSortBy === 'SIZE' && <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleSelectClosedSort('FEES')}
                              className={`w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-neutral-800 transition-colors ${
                                closedSortBy === 'FEES' ? 'text-amber-400 font-bold bg-amber-500/10' : 'text-neutral-300'
                              }`}
                            >
                              <div className="flex flex-col">
                                <span className="font-semibold text-neutral-200">🏷️ Fees Paid</span>
                                <span className="text-[10px] text-neutral-400">Highest Binance fees first</span>
                              </div>
                              {closedSortBy === 'FEES' && <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {draggedTradeId && activeDropTarget === 'CLOSED' && (
                    <div className="border border-dashed border-neutral-400/70 bg-neutral-800/60 text-neutral-300 rounded-lg py-2 text-center text-xs font-medium">
                      Close and archive {draggedTrade?.symbol}
                    </div>
                  )}

                  {closedTrades.length === 0 && (
                    <div className="border border-dashed border-neutral-800 rounded-xl p-4 text-center text-xs text-neutral-500 bg-neutral-950/40">
                      Drop trades here to close
                    </div>
                  )}
                  {closedTrades.map(t => renderTradeCard(t, 'CLOSED'))}
                </>
              )}
            </div>
          )}
        </div>
      )}

      <Suspense fallback={null}>
        {editingTrade && (
          <EditTradeModal trade={editingTrade} onClose={() => setEditingTrade(null)} />
        )}
        {showImportModal && (
          <ImportTradeModal 
            onClose={() => setShowImportModal(false)}
            activeTrades={trades.filter(t => t.status === 'ACTIVE' || t.status === 'PENDING')}
            onUpdateRunning={handleUpdateRunningFromBinance}
            onMergeDCA={async (tradeId, addedCoins, addedPrice, addedFeeUsd = 0) => {
              try {
                const existing = trades.find(t => t.id === tradeId);
                if (!existing) return;
                const merged = calculateMergedDCA(existing, addedCoins, addedPrice, addedFeeUsd);
                await updateDoc(doc(db, 'trades', tradeId), {
                  positionSizeCoins: merged.newPositionSizeCoins,
                  entryPrice: merged.newEntryPrice,
                  totalBuyUsd: merged.newTotalBuyUsd,
                  feeUsd: merged.newFeeUsd,
                  notes: `${existing.notes || ''} | DCA added ${addedCoins.toLocaleString()} @ $${formatPrice(addedPrice)}`.trim()
                });
                toast.success(`DCA: Merged ${addedCoins.toLocaleString()} coins into ${existing.symbol}`);
                setShowImportModal(false);
              } catch (e) {
                console.error(e);
                toast.error("Failed to merge DCA trade");
              }
            }}
            onToggleTradeType={handleToggleTradeType}
            onSelect={async (sym, importedEntry, size, feeUsd, isPending, tradeType = 'TRADE', market = 'SPOT', binanceOrderId) => {
              try {
                if (!auth.currentUser) {
                  toast.error("Not logged in");
                  return;
                }
                const isAlpha = market === 'ALPHA' || isAlphaTradeOrSymbol(sym);
                const newTrade: any = {
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
                  buyFeeUsd: feeUsd || 0,
                  feeUsd: feeUsd || 0,
                  totalFeesUsd: feeUsd || 0,
                  type: isPending ? 'TRADE' : tradeType,
                  market: isAlpha ? 'ALPHA' : 'SPOT',
                  isAlpha: isAlpha,
                  status: isPending ? 'PENDING' : 'ACTIVE',
                  notes: isPending ? 'Imported Limit Order from Binance' : `Imported from Binance as ${tradeType}`,
                  createdAt: Date.now(),
                  pkrRate: pkrRateFromContext || 283.89
                };
                if (binanceOrderId) {
                  newTrade.binanceOrderId = String(binanceOrderId);
                }
                await saveTradeOptimistic(newTrade);
                setShowImportModal(false);
                toast.success(isPending ? `Imported ${sym} as Limit Order` : `Imported ${sym} as ${tradeType}`);
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
        {sharingTrade && (
          <SharePnLModal
            trade={sharingTrade}
            livePrice={livePrices[sharingTrade.symbol]}
            onClose={() => setSharingTrade(null)}
          />
        )}
        {inspectingTrade && (
          <TradeDetailDrawer
            trade={inspectingTrade}
            livePrice={livePrices[inspectingTrade.symbol]}
            viewMode={viewMode}
            onClose={() => setInspectingTrade(null)}
            onSharePnL={(t) => {
              setInspectingTrade(null);
              setSharingTrade(t);
            }}
            onReviewDiscipline={(t) => {
              setInspectingTrade(null);
              setReviewingDisciplineTrade(t);
            }}
            onApplyStopLoss={handleSetQuickSL}
          />
        )}
        {reviewingDisciplineTrade && (
          <DisciplineReviewModal
            trade={reviewingDisciplineTrade}
            isOpen={Boolean(reviewingDisciplineTrade)}
            onClose={() => setReviewingDisciplineTrade(null)}
            onSaveTag={async (tradeId, tag, note) => {
              try {
                await updateDoc(doc(db, 'trades', tradeId), {
                  disciplineTag: tag,
                  disciplineNotes: note || null
                });
                toast.success(`Discipline logged: ${DISCIPLINE_TAGS[tag]?.label || tag}`);
                await refreshTrades();
              } catch (e: any) {
                toast.error('Failed to save discipline tag');
              }
            }}
          />
        )}
      </Suspense>
    </div>
  );
}
