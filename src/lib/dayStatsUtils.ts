import { Trade } from '../types';
import { getTradeAchievedPnL, getTradeConsolidatedFees, getCleanSymbol } from './tradeUtils';

export const getTradeCloseTimestamp = (trade: Trade): number => {
  const raw = trade.closedAt || trade.filledAt || trade.createdAt || trade.date;
  if (!raw) return 0;
  if (typeof raw === 'number') {
    return raw < 1e11 ? raw * 1000 : raw;
  }
  const parsed = new Date(raw).getTime();
  return isNaN(parsed) ? 0 : parsed;
};

export const getLocalDateKey = (timestamp: number): string => {
  if (!timestamp || isNaN(timestamp)) return 'UNKNOWN';
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return 'UNKNOWN';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export interface DayGroupStats {
  dateKey: string;
  title: string;
  subtitle: string;
  relative: string;
  isToday: boolean;
  isYesterday: boolean;
  timestamp: number;
  trades: Trade[];
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  netPnL: number;
  totalInvested: number;
  totalFees: number;
  symbols: string[];
  bestTrade?: Trade;
  worstTrade?: Trade;
}

export const formatDayDisplay = (dateKey: string) => {
  if (dateKey === 'UNKNOWN') {
    return { title: 'Unknown Date', subtitle: '', relative: '', isToday: false, isYesterday: false };
  }
  const parts = dateKey.split('-').map(Number);
  if (parts.length !== 3 || isNaN(parts[0])) {
    return { title: dateKey, subtitle: '', relative: '', isToday: false, isYesterday: false };
  }
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  
  const now = new Date();
  const todayKey = getLocalDateKey(now.getTime());
  const yesterday = new Date(now.getTime() - 86400000);
  const yesterdayKey = getLocalDateKey(yesterday.getTime());

  const isToday = dateKey === todayKey;
  const isYesterday = dateKey === yesterdayKey;

  let relative = '';
  if (isToday) relative = 'Today';
  else if (isYesterday) relative = 'Yesterday';
  else relative = d.toLocaleDateString('en-US', { weekday: 'short' });

  const title = isToday ? 'Today' : isYesterday ? 'Yesterday' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
  const subtitle = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  return { title, subtitle, relative, isToday, isYesterday };
};

export const groupTradesByDay = (trades: Trade[]): DayGroupStats[] => {
  const dayMap = new Map<string, Trade[]>();

  for (const t of trades) {
    const ts = getTradeCloseTimestamp(t);
    const key = getLocalDateKey(ts);
    if (!dayMap.has(key)) {
      dayMap.set(key, []);
    }
    dayMap.get(key)!.push(t);
  }

  const results: DayGroupStats[] = [];

  for (const [dateKey, dayTrades] of dayMap.entries()) {
    let netPnL = 0;
    let wins = 0;
    let losses = 0;
    let breakeven = 0;
    let totalInvested = 0;
    let totalFees = 0;
    const symSet = new Set<string>();

    let bestTrade: Trade | undefined;
    let worstTrade: Trade | undefined;
    let maxPnL = -Infinity;
    let minPnL = Infinity;

    for (const t of dayTrades) {
      const pnl = getTradeAchievedPnL(t);
      netPnL += pnl;

      if (pnl > 0.001) wins++;
      else if (pnl < -0.001) losses++;
      else breakeven++;

      if (pnl > maxPnL) {
        maxPnL = pnl;
        bestTrade = t;
      }
      if (pnl < minPnL) {
        minPnL = pnl;
        worstTrade = t;
      }

      const fees = getTradeConsolidatedFees(t).totalFees;
      totalFees += fees;

      const inv = t.totalBuyUsd || ((t.positionSizeCoins || 0) * (t.entryPrice || 0)) || 0;
      totalInvested += inv;

      const sym = getCleanSymbol(t.symbol) || t.symbol;
      if (sym) symSet.add(sym.replace(/USDT|USDC|BUSD|FDUSD$/, ''));
    }

    const totalDecided = wins + losses;
    const winRate = totalDecided > 0 ? Math.round((wins / totalDecided) * 100) : (wins > 0 ? 100 : 0);

    const dayMeta = formatDayDisplay(dateKey);
    const repTimestamp = dayTrades[0] ? getTradeCloseTimestamp(dayTrades[0]) : 0;

    results.push({
      dateKey,
      title: dayMeta.title,
      subtitle: dayMeta.subtitle,
      relative: dayMeta.relative,
      isToday: dayMeta.isToday,
      isYesterday: dayMeta.isYesterday,
      timestamp: repTimestamp,
      trades: dayTrades,
      totalTrades: dayTrades.length,
      wins,
      losses,
      breakeven,
      winRate,
      netPnL,
      totalInvested,
      totalFees,
      symbols: Array.from(symSet),
      bestTrade,
      worstTrade
    });
  }

  // Sort by date key descending (newest first)
  results.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  return results;
};

export interface DateRangeSummary {
  totalRealizedPnL: number;
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  profitFactor: number;
  grossProfit: number;
  grossLoss: number;
  totalFees: number;
  activeDaysCount: number;
  winningDaysCount: number;
  losingDaysCount: number;
  bestDay: DayGroupStats | null;
  worstDay: DayGroupStats | null;
  averageDayPnL: number;
}

export const calculateDateRangeSummary = (days: DayGroupStats[]): DateRangeSummary => {
  let totalRealizedPnL = 0;
  let totalTrades = 0;
  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let totalFees = 0;
  let winningDaysCount = 0;
  let losingDaysCount = 0;

  let bestDay: DayGroupStats | null = null;
  let worstDay: DayGroupStats | null = null;
  let maxDayPnL = -Infinity;
  let minDayPnL = Infinity;

  for (const day of days) {
    totalRealizedPnL += day.netPnL;
    totalTrades += day.totalTrades;
    wins += day.wins;
    losses += day.losses;
    breakeven += day.breakeven;
    totalFees += day.totalFees;

    if (day.netPnL > 0.001) winningDaysCount++;
    else if (day.netPnL < -0.001) losingDaysCount++;

    if (day.netPnL > maxDayPnL) {
      maxDayPnL = day.netPnL;
      bestDay = day;
    }
    if (day.netPnL < minDayPnL) {
      minDayPnL = day.netPnL;
      worstDay = day;
    }

    for (const t of day.trades) {
      const pnl = getTradeAchievedPnL(t);
      if (pnl > 0) grossProfit += pnl;
      else if (pnl < 0) grossLoss += Math.abs(pnl);
    }
  }

  const decided = wins + losses;
  const winRate = decided > 0 ? Math.round((wins / decided) * 100) : (wins > 0 ? 100 : 0);
  const profitFactor = grossLoss > 0 ? parseFloat((grossProfit / grossLoss).toFixed(2)) : (grossProfit > 0 ? 99.9 : 0);
  const activeDaysCount = days.length;
  const averageDayPnL = activeDaysCount > 0 ? totalRealizedPnL / activeDaysCount : 0;

  return {
    totalRealizedPnL,
    totalTrades,
    wins,
    losses,
    breakeven,
    winRate,
    profitFactor,
    grossProfit,
    grossLoss,
    totalFees,
    activeDaysCount,
    winningDaysCount,
    losingDaysCount,
    bestDay,
    worstDay,
    averageDayPnL
  };
};

export const filterTradesByDateRange = (
  trades: Trade[],
  preset: string,
  startDate?: string,
  endDate?: string,
  selectedDay?: string | null
): Trade[] => {
  if (selectedDay) {
    return trades.filter(t => {
      const ts = getTradeCloseTimestamp(t);
      return getLocalDateKey(ts) === selectedDay;
    });
  }

  if (preset === 'ALL' && !startDate && !endDate) {
    return trades;
  }

  const now = new Date();
  let startTimestamp = 0;
  let endTimestamp = Infinity;

  if (preset === 'TODAY') {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    startTimestamp = today.getTime();
  } else if (preset === 'YESTERDAY') {
    const yStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0);
    const yEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
    startTimestamp = yStart.getTime();
    endTimestamp = yEnd.getTime();
  } else if (preset === '7D') {
    startTimestamp = Date.now() - (7 * 24 * 60 * 60 * 1000);
  } else if (preset === '30D') {
    startTimestamp = Date.now() - (30 * 24 * 60 * 60 * 1000);
  } else if (preset === 'THIS_MONTH') {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    startTimestamp = monthStart.getTime();
  } else if (preset === 'CUSTOM' || startDate || endDate) {
    if (startDate) {
      const parts = startDate.split('-').map(Number);
      if (parts.length === 3) {
        startTimestamp = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0).getTime();
      }
    }
    if (endDate) {
      const parts = endDate.split('-').map(Number);
      if (parts.length === 3) {
        endTimestamp = new Date(parts[0], parts[1] - 1, parts[2], 23, 59, 59, 999).getTime();
      }
    }
  }

  return trades.filter(t => {
    const ts = getTradeCloseTimestamp(t);
    return ts >= startTimestamp && ts <= endTimestamp;
  });
};
