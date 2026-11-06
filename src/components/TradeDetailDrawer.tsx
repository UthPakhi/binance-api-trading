import React from 'react';
import { Button } from './Button';
import { 
  X, Calendar, Clock, DollarSign, Target, Shield, AlertTriangle, 
  Receipt, Share2, Tag, FileText, ExternalLink, ArrowRight, CheckCircle2, Brain, Zap, Scissors 
} from 'lucide-react';
import { Trade, PnlViewMode } from '../types';
import { 
  formatPrice, formatPkr, getTradeIsLong, isAlphaTradeOrSymbol, getTradeCoins, 
  getTradeConsolidatedFees, calculateBlendedBreakeven, DISCIPLINE_TAGS,
  getTradeRiskFramework, calculateNormalizedRMultiple,
  getTradeExitPrice, parseTradeNotesLineByLine, parseStructuredTradeNotes, getTradeExecutionNotes,
  getTradeBankedProfit, calculateRemainingCoins,
  formatBankedProfitDisplay, formatExitPnlDisplay, formatNoteLineForView, formatTradeDuration,
  getTradeCostBasisSummary, getTradeEntryPriceByMethod, getTradeRealizedPnlByMethod
} from '../lib/tradeUtils';
import { dFormat8 } from '../lib/financialMath';
import { useTradeContext } from '../lib/TradeContext';

interface TradeDetailDrawerProps {
  trade: Trade;
  livePrice?: number;
  onClose: () => void;
  onSharePnL: (trade: Trade) => void;
  onReviewDiscipline?: (trade: Trade) => void;
  onApplyStopLoss?: (trade: Trade, stopLoss: number) => Promise<void>;
  viewMode?: PnlViewMode;
}

export function TradeDetailDrawer({ 
  trade, 
  livePrice, 
  onClose, 
  onSharePnL, 
  onReviewDiscipline,
  onApplyStopLoss,
  viewMode = 'DOLLAR'
}: TradeDetailDrawerProps) {
  const isLong = getTradeIsLong(trade);
  const isAlpha = trade.market === 'ALPHA' || trade.isAlpha || isAlphaTradeOrSymbol(trade);
  const isClosed = Boolean(trade.closedAt || trade.status === 'CLOSED_MANUAL' || trade.status === 'HIT_SL' || trade.status === 'HIT_TP3');
  
  const { pkrRate } = useTradeContext();
  const currentPkrRate = isClosed 
    ? ((trade.pkrRate && trade.pkrRate !== 285) ? trade.pkrRate : pkrRate)
    : pkrRate;
  
  const coins = getTradeCoins(trade);
  const activeEntryPrice = getTradeEntryPriceByMethod(trade, 'WAC') || trade.entryPrice || 0;
  const invested = trade.totalBuyUsd || (coins * activeEntryPrice);
  const fees = getTradeConsolidatedFees(trade);
  const beInfo = calculateBlendedBreakeven(trade, 'WAC');
  const framework = getTradeRiskFramework(trade, undefined, 'WAC');
  const bankedInfo = getTradeBankedProfit(trade);
  const remainingCoins = calculateRemainingCoins(trade);

  // Time duration
  const durationStr = formatTradeDuration(trade) || (isClosed ? 'Closed' : 'Active');

  const pnlUsd = getTradeRealizedPnlByMethod(trade, 'WAC', false);
  const pnlExact8Usd = getTradeRealizedPnlByMethod(trade, 'WAC', true);
  const isWin = pnlUsd >= 0;
  const normR = calculateNormalizedRMultiple(pnlExact8Usd, trade, undefined, 'WAC');
  const rMultiple = normR.r.toFixed(2);
  const isNormalizedR = normR.isNormalized;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-neutral-900 border-l border-neutral-800 w-full max-w-lg h-full overflow-y-auto flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
        
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between sticky top-0 bg-neutral-900/95 backdrop-blur z-10">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-lg font-black text-white">{trade.symbol}</span>
            <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${
              isAlpha ? 'bg-purple-950/60 text-purple-300 border-purple-700/80' : 'bg-blue-950/60 text-blue-300 border-blue-700/80'
            }`}>
              {isAlpha ? 'ALPHA' : 'SPOT'}
            </span>
            <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${
              isLong ? 'bg-blue-500/20 text-sky-300' : 'bg-slate-800 text-slate-300'
            }`}>
              {isLong ? 'LONG' : 'SHORT'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onSharePnL(trade)}
              className="text-neutral-400 hover:text-sky-400 h-8 w-8"
              title="Share PnL Card"
            >
              <Share2 className="w-4 h-4" />
            </Button>
            <button
              onClick={onClose}
              className="text-neutral-400 hover:text-white p-1 rounded-lg hover:bg-neutral-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 flex flex-col gap-6 flex-1">
          
          {/* Result Banner if Closed */}
          {isClosed && (
            <div className={`p-4 rounded-xl border flex items-center justify-between ${
              isWin 
                ? 'bg-blue-950/40 border-blue-800/60 text-sky-300' 
                : 'bg-slate-900 border-slate-700/60 text-slate-300'
            }`}>
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-base ${
                  isWin ? 'bg-blue-500/20 text-sky-300' : 'bg-slate-800 text-slate-300'
                }`}>
                  {isWin ? '✓' : '✕'}
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wider font-semibold opacity-80 block">
                    Realized Net Result
                  </span>
                  <div className="text-xl font-bold font-mono flex items-center gap-1.5 flex-wrap">
                    <span>
                      {viewMode === 'PERCENT'
                        ? `${isWin ? '+' : ''}${trade.entryPrice && trade.exitPrice ? (((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * (isLong ? 100 : -100)).toFixed(2) : 0}%`
                        : `${isWin ? '+' : ''}$${pnlUsd.toFixed(2)} USD`}
                    </span>
                    {viewMode !== 'PERCENT' && (
                      <span className="text-sm font-semibold font-mono text-neutral-300">
                        ({formatPkr(pnlUsd * currentPkrRate)})
                      </span>
                    )}
                    {rMultiple && (
                      <span className={`text-xs px-2 py-0.5 rounded font-bold ${
                        isWin ? 'bg-blue-500/20 text-sky-300 border border-blue-500/30' : 'bg-slate-800/60 text-slate-300 border border-slate-700/50'
                      }`} title={normR.note}>
                        {isWin ? '+' : ''}{rMultiple}R{isNormalizedR ? '*' : ''}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <span className="text-[10px] uppercase tracking-wider font-semibold opacity-80 block">Duration</span>
                <span className="font-mono font-bold text-sm text-neutral-200">{durationStr}</span>
              </div>
            </div>
          )}

          {/* Trading Psychology & Discipline Audit */}
          {isClosed && (
            <div className="flex flex-col gap-2">
              <span className="text-xs uppercase font-semibold text-neutral-400 tracking-wider flex items-center gap-1.5">
                <Brain className="w-3.5 h-3.5 text-purple-400" />
                Execution Psychology &amp; Discipline
              </span>
              <div className="bg-neutral-950 p-3.5 rounded-xl border border-neutral-800 flex flex-col gap-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-neutral-500">Execution Tag:</span>
                  {trade.disciplineTag && DISCIPLINE_TAGS[trade.disciplineTag] ? (
                    <span className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold flex items-center gap-1 ${
                      DISCIPLINE_TAGS[trade.disciplineTag].badgeClass
                    }`}>
                      <span>{DISCIPLINE_TAGS[trade.disciplineTag].icon}</span>
                      <span>{DISCIPLINE_TAGS[trade.disciplineTag].label}</span>
                    </span>
                  ) : (
                    <span className="text-neutral-500 italic">Not tagged</span>
                  )}
                </div>

                {trade.disciplineNotes && (
                  <div className="pt-2 border-t border-neutral-800/80">
                    <span className="text-[10px] text-neutral-500 uppercase font-semibold block mb-1">Trader Reflection:</span>
                    <p className="text-neutral-300 italic bg-neutral-900/60 p-2.5 rounded-lg border border-neutral-800/60">
                      "{trade.disciplineNotes}"
                    </p>
                  </div>
                )}

                {onReviewDiscipline && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onReviewDiscipline(trade)}
                    className="mt-1 h-7 text-xs text-purple-300 border-purple-800/60 hover:bg-purple-950/40 w-full justify-center"
                  >
                    <Brain className="w-3 h-3 mr-1.5 text-purple-400" />
                    {trade.disciplineTag ? 'Edit Discipline Tag & Reflection' : 'Tag Execution Psychology'}
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Pricing & Execution Audit */}
          <div className="flex flex-col gap-2">
            <span className="text-xs uppercase font-semibold text-neutral-400 tracking-wider flex items-center gap-1.5">
              <Target className="w-3.5 h-3.5 text-blue-400" />
              Execution &amp; Key Levels
            </span>
            <div className="grid grid-cols-2 gap-2 bg-neutral-950 p-3.5 rounded-xl border border-neutral-800 text-xs font-mono">
              <div>
                <span className="text-neutral-500 block mb-0.5 text-[11px]">Entry Price:</span>
                <span className="text-white font-bold">{formatPrice(trade.entryPrice, viewMode !== 'PERCENT')}</span>
              </div>
              <div>
                <span className="text-neutral-500 block mb-0.5 text-[11px]">
                  {isClosed ? 'Exit Price:' : 'Live Price:'}
                </span>
                <span className="text-blue-300 font-bold">
                  {formatPrice(isClosed ? (getTradeExitPrice(trade) || trade.entryPrice) : (livePrice || trade.entryPrice), viewMode !== 'PERCENT')}
                </span>
              </div>
              <div>
                <span className="text-neutral-500 block mb-0.5 text-[11px]">Stop Loss:</span>
                <span className="text-slate-300 font-bold">
                  {trade.stopLoss ? formatPrice(trade.stopLoss, viewMode !== 'PERCENT') : 'None'}
                </span>
              </div>
              <div>
                <span className="text-neutral-500 block mb-0.5 text-[11px]">Take Profit 1:</span>
                <span className="text-cyan-300 font-bold">
                  {trade.takeProfit1 ? formatPrice(trade.takeProfit1, viewMode !== 'PERCENT') : 'None'}
                </span>
              </div>
            </div>
          </div>

          {/* Risk & Position Summary */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase font-semibold text-neutral-400 tracking-wider flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-blue-400" />
                Risk &amp; Position Summary
              </span>
              {framework.isUnprotected ? (
                <span className="text-[10px] font-bold text-amber-400 bg-amber-950/60 border border-amber-800/80 px-2 py-0.5 rounded flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 text-amber-400" />
                  No Stop Loss
                </span>
              ) : framework.isBreakeven ? (
                <span className="text-[10px] font-bold text-sky-400 bg-sky-950/60 border border-sky-800/80 px-2 py-0.5 rounded flex items-center gap-1">
                  <Shield className="w-3 h-3 text-sky-400" />
                  Breakeven Protected
                </span>
              ) : (
                <span className="text-[10px] font-bold text-blue-400 bg-blue-950/60 border border-blue-800/80 px-2 py-0.5 rounded flex items-center gap-1">
                  <Shield className="w-3 h-3 text-blue-400" />
                  Stop Loss Active
                </span>
              )}
            </div>

            <div className="bg-neutral-950 p-3.5 rounded-xl border border-neutral-800 flex flex-col gap-3 text-xs">
              {/* Core Risk Metrics Grid */}
              <div className="grid grid-cols-2 gap-3 font-mono">
                <div>
                  <span className="text-neutral-500 block mb-0.5 text-[11px]">
                    {framework.isUnprotected ? 'Max Capital at Risk:' : 'Hard Stop Risk:'}
                  </span>
                  <span className={`font-bold ${framework.isUnprotected ? 'text-amber-400' : 'text-slate-300'}`}>
                    ${framework.isUnprotected ? framework.maxDownsideExposure.toFixed(2) : framework.effectiveRiskAmount.toFixed(2)}
                  </span>
                  <span className="text-[10px] text-neutral-500 block">
                    {framework.isUnprotected ? (
                      '100% position exposure'
                    ) : (
                      (() => {
                        const riskR = framework.portfolioRiskUnit > 0 ? (framework.effectiveRiskAmount / framework.portfolioRiskUnit) : 1;
                        const rFormatted = riskR >= 10 ? riskR.toFixed(1) : riskR.toFixed(2);
                        return `-${rFormatted}R equity risk`;
                      })()
                    )}
                  </span>
                </div>

                <div>
                  <span className="text-neutral-500 block mb-0.5 text-[11px]">Framework 1R Unit:</span>
                  <span className="text-neutral-200 font-bold">
                    ${framework.portfolioRiskUnit.toFixed(2)}
                  </span>
                  <span className="text-[10px] text-neutral-500 block">
                    1.0% equity benchmark
                  </span>
                </div>

                <div>
                  <span className="text-neutral-500 block mb-0.5 text-[11px]">Target R:R Ratio:</span>
                  <span className="text-sky-400 font-bold">
                    {framework.impliedRiskReward ? `1:${framework.impliedRiskReward}` : (trade.tp1RR ? `1:${trade.tp1RR.toFixed(2)}` : 'N/A')}
                  </span>
                  <span className="text-[10px] text-neutral-500 block">
                    {trade.takeProfit1 ? `Target: $${formatPrice(trade.takeProfit1)}` : 'No target defined'}
                  </span>
                </div>

                <div>
                  <span className="text-neutral-500 block mb-0.5 text-[11px]">Position Coins / Capital:</span>
                  <span className="text-neutral-300 font-bold">
                    {coins.toLocaleString()} coins
                  </span>
                  <span className="text-[10px] text-neutral-500 block">
                    Invested: ${invested.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* No-SL Framework Action Panel */}
              {framework.isUnprotected && !isClosed && (
                <div className="pt-2.5 border-t border-neutral-800/80 flex flex-col gap-2">
                  <div className="flex items-center gap-1.5 text-amber-300 text-[11px] font-semibold">
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    <span>Recommended Benchmark Protection</span>
                  </div>
                  <p className="text-[11px] text-neutral-400 leading-relaxed">
                    This position currently lacks a Stop Loss order. Apply a recommended benchmark stop below to eliminate uncapped downside risk and establish a clean 1R unit:
                  </p>

                  <div className="flex items-center gap-2 flex-wrap pt-1">
                    {framework.impliedStopLoss && onApplyStopLoss && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onApplyStopLoss(trade, framework.impliedStopLoss!)}
                        className="h-7 text-xs font-semibold text-sky-300 border-sky-700/70 bg-sky-950/40 hover:bg-sky-900/60"
                        title="Sets stop loss based on 1:2 Risk/Reward target"
                      >
                        <Shield className="w-3 h-3 mr-1 text-sky-400" />
                        Apply 1:2 SL (${formatPrice(framework.impliedStopLoss)})
                      </Button>
                    )}

                    {framework.recommendedStops && onApplyStopLoss && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onApplyStopLoss(trade, framework.recommendedStops!.balanced)}
                          className="h-7 text-xs font-semibold text-blue-300 border-blue-800/70 bg-blue-950/40 hover:bg-blue-900/60"
                          title="Sets a standard 5% technical stop"
                        >
                          Apply -5% SL (${formatPrice(framework.recommendedStops!.balanced)})
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onApplyStopLoss(trade, framework.recommendedStops!.conservative)}
                          className="h-7 text-xs text-neutral-400 border-neutral-800 hover:text-white"
                          title="Sets a conservative 3% stop"
                        >
                          -3% SL (${formatPrice(framework.recommendedStops!.conservative)})
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Scaled Out Along The Way / Profit Banked / Loss Cut Card */}
          {(bankedInfo.hasBankedProfit || bankedInfo.hasLossCut) && (
            <div className="flex flex-col gap-2">
              <span className="text-xs uppercase font-semibold text-neutral-400 tracking-wider flex items-center gap-1.5">
                {bankedInfo.hasBankedProfit ? <Target className="w-3.5 h-3.5 text-blue-400" /> : <Scissors className="w-3.5 h-3.5 text-slate-400" />}
                {bankedInfo.hasBankedProfit ? 'Profit Banked Along The Way' : 'Loss Cut Along The Way'}
              </span>
              <div className={`p-3.5 rounded-xl border flex flex-col gap-2 font-mono text-xs ${
                bankedInfo.hasBankedProfit ? 'bg-blue-950/30 border-blue-800/60' : 'bg-neutral-900 border-neutral-700/60'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="text-neutral-400">Total Banked:</span>
                  <span className={`text-base font-bold ${bankedInfo.hasBankedProfit ? 'text-blue-300' : 'text-slate-300'}`}>
                    {formatBankedProfitDisplay(trade, bankedInfo, viewMode, trade.portfolioSize)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-neutral-400 text-[11px]">
                  <span>Coins Sold:</span>
                  <span className="text-white font-semibold">
                    {(trade.soldCoins || 0).toLocaleString()} coins ({bankedInfo.soldPercent}%)
                  </span>
                </div>
                {!isClosed && (
                  <div className="flex items-center justify-between text-neutral-400 text-[11px]">
                    <span>Remaining Held:</span>
                    <span className="text-blue-300 font-semibold">
                      {remainingCoins.toLocaleString()} coins ({Math.max(0, 100 - bankedInfo.soldPercent)}%)
                    </span>
                  </div>
                )}
                {viewMode !== 'PERCENT' && (
                  <div className="flex items-center justify-between text-neutral-400 text-[11px] pt-1.5 border-t border-neutral-800/80">
                    <span>PKR Equivalent:</span>
                    <span className="text-neutral-200">
                      {formatPkr(bankedInfo.bankedAmountUsd * currentPkrRate)}
                    </span>
                  </div>
                )}
                {bankedInfo.exits && bankedInfo.exits.length > 0 && (
                  <div className="pt-2 border-t border-neutral-800/80 flex flex-col gap-1.5">
                    <span className="text-[10px] uppercase font-semibold text-neutral-400">Exits at each price:</span>
                    <div className="grid grid-cols-1 gap-1">
                      {bankedInfo.exits.map((ex, exIdx) => {
                        const isProf = (ex.profitUsd || 0) >= 0;
                        return (
                          <div 
                            key={exIdx} 
                            className={`p-2 rounded-lg border flex items-center justify-between text-[11px] ${
                              isProf ? 'bg-blue-950/40 border-blue-500/30 text-blue-200' : 'bg-neutral-900 border-neutral-700/60 text-slate-300'
                            }`}
                          >
                            <div className="flex items-center gap-1.5">
                              <span>{isProf ? '🎯' : '✂️'}</span>
                              <span className="font-bold">@{formatPrice(ex.price || 0, viewMode !== 'PERCENT')}</span>
                              {ex.coins && (
                                <span className="text-neutral-400 text-[10px]">
                                  ({ex.coins.toLocaleString()} coins)
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 font-bold">
                              <span>{formatExitPnlDisplay(ex, viewMode, trade.entryPrice)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Fee Drag & Breakeven */}
          <div className="flex flex-col gap-2">
            <span className="text-xs uppercase font-semibold text-neutral-400 tracking-wider flex items-center gap-1.5">
              <Receipt className="w-3.5 h-3.5 text-amber-400" />
              Fees &amp; Profit Breakdown
            </span>
            <div className="bg-neutral-950 p-3.5 rounded-xl border border-neutral-800 flex flex-col gap-2 text-xs font-mono">
              {isClosed && (
                <div className="flex justify-between items-center text-neutral-400">
                  <span>Gross Profit (Excl. Fees):</span>
                  <span className="text-neutral-200 font-bold">
                    {(() => {
                      const gross = (trade.exitPrice && trade.entryPrice && coins > 0)
                        ? (isLong ? (trade.exitPrice - trade.entryPrice) * coins : (trade.entryPrice - trade.exitPrice) * coins)
                        : (pnlUsd + fees.totalFees);
                      return `${gross >= 0 ? '+' : ''}$${gross.toFixed(2)} USD`;
                    })()}
                  </span>
                </div>
              )}
              {trade.buyFeeUsd !== undefined && trade.buyFeeUsd > 0 && (
                <div className="flex justify-between items-center text-neutral-400 text-[11px]">
                  <span>Buy Execution Fee:</span>
                  <span className="text-amber-400 font-medium">-${trade.buyFeeUsd.toFixed(4)} USD</span>
                </div>
              )}
              {trade.sellFeeUsd !== undefined && trade.sellFeeUsd > 0 && (
                <div className="flex justify-between items-center text-neutral-400 text-[11px]">
                  <span>Sell Execution Fee:</span>
                  <span className="text-amber-400 font-medium">-${trade.sellFeeUsd.toFixed(4)} USD</span>
                </div>
              )}
              <div className="flex justify-between items-center text-neutral-400">
                <span>Total Exchange Fees Paid:</span>
                <span className="text-amber-400 font-bold">-${fees.totalFees.toFixed(4)} USD</span>
              </div>
              {isClosed && (
                <div className="flex justify-between items-center pt-2 border-t border-neutral-800/80 text-neutral-300">
                  <span className="font-semibold text-white">Net Profit (Profit minus Fees):</span>
                  <span className={`font-bold ${pnlUsd >= 0 ? 'text-sky-400' : 'text-slate-400'}`}>
                    {pnlUsd >= 0 ? '+' : ''}${pnlUsd.toFixed(2)} USD
                  </span>
                </div>
              )}
              {beInfo.blendedBreakeven !== null && !isClosed && (
                <div className="flex justify-between items-center pt-2 border-t border-neutral-800/80 text-neutral-400">
                  <span>Dynamic Breakeven Level:</span>
                  <span className="text-sky-300 font-bold">${formatPrice(beInfo.blendedBreakeven, true)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Timestamps & Order IDs */}
          <div className="flex flex-col gap-2">
            <span className="text-xs uppercase font-semibold text-neutral-400 tracking-wider flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-neutral-400" />
              Timeline &amp; Exchange IDs
            </span>
            <div className="bg-neutral-950 p-3.5 rounded-xl border border-neutral-800 flex flex-col gap-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-neutral-500">Created At:</span>
                <span className="text-neutral-300 font-mono">
                  {new Date(trade.createdAt).toLocaleString()}
                </span>
              </div>
              {trade.filledAt && (
                <div className="flex justify-between items-center">
                  <span className="text-neutral-500">Execution Fill:</span>
                  <span className="text-blue-300 font-mono">
                    {new Date(trade.filledAt).toLocaleString()}
                  </span>
                </div>
              )}
              {trade.closedAt && (
                <div className="flex justify-between items-center">
                  <span className="text-neutral-500">Closed At:</span>
                  <span className="text-neutral-300 font-mono">
                    {new Date(trade.closedAt).toLocaleString()}
                  </span>
                </div>
              )}
              {trade.binanceOrderId && (
                <div className="flex justify-between items-center pt-2 border-t border-neutral-800">
                  <span className="text-neutral-500">Order Reference:</span>
                  <span className="text-neutral-400 font-mono">#{trade.binanceOrderId}</span>
                </div>
              )}
            </div>
          </div>

          {/* Subtle Buy & Sell Level Notes */}
          {(() => {
            const items = getTradeExecutionNotes(trade);

            if (items.length === 0) return null;

            return (
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] uppercase font-medium text-neutral-500 tracking-wider flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-neutral-400" />
                    Trade Notes (Buys &amp; Sells)
                  </span>
                  {(bankedInfo.hasBankedProfit || bankedInfo.hasLossCut) && (
                    <span className={`text-[10px] font-medium font-mono px-1.5 py-0.2 rounded ${
                      bankedInfo.hasBankedProfit ? 'bg-blue-500/15 text-blue-300' : 'bg-neutral-800 text-slate-300 border border-neutral-700'
                    }`}>
                      {bankedInfo.hasBankedProfit 
                        ? `${formatBankedProfitDisplay(trade, bankedInfo, viewMode, trade.portfolioSize)} Banked` 
                        : `${formatBankedProfitDisplay(trade, bankedInfo, viewMode, trade.portfolioSize)} Loss Cut`}
                    </span>
                  )}
                </span>
                <div className="bg-neutral-950/60 px-3 py-2 rounded-xl border border-neutral-800/60 text-[11px] flex flex-col gap-1 font-mono">
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
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-neutral-800 bg-neutral-950 flex items-center justify-between">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => onSharePnL(trade)}
            className="flex items-center gap-1.5 text-blue-300 border-blue-800/60 hover:bg-blue-950/40"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Share Trade Card</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
