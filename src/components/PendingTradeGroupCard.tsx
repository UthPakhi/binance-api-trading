import React, { useState } from 'react';
import { ChevronDown, Layers } from 'lucide-react';
import { Trade, PnlViewMode } from '../types';
import { 
  TradeGroupItem, formatPrice, formatCurrencyPrivacy, getTradeIsLong,
  getLimitOrderFillDistancePercent 
} from '../lib/tradeUtils';
import { triggerHaptic } from '../lib/haptics';

interface PendingTradeGroupCardProps {
  key?: React.Key;
  group: TradeGroupItem;
  livePrice?: number;
  privacyMode: boolean;
  viewMode?: PnlViewMode;
  defaultExpanded?: boolean;
  renderChildTradeCard: (trade: Trade) => React.ReactNode;
}

export function PendingTradeGroupCard({
  group,
  livePrice,
  privacyMode,
  viewMode = 'DOLLAR',
  defaultExpanded,
  renderChildTradeCard
}: PendingTradeGroupCardProps) {
  const { symbol, trades, totalCoins, totalInvested } = group;
  // If defaultExpanded is not explicitly provided, collapse groups with many orders to prevent viewport clutter
  const [isExpanded, setIsExpanded] = useState<boolean>(
    defaultExpanded !== undefined ? defaultExpanded : (trades.length <= 2)
  );

  const cp = livePrice || 0;

  // Sort child trades with least % required to fill on top
  const sortedTrades = [...trades].sort((a, b) => {
    const da = getLimitOrderFillDistancePercent(a, cp);
    const db = getLimitOrderFillDistancePercent(b, cp);
    if (da !== db) return da - db;
    return (b.entryPrice || 0) - (a.entryPrice || 0);
  });

  // Find nearest limit order's % to fill among trades in this group (supports both Long and Short orders)
  let nearestFillText = '';
  let nearestFillColor = 'text-neutral-400';
  let minDistancePct = Infinity;

  sortedTrades.forEach(t => {
    const entry = t.entryPrice || 0;
    if (cp > 0 && entry > 0) {
      const isLong = getTradeIsLong(t);
      if (isLong) {
        // For Long: entry is below market price. We wait for price to drop to entry.
        if (cp > entry) {
          const drop = ((cp - entry) / cp) * 100;
          if (drop < minDistancePct) {
            minDistancePct = drop;
            nearestFillText = `-${drop.toFixed(1)}% to fill`;
            nearestFillColor = 'text-slate-400';
          }
        } else {
          // Live price is already at or below entry price
          if (0 < minDistancePct) {
            minDistancePct = 0;
            nearestFillText = 'Fill target reached';
            nearestFillColor = 'text-sky-400';
          }
        }
      } else {
        // For Short: entry is above market price. We wait for price to rally up to entry.
        if (cp < entry) {
          const rally = ((entry - cp) / cp) * 100;
          if (rally < minDistancePct) {
            minDistancePct = rally;
            nearestFillText = `+${rally.toFixed(1)}% to fill`;
            nearestFillColor = 'text-slate-400';
          }
        } else {
          // Live price is already at or above entry price for short
          if (0 < minDistancePct) {
            minDistancePct = 0;
            nearestFillText = 'Fill target reached';
            nearestFillColor = 'text-sky-400';
          }
        }
      }
    }
  });

  return (
    <div className="bg-neutral-900 border border-neutral-800 hover:border-neutral-700/80 rounded-xl overflow-hidden shadow-sm transition-all tabular-nums">
      {/* Group Summary Header */}
      <div 
        onClick={() => {
          triggerHaptic('selection');
          setIsExpanded(!isExpanded);
        }}
        className="p-3 cursor-pointer select-none bg-neutral-900 hover:bg-neutral-850 transition-colors flex flex-col gap-2.5"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-yellow-500/10 border border-yellow-500/30 flex items-center justify-center text-yellow-400">
              <Layers className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-bold text-white font-mono">{symbol}</h3>
                <span className="text-[9px] bg-yellow-500/20 text-yellow-300 font-semibold px-1.5 py-0.2 rounded border border-yellow-500/30 tabular-nums">
                  {trades.length} Limit Orders
                </span>
              </div>
              <div className="text-[10px] text-neutral-400 font-mono tabular-nums mt-0.5">
                Total Size: <strong className="text-neutral-200 font-semibold">{formatCurrencyPrivacy(totalInvested, privacyMode)}</strong> · {totalCoins.toLocaleString()} coins
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="text-right flex flex-col items-end">
              <span className="text-[9px] uppercase tracking-wider font-semibold text-neutral-500 tabular-nums">
                Live: {cp > 0 ? formatPrice(cp, viewMode !== 'PERCENT') : '---'}
              </span>
              <div className={`text-xs sm:text-sm font-bold font-mono tabular-nums flex items-center gap-1 ${nearestFillColor}`}>
                <span>{nearestFillText || 'Pending'}</span>
              </div>
            </div>

            <button
              type="button"
              className="p-1 rounded-md text-neutral-400 hover:text-white bg-neutral-800/60"
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>

        {/* Quick Stack Metric Bar */}
        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-neutral-800/70 text-[11px] font-mono tabular-nums">
          <div className="bg-neutral-950/60 p-1.5 rounded-md border border-neutral-800/50">
            <span className="text-[9px] text-neutral-500 uppercase block">Orders Count</span>
            <span className="text-yellow-300 font-bold">
              {trades.length} Active Limit{trades.length > 1 ? 's' : ''}
            </span>
          </div>

          <div className="bg-neutral-950/60 p-1.5 rounded-md border border-neutral-800/50">
            <span className="text-[9px] text-neutral-500 uppercase block">Total Value</span>
            <span className="text-neutral-200 font-bold">
              {formatCurrencyPrivacy(totalInvested, privacyMode)}
            </span>
          </div>

          <div className="bg-neutral-950/60 p-1.5 rounded-md border border-neutral-800/50">
            <span className="text-[9px] text-neutral-500 uppercase block">Market Price</span>
            <span className="text-neutral-200 font-bold">
              {cp > 0 ? formatPrice(cp, viewMode !== 'PERCENT') : '---'}
            </span>
          </div>
        </div>
      </div>

      {/* Expandable Child Trade Cards Container */}
      {isExpanded && (
        <div className="p-2 sm:p-2.5 bg-neutral-950/60 border-t border-neutral-800/70 flex flex-col gap-2">
          <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider flex items-center justify-between px-1">
            <span>Limit Orders ({trades.length})</span>
            <span className="text-neutral-500 lowercase">expandable target entries</span>
          </div>
          {sortedTrades.map((trade, idx) => (
            <div key={`pending-child-${trade.id || idx}-${idx}`} className="relative pl-1.5 border-l-2 border-yellow-500/40">
              {renderChildTradeCard(trade)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
