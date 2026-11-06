import React, { useState } from 'react';
import { Trade } from '../types';
import { 
  formatPrice, getTradeIsLong, calculateRemainingCoins, 
  getTradeCoins, formatCurrency, formatPkr, formatPartialExitNote 
} from '../lib/tradeUtils';
import { Button } from './Button';
import { Input } from './Input';
import { X, Scissors, Target, Shield, AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useTradeContext } from '../lib/TradeContext';
import toast from 'react-hot-toast';

interface ScaleOutModalProps {
  trade: Trade;
  livePrice?: number;
  pkrRate?: number;
  onClose: () => void;
  onConfirm: (tradeId: string, updates: Partial<Trade>) => Promise<void>;
}

export function ScaleOutModal({
  trade,
  livePrice,
  pkrRate = 283.89,
  onClose,
  onConfirm
}: ScaleOutModalProps) {
  const { effectiveFeeRate } = useTradeContext();
  const feeRate = effectiveFeeRate ?? 0.001;
  const isLong = getTradeIsLong(trade);
  const remainingCoins = calculateRemainingCoins(trade);
  const initialCoins = getTradeCoins(trade);
  const entryPrice = trade.entryPrice || 0;
  const currentMarketPrice = livePrice || entryPrice;

  // Selected percentage (or custom)
  const [selectedPercent, setSelectedPercent] = useState<number>(50);
  const [customCoins, setCustomCoins] = useState<string>((remainingCoins * 0.5).toFixed(4));
  const [exitPriceInput, setExitPriceInput] = useState<string>(formatPrice(currentMarketPrice).toString());
  const [isSubmitting, setIsSubmitting] = useState(false);

  const parsedCoins = parseFloat(customCoins) || 0;
  const parsedPrice = parseFloat(exitPriceInput) || 0;

  // Real-time calculation (net of proportional entry & exit fees)
  const profitPerCoin = isLong ? (parsedPrice - entryPrice) : (entryPrice - parsedPrice);
  const grossBankedProfit = parsedCoins * profitPerCoin;
  const allocatedBuyFee = trade.buyFeeUsd && initialCoins > 0
    ? trade.buyFeeUsd * (parsedCoins / initialCoins)
    : (parsedCoins * entryPrice) * feeRate;
  const exitSellFee = (parsedCoins * parsedPrice) * feeRate;
  const bankedProfit = grossBankedProfit - allocatedBuyFee - exitSellFee;
  const isProfit = bankedProfit >= 0;
  const isLoss = bankedProfit < 0;
  const returnPercent = entryPrice > 0 ? (profitPerCoin / entryPrice) * 100 : 0;

  const newTotalSoldCoins = (trade.soldCoins || 0) + parsedCoins;
  const newTotalRealizedProfit = (trade.realizedProfitUsd || 0) + bankedProfit;
  const coinsLeftAfterExit = Math.max(0, remainingCoins - parsedCoins);
  const isClosingEntirePosition = coinsLeftAfterExit <= 0.0001;

  const handlePercentPreset = (pct: number) => {
    setSelectedPercent(pct);
    const coinsToSell = remainingCoins * (pct / 100);
    setCustomCoins(coinsToSell.toFixed(coinsToSell < 1 ? 6 : 4));
  };

  const handleCoinsChange = (val: string) => {
    setCustomCoins(val);
    const c = parseFloat(val) || 0;
    if (remainingCoins > 0) {
      setSelectedPercent(Math.min(100, Math.round((c / remainingCoins) * 100)));
    }
  };

  const handleSubmit = async () => {
    if (!trade.id) return;
    if (parsedCoins <= 0) {
      toast.error('Please enter a valid amount of coins to exit');
      return;
    }
    if (parsedCoins > remainingCoins * 1.001) {
      toast.error(`Cannot sell more than available remaining coins (${remainingCoins.toLocaleString()} coins)`);
      return;
    }
    if (parsedPrice <= 0) {
      toast.error('Please enter a valid exit price');
      return;
    }

    setIsSubmitting(true);
    try {
      const now = Date.now();
      const exitPct = Math.round((parsedCoins / (initialCoins || remainingCoins)) * 100);
      const noteLine = formatPartialExitNote({
        trade,
        exitPrice: parsedPrice,
        exitCoins: parsedCoins,
        exitPercent: exitPct > 0 ? exitPct : undefined,
        reason: isClosingEntirePosition 
          ? (isProfit ? 'Final Take Profit' : 'Final Loss Cut') 
          : (isProfit ? 'Profit Banked' : 'Loss Cut')
      });

      const updatedNotes = trade.notes ? `${trade.notes}\n${noteLine}` : noteLine;

      const updates: Partial<Trade> = {
        soldCoins: newTotalSoldCoins,
        realizedProfitUsd: newTotalRealizedProfit,
        feeUsd: (trade.feeUsd || 0) + exitSellFee,
        sellFeeUsd: (trade.sellFeeUsd || 0) + exitSellFee,
        totalFeesUsd: (trade.totalFeesUsd || trade.feeUsd || 0) + exitSellFee,
        updatedAt: now,
        notes: updatedNotes
      };

      if (isClosingEntirePosition) {
        updates.status = 'CLOSED_MANUAL';
        updates.closedAt = now;
        updates.exitPrice = parsedPrice;
      } else {
        updates.status = 'PARTIAL_EXIT';
      }

      await onConfirm(trade.id, updates);
      
      if (isProfit) {
        toast.success(`🎯 Profit Banked: +$${bankedProfit.toFixed(2)} on ${trade.symbol}!`);
      } else {
        toast.success(`✂️ Loss Cut: -$${Math.abs(bankedProfit).toFixed(2)} on ${trade.symbol}`);
      }
      onClose();
    } catch (err: any) {
      console.error(err);
      toast.error('Failed to record exit execution');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/60">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              isProfit ? 'bg-blue-500/20 text-blue-400' : 'bg-neutral-800 text-slate-300'
            }`}>
              {isProfit ? <Target className="w-4 h-4" /> : <Scissors className="w-4 h-4" />}
            </div>
            <div>
              <h2 className="text-sm font-bold text-white font-mono flex items-center gap-1.5">
                <span>Scale Out: {trade.symbol}</span>
                <span className={`text-[9px] uppercase font-bold px-1.5 py-0.2 rounded border ${
                  isProfit ? 'bg-blue-950/70 text-blue-300 border-blue-700/80' : 'bg-neutral-800 text-slate-300 border-neutral-700'
                }`}>
                  {isProfit ? 'Bank Profit' : 'Cut Loss'}
                </span>
              </h2>
              <span className="text-[10px] text-neutral-400">
                Entry: ${formatPrice(entryPrice, true)} · Holding: {remainingCoins.toLocaleString()} coins
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-white p-1 rounded-lg hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-4 text-xs font-mono">
          
          {/* Quick % Presets */}
          <div>
            <label className="text-[10px] uppercase font-semibold text-neutral-400 block mb-1.5">
              Select Position to Exit:
            </label>
            <div className="grid grid-cols-5 gap-1.5">
              {[25, 33, 50, 75, 100].map(pct => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => handlePercentPreset(pct)}
                  className={`py-1.5 rounded-lg border text-xs font-bold transition-all ${
                    selectedPercent === pct
                      ? 'bg-blue-600 border-blue-500 text-white shadow-sm'
                      : 'bg-neutral-950/80 border-neutral-800 text-neutral-300 hover:border-neutral-700'
                  }`}
                >
                  {pct === 100 ? '100% (All)' : `${pct}%`}
                </button>
              ))}
            </div>
          </div>

          {/* Amount Inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase font-semibold text-neutral-400 block mb-1">
                Coins to Sell:
              </label>
              <Input
                type="number"
                step="any"
                value={customCoins}
                onChange={(e) => handleCoinsChange(e.target.value)}
                placeholder="Coins"
                className="h-9 bg-neutral-950 font-mono text-xs text-white"
              />
              <span className="text-[9px] text-neutral-500 mt-0.5 block truncate">
                Max: {remainingCoins.toLocaleString()} coins
              </span>
            </div>

            <div>
              <label className="text-[10px] uppercase font-semibold text-neutral-400 block mb-1">
                Exit Price ($ USD):
              </label>
              <Input
                type="number"
                step="any"
                value={exitPriceInput}
                onChange={(e) => setExitPriceInput(e.target.value)}
                placeholder="Price"
                className="h-9 bg-neutral-950 font-mono text-xs text-white"
              />
              <span className="text-[9px] text-neutral-500 mt-0.5 block truncate">
                Live: ${formatPrice(currentMarketPrice, true)}
              </span>
            </div>
          </div>

          {/* Live Outcome Calculation Card */}
          <div className={`p-3.5 rounded-xl border flex flex-col gap-2 ${
            isProfit 
              ? 'bg-blue-950/25 border-blue-800/60' 
              : 'bg-neutral-900 border-neutral-800'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-semibold text-neutral-400">
                {isProfit ? 'Profit Banked at this Price:' : 'Loss Cut at this Price:'}
              </span>
              <span className={`text-[11px] font-bold px-1.5 py-0.2 rounded ${
                isProfit ? 'bg-blue-500/20 text-blue-300' : 'bg-neutral-800 text-slate-300'
              }`}>
                {returnPercent >= 0 ? '+' : ''}{returnPercent.toFixed(1)}% Return
              </span>
            </div>

            <div className="flex items-baseline justify-between">
              <span className={`text-xl font-extrabold font-mono ${
                isProfit ? 'text-blue-300' : 'text-slate-300'
              }`}>
                {isProfit ? `+$${bankedProfit.toFixed(2)} USD` : `-$${Math.abs(bankedProfit).toFixed(2)} USD`}
              </span>
              <span className="text-xs text-neutral-300 font-semibold font-mono">
                {formatPkr(bankedProfit * pkrRate)}
              </span>
            </div>

            <div className="pt-2 border-t border-neutral-800/80 flex items-center justify-between text-[10px] text-neutral-400">
              <span>Remaining after exit:</span>
              <span className="text-white font-bold font-mono">
                {coinsLeftAfterExit <= 0.0001 ? '0 coins (Fully Closed)' : `${coinsLeftAfterExit.toLocaleString(undefined, { maximumFractionDigits: 4 })} coins`}
              </span>
            </div>
          </div>

          {/* Activity Note Preview */}
          <div className="bg-neutral-950 p-2.5 rounded-lg border border-neutral-800/70 text-[11px]">
            <span className="text-[9px] uppercase font-semibold text-neutral-500 block mb-0.5">
              Will Log To Trade Activity Notes:
            </span>
            <span className={isProfit ? 'text-blue-300' : 'text-slate-300'}>
              {formatPartialExitNote({
                trade,
                exitPrice: parsedPrice,
                exitCoins: parsedCoins,
                exitPercent: selectedPercent,
                reason: isClosingEntirePosition ? (isProfit ? 'Final Take Profit' : 'Final Loss Cut') : (isProfit ? 'Profit Banked' : 'Loss Cut')
              })}
            </span>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 h-9 text-xs border-neutral-800 text-neutral-300 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || parsedCoins <= 0 || parsedPrice <= 0}
              className={`flex-1 h-9 text-xs font-bold text-white shadow-lg ${
                isProfit 
                  ? 'bg-blue-600 hover:bg-blue-500 shadow-blue-950/50' 
                  : 'bg-slate-700 hover:bg-slate-600 shadow-neutral-950/50'
              }`}
            >
              {isSubmitting ? 'Recording...' : isProfit ? `Bank +$${bankedProfit.toFixed(2)} Profit` : `Cut -$${Math.abs(bankedProfit).toFixed(2)} Loss`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
