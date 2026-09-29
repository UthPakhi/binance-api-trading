import React, { useState, useEffect, useRef } from 'react';
import { Input } from './Input';
import { Button } from './Button';
import { Save, Search, RefreshCw, RotateCcw, AlertTriangle } from 'lucide-react';
import { auth, db } from '../lib/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { Trade } from '../types';
import { useBinanceTickers, fetchBinanceSymbols } from '../lib/binance';
import { useTradeContext } from '../lib/TradeContext';
import { calculatePortfolioStats, formatPrice } from '../lib/tradeUtils';
import toast from 'react-hot-toast';



export function Calculator() {
  const { trades, baseCapital, setBaseCapital, livePrices: contextLivePrices } = useTradeContext();
  const { availableCapital, totalEquity, totalRealizedPnL, totalLiveUnrealizedPnL } = calculatePortfolioStats(trades, baseCapital, contextLivePrices);

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
  
  const [customRiskAmount, setCustomRiskAmount] = useState<string>('');
  const [customTotalBuy, setCustomTotalBuy] = useState<string>('');
  const [customProfit1, setCustomProfit1] = useState<string>('');
  const [customProfit2, setCustomProfit2] = useState<string>('');
  const [customProfit3, setCustomProfit3] = useState<string>('');
  
  const [symbol, setSymbol] = useState<string>(() => localStorage.getItem('calc_symbol') || '');
  const [notes, setNotes] = useState<string>(() => localStorage.getItem('calc_notes') || '');
  const [isSaving, setIsSaving] = useState(false);
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
          isLong: t.entryPrice > t.stopLoss,
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
  const livePrices = useBinanceTickers(symbol.length > 2 ? [symbol] : []);
  const livePrice = livePrices[symbol.toUpperCase()];

  const PKR_RATE = 285;

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
  const formatNumber = (val: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(val);
  const formatPkr = (val: number) => `₨${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(val)}`;

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
      <span className={`text-[10px] ml-2 ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
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

  const FEE_RATE = 0.001; // 0.1% Binance spot fee
  const buyFeeUsd = totalBuy * FEE_RATE;

  const calculateRR = (tp: number) => {
    if (riskPerCoin === 0 || tp === 0) return 0;
    const isLong = ent > stop;
    const profitPerCoin = isLong ? (tp - ent) : (ent - tp);
    return profitPerCoin / riskPerCoin;
  };

  const calculateProfit = (tp: number, pct: number) => {
    if (tp === 0 || pct === 0) return 0;
    const isLong = ent > stop;
    const profitPerCoin = isLong ? (tp - ent) : (ent - tp);
    const soldCoins = coins * (pct / 100);
    return soldCoins * profitPerCoin;
  };

  const calculateSellFee = (tp: number, pct: number) => {
    if (tp === 0 || pct === 0) return 0;
    const soldCoins = coins * (pct / 100);
    return soldCoins * tp * FEE_RATE;
  };

  const profit1 = calculateProfit(t1, t1Pct);
  const profit2 = calculateProfit(t2, t2Pct);
  const profit3 = calculateProfit(t3, t3Pct);

  const sellFee1 = calculateSellFee(t1, t1Pct);
  const sellFee2 = calculateSellFee(t2, t2Pct);
  const sellFee3 = calculateSellFee(t3, t3Pct);

  const totalProfitUsd = profit1 + profit2 + profit3;
  const totalSellFeeUsd = sellFee1 + sellFee2 + sellFee3;
  const totalFeeUsd = buyFeeUsd + totalSellFeeUsd;
  
  const totalNetProfitUsd = totalProfitUsd - totalFeeUsd;
  const totalProfitPkr = totalNetProfitUsd * PKR_RATE;

  const expectedPortfolioWin = pSize + totalNetProfitUsd;
  
  const stopSellFeeUsd = (coins * stop) * FEE_RATE;
  const expectedStopFeeUsd = buyFeeUsd + stopSellFeeUsd;
  const expectedPortfolioLoss = Math.max(0, pSize - riskAmount - expectedStopFeeUsd);

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
  };

  const handleSave = async (status: string = 'ACTIVE') => {
    if (!auth.currentUser) return;
    if (coins === 0 || totalBuy === 0) return;
    if (!isPctValid) {
      alert("Total sell percentage must be exactly 100%.");
      return;
    }
    
    if (totalBuy > availableCapital + 0.01) {
      alert(`Insufficient funds! You only have $${availableCapital.toFixed(2)} available. Required: $${totalBuy.toFixed(2)}`);
      return;
    }

    setIsSaving(true);
    try {
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
        tp1RR: calculateRR(t1),
        tp1Profit: profit1,
        tp1Percent: t1Pct,
        tp2Percent: t2Pct,
        tp3Percent: t3Pct,
        totalProfitUsd: totalNetProfitUsd,
        totalProfitPkr,
        feeUsd: totalFeeUsd,
        pkrRate: PKR_RATE,
        notes: notes.trim() || undefined,
        createdAt: Date.now(),
        status: status,
      };

      await addDoc(collection(db, 'trades'), trade);
      setSymbol('');
      alert(`Trade saved successfully as ${status}!`);
    } catch (e) {
      console.error("Error saving trade: ", e);
      alert("Failed to save trade.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 pb-20">
      
      <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800 shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-neutral-100 flex items-center gap-2">
              Trade Setup
            </h2>
            <div className="flex gap-1.5 ml-2">
              <Button 
                size="sm" 
                variant="secondary" 
                className="bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 h-7 text-[10px] px-2 flex items-center gap-1"
                onClick={() => handleSuggestTrade('scalp')}
                disabled={isSuggesting !== null}
              >
                {isSuggesting === 'scalp' ? <RefreshCw className="w-3 h-3 animate-spin" /> : "⚡"} Scalp
              </Button>
              <Button 
                size="sm" 
                variant="secondary" 
                className="bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 h-7 text-[10px] px-2 flex items-center gap-1"
                onClick={() => handleSuggestTrade('day')}
                disabled={isSuggesting !== null}
              >
                {isSuggesting === 'day' ? <RefreshCw className="w-3 h-3 animate-spin" /> : "☀️"} Day Trade
              </Button>
              <Button 
                size="sm" 
                variant="secondary" 
                className="bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 h-7 text-[10px] px-2 flex items-center gap-1"
                onClick={() => handleSuggestTrade('swing')}
                disabled={isSuggesting !== null}
              >
                {isSuggesting === 'swing' ? <RefreshCw className="w-3 h-3 animate-spin" /> : "🌊"} Swing
              </Button>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={handleClear} className="h-8 w-8 text-neutral-500 hover:text-red-400" title="Clear Trade Fields">
            <RotateCcw className="w-4 h-4" />
          </Button>
        </div>

        {aiRiskAudit && (
          <div className={`mb-4 p-3 rounded-lg border text-xs flex items-start justify-between gap-2 ${
            aiRiskAudit.status === 'approved'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
          }`}>
            <div className="flex items-start gap-2">
              <span className="text-sm">{aiRiskAudit.status === 'approved' ? '⚡' : '🛡️'}</span>
              <div>
                <span className="font-bold uppercase tracking-wider block mb-0.5 text-[10px]">
                  {aiRiskAudit.status === 'approved' ? 'Institutional Quant Setup Approved' : 'Quantitative Risk Desk Veto'}
                </span>
                <p className="leading-relaxed text-neutral-300">{aiRiskAudit.message}</p>
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

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 relative" ref={dropdownRef}>
            <label className="text-xs text-neutral-400 mb-1 block uppercase font-semibold">Coin Symbol (Binance Spot)</label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-500" />
              <Input 
                placeholder="Search ticker e.g. BTCUSDT" 
                value={symbol} 
                onChange={(e) => {
                  setSymbol(e.target.value.toUpperCase());
                  setShowDropdown(true);
                }} 
                onFocus={() => setShowDropdown(true)}
                className="pl-9"
              />
            </div>
            
            {showDropdown && symbol.length > 0 && filteredSymbols.length > 0 && (
              <ul className="absolute z-10 w-full mt-1 bg-neutral-800 border border-neutral-700 rounded-md shadow-lg max-h-40 overflow-y-auto">
                {filteredSymbols.map(s => (
                  <li 
                    key={s} 
                    className="px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-700 cursor-pointer"
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
            
            {livePrice && (
              <div className="mt-2 flex items-center justify-between bg-neutral-950 p-2 rounded-md border border-neutral-800">
                <div className="text-xs text-neutral-400">
                  Live Price: <span className="font-bold text-emerald-400 ml-1">{formatCurrency(livePrice)}</span>
                </div>
                <button 
                  onClick={() => setEntry(formatPrice(livePrice).toString())}
                  className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-1 rounded border border-blue-500/30 hover:bg-blue-500/30 transition-colors flex items-center gap-1 uppercase font-bold"
                >
                  <RefreshCw className="w-3 h-3" /> Use Live
                </button>
              </div>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-neutral-400 uppercase font-semibold">Total Equity ($)</label>
              {availableCapital > 0 && (
                <span className="text-[10px] text-emerald-400 font-medium" title="Trade-able cash currently available in USDT">
                  Avail: {formatCurrency(availableCapital)}
                </span>
              )}
            </div>
            <Input 
              type="number" 
              value={portfolioSize} 
              onChange={(e) => {
                hasUserEditedEquity.current = true;
                setPortfolioSize(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                }
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
            />
            <div className="flex items-center justify-between mt-1 text-[10px] text-neutral-500">
              <span>Account Bankroll</span>
              {availableCapital > 0 && Math.abs(pSize - availableCapital) > 0.01 && (
                <button 
                  type="button" 
                  onClick={() => {
                    const newVal = availableCapital;
                    const pnl = (totalRealizedPnL || 0);
                    const unrealized = (totalLiveUnrealizedPnL || 0);
                    setBaseCapital(newVal - pnl - unrealized);
                    setPortfolioSize(newVal.toFixed(2));
                    hasUserEditedEquity.current = false;
                    toast.success(`Total equity set to available cash!`);
                  }}
                  className="text-neutral-400 hover:text-emerald-400 transition-colors underline"
                >
                  Use Avail USDT (${availableCapital.toFixed(0)})
                </button>
              )}
            </div>
          </div>
          <div>
            <label className="text-xs text-neutral-400 mb-1 block uppercase font-semibold">Risk %</label>
            <Input type="number" step="0.1" value={riskPercent} onChange={(e) => setRiskPercent(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-neutral-400 mb-1 block uppercase font-semibold">Entry</label>
            <Input type="number" step="0.0001" value={entry} onChange={(e) => setEntry(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-neutral-400 mb-1 flex items-center uppercase font-semibold">Stop Loss {renderPctChange(stop)}</label>
            <Input type="number" step="0.0001" value={sl} onChange={(e) => setSl(e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-neutral-400 mb-1 block uppercase font-semibold">Notes (Optional)</label>
            <textarea 
              value={notes} 
              onChange={(e) => setNotes(e.target.value)} 
              placeholder="Trading strategy, logic, or thoughts..."
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 resize-none h-20"
            />
          </div>
        </div>
      </div>

      <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800 shadow-sm">
        <h2 className="text-lg font-semibold text-neutral-100 mb-4">Targets (Exit Strategy)</h2>
        <div className="space-y-4">
          
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <label className="text-[10px] text-neutral-400 mb-1 flex items-center uppercase font-semibold">TP 1 {renderPctChange(t1)}</label>
              <Input type="number" step="0.0001" value={tp1} onChange={(e) => setTp1(e.target.value)} className="px-2" />
            </div>
            <div className="w-16">
              <label className="text-[10px] text-neutral-400 mb-1 block uppercase font-semibold">Sell %</label>
              <Input type="number" step="1" value={tp1Pct} onChange={(e) => setTp1Pct(e.target.value)} className="px-2 text-center" />
              <div className="text-[9px] text-neutral-500 text-center mt-1 whitespace-nowrap overflow-visible">
                {coins > 0 && t1Pct > 0 ? formatNumber(coins * (t1Pct / 100)) : '\u00A0'}
              </div>
            </div>
            <div className="flex-1 text-right pt-4">
              <Input 
                type="number" 
                className="text-sm font-medium text-emerald-400 h-8 px-2 text-right"
                value={customProfit1 !== '' ? customProfit1 : (profit1 > 0 ? profit1.toFixed(2) : '')}
                onChange={(e) => setCustomProfit1(e.target.value)}
                onBlur={() => {
                  if (customProfit1 !== '') {
                    const p = parseFloat(customProfit1);
                    if (!isNaN(p) && coins > 0 && t1Pct > 0) {
                      const isL = ent > stop;
                      const sC = coins * (t1Pct / 100);
                      const pPC = p / sC;
                      setTp1((isL ? ent + pPC : ent - pPC).toFixed(4));
                    }
                    setCustomProfit1('');
                  }
                }}
              />
              <div className="text-[10px] text-emerald-500/70">{formatPkr(profit1 * PKR_RATE)}</div>
            </div>
            <div className="w-12 text-right pt-4">
              <span className="text-xs font-medium text-blue-400">{calculateRR(t1).toFixed(1)} RR</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex-1">
              <label className="text-[10px] text-neutral-400 mb-1 flex items-center uppercase font-semibold">TP 2 {renderPctChange(t2)}</label>
              <Input type="number" step="0.0001" value={tp2} onChange={(e) => setTp2(e.target.value)} className="px-2" />
            </div>
            <div className="w-16">
              <label className="text-[10px] text-neutral-400 mb-1 block uppercase font-semibold">Sell %</label>
              <Input type="number" step="1" value={tp2Pct} onChange={(e) => setTp2Pct(e.target.value)} className="px-2 text-center" />
              <div className="text-[9px] text-neutral-500 text-center mt-1 whitespace-nowrap overflow-visible">
                {coins > 0 && t2Pct > 0 ? formatNumber(coins * (t2Pct / 100)) : '\u00A0'}
              </div>
            </div>
            <div className="flex-1 text-right pt-4">
              <Input 
                type="number" 
                className="text-sm font-medium text-emerald-400 h-8 px-2 text-right"
                value={customProfit2 !== '' ? customProfit2 : (profit2 > 0 ? profit2.toFixed(2) : '')}
                onChange={(e) => setCustomProfit2(e.target.value)}
                onBlur={() => {
                  if (customProfit2 !== '') {
                    const p = parseFloat(customProfit2);
                    if (!isNaN(p) && coins > 0 && t2Pct > 0) {
                      const isL = ent > stop;
                      const sC = coins * (t2Pct / 100);
                      const pPC = p / sC;
                      setTp2((isL ? ent + pPC : ent - pPC).toFixed(4));
                    }
                    setCustomProfit2('');
                  }
                }}
              />
              <div className="text-[10px] text-emerald-500/70">{formatPkr(profit2 * PKR_RATE)}</div>
            </div>
            <div className="w-12 text-right pt-4">
              <span className="text-xs font-medium text-blue-400">{calculateRR(t2).toFixed(1)} RR</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex-1">
              <label className="text-[10px] text-neutral-400 mb-1 flex items-center uppercase font-semibold">TP 3 {renderPctChange(t3)}</label>
              <Input type="number" step="0.0001" value={tp3} onChange={(e) => setTp3(e.target.value)} className="px-2" />
            </div>
            <div className="w-16">
              <label className="text-[10px] text-neutral-400 mb-1 block uppercase font-semibold">Sell %</label>
              <Input type="number" step="1" value={tp3Pct} onChange={(e) => setTp3Pct(e.target.value)} className="px-2 text-center" />
              <div className="text-[9px] text-neutral-500 text-center mt-1 whitespace-nowrap overflow-visible">
                {coins > 0 && t3Pct > 0 ? formatNumber(coins * (t3Pct / 100)) : '\u00A0'}
              </div>
            </div>
            <div className="flex-1 text-right pt-4">
              <Input 
                type="number" 
                className="text-sm font-medium text-emerald-400 h-8 px-2 text-right"
                value={customProfit3 !== '' ? customProfit3 : (profit3 > 0 ? profit3.toFixed(2) : '')}
                onChange={(e) => setCustomProfit3(e.target.value)}
                onBlur={() => {
                  if (customProfit3 !== '') {
                    const p = parseFloat(customProfit3);
                    if (!isNaN(p) && coins > 0 && t3Pct > 0) {
                      const isL = ent > stop;
                      const sC = coins * (t3Pct / 100);
                      const pPC = p / sC;
                      setTp3((isL ? ent + pPC : ent - pPC).toFixed(4));
                    }
                    setCustomProfit3('');
                  }
                }}
              />
              <div className="text-[10px] text-emerald-500/70">{formatPkr(profit3 * PKR_RATE)}</div>
            </div>
            <div className="w-12 text-right pt-4">
              <span className="text-xs font-medium text-blue-400">{calculateRR(t3).toFixed(1)} RR</span>
            </div>
          </div>
          
        </div>

        {!isPctValid && (
          <div className="mt-4 p-3 rounded-md bg-red-500/10 border border-red-500/20 text-xs text-red-400">
            Total sell percentage must be exactly 100%. Currently: {totalPct}%
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-neutral-800 flex justify-between items-center">
          <div className="flex flex-col">
            <div className="text-sm text-neutral-300 font-semibold">Total Expected Net Profit</div>
            <div className="text-[10px] text-neutral-500 mt-0.5">Est. Fees: {formatCurrency(totalFeeUsd)}</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-emerald-400">{formatCurrency(totalNetProfitUsd)}</div>
            <div className="text-xs text-emerald-500/70">{formatPkr(totalProfitPkr)}</div>
          </div>
        </div>
      </div>

      <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-blue-500"></div>
        <h2 className="text-lg font-semibold text-neutral-100 mb-4 mt-1">Position Sizing</h2>
        
        <div className="grid grid-cols-2 gap-y-6 gap-x-4">
          {isCappedByCash && (
            <div className="col-span-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-300">
              <div className="flex items-center justify-between font-semibold mb-1">
                <span className="flex items-center gap-1.5 text-amber-400 text-xs">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  Capped by Available Spot Cash ({formatCurrency(maxAvailableCash)})
                </span>
                <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                  Spot Limit
                </span>
              </div>
              <p className="text-[11px] text-amber-200/85 leading-relaxed">
                Targeting {rPct}% risk ({formatCurrency(theoreticalRisk)}) required a {formatCurrency(theoreticalBuy)} position size. Because you have {formatCurrency(maxAvailableCash)} free USDT, your buy size is capped at available cash, lowering your actual risk to <span className="font-bold text-amber-300">{formatCurrency(riskAmount)}</span> ({((riskAmount / pSize) * 100).toFixed(2)}% of equity).
              </p>
            </div>
          )}
          <div>
            <div className="text-xs text-neutral-400 uppercase font-semibold mb-1">Risk (Max Loss)</div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 font-bold">$</span>
              <Input 
                type="number"
                className="text-lg font-bold text-red-400 h-10 pl-8 pr-3 bg-neutral-950"
                value={customRiskAmount !== '' ? customRiskAmount : (riskAmount > 0 ? riskAmount.toFixed(2) : '')}
                onChange={(e) => setCustomRiskAmount(e.target.value)}
                onBlur={() => {
                  if (customRiskAmount !== '') {
                    const val = parseFloat(customRiskAmount);
                    if (!isNaN(val) && pSize > 0) {
                      setRiskPercent(((val / pSize) * 100).toFixed(3));
                    }
                    setCustomRiskAmount('');
                  }
                }}
              />
            </div>
            <div className="text-xs text-red-500/70 mt-1">{formatPkr(riskAmount * PKR_RATE)}</div>
          </div>
          
          <div>
            <div className="text-xs text-neutral-400 uppercase font-semibold mb-1">Total Buy Size</div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 font-bold">$</span>
              <Input 
                type="number"
                className="text-lg font-bold text-blue-400 h-10 pl-8 pr-3 bg-neutral-950"
                value={customTotalBuy !== '' ? customTotalBuy : (totalBuy > 0 ? totalBuy.toFixed(2) : '')}
                onChange={(e) => setCustomTotalBuy(e.target.value)}
                onBlur={() => {
                  if (customTotalBuy !== '') {
                    const val = parseFloat(customTotalBuy);
                    if (!isNaN(val) && ent > 0 && pSize > 0) {
                      const c = val / ent;
                      const rp = Math.abs(ent - stop);
                      const newRisk = c * rp;
                      setRiskPercent(((newRisk / pSize) * 100).toFixed(3));
                    }
                    setCustomTotalBuy('');
                  }
                }}
              />
            </div>
            <div className="text-xs text-blue-500/70 mt-1">{formatPkr(totalBuy * PKR_RATE)}</div>
          </div>
          
          <div className="col-span-2 bg-neutral-800/50 rounded-lg p-3 border border-neutral-800">
            <div className="flex justify-between items-center">
              <span className="text-sm text-neutral-300">Position Size (Coins)</span>
              <span className="text-lg font-bold text-neutral-100">{formatNumber(coins)}</span>
            </div>
          </div>

          <div className="col-span-2 pt-4 mt-2 border-t border-neutral-800">
            <div className="text-sm font-semibold text-neutral-300 mb-3">Expected Portfolio Value</div>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-emerald-500/10 rounded-lg p-3 border border-emerald-500/20">
                <div className="text-[10px] text-emerald-500/80 uppercase font-semibold mb-1">If Targets Hit</div>
                <div className="text-lg font-bold text-emerald-400">{formatCurrency(expectedPortfolioWin)}</div>
                <div className="text-xs text-emerald-500/60 mt-1">{formatPkr(expectedPortfolioWin * PKR_RATE)}</div>
              </div>
              <div className="bg-red-500/10 rounded-lg p-3 border border-red-500/20">
                <div className="text-[10px] text-red-500/80 uppercase font-semibold mb-1">If Stop Hit</div>
                <div className="text-lg font-bold text-red-400">{formatCurrency(expectedPortfolioLoss)}</div>
                <div className="text-xs text-red-500/60 mt-1">{formatPkr(expectedPortfolioLoss * PKR_RATE)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <Button 
          onClick={() => handleSave('ACTIVE')} 
          disabled={isSaving || !auth.currentUser || !isPctValid}
          size="lg" 
          className="flex-1 gap-2 shadow-lg shadow-emerald-900/20"
        >
          <Save className="w-5 h-5" />
          {isSaving ? "Saving..." : "Save Active"}
        </Button>
        <Button 
          onClick={() => handleSave('PENDING')} 
          disabled={isSaving || !auth.currentUser || !isPctValid}
          size="lg" 
          variant="outline"
          className="flex-1 gap-2 shadow-lg"
        >
          <Save className="w-5 h-5" />
          {isSaving ? "Saving..." : "Save Limit Order"}
        </Button>
      </div>


    </div>
  );
}

