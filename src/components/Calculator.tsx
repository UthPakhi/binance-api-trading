import React, { useState, useEffect, useRef } from 'react';
import { Input } from './Input';
import { Button } from './Button';
import { Save, Search, RefreshCw, RotateCcw, AlertTriangle, Plus, X } from 'lucide-react';
import { auth, db } from '../lib/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { Trade } from '../types';
import { useBinanceTickers, fetchBinanceSymbols } from '../lib/binance';
import { useTradeContext } from '../lib/TradeContext';
import { 
  calculatePortfolioStats, formatPrice, isAlphaTradeOrSymbol, getTradeIsLong,
  formatCurrency, formatPkr, calculateTargetRR, calculateTargetProfit, calculateTargetSellFee 
} from '../lib/tradeUtils';
import toast from 'react-hot-toast';



export function Calculator() {
  const { 
    trades, 
    baseCapital, 
    setBaseCapital, 
    livePrices: contextLivePrices, 
    binanceBalance, 
    pkrRate,
    effectiveFeeRate,
    isDemoMode,
    feeTier,
    saveTradeOptimistic
  } = useTradeContext();
  const { availableCapital, freeAvailableCash, totalEquity, totalRealizedPnL, totalLiveUnrealizedPnL } = calculatePortfolioStats(trades, baseCapital, contextLivePrices, binanceBalance);

  const [portfolioSize, setPortfolioSize] = useState<string>('');
  const [riskPercent, setRiskPercent] = useState<string>(() => localStorage.getItem('calc_riskPercent') || '0.5');
  const hasUserEditedEquity = useRef(false);
  const [entry, setEntry] = useState<string>(() => localStorage.getItem('calc_entry') || '');
  const [sl, setSl] = useState<string>(() => localStorage.getItem('calc_sl') || '');
  
  const [tp1, setTp1] = useState<string>(() => localStorage.getItem('calc_tp1') || '');
  const [tp1Pct, setTp1Pct] = useState<string>(() => localStorage.getItem('calc_tp1Pct') || '100');
  
  const [tp2, setTp2] = useState<string>(() => localStorage.getItem('calc_tp2') || '');
  const [tp2Pct, setTp2Pct] = useState<string>(() => localStorage.getItem('calc_tp2Pct') || '0');
  
  const [tp3, setTp3] = useState<string>(() => localStorage.getItem('calc_tp3') || '');
  const [tp3Pct, setTp3Pct] = useState<string>(() => localStorage.getItem('calc_tp3Pct') || '0');
  
  const [visibleTpCount, setVisibleTpCount] = useState<number>(() => {
    const savedTp3 = localStorage.getItem('calc_tp3');
    const savedTp2 = localStorage.getItem('calc_tp2');
    if (savedTp3 && parseFloat(savedTp3) > 0) return 3;
    if (savedTp2 && parseFloat(savedTp2) > 0) return 2;
    return 1;
  });
  const riskInputRef = useRef<HTMLInputElement>(null);
  
  const [customRiskAmount, setCustomRiskAmount] = useState<string>('');

  const [customTotalBuy, setCustomTotalBuy] = useState<string>('');
  const [customProfit1, setCustomProfit1] = useState<string>('');
  const [customProfit2, setCustomProfit2] = useState<string>('');
  const [customProfit3, setCustomProfit3] = useState<string>('');
  
  const [symbol, setSymbol] = useState<string>(() => localStorage.getItem('calc_symbol') || '');
  const [notes, setNotes] = useState<string>(() => localStorage.getItem('calc_notes') || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isExecutingBinance, setIsExecutingBinance] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState<string | null>(null);

  const [aiRiskAudit, setAiRiskAudit] = useState<{ status: 'approved' | 'vetoed'; message: string } | null>(null);

  // Sync state to local storage to persist across tabs/history
  useEffect(() => {
    localStorage.setItem('calc_riskPercent', riskPercent);
    localStorage.setItem('calc_entry', entry);
    localStorage.setItem('calc_sl', sl);
    localStorage.setItem('calc_tp1', tp1);
    localStorage.setItem('calc_tp1Pct', tp1Pct);
    localStorage.setItem('calc_tp2', tp2);
    localStorage.setItem('calc_tp2Pct', tp2Pct);
    localStorage.setItem('calc_tp3', tp3);
    localStorage.setItem('calc_tp3Pct', tp3Pct);
    localStorage.setItem('calc_symbol', symbol);
    localStorage.setItem('calc_notes', notes);
  }, [riskPercent, entry, sl, tp1, tp1Pct, tp2, tp2Pct, tp3, tp3Pct, symbol, notes]);

  // Auto-sync portfolio size with total account equity when available
  useEffect(() => {
    const effectiveEquity = totalEquity > 0 ? totalEquity : (baseCapital > 0 ? baseCapital : 0);
    if (effectiveEquity > 0 && !hasUserEditedEquity.current) {
      setPortfolioSize(effectiveEquity.toFixed(2));
    }
  }, [totalEquity, baseCapital]);

  const handleSuggestTrade = async (style: string) => {
    try {
      setIsSuggesting(style);

      // Performance feedback loop: pull recent closed trades
      const recentClosedTrades = trades
        .filter(t => ['HIT_SL', 'HIT_TP1', 'HIT_TP2', 'HIT_TP3', 'CLOSED_MANUAL'].includes(t.status || ''))
        .slice(0, 8)
        .map(t => ({
          symbol: t.symbol,
          status: t.status,
          realizedProfitUsd: t.realizedProfitUsd,
          isLong: getTradeIsLong(t),
          entryPrice: t.entryPrice,
          stopLoss: t.stopLoss,
        }));

      const res = await fetch('/api/suggest-trade', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          style, 
          symbol: symbol || undefined,
          recentTrades: recentClosedTrades
        })
      });
      const data = await res.json();
      
      if (data.status === 'success' && data.tradeSetup) {
        if (data.tradeSetup.tradeFound === false) {
          setAiRiskAudit({
            status: 'vetoed',
            message: data.tradeSetup.notes || "Market conditions lack high-conviction institutional confluence. Trade vetoed to preserve capital."
          });
          return;
        }

        const { symbol, entry, sl, tp1, tp2, tp3, tp1Pct, tp2Pct, tp3Pct, notes } = data.tradeSetup;
        setSymbol(symbol || '');
        setEntry(entry ? entry.toString() : '');
        setSl(sl ? sl.toString() : '');
        setTp1(tp1 ? tp1.toString() : '');
        setTp2(tp2 ? tp2.toString() : '');
        setTp3(tp3 ? tp3.toString() : '');
        setTp1Pct(tp1Pct ? tp1Pct.toString() : '100');
        setTp2Pct(tp2Pct ? tp2Pct.toString() : '0');
        setTp3Pct(tp3Pct ? tp3Pct.toString() : '0');
        setNotes(notes || '');

        if (tp3 && parseFloat(tp3) > 0) {
          setVisibleTpCount(3);
        } else if (tp2 && parseFloat(tp2) > 0) {
          setVisibleTpCount(2);
        } else {
          setVisibleTpCount(1);
        }
        setAiRiskAudit({
          status: 'approved',
          message: notes || "Audited & approved by Quantitative Risk Desk."
        });
        toast.success("AI Trade Suggested & Risk Audited!", { icon: "✨" });
      } else {
        throw new Error(data.message || 'Failed to suggest trade');
      }
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "Could not generate trade");
    } finally {
      setIsSuggesting(null);
    }
  };
  
  // Binance Symbol Search State
  const [allSymbols, setAllSymbols] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchBinanceSymbols().then(setAllSymbols);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredSymbols = allSymbols
    .filter(s => s.toLowerCase().includes(symbol.toLowerCase()))
    .slice(0, 10);

  // Live Price Hook
  const normalizedSymbol = symbol.trim().toUpperCase();
  const lookupSymbols = normalizedSymbol.length > 1
    ? [normalizedSymbol, normalizedSymbol.endsWith('USDT') ? normalizedSymbol : `${normalizedSymbol}USDT`]
    : [];
  const livePrices = useBinanceTickers(lookupSymbols);
  const livePrice = livePrices[normalizedSymbol] || livePrices[`${normalizedSymbol}USDT`];

  const PKR_RATE = pkrRate || 283.89;

  const formatNumber = (val: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(val);

  // Parsed values
  const pSize = parseFloat(portfolioSize) || 0;
  const rPct = parseFloat(riskPercent) || 0;
  const ent = parseFloat(entry) || 0;
  const stop = parseFloat(sl) || 0;
  
  const t1 = parseFloat(tp1) || 0;
  const t1Pct = parseFloat(tp1Pct) || 0;
  const t2 = parseFloat(tp2) || 0;
  const t2Pct = parseFloat(tp2Pct) || 0;
  const t3 = parseFloat(tp3) || 0;
  const t3Pct = parseFloat(tp3Pct) || 0;

  const totalPct = t1Pct + t2Pct + t3Pct;
  const isPctValid = totalPct === 100;

  const getPctChange = (price: number) => {
    if (ent === 0 || price === 0) return 0;
    const isLong = ent > stop;
    const change = ((price - ent) / ent) * 100;
    return isLong ? change : -change;
  };

  const renderPctChange = (price: number) => {
    const pct = getPctChange(price);
    if (pct === 0) return null;
    const isPos = pct > 0;
    return (
      <span className={`text-[10px] ml-2 ${isPos ? 'text-sky-400' : 'text-slate-400'}`}>
        {isPos ? '+' : ''}{pct.toFixed(2)}%
      </span>
    );
  };

  // Derived values: Risk target based on Total Account Equity
  const riskAmountTarget = pSize * (rPct / 100);
  const riskPerCoin = Math.abs(ent - stop);
  
  let coins = riskPerCoin > 0 ? riskAmountTarget / riskPerCoin : 0;
  let totalBuy = coins * ent;
  let riskAmount = riskAmountTarget;

  // Enforce Spot Buying Power: Cannot spend more than available free USDT cash
  const maxAvailableCash = availableCapital > 0 ? availableCapital : pSize;
  const theoreticalBuy = totalBuy;
  const theoreticalRisk = riskAmountTarget;
  const isCappedByCash = ent > 0 && maxAvailableCash > 0 && totalBuy > (maxAvailableCash + 0.01);

  if (isCappedByCash) {
    totalBuy = maxAvailableCash;
    coins = totalBuy / ent;
    riskAmount = coins * riskPerCoin;
  }

  const FEE_RATE = effectiveFeeRate ?? 0.001;
  const buyFeeUsd = totalBuy * FEE_RATE;

  const profit1 = calculateTargetProfit(ent, stop, t1, coins, t1Pct);
  const profit2 = calculateTargetProfit(ent, stop, t2, coins, t2Pct);
  const profit3 = calculateTargetProfit(ent, stop, t3, coins, t3Pct);

  const sellFee1 = calculateTargetSellFee(t1, coins, t1Pct, FEE_RATE);
  const sellFee2 = calculateTargetSellFee(t2, coins, t2Pct, FEE_RATE);
  const sellFee3 = calculateTargetSellFee(t3, coins, t3Pct, FEE_RATE);

  const totalProfitUsd = profit1 + profit2 + profit3;
  const totalSellFeeUsd = sellFee1 + sellFee2 + sellFee3;
  const totalFeeUsd = buyFeeUsd + totalSellFeeUsd;
  
  const totalNetProfitUsd = totalProfitUsd - totalFeeUsd;
  const totalProfitPkr = totalNetProfitUsd * PKR_RATE;

  const expectedPortfolioWin = pSize + totalNetProfitUsd;
  
  const stopSellFeeUsd = (coins * stop) * FEE_RATE;
  const expectedStopFeeUsd = buyFeeUsd + stopSellFeeUsd;
  const totalRiskLossUsd = riskAmount + expectedStopFeeUsd;
  const expectedPortfolioLoss = Math.max(0, pSize - totalRiskLossUsd);

  // Smart TP Percentage Auto-Balancing Handlers
  const handleAutoBalanceEqual = () => {
    // Determine which TPs have prices set
    const hasT1 = t1 > 0;
    const hasT2 = t2 > 0;
    const hasT3 = t3 > 0;
    const activeCount = (hasT1 ? 1 : 0) + (hasT2 ? 1 : 0) + (hasT3 ? 1 : 0);

    if (activeCount === 3) {
      setTp1Pct('34');
      setTp2Pct('33');
      setTp3Pct('33');
      toast.success("Split equally: 34% / 33% / 33%");
    } else if (activeCount === 2) {
      if (hasT1 && hasT2) {
        setTp1Pct('50');
        setTp2Pct('50');
        setTp3Pct('0');
      } else if (hasT1 && hasT3) {
        setTp1Pct('50');
        setTp2Pct('0');
        setTp3Pct('50');
      } else {
        setTp1Pct('0');
        setTp2Pct('50');
        setTp3Pct('50');
      }
      toast.success("Split equally: 50% / 50%");
    } else {
      // Default to 100% on TP1 or single active TP
      if (hasT2) {
        setTp1Pct('0');
        setTp2Pct('100');
        setTp3Pct('0');
      } else if (hasT3) {
        setTp1Pct('0');
        setTp2Pct('0');
        setTp3Pct('100');
      } else {
        setTp1Pct('100');
        setTp2Pct('0');
        setTp3Pct('0');
      }
      toast.success("Allocated 100% to active target");
    }
  };

  const handleFillRemaining = (targetSlot: 1 | 2 | 3) => {
    if (targetSlot === 1) {
      const remaining = Math.max(0, 100 - (t2Pct + t3Pct));
      setTp1Pct(remaining.toString());
      toast.success(`TP1 filled with remaining ${remaining}%`);
    } else if (targetSlot === 2) {
      const remaining = Math.max(0, 100 - (t1Pct + t3Pct));
      setTp2Pct(remaining.toString());
      toast.success(`TP2 filled with remaining ${remaining}%`);
    } else {
      const remaining = Math.max(0, 100 - (t1Pct + t2Pct));
      setTp3Pct(remaining.toString());
      toast.success(`TP3 filled with remaining ${remaining}%`);
    }
  };

  const handleAddTarget = () => {
    if (visibleTpCount === 1) {
      setVisibleTpCount(2);
      setTp1Pct('50');
      setTp2Pct('50');
      setTp3Pct('0');
      toast.success("Added TP2 (50% / 50% split)", { icon: "🎯" });
    } else if (visibleTpCount === 2) {
      setVisibleTpCount(3);
      setTp1Pct('34');
      setTp2Pct('33');
      setTp3Pct('33');
      toast.success("Added TP3 (34% / 33% / 33% split)", { icon: "🎯" });
    }
  };

  const handleRemoveTarget = (slot: 2 | 3) => {
    if (slot === 3) {
      const returningPct = parseFloat(tp3Pct) || 0;
      const currentTp1Pct = parseFloat(tp1Pct) || 0;
      setTp3('');
      setTp3Pct('0');
      setTp1Pct((currentTp1Pct + returningPct).toString());
      setVisibleTpCount(2);
      toast.success(`Removed TP3. Returned ${returningPct}% to TP1`);
    } else if (slot === 2) {
      const returningPct = (parseFloat(tp2Pct) || 0) + (parseFloat(tp3Pct) || 0);
      const currentTp1Pct = parseFloat(tp1Pct) || 0;
      setTp2('');
      setTp2Pct('0');
      setTp3('');
      setTp3Pct('0');
      setTp1Pct((currentTp1Pct + returningPct).toString());
      setVisibleTpCount(1);
      toast.success("Removed extra targets. TP1 allocated 100%");
    }
  };

  const handleClear = () => {
    setSymbol('');
    setEntry('');
    setSl('');
    setTp1('');
    setTp2('');
    setTp3('');
    setTp1Pct('100');
    setTp2Pct('0');
    setTp3Pct('0');
    setNotes('');
    setVisibleTpCount(1);
  };

  const handleExecuteBinance = async (orderType: 'MARKET' | 'LIMIT') => {
    if (!symbol || !coins || coins <= 0 || !ent) {
      toast.error("Please enter a valid symbol, entry, and position size.");
      return;
    }
    try {
      setIsExecutingBinance(true);
      const isLong = ent >= stop;
      const side = isLong ? 'BUY' : 'SELL';
      const cleanSym = symbol.trim().toUpperCase();

      const res = await fetch('/api/exchange/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: cleanSym,
          side,
          type: orderType,
          quantity: coins.toFixed(6),
          price: orderType === 'LIMIT' ? ent : undefined
        })
      });
      const data = await res.json();
      if (data.status === 'success') {
        toast.success(`🚀 Binance ${orderType} order executed successfully for ${cleanSym}!`, { icon: '🚀' });
        await handleSave(orderType === 'MARKET' ? 'ACTIVE' : 'PENDING');
      } else {
        throw new Error(data.message || 'Binance order execution failed');
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to execute order on Binance');
    } finally {
      setIsExecutingBinance(false);
    }
  };

  const handleSave = async (status: string = 'ACTIVE') => {
    if (!auth.currentUser) return;
    if (coins === 0 || totalBuy === 0) return;
    if (!isPctValid) {
      alert("Total sell percentage must be exactly 100%. Use Auto-Balance to resolve instantly.");
      return;
    }
    
    if (totalBuy > availableCapital + 0.01) {
      alert(`Insufficient funds! You only have $${availableCapital.toFixed(2)} available. Required: $${totalBuy.toFixed(2)}`);
      return;
    }

    setIsSaving(true);
    try {
      const isAlpha = isAlphaTradeOrSymbol(symbol);
      const trade: Trade = {
        userId: auth.currentUser.uid,
        symbol: symbol.trim().toUpperCase() || 'UNKNOWN',
        portfolioSize: pSize,
        riskPercent: rPct,
        entryPrice: ent,
        stopLoss: stop,
        takeProfit1: t1,
        takeProfit2: t2,
        takeProfit3: t3,
        riskAmount: riskAmount,
        positionSizeCoins: coins,
        totalBuyUsd: totalBuy,
        tp1RR: calculateTargetRR(ent, stop, t1),
        tp1Profit: profit1,
        tp1Percent: t1Pct,
        tp2Percent: t2Pct,
        tp3Percent: t3Pct,
        totalProfitUsd: totalNetProfitUsd,
        totalProfitPkr,
        feeUsd: totalFeeUsd,
        pkrRate: PKR_RATE,
        market: isAlpha ? 'ALPHA' : 'SPOT',
        isAlpha: isAlpha,
        notes: notes.trim() || undefined,
        createdAt: Date.now(),
        status: status,
      };

      await saveTradeOptimistic(trade);
      setSymbol('');
      toast.success(isDemoMode ? `🧪 Paper trade saved as ${status}!` : `Trade saved successfully as ${status}!`);
    } catch (e) {
      console.error("Error saving trade: ", e);
      toast.error("Failed to save trade.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3.5 pb-20">
      
      {/* 1. Trade Setup Card */}
      <div className="bg-neutral-900 rounded-xl p-3 sm:p-4 border border-neutral-800 shadow-sm">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-neutral-200">
            Trade Setup
          </h2>
          <div className="flex items-center gap-1.5">
            <Button 
              size="sm" 
              variant="secondary" 
              className="bg-blue-500/10 text-sky-400 hover:bg-blue-500/20 border border-blue-500/20 h-7 text-[11px] px-2.5 flex items-center gap-1"
              onClick={() => handleSuggestTrade('scalp')}
              disabled={isSuggesting !== null}
            >
              {isSuggesting === 'scalp' ? <RefreshCw className="w-3 h-3 animate-spin" /> : "⚡"} Scalp Setup
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={handleClear} 
              className="h-7 w-7 text-neutral-500 hover:text-slate-300 shrink-0" 
              title="Reset / Clear Trade Fields"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {aiRiskAudit && (
          <div className={`mb-3 p-2.5 rounded-lg border text-xs flex items-start justify-between gap-2 ${
            aiRiskAudit.status === 'approved'
              ? 'bg-blue-500/10 border-blue-500/30 text-sky-300'
              : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
          }`}>
            <div className="flex items-start gap-2">
              <span className="text-sm">{aiRiskAudit.status === 'approved' ? '⚡' : '🛡️'}</span>
              <div>
                <span className="font-bold uppercase tracking-wider block mb-0.5 text-[10px]">
                  {aiRiskAudit.status === 'approved' ? 'Quant Setup Approved' : 'Risk Desk Veto'}
                </span>
                <p className="leading-relaxed text-neutral-300 text-[11px]">{aiRiskAudit.message}</p>
              </div>
            </div>
            <button
              onClick={() => setAiRiskAudit(null)}
              className="text-neutral-400 hover:text-neutral-200 text-xs px-1"
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {/* Symbol Search & Live Price Bar */}
          <div className="relative" ref={dropdownRef}>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] text-neutral-400 font-medium">Coin Symbol</label>
              {livePrice && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-neutral-400 text-[11px]">
                    Live: <strong className="text-sky-400 font-mono font-semibold">{formatCurrency(livePrice)}</strong>
                  </span>
                  <button 
                    type="button"
                    onClick={() => setEntry(formatPrice(livePrice).toString())}
                    className="text-[10px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded border border-blue-500/30 hover:bg-blue-500/30 transition-colors uppercase font-bold"
                  >
                    Use Live
                  </button>
                </div>
              )}
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-500" />
              <Input 
                placeholder="Search ticker e.g. BTCUSDT, SOLUSDT, FARTCOIN" 
                value={symbol} 
                onChange={(e) => {
                  setSymbol(e.target.value.toUpperCase());
                  setShowDropdown(true);
                }} 
                onFocus={() => setShowDropdown(true)}
                className="pl-9 h-9 text-xs font-mono"
              />
            </div>
            
            {showDropdown && symbol.length > 0 && filteredSymbols.length > 0 && (
              <ul className="absolute z-10 w-full mt-1 bg-neutral-800 border border-neutral-700 rounded-md shadow-lg max-h-40 overflow-y-auto">
                {filteredSymbols.map(s => (
                  <li 
                    key={s} 
                    className="px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-700 cursor-pointer font-mono"
                    onClick={() => {
                      setSymbol(s);
                      setShowDropdown(false);
                    }}
                  >
                    {s}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 4 Compact Inputs Grid: Equity, Risk %, Entry, Stop Loss */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {/* Total Equity */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] text-neutral-400 font-medium">Total Equity ($)</label>
              </div>
              <Input 
                type="number" 
                value={portfolioSize} 
                onChange={(e) => {
                  hasUserEditedEquity.current = true;
                  setPortfolioSize(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                onBlur={(e) => {
                  const newVal = parseFloat(e.target.value);
                  if (!isNaN(newVal) && Math.abs(newVal - totalEquity) > 0.01) {
                    const pnl = (totalRealizedPnL || 0);
                    const unrealized = (totalLiveUnrealizedPnL || 0);
                    setBaseCapital(newVal - pnl - unrealized);
                    toast.success(`Total equity updated to $${newVal}!`);
                  }
                  hasUserEditedEquity.current = false;
                  
                  if (isNaN(newVal) || newVal <= 0) {
                    setPortfolioSize(totalEquity > 0 ? totalEquity.toFixed(2) : (baseCapital > 0 ? baseCapital.toFixed(2) : '0'));
                  }
                }}
                className="h-9 text-xs font-mono"
              />
              <div className="flex items-center justify-between mt-1 text-[10px] text-neutral-500">
                {freeAvailableCash !== undefined && freeAvailableCash > 0 && (
                  <button 
                    type="button" 
                    onClick={() => {
                      setPortfolioSize(freeAvailableCash.toFixed(2));
                      hasUserEditedEquity.current = true;
                      toast.success(`Set to Free: $${freeAvailableCash.toFixed(2)}`);
                    }}
                    className="text-sky-400 hover:underline"
                  >
                    Free: ${freeAvailableCash.toFixed(0)}
                  </button>
                )}
                {availableCapital > 0 && (
                  <button 
                    type="button" 
                    onClick={() => {
                      setPortfolioSize(availableCapital.toFixed(2));
                      hasUserEditedEquity.current = true;
                      toast.success(`Set to Avail: $${availableCapital.toFixed(2)}`);
                    }}
                    className="text-neutral-400 hover:underline ml-auto"
                  >
                    Avail: ${availableCapital.toFixed(0)}
                  </button>
                )}
              </div>
            </div>

            {/* Risk % */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] text-neutral-400 font-medium">Risk %</label>
              </div>

              {/* Selector pills: 0.5 | 1 | 1.25 | 1.5 | Manual */}
              <div className="grid grid-cols-5 gap-1 mb-1.5 p-0.5 bg-neutral-950 rounded-lg border border-neutral-800/80">
                {[0.5, 1, 1.25, 1.5].map((preset) => {
                  const isSelected = Math.abs(parseFloat(riskPercent) - preset) < 0.001;
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setRiskPercent(preset.toString())}
                      className={`py-1 text-[10px] font-mono font-bold rounded transition-all text-center ${
                        isSelected
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
                      }`}
                    >
                      {preset}%
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    riskInputRef.current?.focus();
                    riskInputRef.current?.select();
                  }}
                  className={`py-1 text-[10px] font-mono font-bold rounded transition-all text-center ${
                    ![0.5, 1, 1.25, 1.5].some(p => Math.abs(parseFloat(riskPercent) - p) < 0.001)
                      ? 'bg-amber-600/80 text-white shadow-sm'
                      : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
                  }`}
                  title="Type custom manual risk percentage"
                >
                  Manual
                </button>
              </div>

              <Input 
                ref={riskInputRef}
                type="number" 
                step="0.05" 
                value={riskPercent} 
                onChange={(e) => setRiskPercent(e.target.value)} 
                className="h-8 text-xs font-mono"
                placeholder="1.0"
              />
              <div className="mt-1 text-[10px] text-slate-300 font-mono truncate">
                -{formatCurrency(totalRiskLossUsd)} loss
                {expectedStopFeeUsd > 0.01 && <span className="text-[9px] text-neutral-500 ml-1">(fee: -${expectedStopFeeUsd.toFixed(2)})</span>}
              </div>
            </div>

            {/* Entry Price */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] text-neutral-400 font-medium">Entry Price</label>
              </div>
              <Input 
                type="number" 
                step="0.0001" 
                value={entry} 
                onChange={(e) => setEntry(e.target.value)} 
                className="h-9 text-xs font-mono"
                placeholder="0.00"
              />
              <div className="mt-1 text-[10px] text-neutral-500 font-mono">
                {ent > 0 ? `$${formatPrice(ent, true)}` : 'Entry'}
              </div>
            </div>

            {/* Stop Loss */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] text-neutral-400 font-medium flex items-center">
                  Stop Loss {renderPctChange(stop)}
                </label>
              </div>
              <Input 
                type="number" 
                step="0.0001" 
                value={sl} 
                onChange={(e) => setSl(e.target.value)} 
                className="h-9 text-xs font-mono"
                placeholder="0.00"
              />
              <div className="mt-1 text-[10px] text-neutral-500 font-mono">
                {stop > 0 ? `$${formatPrice(stop, true)}` : 'Stop'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Targets Card (Exit Strategy) */}
      <div className="bg-neutral-900 rounded-xl p-3 sm:p-4 border border-neutral-800 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-neutral-200">
              Exit Strategy
            </h2>
            {visibleTpCount < 3 && (
              <button
                type="button"
                onClick={handleAddTarget}
                className="h-6 px-2 text-[10px] font-bold bg-blue-500/10 text-sky-400 hover:bg-blue-500/20 border border-blue-500/30 rounded flex items-center gap-1 transition-all shadow-sm"
                title="Add another Take Profit target"
              >
                <Plus className="w-3 h-3" />
                <span>+ TP{visibleTpCount + 1}</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={handleAutoBalanceEqual}
              className="text-[11px] bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 px-2 py-0.5 rounded transition-colors flex items-center gap-1"
              title="Split percentage equally across active targets"
            >
              <RotateCcw className="w-2.5 h-2.5 text-sky-400" />
              Equal Split
            </button>
            <button
              type="button"
              onClick={() => {
                setTp1Pct('100');
                setTp2Pct('0');
                setTp3Pct('0');
                toast.success("Allocated 100% to TP1");
              }}
              className="text-[11px] bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 px-2 py-0.5 rounded transition-colors"
            >
              100% TP1
            </button>
          </div>
        </div>

        {/* Targets Table Headers */}
        <div className="flex items-center gap-2 mb-1.5 px-0.5 text-[10px] text-neutral-500 font-semibold uppercase tracking-wider">
          <div className="flex-1">Target Price</div>
          <div className="w-20 text-center">Sell %</div>
          <div className="w-24 text-right">Profit ($)</div>
          <div className="w-12 text-right">R/R</div>
          {visibleTpCount > 1 && <div className="w-6"></div>}
        </div>

        <div className="flex flex-col gap-2">
          {/* TP 1 */}
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <Input 
                type="number" 
                step="0.0001" 
                value={tp1} 
                onChange={(e) => setTp1(e.target.value)} 
                placeholder="TP1 Price"
                className="h-8 text-xs font-mono px-2.5" 
              />
            </div>
            
            <div className="w-20 shrink-0">
              <Input 
                type="number" 
                step="1" 
                value={tp1Pct} 
                onChange={(e) => setTp1Pct(e.target.value)} 
                className="h-8 text-xs font-mono px-1 text-center" 
              />
            </div>
            
            <div className="w-24 shrink-0">
              <Input 
                type="number" 
                className="h-8 text-xs font-mono font-medium text-sky-400 text-right px-2"
                value={customProfit1 !== '' ? customProfit1 : (profit1 > 0 ? profit1.toFixed(2) : '')}
                onChange={(e) => setCustomProfit1(e.target.value)}
                placeholder="$0.00"
                onBlur={() => {
                  if (customProfit1 !== '') {
                    const p = parseFloat(customProfit1);
                    if (!isNaN(p) && coins > 0 && t1Pct > 0) {
                      const isL = stop > 0 ? ent > stop : true;
                      const sC = coins * (t1Pct / 100);
                      const pPC = p / sC;
                      const calculatedPrice = isL ? ent + pPC : ent - pPC;
                      setTp1(formatPrice(calculatedPrice).toString());
                    }
                    setCustomProfit1('');
                  }
                }}
              />
            </div>

            <div className="w-12 shrink-0 flex items-center justify-end">
              <span className={`text-xs font-bold font-mono ${calculateTargetRR(ent, stop, t1) > 0 ? 'text-blue-400' : 'text-neutral-500'}`}>
                {calculateTargetRR(ent, stop, t1).toFixed(1)}R
              </span>
            </div>
            {visibleTpCount > 1 && <div className="w-6 shrink-0"></div>}
          </div>

          {/* TP 2 (Conditional) */}
          {visibleTpCount >= 2 && (
            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <Input 
                  type="number" 
                  step="0.0001" 
                  value={tp2} 
                  onChange={(e) => setTp2(e.target.value)} 
                  placeholder="TP2 Price"
                  className="h-8 text-xs font-mono px-2.5" 
                />
              </div>
              
              <div className="w-20 shrink-0">
                <Input 
                  type="number" 
                  step="1" 
                  value={tp2Pct} 
                  onChange={(e) => setTp2Pct(e.target.value)} 
                  className="h-8 text-xs font-mono px-1 text-center" 
                />
              </div>
              
              <div className="w-24 shrink-0">
                <Input 
                  type="number" 
                  className="h-8 text-xs font-mono font-medium text-sky-400 text-right px-2"
                  value={customProfit2 !== '' ? customProfit2 : (profit2 > 0 ? profit2.toFixed(2) : '')}
                  onChange={(e) => setCustomProfit2(e.target.value)}
                  placeholder="$0.00"
                  onBlur={() => {
                    if (customProfit2 !== '') {
                      const p = parseFloat(customProfit2);
                      if (!isNaN(p) && coins > 0 && t2Pct > 0) {
                        const isL = stop > 0 ? ent > stop : true;
                        const sC = coins * (t2Pct / 100);
                        const pPC = p / sC;
                        const calculatedPrice = isL ? ent + pPC : ent - pPC;
                        setTp2(formatPrice(calculatedPrice).toString());
                      }
                      setCustomProfit2('');
                    }
                  }}
                />
              </div>

              <div className="w-12 shrink-0 flex items-center justify-end">
                <span className={`text-xs font-bold font-mono ${calculateTargetRR(ent, stop, t2) > 0 ? 'text-blue-400' : 'text-neutral-500'}`}>
                  {calculateTargetRR(ent, stop, t2).toFixed(1)}R
                </span>
              </div>

              <div className="w-6 shrink-0 flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => handleRemoveTarget(2)}
                  className="p-1 text-neutral-500 hover:text-slate-300 rounded transition-colors"
                  title="Remove TP2"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* TP 3 (Conditional) */}
          {visibleTpCount >= 3 && (
            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <Input 
                  type="number" 
                  step="0.0001" 
                  value={tp3} 
                  onChange={(e) => setTp3(e.target.value)} 
                  placeholder="TP3 Price"
                  className="h-8 text-xs font-mono px-2.5" 
                />
              </div>
              
              <div className="w-20 shrink-0">
                <Input 
                  type="number" 
                  step="1" 
                  value={tp3Pct} 
                  onChange={(e) => setTp3Pct(e.target.value)} 
                  className="h-8 text-xs font-mono px-1 text-center" 
                />
              </div>
              
              <div className="w-24 shrink-0">
                <Input 
                  type="number" 
                  className="h-8 text-xs font-mono font-medium text-sky-400 text-right px-2"
                  value={customProfit3 !== '' ? customProfit3 : (profit3 > 0 ? profit3.toFixed(2) : '')}
                  onChange={(e) => setCustomProfit3(e.target.value)}
                  placeholder="$0.00"
                  onBlur={() => {
                    if (customProfit3 !== '') {
                      const p = parseFloat(customProfit3);
                      if (!isNaN(p) && coins > 0 && t3Pct > 0) {
                        const isL = stop > 0 ? ent > stop : true;
                        const sC = coins * (t3Pct / 100);
                        const pPC = p / sC;
                        const calculatedPrice = isL ? ent + pPC : ent - pPC;
                        setTp3(formatPrice(calculatedPrice).toString());
                      }
                      setCustomProfit3('');
                    }
                  }}
                />
              </div>

              <div className="w-12 shrink-0 flex items-center justify-end">
                <span className={`text-xs font-bold font-mono ${calculateTargetRR(ent, stop, t3) > 0 ? 'text-blue-400' : 'text-neutral-500'}`}>
                  {calculateTargetRR(ent, stop, t3).toFixed(1)}R
                </span>
              </div>

              <div className="w-6 shrink-0 flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => handleRemoveTarget(3)}
                  className="p-1 text-neutral-500 hover:text-slate-300 rounded transition-colors"
                  title="Remove TP3"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Plus Add Target Button below when collapsed */}
          {visibleTpCount < 3 && (
            <button
              type="button"
              onClick={handleAddTarget}
              className="w-full py-2 text-xs font-mono font-medium text-neutral-400 hover:text-sky-400 border border-dashed border-neutral-800 hover:border-blue-500/40 rounded-lg flex items-center justify-center gap-1.5 transition-colors bg-neutral-950/40 mt-1"
            >
              <Plus className="w-3.5 h-3.5 text-sky-400" />
              <span>Add Take Profit Target (TP{visibleTpCount + 1})</span>
            </button>
          )}
        </div>

        {!isPctValid && (
          <div className="mt-2.5 p-2 rounded-md bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-center justify-between">
            <span>Total sell percentage must be 100% (currently: <strong className="text-amber-200 font-mono">{totalPct}%</strong>)</span>
            <button
              type="button"
              onClick={handleAutoBalanceEqual}
              className="px-2 py-0.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 rounded font-medium text-[11px]"
            >
              Fix
            </button>
          </div>
        )}

        {/* Expected Net Profit Footer */}
        <div className="mt-3 pt-2.5 border-t border-neutral-800 flex justify-between items-center text-xs">
          <div className="text-neutral-400">
            <span>Expected Net Profit</span>
            <span className="text-neutral-500 text-[10px] ml-1.5">(Est. fee: ${totalFeeUsd.toFixed(2)})</span>
          </div>
          <div className="text-right flex items-center gap-1.5 justify-end">
            {riskAmount > 0 && totalNetProfitUsd > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded font-bold font-mono bg-blue-500/20 text-blue-300 border border-blue-500/30">
                +{(totalNetProfitUsd / riskAmount).toFixed(1)}R
              </span>
            )}
            <span className="text-sm font-bold font-mono text-sky-400">
              +{formatCurrency(totalNetProfitUsd)}
            </span>
            <span className="text-[10px] text-sky-400/80 ml-1 font-mono">
              ({formatPkr(totalProfitPkr)})
            </span>
          </div>
        </div>
      </div>

      {/* 3. Position Sizing & Output Terminal */}
      <div className="bg-neutral-900 rounded-xl p-3 sm:p-4 border border-neutral-800 shadow-sm relative overflow-hidden flex flex-col gap-3">
        <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-blue-600 via-sky-400 to-indigo-500"></div>
        
        <div className="flex items-center justify-between pt-0.5">
          <h2 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-neutral-200">
            Position Sizing &amp; Risk
          </h2>
          {isCappedByCash && (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-400 bg-amber-950/60 border border-amber-800/80 px-2 py-0.5 rounded">
              <AlertTriangle className="w-3 h-3" />
              Capped to Available Cash
            </span>
          )}
        </div>

        {/* 4 Core Dimensions in a Single Compact Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          {/* Position Size Coins */}
          <div className="bg-neutral-950/70 p-2.5 rounded-lg border border-neutral-800/80">
            <span className="text-[10px] text-neutral-500 uppercase font-semibold block mb-0.5">
              Position (Coins)
            </span>
            <div className="text-sm font-bold font-mono text-neutral-100 tabular-nums">
              {formatNumber(coins)}
            </div>
            <div className="text-[10px] text-neutral-500 mt-0.5 truncate">
              {normalizedSymbol || 'Tokens'}
            </div>
          </div>

          {/* Buy Size USD */}
          <div className="bg-neutral-950/70 p-2.5 rounded-lg border border-neutral-800/80">
            <span className="text-[10px] text-neutral-500 uppercase font-semibold block mb-0.5">
              Total Buy Size
            </span>
            <div className="text-sm font-bold font-mono text-blue-400 tabular-nums">
              {formatCurrency(totalBuy)}
            </div>
            <div className="text-[10px] text-blue-500/70 mt-0.5 font-mono truncate">
              {formatPkr(totalBuy * PKR_RATE)}
            </div>
          </div>

          {/* Risk (Max Loss) */}
          <div className="bg-neutral-950/70 p-2.5 rounded-lg border border-neutral-800/80">
            <span className="text-[10px] text-neutral-500 uppercase font-semibold block mb-0.5">
              Max Risk (Loss)
            </span>
            <div className="text-sm font-bold font-mono text-slate-300 tabular-nums">
              -{formatCurrency(totalRiskLossUsd)}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
              -{riskAmountTarget > 0 ? (totalRiskLossUsd / riskAmountTarget).toFixed(2) : '1.00'}R ({pSize > 0 ? ((totalRiskLossUsd / pSize) * 100).toFixed(2) : 0}%)
              {isCappedByCash && ' · Capped'}
            </div>
          </div>

          {/* Win / Loss Ratio */}
          <div className="bg-neutral-950/70 p-2.5 rounded-lg border border-neutral-800/80">
            <span className="text-[10px] text-neutral-500 uppercase font-semibold block mb-0.5">
              Blended R:R
            </span>
            <div className={`text-sm font-bold font-mono tabular-nums ${
              riskAmount > 0 && (totalNetProfitUsd / riskAmount) >= 2 
                ? 'text-sky-400' 
                : riskAmount > 0 && (totalNetProfitUsd / riskAmount) >= 1 
                  ? 'text-blue-400' 
                  : riskAmount > 0 && (totalNetProfitUsd / riskAmount) > 0 
                    ? 'text-amber-400' 
                    : 'text-neutral-400'
            }`}>
              {riskAmount > 0 ? (totalNetProfitUsd / riskAmount).toFixed(2) : '0.00'}R
            </div>
            <div className="text-[10px] text-neutral-500 mt-0.5 font-mono">
              {totalNetProfitUsd >= 0 ? 'Reward to Risk' : 'Loss Target'}
            </div>
          </div>
        </div>

        {/* Compact Expected Outcome Bar */}
        <div className="pt-2 border-t border-neutral-800/80 grid grid-cols-2 gap-2 text-xs font-mono">
          <div className="bg-blue-500/10 rounded-lg p-2 border border-blue-500/20 flex items-center justify-between">
            <div>
              <span className="text-[10px] text-sky-300/80 uppercase font-semibold block">Target Portfolio</span>
              <span className="text-xs font-bold text-sky-400">{formatCurrency(expectedPortfolioWin)}</span>
            </div>
            <span className="text-[10px] font-semibold text-sky-300 bg-blue-500/20 px-1.5 py-0.5 rounded">
              +{pSize > 0 ? ((totalNetProfitUsd / pSize) * 100).toFixed(1) : 0}%
            </span>
          </div>

          <div className="bg-slate-800/40 rounded-lg p-2 border border-slate-700/60 flex items-center justify-between">
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-semibold block">Stop Portfolio</span>
              <span className="text-xs font-bold text-slate-300">{formatCurrency(expectedPortfolioLoss)}</span>
            </div>
            <span className="text-[10px] font-semibold text-slate-300 bg-slate-700/50 px-1.5 py-0.5 rounded">
              -{pSize > 0 ? ((totalRiskLossUsd / pSize) * 100).toFixed(1) : 0}%
            </span>
          </div>
        </div>

        {/* Optional Strategy Notes (Compact) */}
        <div>
          <Input 
            value={notes} 
            onChange={(e) => setNotes(e.target.value)} 
            placeholder="Trade notes / strategy (optional)..."
            className="h-8 text-xs placeholder:text-neutral-600 bg-neutral-950 font-normal"
          />
        </div>
      </div>

      {/* Save & Binance Execution Action Buttons */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2.5">
          <Button 
            onClick={() => handleSave('ACTIVE')} 
            disabled={isSaving || isExecutingBinance || !auth.currentUser || !isPctValid}
            className="flex-1 h-10 gap-1.5 font-bold shadow-md shadow-blue-950/40 text-xs sm:text-sm"
          >
            <Save className="w-4 h-4" />
            {isSaving ? "Saving..." : "Save Active Trade"}
          </Button>
          <Button 
            onClick={() => handleSave('PENDING')} 
            disabled={isSaving || isExecutingBinance || !auth.currentUser || !isPctValid}
            variant="outline"
            className="flex-1 h-10 gap-1.5 font-semibold text-xs sm:text-sm"
          >
            <Save className="w-4 h-4" />
            {isSaving ? "Saving..." : "Save Limit Order"}
          </Button>
        </div>

        <div className="flex gap-2.5">
          <Button 
            onClick={() => handleExecuteBinance('MARKET')} 
            disabled={isSaving || isExecutingBinance || !isPctValid}
            className="flex-1 h-10 gap-1.5 font-bold bg-amber-600 hover:bg-amber-500 text-white shadow-md text-xs sm:text-sm"
          >
            🚀 {isExecutingBinance ? "Executing..." : "Execute Market on Binance"}
          </Button>
          <Button 
            onClick={() => handleExecuteBinance('LIMIT')} 
            disabled={isSaving || isExecutingBinance || !isPctValid}
            variant="outline"
            className="flex-1 h-10 gap-1.5 font-semibold border-amber-500/50 text-amber-400 hover:bg-amber-950/30 text-xs sm:text-sm"
          >
            ⚡ {isExecutingBinance ? "Executing..." : "Execute Limit on Binance"}
          </Button>
        </div>
      </div>

    </div>
  );
}

