import React, { useState } from 'react';
import { Input } from './Input';
import { Button } from './Button';
import { useTradeContext } from '../lib/TradeContext';
import { X, Save } from 'lucide-react';
import { db } from '../lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { Trade } from '../types';

import { 
  calculatePortfolioStats, formatPrice, formatCurrency, formatPkr, 
  calculateTargetRR, calculateTargetProfit, calculateTargetSellFee,
  isAlphaTradeOrSymbol
} from '../lib/tradeUtils';

export function EditTradeModal({ trade, onClose }: { trade: Trade; onClose: () => void }) {
  const { trades, baseCapital, livePrices, pkrRate } = useTradeContext();
  const { availableCapital, totalEquity } = calculatePortfolioStats(trades, baseCapital, livePrices);
  
  const initialPortfolio = trade.portfolioSize && Math.abs(trade.portfolioSize - baseCapital) > 1
    ? trade.portfolioSize 
    : (totalEquity || baseCapital);

  const initialCoins = trade.positionSizeCoins && trade.positionSizeCoins > 0
    ? trade.positionSizeCoins
    : (trade.totalBuyUsd && trade.entryPrice && trade.entryPrice > 0 ? trade.totalBuyUsd / trade.entryPrice : 0);
  const initialTotalBuy = trade.totalBuyUsd && trade.totalBuyUsd > 0
    ? trade.totalBuyUsd
    : (initialCoins > 0 && trade.entryPrice ? initialCoins * trade.entryPrice : 0);

  const initialRiskPercent = (() => {
    if (trade.riskPercent && trade.riskPercent > 0) return trade.riskPercent.toString();
    if (initialPortfolio > 0 && trade.entryPrice && trade.stopLoss && initialCoins > 0) {
      const rPerCoin = Math.abs(trade.entryPrice - trade.stopLoss);
      const totalR = initialCoins * rPerCoin;
      return ((totalR / initialPortfolio) * 100).toFixed(2);
    }
    return (trade.riskPercent || 0).toString();
  })();

  const [portfolioSize, setPortfolioSize] = useState<string>(initialPortfolio.toString());
  const [riskPercent, setRiskPercent] = useState<string>(initialRiskPercent);
  const [entry, setEntry] = useState<string>(trade.entryPrice ? formatPrice(trade.entryPrice).toString() : '0');
  const [sl, setSl] = useState<string>(trade.stopLoss ? formatPrice(trade.stopLoss).toString() : '0');
  
  const [tp1, setTp1] = useState<string>(trade.takeProfit1 ? formatPrice(trade.takeProfit1).toString() : '0');
  const [tp1Pct, setTp1Pct] = useState<string>((trade.tp1Percent || (trade.takeProfit1 ? 0 : 100)).toString());
  
  const [tp2, setTp2] = useState<string>(trade.takeProfit2 ? formatPrice(trade.takeProfit2).toString() : '0');
  const [tp2Pct, setTp2Pct] = useState<string>((trade.tp2Percent || 0).toString());
  
  const [tp3, setTp3] = useState<string>(trade.takeProfit3 ? formatPrice(trade.takeProfit3).toString() : '0');
  const [tp3Pct, setTp3Pct] = useState<string>((trade.tp3Percent || 0).toString());
  
  const [symbol, setSymbol] = useState<string>(trade.symbol);
  const [status, setStatus] = useState<string>(trade.status || 'ACTIVE');
  const [tradeType, setTradeType] = useState<'TRADE' | 'HOLDING'>(trade.type || 'TRADE');
  const [realizedProfit, setRealizedProfit] = useState<string>((trade.realizedProfitUsd || 0).toString());
  
  const [totalBuyInput, setTotalBuyInput] = useState<string>(initialTotalBuy ? initialTotalBuy.toString() : '0');
  const [coinsInput, setCoinsInput] = useState<string>(initialCoins ? initialCoins.toString() : '0');

  const [isSaving, setIsSaving] = useState(false);

  const PKR_RATE = trade.pkrRate || pkrRate || 283.89;

  const pSize = parseFloat(portfolioSize) || 0;
  const rPct = parseFloat(riskPercent) || 0;
  const ent = parseFloat(entry) || 0;
  const stop = parseFloat(sl) || 0;
  const totalBuy = parseFloat(totalBuyInput) || 0;
  const coins = parseFloat(coinsInput) || 0;
  
  const t1 = parseFloat(tp1) || 0;
  const t1Pct = parseFloat(tp1Pct) || 0;
  const t2 = parseFloat(tp2) || 0;
  const t2Pct = parseFloat(tp2Pct) || 0;
  const t3 = parseFloat(tp3) || 0;
  const t3Pct = parseFloat(tp3Pct) || 0;

  const totalPct = t1Pct + t2Pct + t3Pct;
  const isPctValid = totalPct === 100;

  const riskPerCoin = Math.abs(ent - stop);
  const riskAmount = coins * riskPerCoin;

  const updateRiskFromSize = (c: number, e: number, s: number, p: number) => {
    if (p > 0 && e > 0 && s > 0 && c > 0) {
      const riskPerCoin = Math.abs(e - s);
      const totalRisk = c * riskPerCoin;
      const newRiskPct = (totalRisk / p) * 100;
      setRiskPercent(newRiskPct.toFixed(2));
    } else {
      setRiskPercent('0');
    }
  };

  const handleUsdtChange = (val: string) => {
    setTotalBuyInput(val);
    const tb = parseFloat(val) || 0;
    const e = parseFloat(entry) || 0;
    if (e > 0) {
      const c = (tb * 0.999) / e;
      setCoinsInput(c.toFixed(6));
      updateRiskFromSize(c, e, parseFloat(sl) || 0, parseFloat(portfolioSize) || 0);
    }
  };

  const handleCoinsChange = (val: string) => {
    setCoinsInput(val);
    const c = parseFloat(val) || 0;
    const e = parseFloat(entry) || 0;
    if (e > 0) {
      const tb = (c * e) / 0.999;
      setTotalBuyInput(tb.toFixed(2));
      updateRiskFromSize(c, e, parseFloat(sl) || 0, parseFloat(portfolioSize) || 0);
    }
  };

  const handleEntryChange = (val: string) => {
    setEntry(val);
    updateRiskFromSize(parseFloat(coinsInput) || 0, parseFloat(val) || 0, parseFloat(sl) || 0, parseFloat(portfolioSize) || 0);
  };

  const handleSlChange = (val: string) => {
    setSl(val);
    updateRiskFromSize(parseFloat(coinsInput) || 0, parseFloat(entry) || 0, parseFloat(val) || 0, parseFloat(portfolioSize) || 0);
  };

  const handlePortfolioChange = (val: string) => {
    setPortfolioSize(val);
    updateRiskFromSize(parseFloat(coinsInput) || 0, parseFloat(entry) || 0, parseFloat(sl) || 0, parseFloat(val) || 0);
  };

  const handleRiskChange = (val: string) => {
    setRiskPercent(val);
    const rp = parseFloat(val) || 0;
    const pSize = parseFloat(portfolioSize) || 0;
    const ent = parseFloat(entry) || 0;
    const stop = parseFloat(sl) || 0;
    if (ent > 0 && stop > 0 && pSize > 0) {
      const rAmt = pSize * (rp / 100);
      const rPerC = Math.abs(ent - stop);
      if (rPerC > 0) {
        const c = rAmt / rPerC;
        const tb = c * ent;
        setCoinsInput(c.toFixed(6));
        setTotalBuyInput(tb.toFixed(2));
      }
    }
  };
  
  const FEE_RATE = 0.001;
  const buyFeeUsd = totalBuy * FEE_RATE;

  const profit1 = calculateTargetProfit(ent, stop, t1, coins, t1Pct);
  const profit2 = calculateTargetProfit(ent, stop, t2, coins, t2Pct);
  const profit3 = calculateTargetProfit(ent, stop, t3, coins, t3Pct);

  const sellFee1 = calculateTargetSellFee(t1, coins, t1Pct, FEE_RATE);
  const sellFee2 = calculateTargetSellFee(t2, coins, t2Pct, FEE_RATE);
  const sellFee3 = calculateTargetSellFee(t3, coins, t3Pct, FEE_RATE);

  const totalProfitUsdRaw = profit1 + profit2 + profit3;
  const totalFeeUsd = buyFeeUsd + sellFee1 + sellFee2 + sellFee3;
  const totalNetProfitUsd = totalProfitUsdRaw - totalFeeUsd;
  const totalProfitPkr = totalNetProfitUsd * PKR_RATE;

  const stopSellFeeUsd = (coins * stop) * FEE_RATE;
  const expectedStopFeeUsd = buyFeeUsd + stopSellFeeUsd;


  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newStatus = e.target.value;
    setStatus(newStatus);
    if (newStatus === 'ACTIVE') setRealizedProfit('0');
    else if (newStatus === 'HIT_SL') setRealizedProfit((-riskAmount - expectedStopFeeUsd).toString());
    else if (newStatus === 'HIT_TP1') setRealizedProfit((profit1 - buyFeeUsd - sellFee1).toString());
    else if (newStatus === 'HIT_TP2') setRealizedProfit((profit1 + profit2 - buyFeeUsd - sellFee1 - sellFee2).toString());
    else if (newStatus === 'HIT_TP3') setRealizedProfit((profit1 + profit2 + profit3).toString());
    else if (newStatus === 'TARGET_BREAK_EVEN') {
      setRealizedProfit('0');
      setSl('');
      setTp1(entry);
      setTp1Pct('100');
      setTp2('');
      setTp2Pct('');
      setTp3('');
      setTp3Pct('');
    }
    else if (newStatus === 'CLOSED_BREAK_EVEN') {
      const sellFee = (coins * parseFloat(entry || '0')) * FEE_RATE;
      setRealizedProfit((-buyFeeUsd - sellFee).toString());
    }
  };

  const handleSave = async () => {
    if (coins === 0 || totalBuy === 0) return;
    if (!isPctValid) {
      alert("Total sell percentage must be exactly 100%.");
      return;
    }
    
    // Only check capital limits if trade is still active/pending
    if (status === 'ACTIVE' || status === 'PENDING') {
      const oldTotalBuy = trade.status === 'ACTIVE' || trade.status === 'PENDING' ? (trade.totalBuyUsd || 0) : 0;
      const effectiveAvailable = availableCapital + oldTotalBuy;
      if (totalBuy > effectiveAvailable + 0.01) {
        alert(`Insufficient funds! You only have $${effectiveAvailable.toFixed(2)} available for this trade. Required: $${totalBuy.toFixed(2)}`);
        return;
      }
    }

    setIsSaving(true);
    try {
      let finalStatus = status;
      if (trade.status === 'PENDING') {
        finalStatus = 'PENDING';
      }
      let finalRealized = parseFloat(realizedProfit) || 0;
      if (!t1 && !t2 && !t3 && (status === 'HIT_TP1' || status === 'HIT_TP2' || status === 'HIT_TP3')) {
        finalStatus = 'ACTIVE';
        finalRealized = 0;
      }

      const computedRiskAmount = (stop > 0 && ent > 0 && coins > 0)
        ? coins * Math.abs(ent - stop)
        : riskAmount;
      const computedRiskPercent = rPct > 0
        ? rPct
        : (pSize > 0 && computedRiskAmount > 0 ? parseFloat(((computedRiskAmount / pSize) * 100).toFixed(2)) : 0);

      let updatedNotified = Array.isArray(trade.notifiedMilestones) ? [...trade.notifiedMilestones] : [];
      if (t1 !== trade.takeProfit1) updatedNotified = updatedNotified.filter(m => m !== 'TP1');
      if (t2 !== trade.takeProfit2) updatedNotified = updatedNotified.filter(m => m !== 'TP2');
      if (t3 !== trade.takeProfit3) updatedNotified = updatedNotified.filter(m => m !== 'TP3');
      if (stop !== trade.stopLoss) updatedNotified = updatedNotified.filter(m => m !== 'SL');
      if (ent !== trade.entryPrice) updatedNotified = updatedNotified.filter(m => m !== 'ENTRY');

      const now = Date.now();
      const isAlpha = isAlphaTradeOrSymbol(symbol);
      const updatedTrade: Partial<Trade> = {
        symbol: symbol.trim().toUpperCase(),
        portfolioSize: pSize,
        riskPercent: computedRiskPercent,
        entryPrice: ent,
        stopLoss: stop || null,
        takeProfit1: t1 || null,
        takeProfit2: t2 || null,
        takeProfit3: t3 || null,
        riskAmount: computedRiskAmount,
        positionSizeCoins: coins,
        totalBuyUsd: totalBuy,
        tp1RR: calculateTargetRR(ent, stop, t1),
        tp1Profit: profit1,
        tp1Percent: t1Pct || null,
        tp2Percent: t2Pct || null,
        tp3Percent: t3Pct || null,
        totalProfitUsd: totalNetProfitUsd,
        feeUsd: totalFeeUsd,
        totalProfitPkr,
        status: finalStatus,
        type: tradeType,
        market: trade.market || (isAlpha ? 'ALPHA' : 'SPOT'),
        isAlpha: isAlpha,
        realizedProfitUsd: finalRealized,
        notifiedMilestones: updatedNotified,
        updatedAt: now,
        ...(stop > 0 ? { slUpdatedAt: now } : {}),
        ...(['ACTIVE', 'PARTIAL_EXIT', 'PENDING'].includes(finalStatus) ? { closedAt: null } : {})
      };
      await updateDoc(doc(db, 'trades', trade.id!), updatedTrade);
      onClose();
    } catch (e) {
      console.error(e);
      alert("Failed to update trade.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-neutral-950 overflow-y-auto pb-safe">
      <div className="sticky top-0 bg-neutral-950/90 backdrop-blur-md p-4 border-b border-neutral-900 flex items-center justify-between z-10">
        <h2 className="text-lg font-bold text-white">Edit Trade</h2>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 text-neutral-400">
          <X className="w-5 h-5" />
        </Button>
      </div>
      
      <div className="p-4 flex flex-col gap-6 max-w-md mx-auto">
        <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-100 mb-4">Trade Status & Classification</h2>
          <div className="space-y-4">
            {trade.status === 'PENDING' ? (
              <div>
                <label className="text-xs text-neutral-400 mb-1 block uppercase font-semibold">Order Status</label>
                <div className="flex items-center justify-between px-3 py-2.5 bg-neutral-950 border border-neutral-800 rounded-md text-sm text-amber-400 font-semibold">
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                    Pending (Limit Order on Binance)
                  </span>
                  <span className="text-[11px] text-neutral-400 font-normal">Binance Managed</span>
                </div>
                <p className="text-[11px] text-neutral-400 mt-1">
                  Limit orders cannot be manually activated. This order will automatically activate and merge when filled on Binance.
                </p>
              </div>
            ) : (
              <div>
                <label className="text-xs text-neutral-400 mb-1 block uppercase font-semibold">Current Status</label>
                <select 
                  value={status} 
                  onChange={handleStatusChange}
                  className="flex h-11 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="ACTIVE">Active</option>
                  <option value="HIT_TP1">Hit TP 1</option>
                  <option value="HIT_TP2">Hit TP 2</option>
                  <option value="HIT_TP3">Hit TP 3</option>
                  <option value="HIT_SL">Hit Stop Loss</option>
                  <option value="CLOSED_MANUAL">Closed Manually</option>
                  <option value="TARGET_BREAK_EVEN">Target Break Even</option>
                  <option value="CLOSED_BREAK_EVEN">Hit Break Even</option>
                  <option value="BREAK_EVEN">Closed at Break Even</option>
                </select>
              </div>
            )}
            
            <div>
              <label className="text-xs text-neutral-400 mb-1 block uppercase font-semibold">
                {trade.status === 'PENDING' ? 'Target Category (Upon Fill)' : 'Classification & Category'}
              </label>
              <div className="grid grid-cols-2 gap-1.5 bg-neutral-950 p-1 rounded-lg border border-neutral-800">
                <button
                  type="button"
                  onClick={() => setTradeType('TRADE')}
                  className={`text-xs py-2 px-1 rounded-md font-semibold transition-all text-center ${
                    tradeType === 'TRADE' ? 'bg-blue-600 text-white shadow-sm' : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  ⚡ {trade.status === 'PENDING' ? 'Target: Active Trade' : 'Active Trade'}
                </button>
                <button
                  type="button"
                  onClick={() => setTradeType('HOLDING')}
                  className={`text-xs py-2 px-1 rounded-md font-semibold transition-all text-center ${
                    tradeType === 'HOLDING' ? 'bg-purple-600 text-white shadow-sm' : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  💎 {trade.status === 'PENDING' ? 'Target: Portfolio Holding' : 'Portfolio Holding'}
                </button>
              </div>
              {trade.status === 'PENDING' && (
                <p className="text-[11px] text-neutral-400 mt-1.5">
                  When this limit order activates on Binance, it will route to {tradeType === 'HOLDING' ? 'Portfolio Holdings' : 'Active Trades'} and merge with any running {symbol} position to automatically set the new weighted average entry price.
                </p>
              )}
            </div>

            {status !== 'ACTIVE' && status !== 'PENDING' && status !== 'BREAK_EVEN' && (
              <div>
                <label className="text-xs text-neutral-400 mb-1 block uppercase font-semibold">Realized PnL ($)</label>
                <Input 
                  type="number" 
                  step="0.01" 
                  value={realizedProfit} 
                  onChange={(e) => setRealizedProfit(e.target.value)} 
                />
                <div className="text-xs text-neutral-500 mt-1">
                  {formatPkr((parseFloat(realizedProfit) || 0) * PKR_RATE)}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-100 mb-4">Trade Setup</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="text-xs text-neutral-400 mb-1 block uppercase font-semibold">Symbol</label>
              <Input value={symbol} onChange={(e) => setSymbol(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-neutral-400 mb-1 block uppercase font-semibold">Portfolio Size ($)</label>
              <Input type="number" value={portfolioSize} onChange={(e) => handlePortfolioChange(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-neutral-400 mb-1 block uppercase font-semibold">Risk %</label>
              <Input type="number" step="0.1" value={riskPercent} onChange={(e) => handleRiskChange(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-neutral-400 mb-1 block uppercase font-semibold">Entry</label>
              <Input type="number" step="0.0001" value={entry} onChange={(e) => handleEntryChange(e.target.value)} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-neutral-400 block uppercase font-semibold">Stop Loss</label>
                {entry && parseFloat(entry) > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      handleSlChange(entry);
                    }}
                    className="text-[10px] text-sky-400 hover:text-sky-300 font-medium px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-500/20 transition-colors flex items-center gap-1"
                    title="Set Stop Loss to entry price"
                  >
                    🛡️ Breakeven ({formatPrice(entry)})
                  </button>
                )}
              </div>
              <Input type="number" step="0.0001" value={sl} onChange={(e) => handleSlChange(e.target.value)} />
            </div>
            <div className="col-span-2 grid grid-cols-2 gap-4 mt-2 pt-2 border-t border-neutral-800">
              <div>
                <label className="text-[10px] text-blue-400 mb-1 block uppercase font-semibold">Limit Order (USDT)</label>
                <Input type="number" step="0.01" value={totalBuyInput} onChange={(e) => handleUsdtChange(e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] text-purple-400 mb-1 block uppercase font-semibold">Coins Bought</label>
                <Input type="number" step="0.0001" value={coinsInput} onChange={(e) => handleCoinsChange(e.target.value)} />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-neutral-100">Targets (Exit Strategy)</h2>
            <button
              type="button"
              onClick={() => {
                const count = (tp1 ? 1 : 0) + (tp2 ? 1 : 0) + (tp3 ? 1 : 0);
                if (count === 1) {
                  setTp1Pct('100');
                  setTp2Pct('');
                  setTp3Pct('');
                } else if (count === 2) {
                  setTp1Pct('50');
                  setTp2Pct('50');
                  setTp3Pct('');
                } else if (count === 3) {
                  setTp1Pct('33');
                  setTp2Pct('33');
                  setTp3Pct('34');
                }
              }}
              className="text-[11px] text-sky-400 hover:text-sky-300 font-medium px-2 py-0.5 rounded bg-sky-500/10 border border-sky-500/20 transition-colors"
            >
              ⚖️ Auto-Balance %
            </button>
          </div>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="text-[10px] text-neutral-400 mb-1 block uppercase font-semibold">TP 1</label>
                <Input type="number" step="0.0001" value={tp1} onChange={(e) => setTp1(e.target.value)} className="px-2" />
              </div>
              <div className="w-16">
                <label className="text-[10px] text-neutral-400 mb-1 block uppercase font-semibold">Sell %</label>
                <Input type="number" step="1" value={tp1Pct} onChange={(e) => setTp1Pct(e.target.value)} className="px-2 text-center" />
              </div>
              <div className="flex-1 text-right pt-4">
                <div className="text-sm font-medium text-sky-400">{formatCurrency(profit1)}</div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="text-[10px] text-neutral-400 mb-1 block uppercase font-semibold">TP 2</label>
                <Input type="number" step="0.0001" value={tp2} onChange={(e) => setTp2(e.target.value)} className="px-2" />
              </div>
              <div className="w-16">
                <label className="text-[10px] text-neutral-400 mb-1 block uppercase font-semibold">Sell %</label>
                <Input type="number" step="1" value={tp2Pct} onChange={(e) => setTp2Pct(e.target.value)} className="px-2 text-center" />
              </div>
              <div className="flex-1 text-right pt-4">
                <div className="text-sm font-medium text-sky-400">{formatCurrency(profit2)}</div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="text-[10px] text-neutral-400 mb-1 block uppercase font-semibold">TP 3</label>
                <Input type="number" step="0.0001" value={tp3} onChange={(e) => setTp3(e.target.value)} className="px-2" />
              </div>
              <div className="w-16">
                <label className="text-[10px] text-neutral-400 mb-1 block uppercase font-semibold">Sell %</label>
                <Input type="number" step="1" value={tp3Pct} onChange={(e) => setTp3Pct(e.target.value)} className="px-2 text-center" />
              </div>
              <div className="flex-1 text-right pt-4">
                <div className="text-sm font-medium text-sky-400">{formatCurrency(profit3)}</div>
              </div>
            </div>
          </div>
          {!isPctValid && (
            <div className="mt-4 p-3 rounded-md bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
              Total sell percentage must be exactly 100%.
            </div>
          )}
        </div>

        <Button onClick={handleSave} disabled={isSaving || !isPctValid} size="lg" className="w-full gap-2 mt-2">
          <Save className="w-5 h-5" />
          {isSaving ? "Updating..." : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}
