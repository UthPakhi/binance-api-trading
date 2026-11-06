import React, { useState } from 'react';
import { DisciplineStats, DISCIPLINE_TAGS, formatCurrency } from '../lib/tradeUtils';
import { Brain, ShieldCheck, ChevronDown, ChevronUp } from 'lucide-react';
import { PnlViewMode } from '../types';

interface DisciplineScorecardProps {
  stats: DisciplineStats;
  viewMode?: PnlViewMode;
  privacyMode?: boolean;
}

export function DisciplineScorecard({ stats, viewMode = 'DOLLAR', privacyMode = false }: DisciplineScorecardProps) {
  const [expanded, setExpanded] = useState(false);

  if (stats.taggedCount === 0) {
    return (
      <div className="bg-neutral-950/50 border border-neutral-800/60 rounded-lg px-2.5 py-1.5 text-[11px] text-neutral-400 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Brain className="w-3.5 h-3.5 text-purple-400 shrink-0" />
          <span>
            <strong className="text-neutral-300">Psychology &amp; Discipline:</strong> Tag closed trades to evaluate execution edge vs deviations.
          </span>
        </div>
      </div>
    );
  }

  const { disciplineScore, planned, deviated, byTag } = stats;

  const scoreColor = 
    disciplineScore >= 80 ? 'text-sky-400 border-blue-500/40 bg-blue-950/40' :
    disciplineScore >= 60 ? 'text-amber-400 border-amber-500/40 bg-amber-950/40' :
    'text-slate-300 border-slate-700/50 bg-slate-900';

  const formatPnLValue = (pnl: number, r: number) => {
    if (privacyMode || viewMode === 'ZEN') return '••••••';
    if (viewMode === 'R_MULTIPLE') return `${r >= 0 ? '+' : ''}${r.toFixed(2)}R`;
    if (viewMode === 'PERCENT') {
      const totalDevAndPlan = Math.abs(planned.totalPnL) + Math.abs(deviated.totalPnL);
      const pct = totalDevAndPlan > 0 ? ((pnl / totalDevAndPlan) * 100) : 0;
      return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
    }
    return `${pnl >= 0 ? '+' : ''}${formatCurrency(pnl)}`;
  };

  const deltaPnL = planned.totalPnL - (deviated.count > 0 ? deviated.totalPnL : 0);

  return (
    <div className="bg-neutral-900/60 border border-neutral-800/80 rounded-xl px-3 py-2 shadow-sm flex flex-col gap-2 transition-all">
      {/* Compact Header Bar */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <div className="w-5 h-5 rounded bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0">
            <Brain className="w-3 h-3" />
          </div>
          <span className="text-[11px] font-bold text-neutral-200 uppercase tracking-wider truncate">
            Trading Psychology &amp; Discipline
          </span>
          <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full border shrink-0 ${scoreColor}`}>
            {disciplineScore}% Adherence
          </span>
          
          {/* Subtle inline summary metrics */}
          <div className="hidden xs:flex items-center gap-2 text-[10px] font-mono text-neutral-400 pl-1 border-l border-neutral-800">
            <span className="text-sky-400">🎯 Plan: {formatPnLValue(planned.totalPnL, planned.totalR)} ({planned.winRate}%)</span>
            {deviated.count > 0 && (
              <span className="text-amber-400">⚡ Dev: {formatPnLValue(deviated.totalPnL, deviated.totalR)}</span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-neutral-400 hover:text-neutral-200 text-[11px] flex items-center gap-1 transition-colors px-2 py-0.5 rounded bg-neutral-950/60 hover:bg-neutral-800 border border-neutral-800 shrink-0 select-none"
        >
          <span>{expanded ? 'Less' : 'Details'}</span>
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {/* Expanded Breakdown */}
      {expanded && (
        <div className="flex flex-col gap-2.5 pt-2 border-t border-neutral-800/70 animate-in fade-in duration-150">
          {/* Comparison Split Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {/* Card 1: Executed Per Plan */}
            <div className="bg-neutral-950/70 border border-blue-900/40 rounded-lg p-2.5 flex flex-col justify-between">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-sky-400">
                  <span>🎯</span>
                  <span>Executed per Plan</span>
                </div>
                <span className="text-[10px] font-mono text-neutral-400">
                  {planned.count} {planned.count === 1 ? 'trade' : 'trades'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-neutral-800/60 text-xs font-mono">
                <div>
                  <span className="text-[10px] text-neutral-500 block uppercase font-sans">Win Rate</span>
                  <span className="text-neutral-200 font-bold text-sm">
                    {planned.count > 0 ? `${planned.winRate}%` : 'N/A'}
                  </span>
                  <span className="text-[10px] text-neutral-500 block">
                    ({planned.wins}W / {planned.losses}L)
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-neutral-500 block uppercase font-sans">Realized PnL</span>
                  <span className={`font-bold text-sm ${planned.totalPnL >= 0 ? 'text-sky-400' : 'text-slate-400'}`}>
                    {formatPnLValue(planned.totalPnL, planned.totalR)}
                  </span>
                  {viewMode !== 'R_MULTIPLE' && !privacyMode && viewMode !== 'ZEN' && planned.totalR !== 0 && (
                    <span className="text-[10px] text-neutral-500 block">
                      ({planned.totalR >= 0 ? '+' : ''}{planned.totalR.toFixed(1)}R)
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Card 2: Emotional Deviations */}
            <div className="bg-neutral-950/70 border border-amber-900/40 rounded-lg p-2.5 flex flex-col justify-between">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400">
                  <span>⚡</span>
                  <span>Emotional Deviations</span>
                </div>
                <span className="text-[10px] font-mono text-neutral-400">
                  {deviated.count} {deviated.count === 1 ? 'trade' : 'trades'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-neutral-800/60 text-xs font-mono">
                <div>
                  <span className="text-[10px] text-neutral-500 block uppercase font-sans">Win Rate</span>
                  <span className="text-neutral-200 font-bold text-sm">
                    {deviated.count > 0 ? `${deviated.winRate}%` : '0 deviations'}
                  </span>
                  <span className="text-[10px] text-neutral-500 block">
                    ({deviated.wins}W / {deviated.losses}L)
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-neutral-500 block uppercase font-sans">Realized PnL</span>
                  <span className={`font-bold text-sm ${deviated.totalPnL >= 0 ? 'text-sky-400' : 'text-slate-400'}`}>
                    {formatPnLValue(deviated.totalPnL, deviated.totalR)}
                  </span>
                  {viewMode !== 'R_MULTIPLE' && !privacyMode && viewMode !== 'ZEN' && deviated.totalR !== 0 && (
                    <span className="text-[10px] text-neutral-500 block">
                      ({deviated.totalR >= 0 ? '+' : ''}{deviated.totalR.toFixed(1)}R)
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Behavioral Cost Callout */}
          {planned.count > 0 && deviated.count > 0 && (
            <div className="bg-neutral-950/80 p-2 rounded-lg border border-neutral-800/80 text-[11px] text-neutral-300 flex items-center gap-2">
              <ShieldCheck className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span>
                {deltaPnL >= 0 ? (
                  <>
                    <strong className="text-sky-300">The Edge of Discipline:</strong> Following your plan generated{' '}
                    <strong className="text-sky-400">
                      {privacyMode || viewMode === 'ZEN' ? '••••••' : viewMode === 'PERCENT' ? `+${(planned.totalR - (deviated.totalR || 0)).toFixed(1)}R` : `+$${Math.abs(deltaPnL).toFixed(2)}`}
                    </strong>{' '}
                    more than emotional impulse entries. Sticking to rules is your primary edge.
                  </>
                ) : (
                  <>
                    <strong className="text-amber-300">Behavioral Insight:</strong> Review your recent execution. Refine your entry criteria and stop losses to stay consistent.
                  </>
                )}
              </span>
            </div>
          )}

          {/* Individual Tag Distribution */}
          <div className="pt-1.5 border-t border-neutral-800/70 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {Object.values(DISCIPLINE_TAGS).map(tag => {
              const data = byTag[tag.key];
              if (!data || data.count === 0) return null;
              return (
                <div key={tag.key} className="bg-neutral-950/50 p-1.5 rounded-lg border border-neutral-800/60 text-[10px]">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-semibold text-neutral-300 flex items-center gap-1">
                      <span>{tag.icon}</span>
                      <span>{tag.shortLabel}</span>
                    </span>
                    <span className="font-mono text-neutral-500">{data.count}x</span>
                  </div>
                  <div className="flex items-center justify-between font-mono">
                    <span className="text-neutral-500">{data.wins}W / {data.count - data.wins}L</span>
                    <span className={data.totalPnL >= 0 ? 'text-sky-400' : 'text-slate-400'}>
                      {formatPnLValue(data.totalPnL, data.totalR)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
