import React, { useState, useRef } from 'react';
import { Button } from './Button';
import { X, Copy, Check, Sparkles, Share2, Shield, TrendingUp, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { Trade } from '../types';
import { formatPrice, getTradeIsLong, isAlphaTradeOrSymbol, getTradeCoins, getTradeExitPrice } from '../lib/tradeUtils';

interface SharePnLModalProps {
  trade: Trade;
  livePrice?: number;
  onClose: () => void;
}

export function SharePnLModal({ trade, livePrice, onClose }: SharePnLModalProps) {
  const [copied, setCopied] = useState(false);
  const [hideDollar, setHideDollar] = useState(false);
  const [theme, setTheme] = useState<'blue' | 'cyber' | 'minimal'>('blue');
  const cardRef = useRef<HTMLDivElement>(null);

  const isLong = getTradeIsLong(trade);
  const isAlpha = trade.market === 'ALPHA' || trade.isAlpha || isAlphaTradeOrSymbol(trade);
  const isClosed = Boolean(trade.closedAt || trade.status === 'CLOSED_MANUAL' || trade.status === 'HIT_SL' || trade.status === 'HIT_TP3');

  const currentPrice = isClosed ? (getTradeExitPrice(trade) || trade.entryPrice) : (livePrice || trade.entryPrice);
  const entry = trade.entryPrice || 0;
  
  // Calculate PnL
  let pnlUsd = 0;
  let pnlPercent = 0;
  const coins = getTradeCoins(trade);
  
  if (isClosed && trade.realizedProfitUsd !== undefined) {
    pnlUsd = trade.realizedProfitUsd;
    const invested = trade.totalBuyUsd || (coins * entry);
    pnlPercent = invested > 0 ? (pnlUsd / invested) * 100 : 0;
  } else if (entry > 0 && currentPrice) {
    const diff = isLong ? (currentPrice - entry) : (entry - currentPrice);
    pnlUsd = (coins > 0 ? diff * coins : 0) - (trade.totalFeesUsd || trade.feeUsd || 0);
    pnlPercent = (diff / entry) * 100;
  }

  // R-Multiple
  const riskAmount = trade.riskAmount || (trade.stopLoss && entry ? Math.abs(entry - trade.stopLoss) * coins : 0);
  const rMultiple = riskAmount > 0 ? (pnlUsd / riskAmount).toFixed(2) : null;
  const isWin = pnlUsd >= 0;

  const handleCopyText = async () => {
    const text = `🎯 ${trade.symbol} ${isAlpha ? '[ALPHA]' : ''} ${isLong ? 'LONG' : 'SHORT'}
📈 Result: ${isWin ? '+' : ''}${pnlPercent.toFixed(2)}% ${rMultiple ? `(${rMultiple}R)` : ''}
${hideDollar ? '' : `💰 PnL: ${isWin ? '+' : ''}$${pnlUsd.toFixed(2)}\n`}📍 Entry: $${formatPrice(entry)} ➔ ${isClosed ? 'Exit' : 'Live'}: $${formatPrice(currentPrice)}
⚡ Powered by Trade Sizer`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('Trade card copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <Share2 className="w-4 h-4 text-sky-400" />
            <h3 className="font-bold text-sm text-neutral-100">Share Trading Performance</h3>
          </div>
          <button 
            onClick={onClose}
            className="text-neutral-400 hover:text-white transition-colors p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Controls */}
        <div className="px-5 pt-3 pb-1 flex items-center justify-between text-xs border-b border-neutral-800/60 bg-neutral-950/40">
          <div className="flex items-center gap-2">
            <span className="text-neutral-500 font-medium">Style:</span>
            <div className="flex items-center gap-1 p-0.5 bg-neutral-900 rounded-lg border border-neutral-800">
              <button
                type="button"
                onClick={() => setTheme('blue')}
                className={`px-2 py-1 rounded text-[11px] font-semibold transition-all ${
                  theme === 'blue' ? 'bg-blue-500/20 text-sky-300 border border-blue-500/40' : 'text-neutral-400'
                }`}
              >
                Bull
              </button>
              <button
                type="button"
                onClick={() => setTheme('cyber')}
                className={`px-2 py-1 rounded text-[11px] font-semibold transition-all ${
                  theme === 'cyber' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40' : 'text-neutral-400'
                }`}
              >
                Alpha
              </button>
              <button
                type="button"
                onClick={() => setTheme('minimal')}
                className={`px-2 py-1 rounded text-[11px] font-semibold transition-all ${
                  theme === 'minimal' ? 'bg-neutral-800 text-neutral-200 border border-neutral-700' : 'text-neutral-400'
                }`}
              >
                Dark
              </button>
            </div>
          </div>

          <label className="flex items-center gap-1.5 cursor-pointer text-neutral-400 hover:text-neutral-200 select-none">
            <input
              type="checkbox"
              checked={hideDollar}
              onChange={(e) => setHideDollar(e.target.checked)}
              className="rounded bg-neutral-800 border-neutral-700 text-blue-500 focus:ring-0 w-3.5 h-3.5"
            />
            <span>Hide $ Amount</span>
          </label>
        </div>

        {/* Card Preview */}
        <div className="p-6 flex justify-center bg-neutral-950">
          <div 
            ref={cardRef}
            className={`w-full rounded-2xl p-6 relative overflow-hidden border transition-all ${
              theme === 'cyber'
                ? 'bg-gradient-to-br from-purple-950/80 via-neutral-950 to-blue-950/80 border-purple-800/60 shadow-xl shadow-purple-950/40'
                : theme === 'blue'
                  ? 'bg-gradient-to-br from-blue-950/70 via-neutral-950 to-neutral-900 border-blue-800/60 shadow-xl shadow-blue-950/30'
                  : 'bg-neutral-900 border-neutral-800 shadow-xl'
            }`}
          >
            {/* Top decorative badge */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="font-mono text-lg font-black tracking-tight text-white">
                  {trade.symbol}
                </span>
                <span className={`text-[10px] uppercase font-extrabold px-2 py-0.5 rounded border ${
                  isAlpha 
                    ? 'bg-purple-950/60 text-purple-300 border-purple-700/80' 
                    : 'bg-blue-950/60 text-blue-300 border-blue-700/80'
                }`}>
                  {isAlpha ? 'ALPHA • DEX' : 'SPOT'}
                </span>
                <span className={`text-[10px] uppercase font-extrabold px-2 py-0.5 rounded ${
                  isLong ? 'bg-blue-500/20 text-sky-400' : 'bg-slate-800 text-slate-300'
                }`}>
                  {isLong ? 'LONG' : 'SHORT'}
                </span>
              </div>
              <div className="flex items-center gap-1 text-[11px] text-neutral-400 font-semibold font-mono">
                <Shield className="w-3.5 h-3.5 text-sky-400" />
                <span>VERIFIED</span>
              </div>
            </div>

            {/* Big Gain / Return Display */}
            <div className="my-5 flex flex-col items-start">
              <span className="text-xs text-neutral-400 uppercase font-semibold tracking-wider mb-1">
                {isClosed ? 'Realized Net Return' : 'Live Unrealized Return'}
              </span>
              <div className="flex items-baseline gap-3">
                <span className={`text-4xl sm:text-5xl font-black font-mono tracking-tight ${
                  isWin ? 'text-sky-400' : 'text-slate-300'
                }`}>
                  {isWin ? '+' : ''}{pnlPercent.toFixed(2)}%
                </span>
                {rMultiple && (
                  <span className={`text-sm sm:text-base font-bold font-mono px-2 py-0.5 rounded ${
                    isWin ? 'bg-blue-500/20 text-sky-300' : 'bg-slate-800 text-slate-300'
                  }`}>
                    {isWin ? '+' : ''}{rMultiple}R
                  </span>
                )}
              </div>
              {!hideDollar && (
                <span className={`text-sm font-bold font-mono mt-1 ${isWin ? 'text-sky-400/90' : 'text-slate-300/90'}`}>
                  {isWin ? '+' : ''}${pnlUsd.toFixed(2)} USD
                </span>
              )}
            </div>

            {/* Price Nodes */}
            <div className="grid grid-cols-2 gap-3 pt-4 border-t border-neutral-800/80 text-xs font-mono">
              <div className="bg-neutral-900/60 rounded-lg p-2.5 border border-neutral-800/60">
                <span className="text-[10px] text-neutral-500 uppercase block mb-0.5">Entry Price</span>
                <span className="text-neutral-200 font-bold">${formatPrice(entry, true)}</span>
              </div>
              <div className="bg-neutral-900/60 rounded-lg p-2.5 border border-neutral-800/60">
                <span className="text-[10px] text-neutral-500 uppercase block mb-0.5">
                  {isClosed ? 'Exit Price' : 'Current Price'}
                </span>
                <span className={`font-bold ${isWin ? 'text-sky-400' : 'text-slate-300'}`}>
                  ${formatPrice(currentPrice)}
                </span>
              </div>
            </div>

            {/* Branding Footer */}
            <div className="mt-4 pt-3 flex items-center justify-between text-[10px] text-neutral-500 border-t border-neutral-800/40">
              <span className="flex items-center gap-1 font-semibold text-neutral-400">
                <TrendingUp className="w-3 h-3 text-sky-400" />
                TRADE SIZER TERMINAL
              </span>
              <span>{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            </div>
          </div>
        </div>

        {/* Action Footer */}
        <div className="p-4 border-t border-neutral-800 bg-neutral-950 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} size="sm">
            Close
          </Button>
          <Button 
            onClick={handleCopyText} 
            size="sm" 
            className="bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-1.5"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? 'Copied Card!' : 'Copy Card Text'}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
