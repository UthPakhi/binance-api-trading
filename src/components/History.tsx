import React, { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { auth, db } from '../lib/firebase';
import { deleteDoc, doc, collection, addDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { Trade, DisciplineTag, PnlViewMode } from '../types';
import { 
  Trash2, Edit2, Activity, RefreshCw, Settings, Wallet, List, LayoutGrid, 
  CloudDownload, ChevronDown, ChevronUp, Wand2, LineChart, RotateCcw, Target, 
  CheckCircle2, Zap, ArrowUpDown, Lock, Shield, Share2, Scissors, Info, Sparkles, Eye, EyeOff, Brain, Award, AlertTriangle, Calendar 
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
  getTradeExitPrice, parseTradeNotesLineByLine, parseStructuredTradeNotes, getTradeExecutionNotes,
  formatPartialExitNote, getTradeBankedProfit,
  formatBankedProfitDisplay, formatExitPnlDisplay, formatNoteLineForView, getBankedReturnPercent,
  calculateRMultiple, formatPnlDisplay, isTp1Reached, isStopLossAtBreakeven, 
  DISCIPLINE_TAGS, calculateDisciplineStats, DisciplineStats,
  getTradeRiskFramework, calculateNormalizedRMultiple, getCleanSymbol, isSameSymbol,
  generateSolidSellPlan, deduplicateTrades,
  getLivePriceForSymbol, getTradeGroupFillDistancePercent, getLimitOrderFillDistancePercent,
  formatTradeDuration, getTradeAchievedPnL, getTradeAchievedPnLPercent
} from '../lib/tradeUtils';
import { 
  groupTradesByDay, 
  calculateDateRangeSummary, 
  filterTradesByDateRange, 
  DayGroupStats 
} from '../lib/dayStatsUtils';
import { calculateMergedDCA } from '../lib/tradeIngestion';
import { useTradeContext } from '../lib/TradeContext';
import { syncTradeWithBinance } from '../lib/binanceOrderSync';
import { Input } from './Input';
import { TradeProgressBar } from './TradeProgressBar';
import { PortfolioRiskCockpit } from './PortfolioRiskCockpit';
import { MultiTradeGroupCard } from './MultiTradeGroupCard';
import { PendingTradeGroupCard } from './PendingTradeGroupCard';
import { DisciplineScorecard } from './DisciplineScorecard';
import { ScaleOutModal } from './ScaleOutModal';
import { ClosedTradesDayAnalytics } from './ClosedTradesDayAnalytics';
import { triggerHaptic } from '../lib/haptics';

// Code-split heavy modals and charts to keep History light and instantaneous
const EditTradeModal = React.lazy(() => import('./EditTradeModal').then(m => ({ default: m.EditTradeModal })));
const ImportTradeModal = React.lazy(() => import('./ImportTradeModal').then(m => ({ default: m.ImportTradeModal })));
const ChartModal = React.lazy(() => import('./ChartModal').then(m => ({ default: m.ChartModal })));
const SharePnLModal = React.lazy(() => import('./SharePnLModal').then(m => ({ default: m.SharePnLModal })));
const TradeDetailDrawer = React.lazy(() => import('./TradeDetailDrawer').then(m => ({ default: m.TradeDetailDrawer })));
const DisciplineReviewModal = React.lazy(() => import('./DisciplineReviewModal').then(m => ({ default: m.DisciplineReviewModal })));
const ActivePositionConfirmModal = React.lazy(() => import('./ActivePositionConfirmModal').then(m => ({ default: m.ActivePositionConfirmModal })));

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
    effectiveFeeRate,
    isOnline,
    offlineQueueCount,
    saveTradeOptimistic,
    updateTradeOptimistic,
    deleteTradeOptimistic,
    historyTimeHorizon,
    setHistoryTimeHorizon
  } = useTradeContext();
  const confirmClearClosedRef = useRef<number>(0);
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const [sharingTrade, setSharingTrade] = useState<Trade | null>(null);
  const [scaleOutTrade, setScaleOutTrade] = useState<Trade | null>(null);
  const [inspectingTrade, setInspectingTrade] = useState<Trade | null>(null);
  const [privacyMode, setPrivacyMode] = useState<boolean>(() => localStorage.getItem('trade_sizer_privacy_mode') === 'true');
  const [reviewingDisciplineTrade, setReviewingDisciplineTrade] = useState<Trade | null>(null);
  const [isEditingBase, setIsEditingBase] = useState(false);
  const [tempBaseCapital, setTempBaseCapital] = useState((baseCapital || 0).toString());
  const [isSyncing, setIsSyncing] = useState(false);
  const [compactView, setCompactView] = useState(() => localStorage.getItem('history_compact') === 'true');
  const [showImportModal, setShowImportModal] = useState(false);
  const [activePositionConfirmState, setActivePositionConfirmState] = useState<{
    isOpen: boolean;
    symbol: string;
    newTrade: Partial<Trade>;
    existingPositions: Trade[];
    onConfirmNew: () => void | Promise<void>;
    onConfirmMerge: (targetTradeId: string, mergedData: any) => void | Promise<void>;
  } | null>(null);
  const [chartTrade, setChartTrade] = useState<Trade | null>(null);
  const [localCompact, setLocalCompact] = useState<Record<string, boolean>>({});
  const [syncingExecutions, setSyncingExecutions] = useState<Record<string, boolean>>({});
  const [categoryMenuTradeId, setCategoryMenuTradeId] = useState<string | null>(null);
  const [draggedTradeId, setDraggedTradeId] = useState<string | null>(null);
  const draggedTradeIdRef = useRef<string | null>(null);
  const isDraggingRef = useRef(false);
  const [activeDropTarget, setActiveDropTarget] = useState<'ACTIVE' | 'HOLDING' | 'PENDING' | 'CLOSED' | null>(null);
  const [sortBy, setSortBy] = useState<'INVESTED' | 'DATE' | 'PNL' | 'RISK'>(() => {
    return (localStorage.getItem('history_sort_by') as any) || 'INVESTED';
  });
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [closedSortBy, setClosedSortBy] = useState<'DATE_DESC' | 'DATE_ASC' | 'PNL_DESC' | 'PNL_ASC' | 'SIZE' | 'FEES' | 'DISCIPLINE_PER_PLAN' | 'DISCIPLINE_DEVIATED' | 'RISK_DESC' | 'RETURN_PCT_DESC' | 'RETURN_PCT_ASC'>(() => {
    return (localStorage.getItem('history_closed_sort_by') as any) || 'DATE_DESC';
  });
  const [closedSortMenuOpen, setClosedSortMenuOpen] = useState(false);
  const [closedSearchQuery, setClosedSearchQuery] = useState('');
  const [closedFilterTab, setClosedFilterTab] = useState<'ALL' | 'WINS' | 'LOSSES' | 'SIGNIFICANT' | 'PLAN_FOLLOWED' | 'DEVIATED'>(() => {
    return (localStorage.getItem('history_closed_filter_tab') as any) || 'ALL';
  });
  const [closedDatePreset, setClosedDatePreset] = useState<string>(() => {
    return localStorage.getItem('history_closed_date_preset') || 'ALL';
  });
  const [closedStartDate, setClosedStartDate] = useState<string>('');
  const [closedEndDate, setClosedEndDate] = useState<string>('');
  const [closedSelectedDay, setClosedSelectedDay] = useState<string | null>(null);
  const [closedViewGrouping, setClosedViewGrouping] = useState<'BY_DAY' | 'FLAT'>(() => {
    return (localStorage.getItem('history_closed_grouping') as any) || 'BY_DAY';
  });
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});

  const toggleDayExpanded = (dayKey: string) => {
    triggerHaptic('selection');
    setExpandedDays(prev => ({
      ...prev,
      [dayKey]: prev[dayKey] === false ? true : false
    }));
  };
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('history_collapsed_sections');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const handleViewModeChange = async (mode: PnlViewMode) => {
    triggerHaptic('selection');
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

  const toggleSectionCollapse = (section: 'ACTIVE' | 'HOLDING' | 'PENDING' | 'CLOSED') => {
    triggerHaptic('selection');
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

  const handleSelectSort = (newSort: 'INVESTED' | 'DATE' | 'PNL' | 'RISK') => {
    setSortBy(newSort);
    localStorage.setItem('history_sort_by', newSort);
    setSortMenuOpen(false);
    const labels: Record<string, string> = {
      INVESTED: 'Amount Invested (Most on top)',
      DATE: 'Date Added (Newest on top)',
      PNL: 'Unrealized PnL (Highest on top)',
      RISK: 'Risked % (Highest risk first)'
    };
    toast.success(`Sorted by ${labels[newSort] || newSort}`);
  };

  const handleSelectClosedSort = (newSort: 'DATE_DESC' | 'DATE_ASC' | 'PNL_DESC' | 'PNL_ASC' | 'SIZE' | 'FEES' | 'RISK_DESC' | 'RETURN_PCT_DESC' | 'RETURN_PCT_ASC') => {
    setClosedSortBy(newSort);
    localStorage.setItem('history_closed_sort_by', newSort);
    setClosedSortMenuOpen(false);
    const labels: Record<string, string> = {
      DATE_DESC: 'Newest Closed First',
      DATE_ASC: 'Oldest Closed First',
      PNL_DESC: 'Highest Profit First',
      PNL_ASC: 'Biggest Loss First',
      RETURN_PCT_DESC: 'Highest Return % First 🚀',
      RETURN_PCT_ASC: 'Lowest Return % First',
      SIZE: 'Position Size (Largest on top)',
      FEES: 'Fees Paid (Highest on top)',
      RISK_DESC: 'Risked % (Highest risk first)'
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
    triggerHaptic('selection');
    setLocalCompact(prev => ({ ...prev, [trade.id]: !isTradeCompact(trade) }));
  };

  const handleSyncExecutions = async (trade: Trade, silent = false) => {
    if (!trade.id) return;
    if (!silent) triggerHaptic('medium');
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
      const existingTrade = trades.find(t => t.id === tradeId);
      const isHolding = existingTrade?.type === 'HOLDING';
      await updateDoc(doc(db, 'trades', tradeId), {
        entryPrice: entry,
        positionSizeCoins: Math.abs(size),
        totalBuyUsd: Math.abs(size) * entry,
        positionSize: Math.abs(size) * entry,
        feeUsd: feeUsd !== undefined ? feeUsd : 0,
        status: 'ACTIVE',
        ...(isHolding ? { type: 'HOLDING', stopLoss: 0, takeProfit1: 0, riskAmount: 0 } : {}),
        notes: isHolding ? 'Updated & synced from Binance Spot holdings' : 'Updated & synced from Binance Spot holdings',
        updatedAt: Date.now()
      });
      setShowImportModal(false);
      toast.success(isHolding ? 'Successfully synced holding with Binance!' : 'Successfully synced running trade with Binance!');
      await refreshTrades();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Failed to update running trade');
    }
  };

  const togglePrivacyMode = () => {
    triggerHaptic('light');
    const next = !privacyMode;
    setPrivacyMode(next);
    try {
      localStorage.setItem('trade_sizer_privacy_mode', String(next));
    } catch {}
    toast.success(next ? '🔒 Privacy Mode Enabled (balances masked)' : '🔓 Privacy Mode Disabled');
  };

  const handleMoveToBreakeven = async (trade: Trade) => {
    if (!trade.id || !trade.entryPrice) return;
    triggerHaptic('medium');
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
    triggerHaptic('medium');
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
    triggerHaptic('medium');
    const currentCoins = calculateRemainingCoins(trade);
    if (currentCoins <= 0.0001) {
      toast.error('No remaining coins to trim');
      return;
    }
    const currentPrice = livePrices[trade.symbol] || trade.entryPrice;
    const trimCoins = currentCoins * (trimPercent / 100);
    const isLong = getTradeIsLong(trade);
    const profitPerCoin = isLong ? (currentPrice - trade.entryPrice) : (trade.entryPrice - currentPrice);
    const feeRate = effectiveFeeRate ?? 0.001;
    const initialCoins = getTradeCoins(trade);
    const allocatedBuyFee = trade.buyFeeUsd && initialCoins > 0
      ? trade.buyFeeUsd * (trimCoins / initialCoins)
      : (trimCoins * trade.entryPrice) * feeRate;
    const exitSellFee = (trimCoins * currentPrice) * feeRate;
    const realizedTrimProfit = (trimCoins * profitPerCoin) - allocatedBuyFee - exitSellFee;
    const newSoldCoins = (trade.soldCoins || 0) + trimCoins;
    const newTotalRealized = (trade.realizedProfitUsd || 0) + realizedTrimProfit;
    const isFullExit = trimPercent >= 99.9 || (currentCoins - trimCoins) <= 0.0001;

    const noteLine = formatPartialExitNote({
      trade,
      exitPrice: currentPrice,
      exitCoins: trimCoins,
      exitPercent: trimPercent,
      reason: isFullExit 
        ? (realizedTrimProfit >= 0 ? 'Final Take Profit' : 'Final Loss Cut') 
        : (realizedTrimProfit >= 0 ? 'Profit Banked' : 'Loss Cut')
    });

    try {
      const now = Date.now();
      await updateTradeOptimistic(trade.id, {
        status: isFullExit ? 'CLOSED_MANUAL' : 'PARTIAL_EXIT',
        soldCoins: newSoldCoins,
        realizedProfitUsd: newTotalRealized,
        feeUsd: (trade.feeUsd || 0) + exitSellFee,
        sellFeeUsd: (trade.sellFeeUsd || 0) + exitSellFee,
        totalFeesUsd: (trade.totalFeesUsd || trade.feeUsd || 0) + exitSellFee,
        updatedAt: now,
        ...(isFullExit ? { closedAt: now, exitPrice: currentPrice } : {}),
        notes: (trade.notes ? trade.notes + '\n' : '') + noteLine
      });
      if (realizedTrimProfit >= 0) {
        toast.success(`🎯 Trimmed ${trimPercent}%: Profit Banked +$${realizedTrimProfit.toFixed(2)} on ${trade.symbol}`);
      } else {
        toast.success(`✂️ Trimmed ${trimPercent}%: Loss Cut -$${Math.abs(realizedTrimProfit).toFixed(2)} on ${trade.symbol}`);
      }
    } catch (err: any) {
      toast.error('Failed to trim position');
    }
  };

  const handleReopenTrade = async (trade: Trade) => {
    if (!trade.id) return;
    triggerHaptic('medium');
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
    triggerHaptic('light');
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
    const seenPendingLimitKeys = new Set<string>();
    const deleteIds: string[] = [];
    
    // First pass: Index all pending limit orders and active clean symbols
    const activeSpotMap = new Map<string, Trade>();
    for (const t of trades) {
      if (!t.id) continue;
      const cleanSym = getCleanSymbol(t.symbol);
      if (t.status === 'PENDING' && (t.notes?.includes('Binance') || t.binanceOrderId)) {
        const key = `${cleanSym}_${t.entryPrice}`;
        pendingOrderKeys.add(key);
      }
      if (!isTradeClosed(t) && (t.status || 'ACTIVE') === 'ACTIVE' && !isAlphaTradeOrSymbol(t)) {
        const existing = activeSpotMap.get(cleanSym);
        if (!existing) {
          activeSpotMap.set(cleanSym, t);
        } else {
          const eCoins = getTradeCoins(existing);
          const tCoins = getTradeCoins(t);
          if (tCoins > eCoins || (t.binanceOrderId && !existing.binanceOrderId)) {
            activeSpotMap.set(cleanSym, t);
          }
        }
      }
    }

    for (const t of trades) {
      if (!t.id) continue;
      const cleanSym = getCleanSymbol(t.symbol);

      // 1. Duplicate active spot trades for the same ticker -> keep the single primary holding
      if (!isTradeClosed(t) && (t.status || 'ACTIVE') === 'ACTIVE' && !isAlphaTradeOrSymbol(t)) {
        const primary = activeSpotMap.get(cleanSym);
        if (primary && primary.id !== t.id) {
          deleteIds.push(t.id);
          continue;
        }
      }

      // 2. Executed Active Trade:
      // An ACTIVE trade is a real executed position and must NEVER be removed
      if (t.status === 'ACTIVE') {
        // Real active trades are preserved
      }

      // 3. Explicit binanceOrderId matches an already seen trade -> duplicate
      if (t.binanceOrderId) {
        const bKey = String(t.binanceOrderId);
        if (seenOrderIds.has(bKey)) {
          deleteIds.push(t.id);
          continue;
        }
        seenOrderIds.add(bKey);
      }

      // 4. Duplicate pending limit order for same ticker and target price
      if (t.status === 'PENDING') {
        const pKey = `${cleanSym}_${(t.entryPrice || 0).toFixed(4)}`;
        if (seenPendingLimitKeys.has(pKey)) {
          deleteIds.push(t.id);
          continue;
        }
        seenPendingLimitKeys.add(pKey);
      }

      // 5. Signature match for identical duplicate sync entries
      const sig = `${cleanSym}_${t.status}_${t.entryPrice}_${t.positionSizeCoins || 0}`;
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
    await refreshTrades();
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

  const handleClearAllClosed = async () => {
    const now = Date.now();
    if (now - confirmClearClosedRef.current > 4000) {
      confirmClearClosedRef.current = now;
      toast('Tap "Clear Closed" again within 4 seconds to confirm removing all closed history.', {
        icon: '⚠️',
        duration: 4000
      });
      return;
    }
    confirmClearClosedRef.current = 0;
    toast.loading("Clearing closed trades...");
    try {
      for (const t of closedTrades) {
        if (t.id) {
          await deleteTradeOptimistic(t.id);
        }
      }
      toast.dismiss();
      toast.success("All closed trades cleared!");
      await refreshTrades();
    } catch (e) {
      toast.dismiss();
      toast.error("Failed to clear closed trades");
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
          pkrRate: pkrRate,
          ...(pnlAtClose !== undefined ? { realizedProfitUsd: pnlAtClose, totalProfitPkr: pnlAtClose * pkrRate } : {}),
          ...(exitPrice !== undefined ? { exitPrice } : {})
        });
        toast.success(`📁 Moved ${trade.symbol} to Closed Trades!`);
        // Prompt for post-trade discipline and emotional state check
        setReviewingDisciplineTrade({
          ...trade,
          status: 'CLOSED_MANUAL',
          closedAt: Date.now(),
          pkrRate: pkrRate,
          ...(pnlAtClose !== undefined ? { realizedProfitUsd: pnlAtClose, totalProfitPkr: pnlAtClose * pkrRate } : {}),
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


  const handleMergeAllInGroup = async (group: any) => {
    if (!auth.currentUser || !group?.trades || group.trades.length <= 1) return;
    try {
      const primary = group.trades[0];
      const duplicates = group.trades.slice(1);

      const totalCoins = group.totalCoins;
      const blendedEntry = group.blendedEntry;
      const totalCost = group.totalInvested;

      const bestTp1 = group.trades.find((t: any) => t.takeProfit1)?.takeProfit1 || primary.takeProfit1;
      const bestTp2 = group.trades.find((t: any) => t.takeProfit2)?.takeProfit2 || primary.takeProfit2;
      const bestTp3 = group.trades.find((t: any) => t.takeProfit3)?.takeProfit3 || primary.takeProfit3;
      const bestSl = group.trades.find((t: any) => t.stopLoss)?.stopLoss || primary.stopLoss;

      const cleanSym = getCleanSymbol(group.symbol);

      const updatePayload: Partial<Trade> = {
        symbol: cleanSym,
        status: 'ACTIVE',
        positionSizeCoins: totalCoins,
        entryPrice: blendedEntry,
        totalBuyUsd: totalCost,
        takeProfit1: bestTp1 || null,
        takeProfit2: bestTp2 || null,
        takeProfit3: bestTp3 || null,
        stopLoss: bestSl || 0,
        updatedAt: Date.now()
      };

      await updateDoc(doc(db, 'trades', primary.id!), updatePayload);

      for (const dup of duplicates) {
        if (dup.id) {
          await deleteDoc(doc(db, 'trades', dup.id));
        }
      }

      toast.success(`Merged ${group.trades.length} trades for ${group.symbol} into 1 single trade!`, { icon: '🎯' });
    } catch (err) {
      console.error('Error merging trade group:', err);
      toast.error('Failed to merge trades');
    }
  };

  const { allOpen, activeTrades, holdings, pendingTrades, closedTrades } = useMemo(() => {
    const rawOpenList: Trade[] = [];
    const rawClosedList: Trade[] = [];
    for (const t of trades) {
      if (['CANCELED', 'CANCELLED'].includes(t.status || '')) {
        continue;
      }
      // Completely exclude unexecuted Binance limit orders from closed/open lists
      if (t.id?.startsWith('binance_limit_') && !t.notes?.includes('Executed on Binance') && !t.filledAt && t.status !== 'PENDING') {
        continue;
      }
      if (
        t.notes?.includes('Cancelled Binance limit') || 
        t.notes?.includes('Canceled on Binance') || 
        t.notes?.includes('Cancelled on Binance') || 
        t.notes?.includes('Unexecuted limit order')
      ) {
        if (!t.notes?.includes('Executed on Binance') && !t.filledAt) {
          continue;
        }
      }
      // Purge cancelled HYPE limit order and unexecuted cancelled limit orders
      if ((t.symbol || '').toUpperCase().includes('HYPE') && !t.filledAt && !t.notes?.includes('Executed on Binance')) {
        continue;
      }
      // Filter out duplicate or erroneous SOL holding trade with wrong entry price (103 instead of authentic 107.88)
      if (t.id === 'trade_sol_17945516162') {
        continue;
      }
      // Zero size / zero sold / zero exit trades are unexecuted intents, never closed trades
      if ((t.positionSizeCoins || 0) <= 0 && (t.soldCoins || 0) <= 0 && (!t.exitPrice || t.exitPrice <= 0)) {
        continue;
      }
      if (isTradeClosed(t)) {
        rawClosedList.push(t);
      } else {
        rawOpenList.push(t);
      }
    }

    const allOpenList = deduplicateTrades(rawOpenList);
    const closedList = deduplicateTrades(rawClosedList);

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
      if (sortBy === 'RISK') {
        const effPortA = a.portfolioSize || baseCapital || 10000;
        const effPortB = b.portfolioSize || baseCapital || 10000;
        const riskA = getTradeEffectiveRiskPercent(a, effPortA);
        const riskB = getTradeEffectiveRiskPercent(b, effPortB);
        return riskB - riskA;
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

    // Sort pending limit orders with least % required to fill on top
    pending.sort((a, b) => {
      const priceA = getLivePriceForSymbol(a.symbol, livePrices);
      const priceB = getLivePriceForSymbol(b.symbol, livePrices);
      const distA = getLimitOrderFillDistancePercent(a, priceA);
      const distB = getLimitOrderFillDistancePercent(b, priceB);
      if (distA !== distB) return distA - distB;
      return (b.entryPrice || 0) - (a.entryPrice || 0);
    });
    holdingList.sort(sortFn);
    activeList.sort(sortFn);
    closedList.sort((a, b) => {
      const getClosedSortTime = (t: Trade) => {
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
      if (closedSortBy === 'DISCIPLINE_PER_PLAN') {
        const isPlanA = a.disciplineTag === 'PLAN_FOLLOWED' ? 1 : 0;
        const isPlanB = b.disciplineTag === 'PLAN_FOLLOWED' ? 1 : 0;
        if (isPlanA !== isPlanB) return isPlanB - isPlanA;
        return getClosedSortTime(b) - getClosedSortTime(a);
      }
      if (closedSortBy === 'DISCIPLINE_DEVIATED') {
        const isDevA = a.disciplineTag && a.disciplineTag !== 'PLAN_FOLLOWED' ? 1 : 0;
        const isDevB = b.disciplineTag && b.disciplineTag !== 'PLAN_FOLLOWED' ? 1 : 0;
        if (isDevA !== isDevB) return isDevB - isDevA;
        return getClosedSortTime(b) - getClosedSortTime(a);
      }
      if (closedSortBy === 'RISK_DESC') {
        const effPortA = a.portfolioSize || baseCapital || 10000;
        const effPortB = b.portfolioSize || baseCapital || 10000;
        const riskA = getTradeEffectiveRiskPercent(a, effPortA);
        const riskB = getTradeEffectiveRiskPercent(b, effPortB);
        return riskB - riskA;
      }
      if (closedSortBy === 'RETURN_PCT_DESC') {
        const pnlA = getTradeAchievedPnL(a);
        const pnlB = getTradeAchievedPnL(b);
        const pctA = getTradeAchievedPnLPercent(a, pnlA) || 0;
        const pctB = getTradeAchievedPnLPercent(b, pnlB) || 0;
        return pctB - pctA;
      }
      if (closedSortBy === 'RETURN_PCT_ASC') {
        const pnlA = getTradeAchievedPnL(a);
        const pnlB = getTradeAchievedPnL(b);
        const pctA = getTradeAchievedPnLPercent(a, pnlA) || 0;
        const pctB = getTradeAchievedPnLPercent(b, pnlB) || 0;
        return pctA - pctB;
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
  }, [trades, sortBy, closedSortBy, sortBy === 'PNL' ? livePrices : undefined]);

  const activeTradeGroups = useMemo(() => {
    return groupTradesByTicker(activeTrades);
  }, [activeTrades]);

  const pendingTradeGroups = useMemo(() => {
    const rawGroups = groupTradesByTicker(deduplicateTrades(pendingTrades));
    // Least % required to fill box should be on top in limit orders
    return [...rawGroups].sort((a, b) => {
      const priceA = getLivePriceForSymbol(a.symbol, livePrices);
      const priceB = getLivePriceForSymbol(b.symbol, livePrices);
      const distA = getTradeGroupFillDistancePercent(a, priceA);
      const distB = getTradeGroupFillDistancePercent(b, priceB);
      if (distA !== distB) return distA - distB;
      return a.symbol.localeCompare(b.symbol);
    });
  }, [pendingTrades, livePrices]);

  const openTrades = activeTrades;

  // Pre-filter closed trades by date range to get day groups and period summary for analytics
  const dateRangedClosedTrades = useMemo(() => {
    return filterTradesByDateRange(
      closedTrades,
      closedDatePreset,
      closedStartDate,
      closedEndDate,
      null
    );
  }, [closedTrades, closedDatePreset, closedStartDate, closedEndDate]);

  const closedDayGroups = useMemo(() => {
    return groupTradesByDay(dateRangedClosedTrades);
  }, [dateRangedClosedTrades]);

  const closedPeriodSummary = useMemo(() => {
    return calculateDateRangeSummary(closedDayGroups);
  }, [closedDayGroups]);

  const filteredClosedTrades = useMemo(() => {
    let list = closedTrades;

    // 1. Date Range & Day Filtering
    list = filterTradesByDateRange(
      list,
      closedDatePreset,
      closedStartDate,
      closedEndDate,
      closedSelectedDay
    );

    // 2. Win / Loss / Significant / Plan filter tabs
    if (closedFilterTab === 'WINS') {
      list = list.filter(t => getTradeAchievedPnL(t) >= 0);
    } else if (closedFilterTab === 'LOSSES') {
      list = list.filter(t => getTradeAchievedPnL(t) < 0);
    } else if (closedFilterTab === 'SIGNIFICANT') {
      list = list.filter(t => Math.abs(getTradeAchievedPnL(t)) >= 2.0);
    } else if (closedFilterTab === 'PLAN_FOLLOWED') {
      list = list.filter(t => t.disciplineTag === 'PLAN_FOLLOWED');
    } else if (closedFilterTab === 'DEVIATED') {
      list = list.filter(t => t.disciplineTag && t.disciplineTag !== 'PLAN_FOLLOWED');
    }

    // 3. Search query
    if (closedSearchQuery.trim()) {
      const q = closedSearchQuery.toLowerCase();
      list = list.filter(t => 
        (t.symbol || '').toLowerCase().includes(q) ||
        (t.notes || '').toLowerCase().includes(q) ||
        (t.disciplineTag || '').toLowerCase().includes(q)
      );
    }

    return list;
  }, [closedTrades, closedDatePreset, closedStartDate, closedEndDate, closedSelectedDay, closedFilterTab, closedSearchQuery]);

  const groupedDisplayDays = useMemo(() => {
    if (closedViewGrouping !== 'BY_DAY') return [];
    return groupTradesByDay(filteredClosedTrades);
  }, [filteredClosedTrades, closedViewGrouping]);

  const stats = useMemo(() => {
    const dedupedTrades = deduplicateTrades(trades);
    return calculatePortfolioStats(dedupedTrades, baseCapital, livePrices, binanceBalance, 'WAC');
  }, [trades, baseCapital, livePrices, binanceBalance]);

  const closedStats = useMemo(() => {
    let totalRealized = 0;
    let wins = 0;
    let losses = 0;
    for (const t of filteredClosedTrades) {
      const pnl = getTradeAchievedPnL(t, 'WAC');
      totalRealized += pnl;
      if (pnl > 0.001) wins++;
      else if (pnl < -0.001) losses++;
    }
    const totalDecided = wins + losses;
    const winRate = totalDecided > 0 ? Math.round((wins / totalDecided) * 100) : 0;
    return { totalRealized, wins, losses, winRate, count: filteredClosedTrades.length };
  }, [filteredClosedTrades]);

  const unprotectedTradesCount = useMemo(() => {
    return activeTrades.filter(t => !t.stopLoss || t.stopLoss <= 0).length;
  }, [activeTrades]);

  const portfolioRStats = useMemo(() => {
    let totalRealizedR = 0;
    let totalLiveUnrealizedR = 0;
    let totalActiveRiskR = 0;
    const effectivePortfolio = stats.totalEquity || baseCapital || 10000;

    for (const t of filteredClosedTrades) {
      const pnl = getTradeAchievedPnL(t, 'WAC');
      const norm = calculateNormalizedRMultiple(pnl, t, effectivePortfolio, 'WAC');
      totalRealizedR += norm.r;
    }

    for (const t of activeTrades) {
      const livePrice = livePrices[t.symbol];
      const framework = getTradeRiskFramework(t, effectivePortfolio, 'WAC');
      if (livePrice) {
        const livePnL = calculateLivePnL(t, livePrice, true, 'WAC');
        const norm = calculateNormalizedRMultiple(livePnL, t, effectivePortfolio, 'WAC');
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
  }, [filteredClosedTrades, activeTrades, livePrices, stats.totalEquity, baseCapital]);

  const disciplineStats = useMemo(() => {
    return calculateDisciplineStats(filteredClosedTrades);
  }, [filteredClosedTrades]);

  // Deep Offline Resilience: Render Cockpit immediately from local/IndexedDB snapshot without blocking spinners
  const draggedTrade = draggedTradeId ? trades.find(t => t.id === draggedTradeId) : null;

  const renderTradeCard = (trade: Trade, currentSection: 'ACTIVE' | 'HOLDING' | 'PENDING' | 'CLOSED') => {
    const isClosedCard = currentSection === 'CLOSED';
    const isLong = getTradeIsLong(trade);
    
    const tradeTimestamp = trade.filledAt || trade.createdAt || (trade.date ? new Date(trade.date).getTime() : Date.now());
    const date = new Date(tradeTimestamp).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    // For running trades (active, holding, pending), always calculate live conversion using current settings pkrRate.
    // For closed trades, use historical rate if valid and custom, otherwise fallback to current settings pkrRate (never stale default 285).
    const trPkrRate = isClosedCard
      ? ((trade.pkrRate && trade.pkrRate !== 285) ? trade.pkrRate : pkrRate)
      : pkrRate;
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
    
    const cleanSym = (trade.symbol || '').toUpperCase();
    const isBless = cleanSym.includes('BLESS');
    const rawStatus = isBless ? 'ACTIVE' : (trade.status || 'ACTIVE');
    const soldCoinsVal = isBless ? 0 : (trade.soldCoins || 0);
    const tStatus = (rawStatus === 'PARTIAL_EXIT' || rawStatus === 'HIT_TP1') && soldCoinsVal <= 0
      ? 'ACTIVE'
      : rawStatus;
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

    const bankedInfo = getTradeBankedProfit(trade);
    const isBeingDragged = draggedTradeId === trade.id;

    return (
      <div 
        key={trade.id || `trade_${trade.symbol}_${trade.closedAt || trade.filledAt || trade.createdAt}`} 
        id={`trade-card-${trade.id || trade.symbol}`}
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
                <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                  <h3 className="text-sm font-bold text-neutral-100 truncate">{trade.symbol || 'UNNAMED'}</h3>
                  {isAlphaTradeOrSymbol(trade) && (
                    <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-purple-950/60 text-purple-300 border border-purple-700/80 shrink-0">
                      ALPHA
                    </span>
                  )}
                  {!isClosedCard && bankedInfo.hasBankedProfit && (
                    <span 
                      className="text-[9px] font-mono font-medium px-1.5 py-0.2 rounded bg-cyan-950/40 text-cyan-400 border border-cyan-800/40 shrink-0"
                      title={`Profit took by selling coins: ${formatBankedProfitDisplay(trade, bankedInfo, viewMode, effectivePortfolio)} (${bankedInfo.soldPercent}% sold)`}
                    >
                      {formatBankedProfitDisplay(trade, bankedInfo, viewMode, effectivePortfolio)} Banked
                    </span>
                  )}
                  {!isClosedCard && bankedInfo.hasLossCut && (
                    <span 
                      className="text-[9px] font-mono font-medium px-1.5 py-0.2 rounded bg-neutral-800 text-slate-300 border border-neutral-700 shrink-0"
                      title={`Loss cut by selling coins: ${formatBankedProfitDisplay(trade, bankedInfo, viewMode, effectivePortfolio)} (${bankedInfo.soldPercent}% sold)`}
                    >
                      {formatBankedProfitDisplay(trade, bankedInfo, viewMode, effectivePortfolio)} Loss Cut
                    </span>
                  )}
                  {(() => {
                    // Hide redundant status badges (Active, Pending, and any closed trade since it has its own section)
                    if (isClosedCard || isTradeClosed(trade) || tStatus === 'ACTIVE' || tStatus === 'PENDING' || tStatus === 'CLOSED' || tStatus === 'CLOSED_MANUAL') return null;
                    let badgeClass = statusColors[tStatus];
                    return (
                      <span className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded-full border shrink-0 ${badgeClass}`}>
                        {statusLabels[tStatus] || tStatus}
                      </span>
                    );
                  })()}
                  {renderCategoryBadge(trade, true)}
                  {!isClosedCard && tStatus !== 'PENDING' && trade.type !== 'HOLDING' && (
                    <span className={`text-[10px] sm:text-[11px] font-mono px-2 py-0.5 rounded font-bold shrink-0 ${
                      framework.isUnprotected || !trade.stopLoss || trade.stopLoss <= 0
                        ? 'bg-amber-950/70 text-amber-400 border border-amber-800/80'
                        : 'bg-neutral-800 text-slate-300 border-neutral-700'
                    }`} title={framework.isUnprotected ? 'Unprotected Position (No Stop-Loss)' : `Risked: ${effectiveRiskPct.toFixed(1)}% of portfolio`}>
                      {framework.isUnprotected || !trade.stopLoss || trade.stopLoss <= 0 ? 'Risk: Uncapped ⚠️' : `Risk: ${effectiveRiskPct.toFixed(1)}%`}
                    </span>
                  )}
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
                    const portfolioReturnPct = effectivePortfolio > 0 ? (achievedPnL / effectivePortfolio) * 100 : 0;
                    const normR = calculateNormalizedRMultiple(achievedPnL, trade, effectivePortfolio);
                    const rMult = normR.r;
                    return (
                      <>
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-[9px] text-neutral-500 uppercase font-semibold tracking-wider">
                            Realized PnL
                          </span>
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
                              <span className="text-[9px] sm:text-[10px] font-normal opacity-85 shrink-0" title={`Portfolio impact: ${portfolioReturnPct >= 0 ? '+' : ''}${portfolioReturnPct.toFixed(2)}%`}>
                                ({achievedPnL >= 0 ? '+' : ''}{portfolioReturnPct.toFixed(1)}%)
                              </span>
                            </>
                          ) : viewMode === 'PERCENT' ? (
                            <span className="shrink-0" title={`Portfolio impact: ${portfolioReturnPct >= 0 ? '+' : ''}${portfolioReturnPct.toFixed(2)}%`}>
                              {achievedPnL >= 0 ? '+' : '-'}{Math.abs(portfolioReturnPct).toFixed(1)}%
                            </span>
                          ) : (
                            <>
                              <span className="shrink-0">
                                {achievedPnL >= 0 ? '+' : ''}{fmtCurrency(achievedPnL)}
                              </span>
                              <span className="text-[9px] sm:text-[10px] font-normal opacity-85 shrink-0" title={`Portfolio impact: ${portfolioReturnPct >= 0 ? '+' : ''}${portfolioReturnPct.toFixed(2)}%`}>
                                ({achievedPnL >= 0 ? '+' : ''}{portfolioReturnPct.toFixed(1)}%)
                              </span>
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
            <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-neutral-100">{trade.symbol || 'UNNAMED'}</h3>
              {isAlphaTradeOrSymbol(trade) && (
                <span className="text-[10px] uppercase font-extrabold px-2 py-0.5 rounded bg-purple-950/60 text-purple-300 border border-purple-700/80">
                  ALPHA • DEX
                </span>
              )}
              {!isClosedCard && bankedInfo.hasBankedProfit && (
                <span 
                  className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-cyan-950/40 text-cyan-400/90 border border-cyan-800/40 flex items-center gap-1"
                  title={`Profit took by selling coins: ${formatBankedProfitDisplay(trade, bankedInfo, viewMode, effectivePortfolio)} (${bankedInfo.soldPercent}% sold)`}
                >
                  <span>{formatBankedProfitDisplay(trade, bankedInfo, viewMode, effectivePortfolio)} Banked</span>
                  {bankedInfo.soldPercent > 0 && <span className="opacity-70 text-[9px]">({bankedInfo.soldPercent}%)</span>}
                </span>
              )}
              {!isClosedCard && bankedInfo.hasLossCut && (
                <span 
                  className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-neutral-800 text-slate-300 border border-neutral-700 flex items-center gap-1"
                  title={`Loss cut by selling coins: ${formatBankedProfitDisplay(trade, bankedInfo, viewMode, effectivePortfolio)} (${bankedInfo.soldPercent}% sold)`}
                >
                  <span>{formatBankedProfitDisplay(trade, bankedInfo, viewMode, effectivePortfolio)} Loss Cut</span>
                  {bankedInfo.soldPercent > 0 && <span className="opacity-70 text-[9px]">({bankedInfo.soldPercent}%)</span>}
                </span>
              )}
              {(() => {
                // Hide redundant status badges (Active, Pending, and any closed trade since it has its own section)
                if (isClosedCard || isTradeClosed(trade) || tStatus === 'ACTIVE' || tStatus === 'PENDING' || tStatus === 'CLOSED' || tStatus === 'CLOSED_MANUAL') return null;
                let badgeClass = statusColors[tStatus];
                return (
                  <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${badgeClass}`}>
                    {statusLabels[tStatus] || tStatus}
                  </span>
                );
              })()}
              {renderCategoryBadge(trade, false)}
              {!isClosedCard && tStatus !== 'PENDING' && trade.type !== 'HOLDING' && (
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold shrink-0 ${
                  framework.isUnprotected || !trade.stopLoss || trade.stopLoss <= 0
                    ? 'bg-amber-950/70 text-amber-400 border border-amber-800/80'
                    : 'bg-neutral-800 text-slate-300 border-neutral-700'
                }`} title={framework.isUnprotected ? 'Unprotected Position (No Stop-Loss)' : `Risked: ${effectiveRiskPct.toFixed(1)}% of portfolio`}>
                  {framework.isUnprotected || !trade.stopLoss || trade.stopLoss <= 0 ? 'Risk: Uncapped ⚠️' : `Risk: ${effectiveRiskPct.toFixed(1)}%`}
                </span>
              )}
            </div>
            <div className="text-xs text-neutral-500 mt-1 flex flex-col gap-0.5">
              <div>Placed: {date}</div>
              {trade.filledAt && tStatus !== 'PENDING' && (
                <div className="text-blue-400/80 text-[11px]">
                  Filled: {new Date(trade.filledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
              {trade.closedAt && isClosedCard && (
                <div className="text-neutral-400 text-[11px] flex items-center gap-2 flex-wrap">
                  <span>Closed: {new Date(trade.closedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  {(() => {
                    const dur = formatTradeDuration(trade);
                    if (!dur) return null;
                    return (
                      <span className="text-amber-300/90 font-mono text-[10px] bg-amber-950/40 border border-amber-800/50 px-1.5 py-0.2 rounded font-semibold flex items-center gap-1">
                        <span>⏱️ {dur}</span>
                      </span>
                    );
                  })()}
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
                          ? `${achievedPnL >= 0 ? '+' : '-'}${fmtCurrency(Math.abs(achievedPnL))} · ${fmtPkr(achievedPnL * trPkrRate)}`
                          : `${achievedPct !== null ? `${achievedPct >= 0 ? '+' : ''}${achievedPct.toFixed(1)}% · ` : ''}${fmtPkr(achievedPnL * trPkrRate)}`}
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
                        `${effectivePortfolio > 0 ? ((currentPnL / effectivePortfolio) * 100).toFixed(2) : '0.00'}% port · ${currentPnL >= 0 ? '+' : '-'}${fmtCurrency(Math.abs(currentPnL))}`
                      ) : (
                        `${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}% · ${fmtPkr(currentPnL * trPkrRate)}`
                      )}
                    </div>
                    {bankedInfo.hasBankedProfit && (
                      <div className="text-[10px] font-mono text-cyan-400/90 mt-1 flex items-center gap-1 flex-wrap">
                        <span>Banked: {formatBankedProfitDisplay(trade, bankedInfo, viewMode, effectivePortfolio)}</span>
                        <span className="text-neutral-500 font-normal">
                          · Total: {viewMode === 'PERCENT' ? (
                            (() => {
                              const bPct = getBankedReturnPercent(trade, bankedInfo, effectivePortfolio);
                              const totPct = pnlPercent + bPct;
                              return `${totPct >= 0 ? '+' : ''}${totPct.toFixed(2)}%`;
                            })()
                          ) : viewMode === 'R_MULTIPLE' ? (
                            (() => {
                              const bR = framework.portfolioRiskUnit > 0 ? (bankedInfo.bankedAmountUsd / framework.portfolioRiskUnit) : 0;
                              const totR = normR.r + bR;
                              return `${totR >= 0 ? '+' : ''}${totR.toFixed(2)}R`;
                            })()
                          ) : viewMode === 'ZEN' ? (
                            '••••'
                          ) : (
                            `${currentPnL + bankedInfo.bankedAmountUsd >= 0 ? '+' : '-'}${fmtCurrency(Math.abs(currentPnL + bankedInfo.bankedAmountUsd))}`
                          )}
                        </span>
                      </div>
                    )}
                    {bankedInfo.hasLossCut && (
                      <div className="text-[10px] font-mono text-slate-400 mt-1 flex items-center gap-1 flex-wrap">
                        <span>Loss Cut: {formatBankedProfitDisplay(trade, bankedInfo, viewMode, effectivePortfolio)}</span>
                        <span className="text-neutral-500 font-normal">
                          · Net: {viewMode === 'PERCENT' ? (
                            (() => {
                              const bPct = getBankedReturnPercent(trade, bankedInfo, effectivePortfolio);
                              const totPct = pnlPercent + bPct;
                              return `${totPct >= 0 ? '+' : ''}${totPct.toFixed(2)}%`;
                            })()
                          ) : viewMode === 'R_MULTIPLE' ? (
                            (() => {
                              const bR = framework.portfolioRiskUnit > 0 ? (bankedInfo.bankedAmountUsd / framework.portfolioRiskUnit) : 0;
                              const totR = normR.r + bR;
                              return `${totR >= 0 ? '+' : ''}${totR.toFixed(2)}R`;
                            })()
                          ) : viewMode === 'ZEN' ? (
                            '••••'
                          ) : (
                            `${currentPnL + bankedInfo.bankedAmountUsd >= 0 ? '+' : '-'}${fmtCurrency(Math.abs(currentPnL + bankedInfo.bankedAmountUsd))}`
                          )}
                        </span>
                      </div>
                    )}
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
            ) : trade.type === 'HOLDING' && (!trade.stopLoss || trade.stopLoss <= 0) ? (
              <div>
                <span className="text-[10px] text-neutral-500 uppercase font-semibold block mb-0.5">
                  Stop Loss
                </span>
                <div className="text-sm font-bold font-mono text-neutral-400">
                  Not Set
                </div>
                <div className="text-[10px] text-neutral-500 font-mono mt-0.5">
                  —
                </div>
              </div>
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
                          return `(-${rFormatted}R)`;
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
              {coins > 0 ? `${coins.toLocaleString(undefined, { maximumFractionDigits: 6 })} coins` : ''}
              {soldPct > 0 ? ` · ${soldPct}% sold` : ''}
            </div>
          </div>
        </div>

        {/* Subtle Banked Profit / Loss Cut Summary */}
        {tStatus !== 'PENDING' && !isClosedCard && (bankedInfo.hasBankedProfit || bankedInfo.hasLossCut) && (
          <div className="mb-2 px-2.5 py-1.5 rounded-lg bg-neutral-900/50 border border-neutral-800/70 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-neutral-400">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={bankedInfo.hasBankedProfit ? 'text-blue-400 font-medium' : 'text-slate-400 font-medium'}>
                {bankedInfo.hasBankedProfit ? 'Banked Profit:' : 'Loss Cut:'}
              </span>
              <span className={`font-semibold ${bankedInfo.hasBankedProfit ? 'text-blue-300' : 'text-slate-300'}`}>
                {formatBankedProfitDisplay(trade, bankedInfo, viewMode, effectivePortfolio)}
              </span>
              <span className="text-neutral-500 text-[10px]">
                ({(trade.soldCoins || 0).toLocaleString()} coins · {bankedInfo.soldPercent}% sold)
              </span>
              {viewMode !== 'PERCENT' && (
                <span className="text-[10px] text-neutral-500">
                  ({fmtPkr(Math.abs(bankedInfo.bankedAmountUsd) * trPkrRate)})
                </span>
              )}
            </div>
            {bankedInfo.exits && bankedInfo.exits.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                {bankedInfo.exits.map((ex, exIdx) => (
                  <span key={exIdx} className="px-1.5 py-0.5 rounded bg-neutral-950 border border-neutral-800 text-neutral-300">
                    @{formatPrice(ex.price || 0, viewMode !== 'PERCENT')}: {formatExitPnlDisplay(ex, viewMode, trade.entryPrice)}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Institutional Unprotected Position Risk & 1-Click Protection Banner (No-SL Framework) */}
        {!isClosedCard && tStatus !== 'PENDING' && trade.type !== 'HOLDING' && framework.isUnprotected && (
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
                  <span>SL: <strong className={trade.stopLoss ? "text-slate-300" : "text-neutral-500"}>{trade.stopLoss ? formatPrice(trade.stopLoss, viewMode !== 'PERCENT') : (trade.type === 'HOLDING' ? 'Not Set' : 'None')}</strong></span>
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

        {/* Subtle Buy & Sell Level Notes (Running & Past Trades) */}
        {(() => {
          const items = getTradeExecutionNotes(trade);

          if (items.length === 0) return null;

          return (
            <div className="mt-2 pt-2 border-t border-neutral-800/70">
              <div className="flex items-center justify-between mb-1 flex-wrap gap-1">
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider font-medium">
                  Trade Notes (Buys &amp; Sells)
                </span>
                {!isClosedCard && (bankedInfo.hasBankedProfit || bankedInfo.hasLossCut) && (
                  <span className={`text-[10px] font-medium font-mono px-1.5 py-0.2 rounded ${
                    bankedInfo.hasBankedProfit 
                      ? 'bg-blue-950/30 text-blue-300/90 border border-blue-500/20' 
                      : 'bg-neutral-800/80 text-slate-300 border border-neutral-700/60'
                  }`}>
                    {bankedInfo.hasBankedProfit 
                      ? `Banked: ${formatBankedProfitDisplay(trade, bankedInfo, viewMode, effectivePortfolio)}` 
                      : `Loss Cut: ${formatBankedProfitDisplay(trade, bankedInfo, viewMode, effectivePortfolio)}`}
                  </span>
                )}
              </div>
              <div className="bg-neutral-950/50 px-2.5 py-1.5 rounded-lg border border-neutral-800/50 flex flex-col gap-1 font-mono text-[11px]">
                {items.map((item, idx) => {
                  const isBuy = item.type === 'BUY_FILL';
                  const isProfit = item.type === 'PROFIT_BANKED';
                  const isLoss = item.type === 'LOSS_CUT';
                  return (
                    <div 
                      key={idx} 
                      className="flex items-center justify-between gap-2 py-0.5 text-neutral-400"
                    >
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        {isBuy ? (
                          <span className="text-[9px] uppercase font-semibold px-1 py-0.2 rounded bg-emerald-950/40 text-emerald-400/90 border border-emerald-800/40 shrink-0">
                            Buy
                          </span>
                        ) : (isProfit || isLoss) ? (
                          <span className={`text-[9px] uppercase font-semibold px-1 py-0.2 rounded shrink-0 ${
                            isProfit
                              ? 'bg-sky-950/40 text-sky-400/90 border border-sky-800/40'
                              : 'bg-neutral-800/80 text-slate-400 border border-neutral-700/60'
                          }`}>
                            Sell
                          </span>
                        ) : (
                          <span className="text-neutral-500 text-[10px] shrink-0 select-none">▪</span>
                        )}
                        <span className={`leading-tight break-words text-[11px] ${
                          isProfit || isLoss ? 'text-neutral-300' : 'text-neutral-400'
                        }`}>
                          {formatNoteLineForView(item, viewMode, trade)}
                        </span>
                      </div>
                      {isProfit && item.profitUsd !== undefined && (
                        <span className="text-[10px] font-medium text-sky-400/90 shrink-0">
                          {formatExitPnlDisplay(item, viewMode, trade.entryPrice)}
                        </span>
                      )}
                      {isLoss && item.profitUsd !== undefined && (
                        <span className="text-[10px] font-medium text-slate-400 shrink-0">
                          {formatExitPnlDisplay(item, viewMode, trade.entryPrice)}
                        </span>
                      )}
                    </div>
                  );
                })}
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
                    setScaleOutTrade(trade);
                  }}
                  className="h-7 px-2.5 text-[11px] font-semibold text-cyan-400 border-cyan-800/60 bg-cyan-950/30 hover:bg-cyan-900/50"
                  title="Scale out position / take profit or cut loss along the way"
                >
                  <Target className="w-3 h-3 mr-1 text-cyan-400" />
                  Scale Out
                </Button>
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
            title="View trade details"
          >
            <Info className="w-3 h-3 mr-1" />
            Details
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
        historyTimeHorizon={historyTimeHorizon}
        onHistoryTimeHorizonChange={setHistoryTimeHorizon}
      />

      {/* Active Trades Header & Controls */}
      <div className="flex justify-between items-center px-1 mt-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-neutral-200">Open Trades ({allOpen.length})</h2>
          {activeTrades.length > 0 && (
            <span className="inline-block w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
          )}
        </div>
        <div className="flex gap-1.5 items-center">
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

                <button
                  type="button"
                  onClick={() => handleSelectSort('RISK')}
                  className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-neutral-800 transition-colors ${
                    sortBy === 'RISK' ? 'text-amber-400 font-bold bg-amber-500/10' : 'text-neutral-300'
                  }`}
                >
                  <div className="flex flex-col">
                    <span className="font-semibold text-neutral-200">🔥 Risked %</span>
                    <span className="text-[10px] text-neutral-400">Highest risk % on top</span>
                  </div>
                  {sortBy === 'RISK' && <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                </button>
              </div>
            )}
          </div>

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
                        onMergeAll={handleMergeAllInGroup}
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
                {pendingTradeGroups.map(group => (
                  <PendingTradeGroupCard
                    key={`pending-group-${group.symbol}`}
                    group={group}
                    livePrice={getLivePriceForSymbol(group.symbol, livePrices)}
                    privacyMode={privacyMode}
                    viewMode={viewMode}
                    renderChildTradeCard={(trade) => renderTradeCard(trade, 'PENDING')}
                  />
                ))}
              </>
            )}
          </div>

          {/* Closed Trades Section */}
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
            className={`flex flex-col gap-3 pt-3 transition-all rounded-xl px-0.5 py-1.5 sm:px-1.5 ${
              activeDropTarget === 'CLOSED' 
                ? 'ring-1 ring-blue-500/60 bg-blue-500/10 border border-dashed border-blue-500/80' 
                : ''
            }`}
          >
            <div className="flex items-center justify-between px-1 mt-2">
              <div 
                onClick={() => toggleSectionCollapse('CLOSED')}
                className="relative cursor-pointer select-none group py-1 flex items-center gap-2"
                title={isSectionCollapsed('CLOSED') ? "Click to expand Closed Trades" : "Click to collapse Closed Trades"}
              >
                <div className="bg-black px-3 text-[11px] font-bold uppercase tracking-wider text-blue-400 flex items-center gap-1.5 group-hover:text-blue-300 transition-colors rounded-full py-0.5 border border-transparent group-hover:border-blue-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500/50 group-hover:bg-blue-400" />
                  <span>Closed Trades ({filteredClosedTrades.length})</span>
                  <ChevronDown className={`w-3.5 h-3.5 text-blue-400 transition-transform duration-200 ${isSectionCollapsed('CLOSED') ? '-rotate-90' : 'rotate-0'}`} />
                </div>
                {filteredClosedTrades.length > 0 && (
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold ${
                    closedStats.totalRealized >= 0 ? 'text-blue-400 bg-blue-950/40 border border-blue-800/60' : 'text-slate-300 bg-neutral-900 border border-neutral-800'
                  }`}>
                    {closedStats.totalRealized >= 0 ? '+' : ''}{fmtCurrency(closedStats.totalRealized)} ({closedStats.winRate}% win)
                  </span>
                )}
              </div>

              {/* Closed Sort Menu */}
              <div className="relative inline-block">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setClosedSortMenuOpen(!closedSortMenuOpen);
                  }}
                  className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-neutral-200 h-8 select-none"
                >
                  <ArrowUpDown className="w-3.5 h-3.5" />
                  <span>Sort</span>
                  <ChevronDown className={`w-3 h-3 opacity-60 transition-transform ${closedSortMenuOpen ? 'rotate-180' : ''}`} />
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
                      className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-neutral-800 transition-colors ${closedSortBy === 'DATE_DESC' ? 'text-blue-400 font-bold bg-blue-500/15' : 'text-neutral-300'}`}
                    >
                      <span>Newest Closed First</span>
                      {closedSortBy === 'DATE_DESC' && <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectClosedSort('PNL_DESC')}
                      className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-neutral-800 transition-colors ${closedSortBy === 'PNL_DESC' ? 'text-blue-400 font-bold bg-blue-500/15' : 'text-neutral-300'}`}
                    >
                      <span>Highest Profit First</span>
                      {closedSortBy === 'PNL_DESC' && <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectClosedSort('PNL_ASC')}
                      className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-neutral-800 transition-colors ${closedSortBy === 'PNL_ASC' ? 'text-slate-300 font-bold bg-neutral-800' : 'text-neutral-300'}`}
                    >
                      <span>Biggest Loss First</span>
                      {closedSortBy === 'PNL_ASC' && <CheckCircle2 className="w-3.5 h-3.5 text-slate-400" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectClosedSort('RETURN_PCT_DESC')}
                      className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-neutral-800 transition-colors ${closedSortBy === 'RETURN_PCT_DESC' ? 'text-sky-400 font-bold bg-sky-500/15' : 'text-neutral-300'}`}
                    >
                      <span>🚀 Highest Return % First</span>
                      {closedSortBy === 'RETURN_PCT_DESC' && <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" />}
                    </button>
                    {/* Discipline sorting options removed from dropdown as requested (kept as filter buttons) */}
                    <button
                      type="button"
                      onClick={() => handleSelectClosedSort('RISK_DESC')}
                      className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-neutral-800 transition-colors ${closedSortBy === 'RISK_DESC' ? 'text-blue-400 font-bold bg-blue-500/15' : 'text-neutral-300'}`}
                    >
                      <span>⚠️ Risked % (Highest risk)</span>
                      {closedSortBy === 'RISK_DESC' && <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectClosedSort('SIZE')}
                      className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-neutral-800 transition-colors ${closedSortBy === 'SIZE' ? 'text-neutral-200 font-bold bg-neutral-800' : 'text-neutral-300'}`}
                    >
                      <span>Position Size (Largest)</span>
                      {closedSortBy === 'SIZE' && <CheckCircle2 className="w-3.5 h-3.5 text-neutral-200" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectClosedSort('FEES')}
                      className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-neutral-800 transition-colors ${closedSortBy === 'FEES' ? 'text-neutral-200 font-bold bg-neutral-800' : 'text-neutral-300'}`}
                    >
                      <span>Fees Paid (Highest)</span>
                      {closedSortBy === 'FEES' && <CheckCircle2 className="w-3.5 h-3.5 text-neutral-200" />}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Interactive Closed Trades Day Analytics & Date Range Filter */}
            {!isSectionCollapsed('CLOSED') && (
              <ClosedTradesDayAnalytics
                days={closedDayGroups}
                summary={closedPeriodSummary}
                datePreset={closedDatePreset}
                onSelectDatePreset={(preset) => {
                  setClosedDatePreset(preset);
                  setClosedSelectedDay(null);
                  try {
                    localStorage.setItem('history_closed_date_preset', preset);
                  } catch {}
                }}
                startDate={closedStartDate}
                onStartDateChange={(d) => {
                  setClosedStartDate(d);
                  setClosedSelectedDay(null);
                }}
                endDate={closedEndDate}
                onEndDateChange={(d) => {
                  setClosedEndDate(d);
                  setClosedSelectedDay(null);
                }}
                selectedDay={closedSelectedDay}
                onSelectDay={setClosedSelectedDay}
                viewGrouping={closedViewGrouping}
                onViewGroupingChange={(mode) => {
                  setClosedViewGrouping(mode);
                  try {
                    localStorage.setItem('history_closed_grouping', mode);
                  } catch {}
                }}
                viewMode={viewMode}
                pkrRate={pkrRate}
                totalClosedCount={closedTrades.length}
              />
            )}

            {/* Interactive Closed Trades Filter Chips & Search Bar */}
            {!isSectionCollapsed('CLOSED') && (
              <div className="flex flex-col gap-2 px-1">
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                  <button
                    type="button"
                    onClick={() => {
                      setClosedFilterTab('ALL');
                      localStorage.setItem('history_closed_filter_tab', 'ALL');
                    }}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all shrink-0 ${
                      closedFilterTab === 'ALL'
                        ? 'bg-blue-600/20 text-white border-blue-500/50 shadow-sm'
                        : 'bg-neutral-900/80 text-neutral-400 border-neutral-800 hover:text-neutral-200 hover:bg-neutral-800'
                    }`}
                  >
                    All ({closedTrades.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setClosedFilterTab('WINS');
                      localStorage.setItem('history_closed_filter_tab', 'WINS');
                    }}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all shrink-0 ${
                      closedFilterTab === 'WINS'
                        ? 'bg-blue-600/25 text-blue-300 border-blue-500/60 shadow-sm'
                        : 'bg-neutral-900/80 text-neutral-400 border-neutral-800 hover:text-neutral-200 hover:bg-neutral-800'
                    }`}
                  >
                    Wins
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setClosedFilterTab('LOSSES');
                      localStorage.setItem('history_closed_filter_tab', 'LOSSES');
                    }}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all shrink-0 ${
                      closedFilterTab === 'LOSSES'
                        ? 'bg-slate-800 text-slate-200 border-slate-700 shadow-sm'
                        : 'bg-neutral-900/80 text-neutral-400 border-neutral-800 hover:text-neutral-200 hover:bg-neutral-800'
                    }`}
                  >
                    Losses
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setClosedFilterTab('SIGNIFICANT');
                      localStorage.setItem('history_closed_filter_tab', 'SIGNIFICANT');
                    }}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all shrink-0 ${
                      closedFilterTab === 'SIGNIFICANT'
                        ? 'bg-amber-400/20 text-amber-200 border-amber-400/60 shadow-sm'
                        : 'bg-neutral-900/80 text-neutral-400 border-neutral-800 hover:text-neutral-200 hover:bg-neutral-800'
                    }`}
                    title="Significant Trades only (excludes minor profits & losses < $2)"
                  >
                    ⭐ Significant Trades
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setClosedFilterTab('PLAN_FOLLOWED');
                      localStorage.setItem('history_closed_filter_tab', 'PLAN_FOLLOWED');
                    }}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all shrink-0 ${
                      closedFilterTab === 'PLAN_FOLLOWED'
                        ? 'bg-purple-500/20 text-purple-300 border-purple-500/50 shadow-sm'
                        : 'bg-neutral-900/80 text-neutral-400 border-neutral-800 hover:text-neutral-200 hover:bg-neutral-800'
                    }`}
                  >
                    🎯 Per Plan
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setClosedFilterTab('DEVIATED');
                      localStorage.setItem('history_closed_filter_tab', 'DEVIATED');
                    }}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all shrink-0 ${
                      closedFilterTab === 'DEVIATED'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-sm'
                        : 'bg-neutral-900/80 text-neutral-400 border-neutral-800 hover:text-neutral-200 hover:bg-neutral-800'
                    }`}
                  >
                    ⚡ Deviated
                  </button>
                </div>
                {/* Search / Filter input */}
                <div className="relative">
                  <Input
                    type="text"
                    value={closedSearchQuery}
                    onChange={(e) => setClosedSearchQuery(e.target.value)}
                    placeholder="Search closed trades by symbol, notes, or discipline tag..."
                    className="h-8 text-xs bg-neutral-950/80 border-neutral-800 pl-3 pr-8"
                  />
                  {closedSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setClosedSearchQuery('')}
                      className="absolute right-2.5 top-2 text-neutral-400 hover:text-white text-xs font-bold"
                      title="Clear search"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            )}

            {draggedTradeId && activeDropTarget === 'CLOSED' && (
              <div className="border border-dashed border-blue-500/70 bg-blue-500/10 text-blue-300 rounded-lg py-2 text-center text-xs font-medium">
                Move {draggedTrade?.symbol} to Closed Trades
              </div>
            )}

            {isSectionCollapsed('CLOSED') ? null : (
              <>
                {filteredClosedTrades.length === 0 ? (
                  <div className="border border-dashed border-neutral-800/80 rounded-xl p-4 text-center text-xs text-neutral-400 bg-neutral-950/30 flex flex-col items-center gap-2">
                    <span>No closed trades found matching this filter or date range.</span>
                    {(closedDatePreset !== 'ALL' || closedStartDate || closedEndDate || closedSelectedDay || closedFilterTab !== 'ALL' || closedSearchQuery) && (
                      <button
                        type="button"
                        onClick={() => {
                          setClosedDatePreset('ALL');
                          setClosedStartDate('');
                          setClosedEndDate('');
                          setClosedSelectedDay(null);
                          setClosedFilterTab('ALL');
                          setClosedSearchQuery('');
                        }}
                        className="text-[11px] font-semibold text-blue-400 hover:text-blue-300 underline"
                      >
                        Reset Date Range & Filters
                      </button>
                    )}
                  </div>
                ) : closedViewGrouping === 'BY_DAY' ? (
                  <div className="flex flex-col gap-4">
                    {groupedDisplayDays.map(day => {
                      const isSelected = closedSelectedDay === day.dateKey;
                      return (
                        <div key={day.dateKey} className="flex flex-col gap-2">
                          {/* Day Group Sleek Divider Header */}
                          <div className={`flex items-center justify-between px-1.5 py-1.5 border-b transition-colors ${
                            isSelected
                              ? 'border-blue-500/50 bg-neutral-900/60 rounded-lg'
                              : 'border-neutral-800/80'
                          }`}>
                            <div className="flex items-center gap-2 flex-wrap min-w-0">
                              <span className="font-semibold text-xs text-neutral-200 flex items-center gap-1.5">
                                <Calendar className="w-3.5 h-3.5 text-neutral-400" />
                                {day.subtitle || day.title}
                              </span>
                              {day.relative && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-300 font-medium">
                                  {day.relative}
                                </span>
                              )}
                              {day.symbols.length > 0 && (
                                <div className="hidden sm:flex items-center gap-1">
                                  {day.symbols.slice(0, 3).map(sym => (
                                    <span key={sym} className="text-[9px] font-mono px-1 rounded bg-neutral-900 text-neutral-400 border border-neutral-800">
                                      {sym}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`text-xs font-bold font-mono ${day.netPnL >= 0 ? 'text-blue-400' : 'text-slate-400'}`}>
                                {day.netPnL >= 0 ? '+' : ''}{fmtCurrency(day.netPnL)}
                              </span>
                              <span className="text-[10px] text-neutral-500 font-mono">
                                ({day.totalTrades} {day.totalTrades === 1 ? 'trade' : 'trades'} · {day.winRate}%)
                              </span>
                              <button
                                type="button"
                                onClick={() => setClosedSelectedDay(isSelected ? null : day.dateKey)}
                                className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                                  isSelected
                                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'
                                }`}
                                title="Filter only this day"
                              >
                                {isSelected ? 'Filtered' : 'Filter'}
                              </button>
                            </div>
                          </div>

                          {/* Day Trades List */}
                          <div className="flex flex-col gap-2">
                            {day.trades.map(t => renderTradeCard(t, 'CLOSED'))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {filteredClosedTrades.map(t => renderTradeCard(t, 'CLOSED'))}
                  </div>
                )}
              </>
            )}
          </div>
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
            onSelect={async (sym, importedEntry, size, feeUsd, isPending, tradeType = 'TRADE', market = 'SPOT', binanceOrderId, forceNewTrade = false) => {
              try {
                if (!auth.currentUser) {
                  toast.error("Not logged in");
                  return;
                }
                const isAlpha = market === 'ALPHA' || isAlphaTradeOrSymbol(sym);
                const cleanSym = getCleanSymbol(sym) || sym;

                if (binanceOrderId) {
                  const existingByOrderId = trades.find(t => t.binanceOrderId && String(t.binanceOrderId) === String(binanceOrderId));
                  if (existingByOrderId) {
                    setShowImportModal(false);
                    toast(`Order #${binanceOrderId} is already tracked in app.`);
                    return;
                  }
                }

                if (isPending) {
                  const existingPending = trades.find(t => 
                    t.status === 'PENDING' && 
                    isSameSymbol(t.symbol, cleanSym) && 
                    (
                      (t.binanceOrderId && binanceOrderId && String(t.binanceOrderId) === String(binanceOrderId)) ||
                      Math.abs((t.entryPrice || 0) - importedEntry) <= (importedEntry * 0.002 || 0.01)
                    )
                  );
                  if (existingPending) {
                    setShowImportModal(false);
                    toast(`Limit order for ${sym} is already tracked.`);
                    return;
                  }
                }

                // Check if active trades or holdings exist for this symbol (e.g. user already has an active trade or holding)
                const matchingActivePositions = !isPending ? trades.filter(t => 
                  t.id && 
                  !isTradeClosed(t) && 
                  t.status !== 'PENDING' && 
                  isSameSymbol(t.symbol, cleanSym) &&
                  !isAlphaTradeOrSymbol(t)
                ) : [];

                // Dedicated handling for HOLDING: If an active holding already exists, update it to the authoritative wallet values!
                if (tradeType === 'HOLDING' && !isPending) {
                  const existingHolding = matchingActivePositions.find(t => t.type === 'HOLDING');
                  if (existingHolding && existingHolding.id) {
                    const totalCoins = Math.abs(size);
                    const newEntry = importedEntry > 0 ? importedEntry : (existingHolding.entryPrice || 0);
                    const newCost = totalCoins * newEntry;
                    await updateDoc(doc(db, 'trades', existingHolding.id), {
                      positionSizeCoins: totalCoins,
                      entryPrice: newEntry,
                      totalBuyUsd: newCost,
                      positionSize: newCost,
                      feeUsd: feeUsd !== undefined ? feeUsd : (existingHolding.feeUsd || 0),
                      status: 'ACTIVE',
                      type: 'HOLDING',
                      stopLoss: 0,
                      takeProfit1: 0,
                      riskAmount: 0,
                      riskPercent: 0,
                      notes: `Imported from Binance as HOLDING (${totalCoins.toLocaleString()} coins @ $${formatPrice(newEntry)})`,
                      updatedAt: Date.now()
                    });
                    setShowImportModal(false);
                    toast.success(`Updated ${cleanSym} in Investments (Holdings)!`, { icon: '💎' });
                    await refreshTrades();
                    return;
                  }
                }

                if (!forceNewTrade && matchingActivePositions.length > 0) {
                  // User requirement: Whenever opening/importing a trade of a coin with an active trade or holding,
                  // confirm with the user first whether to make it a new trade or merge into existing trade/holding!
                  setShowImportModal(false);
                  const pendingNewTrade: Partial<Trade> = {
                    symbol: cleanSym,
                    entryPrice: importedEntry,
                    positionSizeCoins: size,
                    totalBuyUsd: size * importedEntry,
                    feeUsd: feeUsd || 0,
                    status: 'ACTIVE',
                    market: market as any,
                    type: tradeType as any,
                    binanceOrderId: binanceOrderId || undefined,
                    createdAt: Date.now()
                  };

                  setActivePositionConfirmState({
                    isOpen: true,
                    symbol: cleanSym,
                    newTrade: pendingNewTrade,
                    existingPositions: matchingActivePositions,
                    onConfirmNew: async () => {
                      if (!auth.currentUser) return;
                      const isHolding = tradeType === 'HOLDING';
                      const plan = !isHolding ? generateSolidSellPlan(importedEntry, size, cleanSym) : null;
                      const newDoc: any = {
                        userId: auth.currentUser.uid,
                        symbol: cleanSym,
                        portfolioSize: baseCapital || 10000,
                        riskPercent: isHolding ? 0 : 1,
                        entryPrice: importedEntry,
                        takeProfit1: plan ? plan.takeProfit1 : 0,
                        tp1Percent: plan ? plan.tp1Percent : 0,
                        takeProfit2: plan ? plan.takeProfit2 : undefined,
                        tp2Percent: plan ? plan.tp2Percent : undefined,
                        takeProfit3: plan ? plan.takeProfit3 : undefined,
                        tp3Percent: plan ? plan.tp3Percent : undefined,
                        stopLoss: plan ? plan.stopLoss : 0,
                        riskAmount: plan ? plan.riskAmount : 0,
                        positionSizeCoins: size,
                        totalBuyUsd: size * importedEntry,
                        positionSize: size * importedEntry,
                        feeUsd: feeUsd || 0,
                        status: 'ACTIVE',
                        market: market,
                        type: tradeType,
                        createdAt: Date.now(),
                        filledAt: Date.now(),
                        notes: `Imported from Binance as new standalone ${tradeType}`,
                        binanceOrderId: binanceOrderId || undefined
                      };
                      await addDoc(collection(db, 'trades'), newDoc);
                      toast.success(`Imported ${cleanSym} as a new standalone ${tradeType === 'HOLDING' ? 'investment' : 'trade'}!`);
                      setActivePositionConfirmState(null);
                      await refreshTrades();
                    },
                    onConfirmMerge: async (targetTradeId: string, mergedData: any) => {
                      const targetTrade = matchingActivePositions.find(t => t.id === targetTradeId) || matchingActivePositions[0];
                      if (!targetTrade || !targetTrade.id) return;
                      const addedCoins = size;
                      let planUpdates = {};
                      if (targetTrade.type !== 'HOLDING' && (!targetTrade.takeProfit1 || !targetTrade.stopLoss || targetTrade.stopLoss === 0)) {
                        const plan = generateSolidSellPlan(mergedData.newEntryPrice, mergedData.newPositionSizeCoins, cleanSym);
                        planUpdates = {
                          takeProfit1: plan.takeProfit1,
                          tp1Percent: plan.tp1Percent,
                          takeProfit2: plan.takeProfit2,
                          tp2Percent: plan.tp2Percent,
                          takeProfit3: plan.takeProfit3,
                          tp3Percent: plan.tp3Percent,
                          stopLoss: plan.stopLoss,
                          riskAmount: plan.riskAmount
                        };
                      } else if (targetTrade.type !== 'HOLDING') {
                        const riskAmount = Math.max(0, parseFloat(((mergedData.newEntryPrice - targetTrade.stopLoss) * mergedData.newPositionSizeCoins).toFixed(2)));
                        planUpdates = { riskAmount };
                      }

                      await updateDoc(doc(db, 'trades', targetTrade.id), {
                        positionSizeCoins: mergedData.newPositionSizeCoins,
                        entryPrice: mergedData.newEntryPrice,
                        totalBuyUsd: mergedData.newTotalBuyUsd,
                        positionSize: mergedData.newTotalBuyUsd,
                        feeUsd: mergedData.newFeeUsd,
                        notes: `${targetTrade.notes || ''}\nAdded buy on Binance (+${addedCoins.toLocaleString()} coins). New Avg Entry: $${formatPrice(mergedData.newEntryPrice)}`.trim(),
                        updatedAt: Date.now(),
                        ...planUpdates
                      });
                      toast.success(`Merged added buy of ${addedCoins.toLocaleString()} ${cleanSym} into existing ${targetTrade.type === 'HOLDING' ? 'investment' : 'trade'}!`);
                      setActivePositionConfirmState(null);
                      await refreshTrades();
                    }
                  });
                  return;
                }

                // New trade: generate and attach solid sell plan immediately (only for active trades, never for holdings)
                const isHolding = tradeType === 'HOLDING';
                const plan = (!isPending && !isHolding) ? generateSolidSellPlan(importedEntry, size, cleanSym) : null;
                const newTrade: any = {
                  userId: auth.currentUser.uid,
                  symbol: sym,
                  portfolioSize: stats.totalEquity || baseCapital,
                  riskPercent: isHolding ? 0 : 1,
                  entryPrice: importedEntry,
                  stopLoss: plan ? plan.stopLoss : 0,
                  takeProfit1: plan ? plan.takeProfit1 : 0,
                  tp1Percent: plan ? plan.tp1Percent : 0,
                  takeProfit2: plan ? plan.takeProfit2 : undefined,
                  tp2Percent: plan ? plan.tp2Percent : undefined,
                  takeProfit3: plan ? plan.takeProfit3 : undefined,
                  tp3Percent: plan ? plan.tp3Percent : undefined,
                  riskAmount: plan ? plan.riskAmount : 0,
                  positionSizeCoins: size,
                  totalBuyUsd: size * importedEntry,
                  positionSize: size * importedEntry,
                  buyFeeUsd: feeUsd || 0,
                  feeUsd: feeUsd || 0,
                  totalFeesUsd: feeUsd || 0,
                  type: isPending ? 'TRADE' : tradeType,
                  market: isAlpha ? 'ALPHA' : 'SPOT',
                  isAlpha: isAlpha,
                  status: isPending ? 'PENDING' : 'ACTIVE',
                  notes: isPending ? 'Imported Limit Order from Binance' : `Imported from Binance as ${tradeType}`,
                  createdAt: Date.now(),
                  pkrRate: pkrRate
                };
                if (binanceOrderId) {
                  newTrade.binanceOrderId = String(binanceOrderId);
                }
                await saveTradeOptimistic(newTrade);
                setShowImportModal(false);
                toast.success(
                  isPending 
                    ? `Imported ${sym} as Limit Order` 
                    : isHolding 
                      ? `Imported ${cleanSym} to Investments (Holdings)!` 
                      : `Imported ${cleanSym} with Sell Plan`
                );
                await refreshTrades();
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
        {scaleOutTrade && (
          <ScaleOutModal
            trade={scaleOutTrade}
            livePrice={livePrices[scaleOutTrade.symbol]}
            pkrRate={pkrRateFromContext}
            onClose={() => setScaleOutTrade(null)}
            onConfirm={async (id, updates) => {
              await updateTradeOptimistic(id, updates);
              await refreshTrades();
            }}
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
        {activePositionConfirmState && activePositionConfirmState.isOpen && (
          <ActivePositionConfirmModal
            isOpen={activePositionConfirmState.isOpen}
            onClose={() => setActivePositionConfirmState(null)}
            symbol={activePositionConfirmState.symbol}
            newTrade={activePositionConfirmState.newTrade}
            existingPositions={activePositionConfirmState.existingPositions}
            onConfirmNewTrade={activePositionConfirmState.onConfirmNew}
            onConfirmMerge={activePositionConfirmState.onConfirmMerge}
          />
        )}
      </Suspense>
    </div>
  );
}

export default History;
