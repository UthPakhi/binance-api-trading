import React, { useState, useEffect } from 'react';
import { 
  Eye, EyeOff, ShieldAlert, ShieldCheck, PieChart, Wallet, 
  Settings, RefreshCw, Check, X, ArrowUpRight, ArrowDownRight, Sparkles, AlertTriangle, Coins
} from 'lucide-react';
import { BinanceBalanceInfo, PnlViewMode } from '../types';
import { formatCurrency, formatPkr, formatCurrencyPrivacy } from '../lib/tradeUtils';
import { useTradeContext } from '../lib/TradeContext';
import { Button } from './Button';
import { Input } from './Input';

interface PortfolioRiskCockpitProps {
  stats: {
    totalEquity: number;
    availableCapital: number;
    freeAvailableCash?: number;
    lockedCash?: number;
    totalActiveRisk: number;
    totalRealizedPnL?: number;
    totalLiveUnrealizedPnL?: number;
    totalFeeDrag?: number;
    totalTradesInvested: number;
    totalHoldingsInvested: number;
  };
  binanceBalance: BinanceBalanceInfo | null;
  privacyMode: boolean;
  onTogglePrivacy: () => void;
  viewMode?: PnlViewMode;
  onViewModeChange?: (mode: PnlViewMode) => void;
  totalRealizedR?: number;
  totalLiveUnrealizedR?: number;
  totalActiveRiskR?: number;
  baseCapital?: number;
  onSaveBaseCapital?: (newBase: number) => void;
  onSyncBinance?: () => void;
  isSyncing?: boolean;
  unprotectedTradesCount?: number;
}

export function PortfolioRiskCockpit({
  stats,
  binanceBalance,
  privacyMode,
  onTogglePrivacy,
  viewMode = 'DOLLAR',
  onViewModeChange,
  totalRealizedR,
  totalLiveUnrealizedR,
  totalActiveRiskR,
  baseCapital = 0,
  onSaveBaseCapital,
  onSyncBinance,
  isSyncing = false,
  unprotectedTradesCount = 0
}: PortfolioRiskCockpitProps) {
  const { 
    totalEquity, 
    availableCapital, 
    totalActiveRisk, 
    totalRealizedPnL = 0,
    totalLiveUnrealizedPnL = 0,
    totalFeeDrag = 0,
    totalTradesInvested, 
    totalHoldingsInvested 
  } = stats;

  const {
    pkrRate,
    binancePkrRate,
    isCustomPkrRate,
    setPkrRate,
    resetPkrRateToBinance,
    fetchBinancePkrRate
  } = useTradeContext();

  const [isEditingBase, setIsEditingBase] = useState(false);
  const [tempBaseCapital, setTempBaseCapital] = useState(baseCapital.toString());
  const [tempPkrRate, setTempPkrRate] = useState(pkrRate.toString());
  const [isRefreshingPkr, setIsRefreshingPkr] = useState(false);

  useEffect(() => {
    setTempBaseCapital(baseCapital.toString());
    setTempPkrRate(pkrRate.toString());
  }, [baseCapital, pkrRate, isEditingBase]);

  const total = totalEquity > 0 ? totalEquity : 1;
  const cashPct = Math.min(100, Math.max(0, (availableCapital / total) * 100));
  const tradesPct = Math.min(100, Math.max(0, (totalTradesInvested / total) * 100));
  const holdingsPct = Math.min(100, Math.max(0, (totalHoldingsInvested / total) * 100));

  const riskPct = totalEquity > 0 ? (totalActiveRisk / totalEquity) * 100 : 0;
  const isHighRisk = riskPct > 3.0;
  const isModerateRisk = riskPct > 1.5 && riskPct <= 3.0;

  const PKR_RATE = pkrRate;

  const fmtCurrency = (val: number) => formatCurrencyPrivacy(val, privacyMode);
  const fmtPkr = (val: number) => {
    if (privacyMode) return '••••••';
    return `Rs ${(val / 1000).toFixed(1)}k`;
  };

  const handleSaveSettings = async () => {
    const parsedBase = parseFloat(tempBaseCapital);
    if (!isNaN(parsedBase) && parsedBase > 0 && onSaveBaseCapital) {
      onSaveBaseCapital(parsedBase);
    }
    const parsedPkr = parseFloat(tempPkrRate);
    if (!isNaN(parsedPkr) && parsedPkr > 0) {
      await setPkrRate(parsedPkr);
    }
    setIsEditingBase(false);
  };

  const handleFetchBinancePkr = async () => {
    setIsRefreshingPkr(true);
    const rate = await fetchBinancePkrRate();
    if (rate) {
      setTempPkrRate(rate.toFixed(2));
    }
    setIsRefreshingPkr(false);
  };

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3 sm:p-4 shadow-sm relative overflow-hidden flex flex-col gap-3">
      <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-blue-600 via-sky-400 to-indigo-500"></div>

      {/* Top Header: Title, Risk Status & Quick Action Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-0.5">
        {/* Left: Brand / Title + Risk Badge + Unprotected Alert */}
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <h2 className="text-xs sm:text-sm font-bold text-neutral-100 uppercase tracking-wider whitespace-nowrap">
            Portfolio Cockpit
          </h2>
          
          {/* Risk Level Badge */}
          {isHighRisk ? (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-slate-300 bg-neutral-900 border border-neutral-700 px-2 py-0.5 rounded shrink-0">
              <ShieldAlert className="w-3 h-3 text-slate-400" />
              <span>Elevated Risk ({riskPct.toFixed(1)}%)</span>
            </span>
          ) : isModerateRisk ? (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-blue-300/80 bg-blue-950/40 border border-blue-800/60 px-2 py-0.5 rounded shrink-0">
              <ShieldCheck className="w-3 h-3 text-blue-400" />
              <span>Moderate ({riskPct.toFixed(1)}%)</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-sky-300 bg-blue-950/60 border border-blue-800/80 px-2 py-0.5 rounded shrink-0">
              <ShieldCheck className="w-3 h-3 text-sky-400" />
              <span>Disciplined ({riskPct.toFixed(1)}%)</span>
            </span>
          )}

          {/* Unprotected Trades Indicator */}
          {unprotectedTradesCount > 0 && (
            <span 
              className="flex items-center gap-1 text-[10px] font-semibold text-amber-400 bg-amber-950/50 border border-amber-800/70 px-2 py-0.5 rounded shrink-0" 
              title={`${unprotectedTradesCount} open position${unprotectedTradesCount > 1 ? 's' : ''} running without a Stop Loss (Framework Applied)`}
            >
              <AlertTriangle className="w-3 h-3 text-amber-400" />
              <span>{unprotectedTradesCount} No-SL</span>
            </span>
          )}

          {binanceBalance && (
            <span className="hidden sm:flex items-center gap-1 text-[10px] text-sky-400 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
              Binance Live
            </span>
          )}
        </div>

        {/* Action Controls Toolbar */}
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          {/* Unit Toggle: $ | R | % */}
          <div className="flex items-center bg-neutral-950 p-0.5 rounded-lg border border-neutral-800 text-[11px] font-mono">
            <button
              type="button"
              onClick={() => onViewModeChange?.('DOLLAR')}
              className={`px-2.5 py-0.5 rounded transition-all ${
                viewMode === 'DOLLAR' 
                  ? 'bg-neutral-800 text-white font-bold shadow-sm' 
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
              title="Standard Currency Mode ($ USD)"
            >
              $
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange?.('R_MULTIPLE')}
              className={`px-2.5 py-0.5 rounded transition-all flex items-center gap-0.5 ${
                viewMode === 'R_MULTIPLE' 
                  ? 'bg-blue-600/30 text-sky-300 font-bold border border-blue-500/40 shadow-sm' 
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
              title="R-Multiple Mode: Decouples emotions from dollar amounts by framing trades in risk units (R)"
            >
              <span>R</span>
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange?.('PERCENT')}
              className={`px-2.5 py-0.5 rounded transition-all ${
                viewMode === 'PERCENT' 
                  ? 'bg-neutral-800 text-white font-bold shadow-sm' 
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
              title="Percentage Return Mode (%)"
            >
              %
            </button>
          </div>

          {/* Unified Stealth / Zen Eye Toggle */}
          <button
            type="button"
            onClick={onTogglePrivacy}
            className={`h-7 px-2.5 flex items-center gap-1.5 text-[11px] font-medium rounded-md border transition-all select-none ${
              privacyMode 
                ? 'bg-blue-950/70 text-sky-300 border-blue-700/60 shadow-sm font-semibold' 
                : 'bg-neutral-950 text-neutral-400 border-neutral-800 hover:text-white'
            }`}
            title={privacyMode ? 'Stealth / Zen Mode ON (click to reveal figures)' : 'Turn ON Stealth / Zen Mode'}
          >
            {privacyMode ? (
              <EyeOff className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            ) : (
              <Eye className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
            )}
            <span className="text-[11px]">{privacyMode ? 'Stealth ON' : 'Stealth'}</span>
          </button>

          {onSyncBinance && (
            <button
              type="button"
              onClick={onSyncBinance}
              disabled={isSyncing}
              className="h-7 px-2 flex items-center gap-1 text-[11px] font-medium text-sky-400 bg-blue-950/40 hover:bg-blue-900/50 border border-blue-800/60 rounded-md transition-colors disabled:opacity-50"
              title="Sync Spot balances and executions with Binance"
            >
              <Wallet className={`w-3.5 h-3.5 ${isSyncing ? 'animate-pulse' : ''}`} />
              <span className="hidden xs:inline">{isSyncing ? 'Syncing...' : 'Sync'}</span>
            </button>
          )}

          {onSaveBaseCapital && (
            <button
              type="button"
              onClick={() => {
                setIsEditingBase(!isEditingBase);
                setTempBaseCapital(baseCapital.toString());
                setTempPkrRate(pkrRate.toString());
              }}
              className={`h-7 w-7 flex items-center justify-center rounded-md border transition-colors ${
                isEditingBase
                  ? 'bg-blue-600 text-white border-blue-500'
                  : 'text-neutral-400 hover:text-white bg-neutral-950 border border-neutral-800 hover:border-neutral-700'
              }`}
              title="Configure Base Capital & PKR/USDT Exchange Rate"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Settings Panel: Base Capital & PKR/USDT Rate Editor */}
      {isEditingBase && (
        <div className="bg-neutral-950 p-3 sm:p-3.5 rounded-xl border border-neutral-800 flex flex-col gap-3 animate-in fade-in duration-150">
          <div className="flex items-center justify-between border-b border-neutral-800/80 pb-2">
            <div className="flex items-center gap-1.5">
              <Settings className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-xs font-bold text-neutral-100 uppercase tracking-wider">
                Cockpit &amp; Currency Settings
              </span>
            </div>
            <span className="text-[10px] text-sky-400/90 bg-blue-950/60 border border-blue-800/70 px-2 py-0.5 rounded font-medium">
              Anti-FOMO White &amp; Blue Theme
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Base Capital Setting */}
            <div>
              <label className="text-[10px] text-neutral-400 uppercase font-semibold block mb-1">
                Base Equity ($ USD)
              </label>
              <Input 
                type="number" 
                value={tempBaseCapital} 
                onChange={e => setTempBaseCapital(e.target.value)} 
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSaveSettings();
                  if (e.key === 'Escape') setIsEditingBase(false);
                }}
                className="h-8 text-xs font-mono"
                placeholder="e.g. 2595"
              />
              <span className="text-[10px] text-neutral-500 mt-1 block">
                Starting bankroll equity for risk scaling and R-multiple calculations.
              </span>
            </div>

            {/* PKR to USDT Exchange Rate Setting */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] text-neutral-400 uppercase font-semibold block">
                  PKR to USDT Rate (1 USDT = ? PKR)
                </label>
                {binancePkrRate && (
                  <span className="text-[10px] text-sky-400 font-mono">
                    Binance: ₨{binancePkrRate.toFixed(2)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <span className="absolute left-2.5 top-2 text-xs text-neutral-500 font-mono select-none">
                    ₨
                  </span>
                  <Input 
                    type="number" 
                    step="0.01"
                    value={tempPkrRate} 
                    onChange={e => setTempPkrRate(e.target.value)} 
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleSaveSettings();
                      if (e.key === 'Escape') setIsEditingBase(false);
                    }}
                    className="h-8 text-xs font-mono pl-7"
                    placeholder="e.g. 283.89"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleFetchBinancePkr}
                  disabled={isRefreshingPkr}
                  className="h-8 px-2 text-[11px] font-medium text-sky-400 border-neutral-700 hover:border-blue-500/50 hover:bg-blue-950/40 shrink-0"
                  title="Fetch latest P2P USDT/PKR market price from Binance"
                >
                  <RefreshCw className={`w-3 h-3 mr-1 ${isRefreshingPkr ? 'animate-spin' : ''}`} />
                  Binance
                </Button>
              </div>

              {/* Status and quick preset actions */}
              <div className="flex items-center justify-between mt-1 text-[10px]">
                <span className="text-neutral-500">
                  {isCustomPkrRate ? (
                    <span className="text-amber-400 font-medium">Custom override active</span>
                  ) : (
                    <span className="text-sky-400 font-medium">Default from Binance P2P</span>
                  )}
                </span>
                {isCustomPkrRate && (
                  <button
                    type="button"
                    onClick={async () => {
                      await resetPkrRateToBinance();
                      setIsEditingBase(false);
                    }}
                    className="text-sky-400 hover:text-sky-300 underline font-medium"
                  >
                    Reset to Binance default
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-1 border-t border-neutral-800/60">
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={() => setIsEditingBase(false)} 
              className="h-8 px-3 text-xs text-neutral-400 hover:text-white"
            >
              Cancel
            </Button>
            <Button 
              size="sm" 
              onClick={handleSaveSettings} 
              className="h-8 px-4 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-sm shadow-blue-900/40"
            >
              <Check className="w-3.5 h-3.5 mr-1" /> Save Settings
            </Button>
          </div>
        </div>
      )}

      {/* Primary Key Metrics Grid (Single Unified Row - Zero Duplicate Data) */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3 pt-1">
        {/* Total Equity */}
        <div className="bg-neutral-950/70 rounded-lg p-2.5 border border-neutral-800/80 flex flex-col justify-between">
          <span className="text-[10px] text-neutral-500 font-semibold uppercase tracking-wider block">
            Total Equity
          </span>
          <div className="mt-1">
            <div className="text-base sm:text-lg font-bold font-mono text-white tabular-nums">
              {viewMode === 'ZEN' || privacyMode ? (
                '••••••'
              ) : viewMode === 'PERCENT' ? (
                <span>{totalEquity >= baseCapital ? '+' : ''}{baseCapital > 0 ? (((totalEquity - baseCapital) / baseCapital) * 100).toFixed(2) : '0.00'}%</span>
              ) : (
                fmtCurrency(totalEquity)
              )}
            </div>
            <div className="text-[10px] text-neutral-500 font-mono mt-0.5">
              {viewMode === 'ZEN' || privacyMode ? (
                'Zen Mode'
              ) : viewMode === 'PERCENT' ? (
                '100% Equity Baseline'
              ) : (
                fmtPkr(totalEquity * PKR_RATE)
              )}
            </div>
          </div>
        </div>

        {/* Available Cash */}
        <div className="bg-neutral-950/70 rounded-lg p-2.5 border border-neutral-800/80 flex flex-col justify-between">
          <span className="text-[10px] text-neutral-500 font-semibold uppercase tracking-wider block">
            Available Cash
          </span>
          <div className="mt-1">
            <div className="text-base sm:text-lg font-bold font-mono text-neutral-100 tabular-nums">
              {viewMode === 'ZEN' || privacyMode ? (
                '••••••'
              ) : viewMode === 'PERCENT' ? (
                <span>{cashPct.toFixed(1)}%</span>
              ) : (
                fmtCurrency(availableCapital)
              )}
            </div>
            <div className="text-[10px] text-neutral-400 font-mono mt-0.5 truncate">
              {viewMode === 'ZEN' || privacyMode ? (
                <span>Masked</span>
              ) : viewMode === 'PERCENT' ? (
                <span>Free Buying Power</span>
              ) : binanceBalance ? (
                <span>Free: ${binanceBalance.usdtFree.toFixed(0)}</span>
              ) : (
                fmtPkr(availableCapital * PKR_RATE)
              )}
            </div>
          </div>
        </div>

        {/* Total Active Risk */}
        <div className="bg-neutral-950/70 rounded-lg p-2.5 border border-neutral-800/80 flex flex-col justify-between">
          <span className="text-[10px] text-neutral-500 font-semibold uppercase tracking-wider block">
            Active Stop Risk
          </span>
          <div className="mt-1">
            <div className="text-base sm:text-lg font-bold font-mono text-slate-300 tabular-nums">
              {viewMode === 'ZEN' || privacyMode ? (
                '••••••'
              ) : viewMode === 'R_MULTIPLE' && totalActiveRiskR !== undefined ? (
                `${totalActiveRiskR.toFixed(1)}R`
              ) : viewMode === 'PERCENT' ? (
                `-${riskPct.toFixed(2)}%`
              ) : (
                fmtCurrency(totalActiveRisk)
              )}
            </div>
            <div className="text-[10px] text-neutral-500 font-mono mt-0.5 truncate">
              {viewMode === 'ZEN' || privacyMode ? (
                'Masked'
              ) : viewMode === 'PERCENT' ? (
                'of Total Portfolio'
              ) : unprotectedTradesCount > 0 ? (
                <span className="text-amber-400 font-medium">{unprotectedTradesCount} unhedged</span>
              ) : totalEquity > 0 ? (
                `${riskPct.toFixed(1)}% equity`
              ) : (
                '0%'
              )}
            </div>
          </div>
        </div>

        {/* Realized PnL */}
        <div className="bg-neutral-950/70 rounded-lg p-2.5 border border-neutral-800/80 flex flex-col justify-between">
          <span className="text-[10px] text-neutral-500 font-semibold uppercase tracking-wider block">
            Realized PnL
          </span>
          <div className="mt-1">
            <div className={`text-base sm:text-lg font-bold font-mono tabular-nums flex items-center gap-0.5 ${
              totalRealizedPnL >= 0 ? 'text-sky-400' : 'text-slate-400'
            }`}>
              {viewMode === 'ZEN' || privacyMode ? (
                <span>••••••</span>
              ) : (
                <>
                  {totalRealizedPnL >= 0 ? <ArrowUpRight className="w-3.5 h-3.5 shrink-0" /> : <ArrowDownRight className="w-3.5 h-3.5 shrink-0" />}
                  {viewMode === 'R_MULTIPLE' && totalRealizedR !== undefined ? (
                    <span>{totalRealizedR >= 0 ? '+' : ''}{totalRealizedR.toFixed(2)}R</span>
                  ) : viewMode === 'PERCENT' ? (
                    <span>{totalRealizedPnL >= 0 ? '+' : ''}{totalEquity > 0 ? ((totalRealizedPnL / totalEquity) * 100).toFixed(2) : 0}%</span>
                  ) : (
                    <span>{totalRealizedPnL >= 0 ? '+' : ''}{fmtCurrency(totalRealizedPnL)}</span>
                  )}
                </>
              )}
            </div>
            <div className="text-[10px] text-neutral-500 font-mono mt-0.5">
              {viewMode === 'R_MULTIPLE' && !privacyMode ? (
                <span>{totalRealizedPnL >= 0 ? '+' : ''}{fmtCurrency(totalRealizedPnL)}</span>
              ) : viewMode === 'PERCENT' ? (
                'Closed trades return'
              ) : (
                'Closed trades'
              )}
            </div>
          </div>
        </div>

        {/* Live Unrealized PnL */}
        <div className="col-span-2 sm:col-span-1 bg-neutral-950/70 rounded-lg p-2.5 border border-neutral-800/80 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-neutral-500 font-semibold uppercase tracking-wider">
              Live Unrealized
            </span>
            {totalFeeDrag > 0 && !privacyMode && viewMode !== 'ZEN' && (
              <span className="text-[9px] text-neutral-500 font-mono" title={`Estimated round-trip fee drag on open active positions: -$${totalFeeDrag.toFixed(2)}`}>
                {viewMode === 'PERCENT' 
                  ? `-${((totalFeeDrag / (totalEquity || 1)) * 100).toFixed(2)}% fees` 
                  : `-$${totalFeeDrag.toFixed(1)} fees`}
              </span>
            )}
          </div>
          <div className="mt-1">
            <div className={`text-base sm:text-lg font-bold font-mono tabular-nums flex items-center gap-0.5 ${
              totalLiveUnrealizedPnL >= 0 ? 'text-sky-400' : 'text-slate-400'
            }`}>
              {viewMode === 'ZEN' || privacyMode ? (
                <span>••••••</span>
              ) : (
                <>
                  {totalLiveUnrealizedPnL >= 0 ? <ArrowUpRight className="w-3.5 h-3.5 shrink-0" /> : <ArrowDownRight className="w-3.5 h-3.5 shrink-0" />}
                  {viewMode === 'R_MULTIPLE' && totalLiveUnrealizedR !== undefined ? (
                    <span>{totalLiveUnrealizedR >= 0 ? '+' : ''}{totalLiveUnrealizedR.toFixed(2)}R</span>
                  ) : viewMode === 'PERCENT' ? (
                    <span>{totalLiveUnrealizedPnL >= 0 ? '+' : ''}{totalEquity > 0 ? ((totalLiveUnrealizedPnL / totalEquity) * 100).toFixed(2) : 0}%</span>
                  ) : (
                    <span>{totalLiveUnrealizedPnL >= 0 ? '+' : ''}{fmtCurrency(totalLiveUnrealizedPnL)}</span>
                  )}
                </>
              )}
            </div>
            <div className="text-[10px] text-neutral-500 font-mono mt-0.5">
              {viewMode === 'R_MULTIPLE' && !privacyMode ? (
                <span>{totalLiveUnrealizedPnL >= 0 ? '+' : ''}{fmtCurrency(totalLiveUnrealizedPnL)}</span>
              ) : viewMode === 'PERCENT' ? (
                'Open positions floating'
              ) : (
                'Open positions'
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Capital Allocation Multi-Segment Strip & Inline Legend */}
      <div className="pt-2 border-t border-neutral-800/70 flex flex-col gap-1.5">
        <div className="w-full h-1.5 bg-neutral-950 rounded-full overflow-hidden flex border border-neutral-800">
          {cashPct > 0 && (
            <div 
              className="bg-neutral-300 transition-all duration-300"
              style={{ width: `${cashPct}%` }}
              title={`USDT Cash: ${cashPct.toFixed(1)}%`}
            />
          )}
          {tradesPct > 0 && (
            <div 
              className="bg-blue-500 transition-all duration-300"
              style={{ width: `${tradesPct}%` }}
              title={`Active Trades: ${tradesPct.toFixed(1)}%`}
            />
          )}
          {holdingsPct > 0 && (
            <div 
              className="bg-cyan-500 transition-all duration-300"
              style={{ width: `${holdingsPct}%` }}
              title={`Investments: ${holdingsPct.toFixed(1)}%`}
            />
          )}
        </div>

        {/* Compact Inline Legend - Hides all dollar values in PERCENT mode */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] font-mono text-neutral-400">
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-neutral-300 shrink-0" />
            <span>Cash:</span>
            <strong className="text-neutral-200">
              {viewMode === 'PERCENT' ? `${cashPct.toFixed(1)}%` : `${fmtCurrency(availableCapital)} (${cashPct.toFixed(0)}%)`}
            </strong>
          </div>

          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
            <span>Trades:</span>
            <strong className="text-neutral-200">
              {viewMode === 'PERCENT' ? `${tradesPct.toFixed(1)}%` : `${fmtCurrency(totalTradesInvested)} (${tradesPct.toFixed(0)}%)`}
            </strong>
          </div>

          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
            <span>Investments:</span>
            <strong className="text-neutral-200">
              {viewMode === 'PERCENT' ? `${holdingsPct.toFixed(1)}%` : `${fmtCurrency(totalHoldingsInvested)} (${holdingsPct.toFixed(0)}%)`}
            </strong>
          </div>
        </div>
      </div>
    </div>
  );
}
