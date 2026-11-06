import React from 'react';
import { Calendar, X, List, Layers } from 'lucide-react';
import { PnlViewMode } from '../types';
import { DayGroupStats, DateRangeSummary, formatDayDisplay, getLocalDateKey } from '../lib/dayStatsUtils';
import { formatCurrency, formatPkr } from '../lib/tradeUtils';

interface ClosedTradesDayAnalyticsProps {
  days: DayGroupStats[];
  summary: DateRangeSummary;
  datePreset: string;
  onSelectDatePreset: (preset: string) => void;
  startDate: string;
  onStartDateChange: (d: string) => void;
  endDate: string;
  onEndDateChange: (d: string) => void;
  selectedDay: string | null;
  onSelectDay: (dayKey: string | null) => void;
  viewGrouping: 'BY_DAY' | 'FLAT';
  onViewGroupingChange: (mode: 'BY_DAY' | 'FLAT') => void;
  viewMode: PnlViewMode;
  pkrRate: number;
  totalClosedCount: number;
}

export const ClosedTradesDayAnalytics: React.FC<ClosedTradesDayAnalyticsProps> = React.memo(({
  days,
  summary,
  datePreset,
  onSelectDatePreset,
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
  selectedDay,
  onSelectDay,
  viewGrouping,
  onViewGroupingChange,
  viewMode,
  pkrRate,
  totalClosedCount
}) => {
  const isCustomActive = datePreset === 'CUSTOM' || Boolean(startDate || endDate);

  const presets = [
    { id: 'ALL', label: `All (${totalClosedCount})` },
    { id: 'TODAY', label: 'Today' },
    { id: 'YESTERDAY', label: 'Yesterday' },
    { id: '7D', label: '7D' },
    { id: '30D', label: '30D' },
    { id: 'CUSTOM', label: 'Custom' },
  ];

  const handlePresetClick = (presetId: string) => {
    onSelectDatePreset(presetId);
    if (presetId !== 'CUSTOM') {
      onStartDateChange('');
      onEndDateChange('');
    }
  };

  const handleSetToLatest = () => {
    const todayStr = getLocalDateKey(Date.now());
    onEndDateChange(todayStr);
    onSelectDatePreset('CUSTOM');
  };

  const handleClearCustomRange = () => {
    onStartDateChange('');
    onEndDateChange('');
    onSelectDatePreset('ALL');
    onSelectDay(null);
  };

  const selectedDayMeta = selectedDay ? formatDayDisplay(selectedDay) : null;
  const selectedDayData = selectedDay ? days.find(d => d.dateKey === selectedDay) : null;

  return (
    <div className="flex flex-col gap-2 mb-3">
      {/* 1. Sleek Filter Toolbar */}
      <div className="bg-neutral-900/60 border border-neutral-800/80 rounded-xl p-2.5 flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Quick Preset Chips */}
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none py-0.5">
            {presets.map(p => {
              const isActive = (datePreset === p.id || (p.id === 'CUSTOM' && isCustomActive)) && !selectedDay;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handlePresetClick(p.id)}
                  className={`text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors select-none shrink-0 ${
                    isActive
                      ? 'bg-neutral-800 text-white font-semibold border border-neutral-700 shadow-sm'
                      : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* Sleek View Switcher */}
          <div className="flex items-center bg-neutral-950/70 border border-neutral-800/80 rounded-lg p-0.5 shrink-0">
            <button
              type="button"
              onClick={() => onViewGroupingChange('BY_DAY')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                viewGrouping === 'BY_DAY'
                  ? 'bg-neutral-800 text-neutral-100 shadow-xs'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
              title="Group trades under daily summaries"
            >
              <Calendar className="w-3 h-3 text-blue-400/90" />
              <span>By Day</span>
            </button>
            <button
              type="button"
              onClick={() => onViewGroupingChange('FLAT')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                viewGrouping === 'FLAT'
                  ? 'bg-neutral-800 text-neutral-100 shadow-xs'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
              title="View all closed trades in single list"
            >
              <List className="w-3 h-3 text-sky-400/90" />
              <span>List</span>
            </button>
          </div>
        </div>

        {/* Custom Date Range (Clean & Inline) */}
        {isCustomActive && (
          <div className="pt-2 border-t border-neutral-800/60 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-[11px] text-neutral-400 font-medium flex items-center gap-1 shrink-0">
              <Calendar className="w-3 h-3 text-neutral-400" />
              Range:
            </span>

            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] text-neutral-500 font-mono">From</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  onStartDateChange(e.target.value);
                  onSelectDatePreset('CUSTOM');
                }}
                className="bg-neutral-950 border border-neutral-800 text-neutral-200 text-xs rounded px-2 py-0.5 focus:outline-none focus:border-neutral-600 font-mono"
              />
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] text-neutral-500 font-mono">To</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  onEndDateChange(e.target.value);
                  onSelectDatePreset('CUSTOM');
                }}
                className="bg-neutral-950 border border-neutral-800 text-neutral-200 text-xs rounded px-2 py-0.5 focus:outline-none focus:border-neutral-600 font-mono"
              />
            </div>

            <div className="flex items-center gap-1 ml-auto">
              <button
                type="button"
                onClick={handleSetToLatest}
                className="text-[10px] px-2 py-0.5 rounded bg-neutral-800/80 hover:bg-neutral-700/80 text-neutral-300 border border-neutral-700/60 transition-colors"
                title="Set end date to today"
              >
                To Latest
              </button>
              {(startDate || endDate) && (
                <button
                  type="button"
                  onClick={handleClearCustomRange}
                  className="text-[10px] px-1.5 py-0.5 rounded text-neutral-400 hover:text-rose-300 hover:bg-neutral-800 transition-colors flex items-center gap-0.5"
                  title="Clear date filter"
                >
                  <X className="w-3 h-3" />
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        {/* Selected Day Isolation Banner (Subtle & Sleek) */}
        {selectedDay && selectedDayMeta && (
          <div className="bg-neutral-950/80 border border-neutral-800 rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 truncate">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
              <span className="text-neutral-300 font-medium truncate">
                Day: <strong className="text-white">{selectedDayMeta.subtitle || selectedDayMeta.title}</strong>
              </span>
              <span className="text-neutral-500 font-mono text-[11px] shrink-0">
                PnL: <span className={(selectedDayData?.netPnL || 0) >= 0 ? 'text-blue-400 font-semibold' : 'text-slate-400 font-semibold'}>
                  {(selectedDayData?.netPnL || 0) >= 0 ? '+' : ''}{formatCurrency(selectedDayData?.netPnL || 0)}
                </span>
                {' · '}{selectedDayData?.totalTrades || 0} trades
              </span>
            </div>
            <button
              type="button"
              onClick={() => onSelectDay(null)}
              className="text-[10px] px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 hover:text-white hover:bg-neutral-700 shrink-0 flex items-center gap-1 transition-colors"
            >
              <X className="w-3 h-3 text-neutral-400" />
              All Days
            </button>
          </div>
        )}
      </div>

      {/* 2. Sleek Summary Metrics Ribbon (Subtle, Compact) */}
      <div className="bg-neutral-900/40 border border-neutral-800/60 rounded-xl px-3 py-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div>
          <span className="text-[10px] text-neutral-500 uppercase tracking-wider block">
            {selectedDay ? 'Day Realized PnL' : 'Period Realized'}
          </span>
          <div className={`text-base font-bold font-mono ${summary.totalRealizedPnL >= 0 ? 'text-blue-400' : 'text-slate-300'}`}>
            {summary.totalRealizedPnL >= 0 ? '+' : ''}{formatCurrency(summary.totalRealizedPnL)}
          </div>
          <div className="text-[10px] text-neutral-500 font-mono">
            {formatPkr(summary.totalRealizedPnL * pkrRate)}
          </div>
        </div>

        <div>
          <span className="text-[10px] text-neutral-500 uppercase tracking-wider block">
            Win Rate
          </span>
          <div className="text-base font-bold font-mono text-neutral-200">
            {summary.winRate}%{' '}
            <span className="text-xs font-normal text-neutral-400">
              (<span className="text-blue-300">{summary.wins}W</span> · <span className="text-slate-400">{summary.losses}L</span>)
            </span>
          </div>
          <div className="text-[10px] text-neutral-500 font-mono">
            {summary.totalTrades} closed · {summary.profitFactor}x PF
          </div>
        </div>

        <div>
          <span className="text-[10px] text-neutral-500 uppercase tracking-wider block">
            Active Days
          </span>
          <div className="text-base font-bold font-mono text-neutral-200">
            {summary.activeDaysCount}{' '}
            <span className="text-xs font-normal text-neutral-400">
              (<span className="text-blue-300 font-medium">{summary.winningDaysCount}W</span> · <span className="text-slate-400">{summary.losingDaysCount}L</span>)
            </span>
          </div>
          <div className="text-[10px] text-neutral-500 font-mono">
            Avg: {summary.averageDayPnL >= 0 ? '+' : ''}{formatCurrency(summary.averageDayPnL)}/day
          </div>
        </div>

        <div>
          <span className="text-[10px] text-neutral-500 uppercase tracking-wider block">
            Best Day & Fees
          </span>
          <div className="text-sm font-bold font-mono text-neutral-200 truncate">
            {summary.bestDay ? (
              <span className="text-blue-300">
                +{formatCurrency(summary.bestDay.netPnL)} ({summary.bestDay.title})
              </span>
            ) : (
              'None'
            )}
          </div>
          <div className="text-[10px] text-neutral-500 font-mono truncate">
            Fees: -{formatCurrency(summary.totalFees)}
          </div>
        </div>
      </div>

      {/* 3. Day-Wise PnL Quick Filter Strip (Sleek Horizontal Pills) */}
      {days.length > 0 && (
        <div className="flex flex-col gap-1 px-0.5">
          <div className="flex items-center justify-between text-[10px] text-neutral-500">
            <span className="uppercase tracking-wider">Trading Days ({days.length}) — Click to filter</span>
            {selectedDay && (
              <button 
                type="button" 
                onClick={() => onSelectDay(null)}
                className="text-neutral-400 hover:text-white underline cursor-pointer"
              >
                Clear day filter
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
            {days.map(day => {
              const isSelected = selectedDay === day.dateKey;
              const isWin = day.netPnL >= 0;
              return (
                <button
                  key={day.dateKey}
                  type="button"
                  onClick={() => onSelectDay(isSelected ? null : day.dateKey)}
                  className={`text-left px-2 py-1 rounded-lg border transition-colors shrink-0 flex items-center gap-2 select-none ${
                    isSelected
                      ? 'bg-neutral-800 text-white border-neutral-600 shadow-sm'
                      : 'bg-neutral-900/50 border-neutral-800/80 hover:bg-neutral-800/60 hover:border-neutral-700 text-neutral-300'
                  }`}
                  title={`${day.subtitle}: ${day.totalTrades} trade(s)`}
                >
                  <span className="text-[10px] font-medium text-neutral-300">
                    {day.title}
                  </span>
                  <span className={`text-[11px] font-mono font-bold ${
                    isWin ? 'text-blue-400' : 'text-slate-400'
                  }`}>
                    {isWin ? '+' : ''}{formatCurrency(day.netPnL)}
                  </span>
                  <span className="text-[9px] text-neutral-500 font-mono">
                    ({day.totalTrades})
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});
