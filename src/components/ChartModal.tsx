import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CrosshairMode, IChartApi, ISeriesApi, CandlestickSeries } from 'lightweight-charts';
import { X, LineChart } from 'lucide-react';
import { Trade } from '../types';

interface ChartModalProps {
  trade: Trade;
  onClose: () => void;
}

const INTERVALS = ['15m', '1h', '4h', '1d'];

export function ChartModal({ trade, onClose }: ChartModalProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [loading, setLoading] = useState(true);
  const [interval, setInterval] = useState('1h');

  // Initialize chart
  useEffect(() => {
    // A small timeout ensures the modal is fully rendered before trying to attach the canvas
    const timer = setTimeout(() => {
      if (!chartContainerRef.current) return;

      const chart = createChart(chartContainerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: '#a3a3a3',
        },
        grid: {
          vertLines: { color: 'rgba(38, 38, 38, 0.5)' }, // neutral-800
          horzLines: { color: 'rgba(38, 38, 38, 0.5)' },
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
        },
        width: chartContainerRef.current.clientWidth || 600,
        height: 400,
      });

      const candlestickSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#38bdf8', // sky-400
        downColor: '#94a3b8', // red-400
        borderVisible: false,
        wickUpColor: '#38bdf8',
        wickDownColor: '#94a3b8',
      });

      // Add price lines
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
          color: '#94a3b8', // red-400
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
            color: '#38bdf8', // sky-400
            lineWidth: 2,
            lineStyle: 2,
            axisLabelVisible: true,
            title: `TP${idx + 1}`,
          });
        }
      });

      chartRef.current = chart;
      seriesRef.current = candlestickSeries;

      const handleResize = () => {
        if (chartContainerRef.current && chartRef.current) {
          chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
        }
      };
      
      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);
        chart.remove();
      };
    }, 50);
    
    return () => clearTimeout(timer);
  }, [trade]);

  // Fetch Data when interval changes
  useEffect(() => {
    let isMounted = true;
    const fetchKlines = async () => {
      if (!seriesRef.current || !chartRef.current) return;
      setLoading(true);
      try {
        const rawSym = trade.symbol.trim().toUpperCase();
        const sym = rawSym.endsWith('USDT') ? rawSym : `${rawSym}USDT`;
        const res = await fetch(`/api/exchange/klines?symbol=${encodeURIComponent(sym)}&interval=${interval}&limit=500`);
        const result = await res.json();
        const data = result.klines || [];
        
        if (!isMounted) return;

        const formattedData = data.map((d: any) => ({
          time: d[0] / 1000,
          open: parseFloat(d[1]),
          high: parseFloat(d[2]),
          low: parseFloat(d[3]),
          close: parseFloat(d[4]),
        }));
        
        seriesRef.current.setData(formattedData);
        chartRef.current.timeScale().fitContent();
      } catch (error) {
        console.error('Failed to fetch chart data', error);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchKlines();
    return () => { isMounted = false; };
  }, [trade.symbol, interval]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-neutral-900 rounded-xl border border-neutral-800 shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-3 sm:p-4 border-b border-neutral-800 bg-neutral-950">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            <h2 className="text-sm sm:text-base font-bold text-neutral-100 flex items-center gap-2">
              <LineChart className="w-4 h-4 text-sky-400" />
              {trade.symbol}
            </h2>
            <div className="flex gap-1 bg-neutral-900 p-1 rounded-lg border border-neutral-800">
              {INTERVALS.map(int => (
                <button
                  key={int}
                  onClick={() => setInterval(int)}
                  className={`text-[10px] sm:text-xs font-semibold px-2 py-1 rounded-md transition-colors ${
                    interval === int 
                      ? 'bg-neutral-800 text-white' 
                      : 'text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  {int}
                </button>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-white transition-colors p-1">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-2 sm:p-4 relative w-full bg-[#0a0a0a]" style={{ height: '400px' }}>
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0a]/50 z-10">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-400"></div>
            </div>
          )}
          <div ref={chartContainerRef} className="w-full h-full" />
        </div>
      </div>
    </div>
  );
}
