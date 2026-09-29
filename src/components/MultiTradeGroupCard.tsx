import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Layers, TrendingUp, Target, Plus, Shield } from 'lucide-react';
import { Trade, PnlViewMode } from '../types';
import { 
  TradeGroupItem, formatPrice, calculateLivePnL, calculateLivePnLPercent, 
  formatCurrencyPrivacy 
} from '../lib/tradeUtils';

interface MultiTradeGroupCardProps {
  key?: React.Key;
  group: TradeGroupItem;
  livePrice?: number;
  privacyMode: boolean;
  viewMode?: PnlViewMode;
  renderChildTradeCard: (trade: Trade) => React.ReactNode;
}

export function MultiTradeGroupCard({
  group,
  livePrice,
  privacyMode,
  viewMode = 'DOLLAR',
  renderChildTradeCard
}: MultiTradeGroupCardProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const { symbol, trades, totalCoins, blendedEntry, totalInvested, totalRisk, isAlpha } = group;

  // Calculate combined live PnL
  let totalLivePnL = 0;
  if (livePrice && livePrice > 0) {
    for (const t of trades) {
      totalLivePnL += calculateLivePnL(t, livePrice);
    }
  }

  const livePnLPct = totalInvested > 0 ? (totalLivePnL / totalInvested) * 100 : 0;
  const isProfit = totalLivePnL >= 0;

  return (
    <div className="bg-neutral-900 border border-neutral-800 hover:border-neutral-700/80 rounded-xl overflow-hidden shadow-sm transition-all">
      {/* Group Summary Header */}
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className="p-3 cursor-pointer select-none bg-neutral-900 hover:bg-neutral-850 transition-colors flex flex-col gap-2.5"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Layers className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-bold text-white font-mono">{symbol}</h3>
                <span className="text-[9px] bg-blue-500/20 text-blue-300 font-semibold px-1.5 py-0.2 rounded border border-blue-500/30">
                  {trades.length} Stacked
                </span>
                {isAlpha && (
                  <span className="text-[9px] bg-purple-500/20 text-purple-300 font-semibold px-1.5 py-0.2 rounded border border-purple-500/30">
                    ALPHA
                  </span>
                )}
              </div>
              <div className="text-[10px] text-neutral-400 font-mono mt-0.5">
                Blended: <strong className="text-neutral-200 font-semibold">{formatPrice(blendedEntry, viewMode !== 'PERCENT')}</strong> · Total: <span className="text-neutral-300">{totalCoins.toLocaleString()} coins</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="text-right flex flex-col items-end">
              <span className="text-[9px] uppercase tracking-wider font-semibold text-neutral-500">
                Combined PnL
              </span>
              <div className={`text-xs sm:text-sm font-bold font-mono flex items-center gap-1 ${
                isProfit ? 'text-sky-400' : 'text-slate-400'
              }`}>
                {privacyMode || viewMode === 'ZEN' ? (
                  <span>••••••</span>
                ) : viewMode === 'R_MULTIPLE' && totalRisk > 0 ? (
                  <>
                    <span>{isProfit ? '+' : ''}{(totalLivePnL / totalRisk).toFixed(2)}R</span>
                    <span className="text-[10px] font-normal opacity-80">
                      ({isProfit ? '+' : ''}{livePnLPct.toFixed(1)}%)
                    </span>
                  </>
                ) : viewMode === 'PERCENT' ? (
                  <span>{isProfit ? '+' : ''}{livePnLPct.toFixed(2)}%</span>
                ) : (
                  <>
                    <span>{isProfit ? '+' : ''}{formatCurrencyPrivacy(totalLivePnL, privacyMode)}</span>
                    <span className="text-[10px] font-normal opacity-80">
                      ({isProfit ? '+' : ''}{livePnLPct.toFixed(1)}%)
                    </span>
                  </>
                )}
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
        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-neutral-800/70 text-[11px] font-mono">
          <div className="bg-neutral-950/60 p-1.5 rounded-md border border-neutral-800/50">
            <span className="text-[9px] text-neutral-500 uppercase block">Invested</span>
            <span className="text-blue-300 font-bold">
              {viewMode === 'PERCENT' ? (totalInvested > 0 ? `${trades.length} Positions` : '0%') : formatCurrencyPrivacy(totalInvested, privacyMode)}
            </span>
          </div>

          <div className="bg-neutral-950/60 p-1.5 rounded-md border border-neutral-800/50">
            <span className="text-[9px] text-neutral-500 uppercase block">Cumulative Risk</span>
            <span className="text-slate-300 font-bold">
              {viewMode === 'PERCENT' ? (trades[0]?.riskPercent ? `${(trades[0].riskPercent * trades.length).toFixed(1)}%` : 'Defined') : formatCurrencyPrivacy(totalRisk, privacyMode)}
            </span>
          </div>

          <div className="bg-neutral-950/60 p-1.5 rounded-md border border-neutral-800/50">
            <span className="text-[9px] text-neutral-500 uppercase block">Market Price</span>
            <span className="text-neutral-200 font-bold">
              {formatPrice(livePrice || blendedEntry, viewMode !== 'PERCENT')}
            </span>
          </div>
        </div>
      </div>

      {/* Expandable Child Trade Cards Container */}
      {isExpanded && (
        <div className="p-2 sm:p-2.5 bg-neutral-950/60 border-t border-neutral-800/70 flex flex-col gap-2">
          <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider flex items-center justify-between px-1">
            <span>Positions ({trades.length})</span>
            <span className="text-neutral-500 lowercase">distinct stop loss &amp; targets</span>
          </div>
          {trades.map((trade, idx) => (
            <div key={trade.id || idx} className="relative pl-1.5 border-l-2 border-blue-500/40">
              {renderChildTradeCard(trade)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
