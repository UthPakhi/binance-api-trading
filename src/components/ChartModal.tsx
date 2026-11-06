import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  createChart,
  createSeriesMarkers,
  ColorType,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  CandlestickSeries,
  LineSeries,
} from 'lightweight-charts';
import { X, LineChart, RefreshCw, AlertCircle, Crosshair } from 'lucide-react';
import { Trade } from '../types';
import {
  getCleanTradingSymbol,
  isTradeClosed,
  getTradeExitPrice,
  getTradeRealizedPnlByMethod,
  calculateNormalizedRMultiple,
  formatPrice,
  formatTradeDuration,
} from '../lib/tradeUtils';

interface ChartModalProps {
  trade: Trade;
  onClose: () => void;
}

const INTERVALS = ['15m', '1h', '4h', '1d'] as const;

const INTERVAL_MS: Record<string, number> = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

function selectOptimalInterval(openTimeMs: number, closeTimeMs: number, closed: boolean): string {
  if (!closed || !openTimeMs || !closeTimeMs || closeTimeMs <= openTimeMs) {
    return '1h';
  }
  const durationMs = closeTimeMs - openTimeMs;
  const hours = durationMs / (1000 * 60 * 60);
  if (hours <= 8) return '15m';
  if (hours <= 24 * 6) return '1h';
  if (hours <= 24 * 35) return '4h';
  return '1d';
}

function findNearestCandleIndex(candles: { time: number }[], targetSec: number): number {
  if (!candles.length) return -1;
  let bestIdx = 0;
  let bestDiff = Math.abs(candles[0].time - targetSec);
  for (let i = 0; i < candles.length; i++) {
    const t = candles[i].time;
    if (t <= targetSec) {
      bestIdx = i;
      bestDiff = targetSec - t;
    } else {
      if (t - targetSec < bestDiff && i === 0) {
        bestIdx = 0;
      }
      break;
    }
  }
  return bestIdx;
}

function formatShortTimestamp(ms: number): string {
  if (!ms || ms <= 0) return '—';
  try {
    return new Date(ms).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export function ChartModal({ trade, onClose }: ChartModalProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const pathSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const markersPluginRef = useRef<any>(null);
  const latestDataRef = useRef<any[] | null>(null);

  const tradeMeta = useMemo(() => {
    const closed = isTradeClosed(trade);
    const openPrice = Number(trade.entryPrice || 0);
    const closePrice = closed ? Number(getTradeExitPrice(trade) || trade.exitPrice || trade.entryPrice || 0) : 0;

    const matchBuyTimes = Array.isArray(trade.ledgerMatches)
      ? trade.ledgerMatches.map((m) => Number(m.buyTimestamp || 0)).filter((t) => t > 0)
      : [];
    const matchSellTimes = Array.isArray(trade.ledgerMatches)
      ? trade.ledgerMatches.map((m) => Number(m.sellTimestamp || 0)).filter((t) => t > 0)
      : [];

    const rawOpenMs =
      matchBuyTimes.length > 0
        ? Math.min(...matchBuyTimes)
        : Number(trade.filledAt || trade.createdAt || 0);
    const rawCloseMs = closed
      ? Number(
          trade.closedAt ||
            (matchSellTimes.length > 0 ? Math.max(...matchSellTimes) : 0) ||
            trade.updatedAt ||
            rawOpenMs
        )
      : 0;

    const openTimeMs = rawOpenMs;
    const closeTimeMs = closed ? Math.max(rawOpenMs, rawCloseMs) : 0;

    // Group intermediate partial exits if multiple sell orders occurred at different times
    const partialExits: { timeMs: number; price: number; qty: number }[] = [];
    if (closed && Array.isArray(trade.ledgerMatches) && trade.ledgerMatches.length > 1) {
      const byOrder = new Map<string, { timeMs: number; proceeds: number; qty: number }>();
      for (const m of trade.ledgerMatches) {
        if (!m.sellTimestamp || !m.sellPrice || !m.matchedQty) continue;
        const key = String(m.sellOrderId || m.sellTimestamp);
        const cur = byOrder.get(key) || { timeMs: m.sellTimestamp, proceeds: 0, qty: 0 };
        cur.qty += m.matchedQty;
        cur.proceeds += m.matchedQty * m.sellPrice;
        if (m.sellTimestamp > cur.timeMs) cur.timeMs = m.sellTimestamp;
        byOrder.set(key, cur);
      }
      const steps = Array.from(byOrder.values()).sort((a, b) => a.timeMs - b.timeMs);
      if (steps.length > 1) {
        for (let i = 0; i < steps.length - 1; i++) {
          const s = steps[i];
          if (s.qty > 0) {
            partialExits.push({
              timeMs: s.timeMs,
              price: s.proceeds / s.qty,
              qty: s.qty,
            });
          }
        }
      }
    }

    const pnlUsd = closed ? getTradeRealizedPnlByMethod(trade, 'WAC', false) : 0;
    const pnlExact8 = closed ? getTradeRealizedPnlByMethod(trade, 'WAC', true) : 0;
    const isWin = pnlUsd >= 0;
    const movePct = openPrice > 0 && closePrice > 0 ? ((closePrice - openPrice) / openPrice) * 100 : 0;
    const normR = closed ? calculateNormalizedRMultiple(pnlExact8, trade, undefined, 'WAC') : null;
    const durationStr = formatTradeDuration(trade);

    return {
      closed,
      openPrice,
      closePrice,
      openTimeMs,
      closeTimeMs,
      partialExits,
      pnlUsd,
      isWin,
      movePct,
      rMultiple: normR ? normR.r : null,
      durationStr,
    };
  }, [trade]);

  const [loading, setLoading] = useState(true);
  const [interval, setInterval] = useState(() =>
    selectOptimalInterval(tradeMeta.openTimeMs, tradeMeta.closeTimeMs, tradeMeta.closed)
  );
  const intervalRef = useRef(interval);
  intervalRef.current = interval;
  const [error, setError] = useState<string | null>(null);
  const [hoveredCandle, setHoveredCandle] = useState<{
    open: number;
    high: number;
    low: number;
    close: number;
    pct: number;
  } | null>(null);

  // Close modal on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Apply subtle trade markers, trajectory path, and viewport framing once candle data is ready
  const applyTradeVisualization = useCallback(
    (candles: { time: number; open: number; high: number; low: number; close: number }[], autoFrame = true) => {
      const chart = chartRef.current;
      const series = seriesRef.current;
      const pathSeries = pathSeriesRef.current;
      if (!chart || !series || !candles || candles.length === 0) return;

      series.setData(candles as any);

      const openSec = tradeMeta.openTimeMs > 0 ? Math.floor(tradeMeta.openTimeMs / 1000) : 0;
      const closeSec = tradeMeta.closeTimeMs > 0 ? Math.floor(tradeMeta.closeTimeMs / 1000) : 0;

      const firstCandleSec = candles[0].time;
      const lastCandleSec = candles[candles.length - 1].time;

      if (tradeMeta.closed && openSec > 0 && closeSec > 0) {
        const startIdx = findNearestCandleIndex(candles, openSec);
        const endIdx = Math.max(startIdx, findNearestCandleIndex(candles, closeSec));
        const startCandle = candles[startIdx];
        const endCandle = candles[endIdx];

        const markers: any[] = [];
        const winColor = '#34d399'; // emerald-400
        const lossColor = '#f87171'; // rose-400
        const openColor = '#38bdf8'; // sky-400
        const exitColor = tradeMeta.isWin ? winColor : lossColor;

        if (startCandle && endCandle) {
          markers.push({
            time: startCandle.time as any,
            position: 'belowBar',
            color: openColor,
            shape: 'arrowUp',
            text: 'Open',
          });

          // Add subtle partial TP markers if they occurred on distinct bars between Open and Close
          const usedTimes = new Set<number>([startCandle.time, endCandle.time]);
          for (const pe of tradeMeta.partialExits) {
            const peIdx = findNearestCandleIndex(candles, Math.floor(pe.timeMs / 1000));
            const peCandle = candles[peIdx];
            if (peCandle && !usedTimes.has(peCandle.time) && peIdx > startIdx && peIdx < endIdx) {
              usedTimes.add(peCandle.time);
              markers.push({
                time: peCandle.time as any,
                position: 'aboveBar',
                color: winColor,
                shape: 'circle',
                text: 'TP',
              });
            }
          }

          markers.push({
            time: endCandle.time as any,
            position: 'aboveBar',
            color: exitColor,
            shape: 'arrowDown',
            text: 'Close',
          });

          markers.sort((a, b) => Number(a.time) - Number(b.time));
          if (markersPluginRef.current) {
            markersPluginRef.current.setMarkers(markers);
          }

          // Subtle dashed trajectory line connecting Open -> Close across distinct candles
          if (pathSeries) {
            if (endCandle.time > startCandle.time && tradeMeta.openPrice > 0 && tradeMeta.closePrice > 0) {
              const pathPointsMap = new Map<number, number>();
              pathPointsMap.set(startCandle.time, tradeMeta.openPrice);
              for (const pe of tradeMeta.partialExits) {
                const peIdx = findNearestCandleIndex(candles, Math.floor(pe.timeMs / 1000));
                const peCandle = candles[peIdx];
                if (peCandle && peCandle.time > startCandle.time && peCandle.time < endCandle.time) {
                  pathPointsMap.set(peCandle.time, pe.price);
                }
              }
              pathPointsMap.set(endCandle.time, tradeMeta.closePrice);

              const pathPoints = Array.from(pathPointsMap.entries())
                .sort((a, b) => a[0] - b[0])
                .map(([time, value]) => ({ time: time as any, value }));
              pathSeries.setData(pathPoints);
            } else {
              pathSeries.setData([]);
            }
          }

          // Frame the chart around the trade's Open and Close with comfortable surrounding context
          if (autoFrame) {
            const tradeSpanBars = Math.max(1, endIdx - startIdx);
            const padBars = Math.max(20, Math.min(80, Math.round(tradeSpanBars * 0.55)));
            const fromLogical = Math.max(0, startIdx - padBars);
            const toLogical = Math.min(candles.length - 1, endIdx + padBars);
            if (toLogical > fromLogical) {
              chart.timeScale().setVisibleLogicalRange({
                from: fromLogical as any,
                to: toLogical as any,
              });
              return;
            }
          }
        }
      } else if (!tradeMeta.closed && openSec >= firstCandleSec && openSec <= lastCandleSec) {
        // For active trades, subtly mark the entry candle if within loaded history
        const startIdx = findNearestCandleIndex(candles, openSec);
        const startCandle = candles[startIdx];
        if (startCandle && markersPluginRef.current) {
          markersPluginRef.current.setMarkers([
            {
              time: startCandle.time as any,
              position: 'belowBar',
              color: '#38bdf8',
              shape: 'arrowUp',
              text: 'Open',
            },
          ]);
        }
        if (pathSeries) pathSeries.setData([]);
      } else {
        if (markersPluginRef.current) markersPluginRef.current.setMarkers([]);
        if (pathSeries) pathSeries.setData([]);
      }

      if (autoFrame) {
        chart.timeScale().fitContent();
      }
    },
    [tradeMeta]
  );

  const handleFocusTrade = useCallback(() => {
    if (latestDataRef.current && latestDataRef.current.length > 0) {
      applyTradeVisualization(latestDataRef.current, true);
    }
  }, [applyTradeVisualization]);

  // Robust Kline data fetcher that centers on the trade window for closed trades
  const fetchKlines = useCallback(
    async (targetInterval: string) => {
      if (!trade.symbol) return;
      setLoading(true);
      setError(null);
      try {
        const sym = getCleanTradingSymbol(trade.symbol);
        const intMs = INTERVAL_MS[targetInterval] || INTERVAL_MS['1h'];

        let url = `/api/exchange/klines?symbol=${encodeURIComponent(sym)}&interval=${targetInterval}&limit=500`;
        if (tradeMeta.closed && tradeMeta.openTimeMs > 0 && tradeMeta.closeTimeMs > 0) {
          // Request ~70 bars before trade open and enough bars after close to fill context
          const beforePadMs = 70 * intMs;
          const afterPadMs = 70 * intMs;
          const startTime = Math.max(0, tradeMeta.openTimeMs - beforePadMs);
          const endTime = Math.min(
            Date.now(),
            Math.max(tradeMeta.closeTimeMs + afterPadMs, startTime + 250 * intMs)
          );
          url += `&startTime=${Math.floor(startTime)}&endTime=${Math.floor(endTime)}`;
        }

        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = await res.json();
        const data = result.klines || [];

        if (!Array.isArray(data) || data.length === 0) {
          setError(`No candle data available for ${sym}`);
          setLoading(false);
          return;
        }

        const seenTimes = new Set<number>();
        const formattedData: { time: number; open: number; high: number; low: number; close: number }[] = [];
        for (const d of data) {
          const t = Math.floor(Number(d[0]) / 1000);
          if (!seenTimes.has(t)) {
            seenTimes.add(t);
            formattedData.push({
              time: t,
              open: parseFloat(d[1]),
              high: parseFloat(d[2]),
              low: parseFloat(d[3]),
              close: parseFloat(d[4]),
            });
          }
        }

        formattedData.sort((a, b) => a.time - b.time);
        latestDataRef.current = formattedData;

        if (seriesRef.current && chartRef.current) {
          applyTradeVisualization(formattedData, true);
        }
      } catch (err: any) {
        console.error('Failed to fetch chart data', err);
        setError(`Unable to load candle data: ${err?.message || 'Network error'}`);
      } finally {
        setLoading(false);
      }
    },
    [trade.symbol, tradeMeta.closed, tradeMeta.openTimeMs, tradeMeta.closeTimeMs, applyTradeVisualization]
  );

  // Fetch data immediately when interval or symbol changes
  useEffect(() => {
    fetchKlines(interval);
  }, [fetchKlines, interval]);

  // Initialize chart canvas in DOM container
  useEffect(() => {
    let chartInstance: IChartApi | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const initChart = () => {
      if (!chartContainerRef.current) return;

      const container = chartContainerRef.current;
      const initialWidth = container.clientWidth || 600;
      const initialHeight = container.clientHeight || 420;

      const chart = createChart(container, {
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: '#a3a3a3',
        },
        grid: {
          vertLines: { color: 'rgba(38, 38, 38, 0.45)' },
          horzLines: { color: 'rgba(38, 38, 38, 0.45)' },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
        },
        rightPriceScale: {
          borderColor: 'rgba(38, 38, 38, 1)',
        },
        timeScale: {
          borderColor: 'rgba(38, 38, 38, 1)',
          timeVisible: true,
          secondsVisible: false,
        },
        width: initialWidth,
        height: initialHeight,
      });

      const pVal = trade.entryPrice || 1;
      const isSubPenny = pVal < 1;
      const candlestickSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#38bdf8', // sky-400
        downColor: '#64748b', // slate-500
        borderVisible: false,
        wickUpColor: '#38bdf8',
        wickDownColor: '#64748b',
        priceFormat: {
          type: 'price',
          precision: isSubPenny ? 6 : 4,
          minMove: isSubPenny ? 0.000001 : 0.0001,
        },
      });

      // Subtle dashed execution connector line between Open and Close for closed trades
      const pathSeries = chart.addSeries(LineSeries, {
        color: tradeMeta.isWin ? 'rgba(52, 211, 153, 0.6)' : 'rgba(248, 113, 113, 0.6)',
        lineWidth: 2,
        lineStyle: 2, // Dashed
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
        priceFormat: {
          type: 'price',
          precision: isSubPenny ? 6 : 4,
          minMove: isSubPenny ? 0.000001 : 0.0001,
        },
      });

      markersPluginRef.current = createSeriesMarkers(candlestickSeries, []);

      if (tradeMeta.closed) {
        // Subtle Open & Close price lines for closed trades
        if (tradeMeta.openPrice > 0) {
          candlestickSeries.createPriceLine({
            price: tradeMeta.openPrice,
            color: 'rgba(56, 189, 248, 0.7)', // sky-400 subtle
            lineWidth: 1,
            lineStyle: 2, // Dashed
            axisLabelVisible: true,
            title: 'OPEN',
          });
        }
        if (tradeMeta.closePrice > 0) {
          candlestickSeries.createPriceLine({
            price: tradeMeta.closePrice,
            color: tradeMeta.isWin ? 'rgba(52, 211, 153, 0.8)' : 'rgba(248, 113, 113, 0.8)',
            lineWidth: 1,
            lineStyle: 2, // Dashed
            axisLabelVisible: true,
            title: 'CLOSE',
          });
        }
        // Quiet reference stop-loss if one was set
        if (trade.stopLoss && trade.stopLoss > 0) {
          candlestickSeries.createPriceLine({
            price: trade.stopLoss,
            color: 'rgba(148, 163, 184, 0.35)',
            lineWidth: 1,
            lineStyle: 3, // LargeDashed / Dotted
            axisLabelVisible: true,
            title: 'SL',
          });
        }
      } else {
        // Active / Pending trade price lines
        if (trade.entryPrice) {
          candlestickSeries.createPriceLine({
            price: trade.entryPrice,
            color: '#60a5fa', // blue-400
            lineWidth: 2,
            lineStyle: 2,
            axisLabelVisible: true,
            title: 'ENT',
          });
        }
        if (trade.stopLoss) {
          candlestickSeries.createPriceLine({
            price: trade.stopLoss,
            color: '#94a3b8', // slate-400
            lineWidth: 2,
            lineStyle: 2,
            axisLabelVisible: true,
            title: 'SL',
          });
        }

        [trade.takeProfit1, trade.takeProfit2, trade.takeProfit3].forEach((tp, idx) => {
          if (tp) {
            candlestickSeries.createPriceLine({
              price: tp,
              color: '#34d399', // emerald-400
              lineWidth: 2,
              lineStyle: 2,
              axisLabelVisible: true,
              title: `TP${idx + 1}`,
            });
          }
        });
      }

      chartRef.current = chart;
      seriesRef.current = candlestickSeries;
      pathSeriesRef.current = pathSeries;
      chartInstance = chart;

      chart.subscribeCrosshairMove((param) => {
        if (param.time && param.seriesData && seriesRef.current) {
          const data = param.seriesData.get(seriesRef.current) as any;
          if (data && typeof data.open === 'number' && typeof data.close === 'number') {
            const pct = ((data.close - data.open) / data.open) * 100;
            setHoveredCandle({
              open: data.open,
              high: data.high,
              low: data.low,
              close: data.close,
              pct,
            });
            return;
          }
        }
        setHoveredCandle(null);
      });

      if (latestDataRef.current && latestDataRef.current.length > 0) {
        applyTradeVisualization(latestDataRef.current, true);
      } else {
        fetchKlines(intervalRef.current);
      }

      resizeObserver = new ResizeObserver((entries) => {
        if (!entries || entries.length === 0 || !chartInstance) return;
        const { width, height } = entries[0].contentRect;
        if (width > 0) {
          chartInstance.applyOptions({
            width,
            height: height > 0 ? height : initialHeight,
          });
        }
      });
      resizeObserver.observe(container);
    };

    const rafId = requestAnimationFrame(initChart);

    return () => {
      cancelAnimationFrame(rafId);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (chartInstance) {
        chartInstance.remove();
      }
      chartRef.current = null;
      seriesRef.current = null;
      pathSeriesRef.current = null;
      markersPluginRef.current = null;
    };
  }, [
    trade.id,
    trade.symbol,
    trade.entryPrice,
    trade.stopLoss,
    trade.takeProfit1,
    trade.takeProfit2,
    trade.takeProfit3,
    tradeMeta,
    fetchKlines,
    applyTradeVisualization,
  ]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-neutral-900 rounded-xl border border-neutral-800 shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between p-3 sm:p-4 border-b border-neutral-800 bg-neutral-950">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            <h2 className="text-sm sm:text-base font-bold text-neutral-100 flex items-center gap-2">
              <LineChart className="w-4 h-4 text-sky-400" />
              <span>{trade.symbol}</span>
              <span className="text-xs font-mono font-normal text-neutral-400">
                ({trade.market || 'SPOT'})
              </span>
            </h2>

            {/* Timeframe intervals & Focus/Refresh buttons */}
            <div className="flex items-center gap-1 bg-neutral-900 p-1 rounded-lg border border-neutral-800">
              {INTERVALS.map((int) => (
                <button
                  key={int}
                  type="button"
                  onClick={() => {
                    setInterval(int);
                    fetchKlines(int);
                  }}
                  className={`text-[10px] sm:text-xs font-semibold px-2.5 py-1 rounded-md transition-colors ${
                    interval === int
                      ? 'bg-neutral-800 text-white shadow-sm'
                      : 'text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  {int}
                </button>
              ))}

              {tradeMeta.closed && (
                <button
                  type="button"
                  onClick={handleFocusTrade}
                  title="Center on Trade Open & Close"
                  className="text-neutral-400 hover:text-sky-300 px-2 py-1 ml-0.5 rounded text-[10px] sm:text-xs font-medium flex items-center gap-1 hover:bg-neutral-800/70 transition-colors"
                >
                  <Crosshair className="w-3 h-3 text-sky-400" />
                  <span className="hidden sm:inline">Focus</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => fetchKlines(interval)}
                title="Refresh Candles"
                className="text-neutral-500 hover:text-neutral-200 p-1 ml-0.5 rounded transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-sky-400' : ''}`} />
              </button>
            </div>

            {hoveredCandle ? (
              <div className="flex items-center gap-1.5 sm:gap-2 px-2 py-1 bg-neutral-900 rounded-lg border border-neutral-800 text-[10px] sm:text-[11px] font-mono">
                <span className="text-neutral-400">
                  O: <span className="text-neutral-200">{hoveredCandle.open}</span>
                </span>
                <span className="text-neutral-400">
                  H: <span className="text-neutral-200">{hoveredCandle.high}</span>
                </span>
                <span className="text-neutral-400">
                  L: <span className="text-neutral-200">{hoveredCandle.low}</span>
                </span>
                <span className="text-neutral-400">
                  C: <span className="text-neutral-200">{hoveredCandle.close}</span>
                </span>
                <span className={`font-bold ${hoveredCandle.pct >= 0 ? 'text-sky-400' : 'text-slate-400'}`}>
                  {hoveredCandle.pct >= 0 ? '+' : ''}
                  {hoveredCandle.pct.toFixed(2)}%
                </span>
              </div>
            ) : (
              <div className="text-[10px] text-neutral-500 font-mono italic">
                Tap/hover chart for candle %
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-neutral-500 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-neutral-800"
            title="Close (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Subtle Closed Trade Summary Bar (Open, Close, Start -> End, Duration, Realized PnL) */}
        {tradeMeta.closed && (
          <div className="px-3 sm:px-4 py-2 border-b border-neutral-800/80 bg-neutral-950/60 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] font-mono text-neutral-400">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                <span className="text-neutral-500">Open</span>
                <span className="text-neutral-200 font-semibold">{formatPrice(tradeMeta.openPrice)}</span>
                <span className="text-neutral-500">({formatShortTimestamp(tradeMeta.openTimeMs)})</span>
              </span>
              <span className="text-neutral-600" aria-hidden="true">→</span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    tradeMeta.isWin ? 'bg-emerald-400' : 'bg-rose-400'
                  }`}
                />
                <span className="text-neutral-500">Close</span>
                <span className="text-neutral-200 font-semibold">{formatPrice(tradeMeta.closePrice)}</span>
                <span className="text-neutral-500">({formatShortTimestamp(tradeMeta.closeTimeMs)})</span>
              </span>
              {tradeMeta.durationStr && (
                <>
                  <span className="text-neutral-600" aria-hidden="true">·</span>
                  <span className="text-neutral-400">Held {tradeMeta.durationStr}</span>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className={tradeMeta.isWin ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
                {tradeMeta.pnlUsd >= 0 ? '+' : '-'}${Math.abs(tradeMeta.pnlUsd).toFixed(2)}
              </span>
              <span className="text-neutral-600" aria-hidden="true">·</span>
              <span className={tradeMeta.movePct >= 0 ? 'text-sky-400' : 'text-slate-400'}>
                {tradeMeta.movePct >= 0 ? '+' : ''}
                {tradeMeta.movePct.toFixed(2)}%
              </span>
              {tradeMeta.rMultiple !== null && !isNaN(tradeMeta.rMultiple) && (
                <>
                  <span className="text-neutral-600" aria-hidden="true">·</span>
                  <span className="text-neutral-300">
                    {tradeMeta.rMultiple >= 0 ? '+' : ''}
                    {tradeMeta.rMultiple.toFixed(2)}R
                  </span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Chart Canvas Area */}
        <div className="p-2 sm:p-4 relative w-full bg-[#0a0a0a]" style={{ height: '420px' }}>
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0a0a]/60 backdrop-blur-[1px] z-10 gap-2">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-sky-400 border-t-transparent"></div>
              <span className="text-xs font-mono text-neutral-400">Loading {interval} candles...</span>
            </div>
          )}

          {error && !loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0a0a]/90 z-10 gap-3 p-4 text-center">
              <AlertCircle className="w-8 h-8 text-rose-400" />
              <p className="text-xs sm:text-sm text-neutral-300 max-w-sm">{error}</p>
              <button
                type="button"
                onClick={() => fetchKlines(interval)}
                className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-medium rounded-lg border border-neutral-700 transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          <div ref={chartContainerRef} className="w-full h-full" />
        </div>
      </div>
    </div>
  );
}
