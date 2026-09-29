import React from 'react';
import { Trade } from '../types';
import { calculateTradeProgress, formatPrice, getTradeIsLong } from '../lib/tradeUtils';

interface TradeProgressBarProps {
  trade: Trade;
  currentPrice?: number;
}

export function TradeProgressBar({ trade, currentPrice }: TradeProgressBarProps) {
  if (!currentPrice || !trade.entryPrice) return null;

  const progress = calculateTradeProgress(trade, currentPrice);
  if (!progress) return null;

  const isLong = getTradeIsLong(trade);
  const { progressPct, status, slDistancePct, tpDistancePct, rMultiple } = progress;

  // Visual status styles
  const isProfit = status === 'in_profit' || status === 'target_hit';
  const isDrawdown = status === 'drawdown' || status === 'stopped';

  return (
    <div className="flex flex-col gap-1.5 w-full bg-neutral-950/80 rounded-xl p-2.5 border border-neutral-800/60 select-none">
      {/* Top Labels: SL vs Entry vs Target */}
      <div className="flex items-center justify-between text-[10px] font-mono">
        <div className="flex items-center gap-1 text-slate-400">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
          <span>SL: ${formatPrice(trade.stopLoss, true)}</span>
          {trade.stopLoss > 0 && (
            <span className="text-[9px] text-neutral-500">(-{slDistancePct.toFixed(1)}%)</span>
          )}
        </div>

        <div className="flex items-center gap-1 text-neutral-300">
          <span className="text-neutral-500">Entry:</span>
          <span>${formatPrice(trade.entryPrice, true)}</span>
        </div>

        <div className="flex items-center gap-1 text-cyan-300 font-medium">
          <span>TP1: ${formatPrice(trade.takeProfit1 || trade.entryPrice * 1.05)}</span>
          {trade.takeProfit1 ? (
            <span className="text-[9px] text-blue-300/80">(+{tpDistancePct.toFixed(1)}%)</span>
          ) : null}
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
        </div>
      </div>

      {/* Progress Track Bar */}
      <div className="relative w-full h-2 bg-neutral-900 rounded-full overflow-visible border border-neutral-800 my-1">
        {/* Entry Marker (50%) */}
        <div 
          className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-neutral-700 z-10 -translate-x-1/2" 
          title="Entry Price"
        />

        {/* Dynamic fill bar */}
        <div 
          className={`h-full rounded-full transition-all duration-300 ${
            isProfit
              ? 'bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-400 shadow-[0_0_8px_rgba(56,189,248,0.35)]'
              : isDrawdown
                ? 'bg-gradient-to-r from-slate-700 to-slate-500'
                : 'bg-gradient-to-r from-blue-900 to-blue-700'
          }`}
          style={{ width: `${Math.max(4, Math.min(100, progressPct))}%` }}
        />

        {/* Live Cursor Pin */}
        <div 
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white border-2 border-neutral-900 shadow-md transition-all duration-300 z-20"
          style={{ left: `${Math.max(2, Math.min(98, progressPct))}%` }}
          title={`Live: $${formatPrice(currentPrice)}`}
        />
      </div>

      {/* Bottom Trailing Status readout */}
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-neutral-500 font-mono">
          Live: <strong className="text-neutral-200">${formatPrice(currentPrice)}</strong>
        </span>

        <div className="flex items-center gap-1.5">
          <span className={`font-mono font-bold px-1.5 py-0.2 rounded text-[10px] ${
            isProfit
              ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
              : isDrawdown
                ? 'bg-neutral-800 text-slate-400 border border-neutral-700'
                : 'bg-neutral-800 text-neutral-300 border border-neutral-700'
          }`}>
            {rMultiple >= 0 ? `+${rMultiple}R` : `${rMultiple}R`}
          </span>

          <span className="text-[10px] text-neutral-400">
            {status === 'in_profit' ? '🔵 Target Trajectory' :
             status === 'target_hit' ? '🎯 Target Hit' :
             status === 'stopped' ? '⏹ Stopped Out' :
             status === 'drawdown' ? '▪ In Drawdown' : '⚪ At Breakeven'}
          </span>
        </div>
      </div>
    </div>
  );
}
