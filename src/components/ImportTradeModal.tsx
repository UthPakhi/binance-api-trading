import React, { useState, useEffect } from 'react';
import { Button } from './Button';
import { 
  X, CloudDownload, RefreshCw, AlertCircle, ArrowRight, Sparkles, Check, 
  Layers, Coins, Plus, Search, ChevronDown, ChevronUp, SlidersHorizontal, 
  ExternalLink, TrendingUp, ShieldCheck 
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Trade } from '../types';
import { formatPrice, isAlphaTradeOrSymbol, getTradeInvestedAmount, calculateRemainingCoins } from '../lib/tradeUtils';
import { calculateUnassignedBalance, calculateMergedDCA, BinancePositionItem } from '../lib/tradeIngestion';

interface ImportTradeModalProps {
  onClose: () => void;
  activeTrades?: Trade[];
  onSelect: (
    symbol: string, 
    entry: number, 
    size: number, 
    feeUsd?: number, 
    isPending?: boolean, 
    type?: 'TRADE' | 'HOLDING', 
    market?: 'SPOT' | 'ALPHA',
    binanceOrderId?: string
  ) => void;
  onUpdateRunning?: (tradeId: string, entry: number, size: number, feeUsd?: number) => void;
  onMergeDCA?: (tradeId: string, addedCoins: number, addedPrice: number, addedFeeUsd?: number) => void;
  onToggleTradeType?: (trade: Trade) => void;
}

interface AlphaPreset {
  symbol: string;
  name: string;
  chain: string;
  category: string;
  defaultUsd: number;
}

const ALPHA_PRESETS: AlphaPreset[] = [
  { symbol: 'GRASSUSDT', name: 'Grass Network', chain: 'Solana', category: 'DePIN / AI', defaultUsd: 90 },
  { symbol: 'FARTCOINUSDT', name: 'Fartcoin', chain: 'Solana', category: 'Meme / AI', defaultUsd: 90 },
  { symbol: 'AI16ZUSDT', name: 'ai16z', chain: 'Solana', category: 'AI Agent', defaultUsd: 90 },
  { symbol: 'ACTUSDT', name: 'Act I Prophecy', chain: 'Solana', category: 'AI', defaultUsd: 90 },
  { symbol: 'PNUTUSDT', name: 'Peanut', chain: 'Solana', category: 'Meme', defaultUsd: 90 },
  { symbol: 'GOATUSDT', name: 'Goatseus', chain: 'Solana', category: 'AI Meme', defaultUsd: 90 },
  { symbol: 'MOODENGUSDT', name: 'Moo Deng', chain: 'Solana', category: 'Meme', defaultUsd: 90 },
  { symbol: 'VIRTUALUSDT', name: 'Virtuals Protocol', chain: 'Base', category: 'AI Agent', defaultUsd: 90 },
];

export function ImportTradeModal({ 
  onClose, 
  activeTrades = [], 
  onSelect, 
  onUpdateRunning, 
  onMergeDCA,
  onToggleTradeType 
}: ImportTradeModalProps) {
  const [activeTab, setActiveTab] = useState<'SPOT' | 'ALPHA'>('SPOT');
  const [positions, setPositions] = useState<BinancePositionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDust, setShowDust] = useState(false);
  const [expandedFills, setExpandedFills] = useState<Record<string, boolean>>({});

  // Alpha Token State
  const [alphaSymbol, setAlphaSymbol] = useState('GRASSUSDT');
  const [alphaPrice, setAlphaPrice] = useState<number>(0);
  const [alphaPriceLoading, setAlphaPriceLoading] = useState(false);
  const [alphaCoins, setAlphaCoins] = useState('');
  const [alphaUsd, setAlphaUsd] = useState('90');
  const [presetPrices, setPresetPrices] = useState<Record<string, number>>({});
  const [presetLoading, setPresetLoading] = useState(false);

  // Alpha Search Engine
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const fetchPositions = async (includeDustOption: boolean = showDust) => {
    setLoading(true);
    try {
      const url = `/api/exchange/positions${includeDustOption ? '?includeDust=true' : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.status === 'success') {
        setPositions(data.positions || []);
      } else {
        toast.error(data.message || 'Failed to fetch positions');
      }
    } catch (e) {
      toast.error('Network error fetching positions');
    } finally {
      setLoading(false);
    }
  };

  const fetchAlphaPrice = async (sym: string) => {
    setAlphaPriceLoading(true);
    try {
      const cleanSym = sym.toUpperCase().endsWith('USDT') ? sym.toUpperCase() : `${sym.toUpperCase()}USDT`;
      const res = await fetch(`/api/exchange/ticker?symbols=${cleanSym}`);
      const data = await res.json();
      if (data.status === 'success' && data.prices && data.prices[cleanSym]) {
        const p = data.prices[cleanSym];
        setAlphaPrice(p);
        setPresetPrices(prev => ({ ...prev, [cleanSym]: p }));
        if (alphaUsd && p > 0) {
          setAlphaCoins((parseFloat(alphaUsd) / p).toFixed(4));
        }
      }
    } catch (err) {
      console.warn('Error fetching alpha ticker', err);
    } finally {
      setAlphaPriceLoading(false);
    }
  };

  const fetchAllPresetPrices = async () => {
    setPresetLoading(true);
    try {
      const syms = ALPHA_PRESETS.map(p => p.symbol).join(',');
      const res = await fetch(`/api/exchange/ticker?symbols=${syms}`);
      const data = await res.json();
      if (data.status === 'success' && data.prices) {
        setPresetPrices(data.prices);
        if (data.prices[alphaSymbol]) {
          const currentP = data.prices[alphaSymbol];
          setAlphaPrice(currentP);
          if (alphaUsd && currentP > 0) {
            setAlphaCoins((parseFloat(alphaUsd) / currentP).toFixed(4));
          }
        }
      }
    } catch (err) {
      console.warn('Error fetching preset prices', err);
    } finally {
      setPresetLoading(false);
    }
  };

  // Debounced search for decentralized Alpha tokens
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await fetch(`/api/exchange/alpha/search?q=${encodeURIComponent(searchQuery.trim())}`);
        const data = await res.json();
        if (data.status === 'success') {
          setSearchResults(data.results || []);
        }
      } catch (err) {
        console.warn('Alpha search failed', err);
      } finally {
        setSearchLoading(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    fetchPositions(showDust);
    fetchAllPresetPrices();
    fetchAlphaPrice(alphaSymbol);
  }, []);

  const handleToggleDust = () => {
    const nextVal = !showDust;
    setShowDust(nextVal);
    fetchPositions(nextVal);
  };

  const toggleFillsExpand = (sym: string) => {
    setExpandedFills(prev => ({ ...prev, [sym]: !prev[sym] }));
  };

  const handleSelectPreset = (preset: AlphaPreset) => {
    setAlphaSymbol(preset.symbol);
    const cachedPrice = presetPrices[preset.symbol];
    if (cachedPrice) {
      setAlphaPrice(cachedPrice);
      const usdNum = parseFloat(alphaUsd) || preset.defaultUsd;
      setAlphaCoins((usdNum / cachedPrice).toFixed(4));
    } else {
      fetchAlphaPrice(preset.symbol);
    }
  };

  const handleSelectSearchResult = (result: any) => {
    setAlphaSymbol(result.symbol);
    if (result.priceUsd > 0) {
      setAlphaPrice(result.priceUsd);
      const usdNum = parseFloat(alphaUsd) || 90;
      setAlphaCoins((usdNum / result.priceUsd).toFixed(4));
    } else {
      fetchAlphaPrice(result.symbol);
    }
    toast.success(`Selected ${result.symbol} ($${formatPrice(result.priceUsd)})`);
  };

  const handleAlphaUsdChange = (val: string) => {
    setAlphaUsd(val);
    const num = parseFloat(val);
    if (!isNaN(num) && alphaPrice > 0) {
      setAlphaCoins((num / alphaPrice).toFixed(4));
    }
  };

  const handleAlphaCoinsChange = (val: string) => {
    setAlphaCoins(val);
    const num = parseFloat(val);
    if (!isNaN(num) && alphaPrice > 0) {
      setAlphaUsd((num * alphaPrice).toFixed(2));
    }
  };

  const handleQuickImportAlpha = (type: 'HOLDING' | 'TRADE') => {
    const coins = parseFloat(alphaCoins);
    const price = alphaPrice || (parseFloat(alphaUsd) / (coins || 1));
    if (!coins || coins <= 0) {
      toast.error('Please enter a valid coin amount or USD size');
      return;
    }
    const cleanSym = alphaSymbol.toUpperCase().endsWith('USDT') ? alphaSymbol.toUpperCase() : `${alphaSymbol.toUpperCase()}USDT`;
    onSelect(cleanSym, price, coins, 0, false, type, 'ALPHA');
  };

  const runningAlphaTrades = [...activeTrades.filter(t => isAlphaTradeOrSymbol(t))].sort(
    (a, b) => getTradeInvestedAmount(b) - getTradeInvestedAmount(a)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-md">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-2xl overflow-hidden flex flex-col shadow-2xl max-h-[90vh]">
        {/* Header */}
        <div className="flex justify-between items-center px-4 py-3.5 border-b border-neutral-800 bg-neutral-900/80">
          <div>
            <h3 className="font-bold text-white flex items-center gap-2 text-base">
              <CloudDownload className="w-5 h-5 text-blue-400" />
              World-Class Trade Ingestion Engine
            </h3>
            <p className="text-xs text-neutral-400 mt-0.5">
              Multi-trade isolation, fill-based ingestion &amp; decentralized Alpha registry
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 text-neutral-400 hover:text-white shrink-0">
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Tab Selector */}
        <div className="flex border-b border-neutral-800 bg-neutral-950/70 p-1.5 gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTab('SPOT')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition-all ${
              activeTab === 'SPOT'
                ? 'bg-neutral-800 text-white shadow-sm border border-neutral-700'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-blue-400" />
            Binance Spot Ingestion
            {positions.length > 0 && (
              <span className="px-1.5 py-0.2 bg-blue-500/20 text-blue-300 text-[10px] rounded-full font-mono">
                {positions.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('ALPHA');
              if (Object.keys(presetPrices).length === 0) fetchAllPresetPrices();
              if (!alphaPrice) fetchAlphaPrice(alphaSymbol);
            }}
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition-all ${
              activeTab === 'ALPHA'
                ? 'bg-gradient-to-r from-purple-950 to-blue-950 text-white shadow-sm border border-purple-800/60'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            Binance Alpha / Web3 Tokens
            {runningAlphaTrades.length > 0 && (
              <span className="w-2 h-2 rounded-full bg-amber-400" />
            )}
          </button>
        </div>
        
        {/* Content Body */}
        <div className="p-4 flex-1 overflow-y-auto max-h-[72vh]">
          {activeTab === 'SPOT' ? (
            <>
              {/* Alpha Awareness & Dust Filter Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="bg-purple-950/20 border border-purple-800/40 rounded-lg px-3 py-1.5 flex items-center gap-2 text-xs text-purple-200">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>Looking for <strong>GRASS</strong> or <strong>FARTCOIN</strong>?</span>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('ALPHA');
                      if (!alphaPrice) fetchAlphaPrice(alphaSymbol);
                    }}
                    className="text-purple-300 hover:text-white font-bold underline ml-1 text-xs"
                  >
                    Switch to Alpha Tab ➔
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleToggleDust}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-md border transition-all flex items-center gap-1.5 ${
                    showDust 
                      ? 'bg-amber-950/40 border-amber-600/50 text-amber-300' 
                      : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                  }`}
                  title="Toggle display of fractional coin dust under $5"
                >
                  <SlidersHorizontal className="w-3 h-3" />
                  {showDust ? 'Dust Included (< $5)' : 'Filter Dust (< $5)'}
                </button>
              </div>

              {loading ? (
                <div className="flex flex-col items-center justify-center py-12 text-neutral-400">
                   <RefreshCw className="w-8 h-8 animate-spin mb-3 text-blue-400" />
                   <p className="text-sm font-semibold text-neutral-200">Scanning Binance Spot Wallet &amp; Order Fills...</p>
                   <p className="text-xs text-neutral-500 mt-1">Cross-referencing active trades &amp; unallocated balances</p>
                </div>
              ) : positions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-neutral-500">
                   <AlertCircle className="w-8 h-8 mb-3 opacity-50 text-neutral-400" />
                   <p className="font-medium text-neutral-300">No Spot holdings or open orders found</p>
                   <p className="text-xs text-neutral-500 mt-1">Try enabling &quot;Dust Included&quot; or check your API keys.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                   {positions.map((p: any, idx: number) => {
                     const analysis = calculateUnassignedBalance(p, activeTrades);
                     const hasMultiple = analysis.existingTrades.length > 0;
                     const primaryTrade = analysis.existingTrades[0];
                     const isFillsExpanded = expandedFills[p.symbol] || false;
                     const recentFills: any[] = p.recentFills || [];
                     const isPendingTracked = p.isPendingOrder && activeTrades.some(t => {
                       if (t.status !== 'PENDING' && t.status !== 'ACTIVE') return false;
                       if (p.binanceOrderId && t.binanceOrderId && String(p.binanceOrderId) === String(t.binanceOrderId)) return true;
                       return t.symbol === p.symbol && Math.abs((t.entryPrice || 0) - p.entryPrice) <= (p.entryPrice * 0.001 || 0.001);
                     });

                     return (
                       <div 
                         key={idx} 
                         className={`bg-neutral-950 border rounded-xl p-3.5 flex flex-col gap-3 transition-all ${
                           hasMultiple 
                             ? 'border-blue-500/40 bg-blue-950/10 shadow-sm shadow-blue-950/20' 
                             : 'border-neutral-800 hover:border-neutral-700'
                         }`}
                       >
                         {/* Card Header */}
                         <div className="flex justify-between items-start">
                           <div>
                             <div className="flex flex-wrap items-center gap-2 mb-1">
                                <span className="font-bold text-base text-neutral-100 font-mono">{p.symbol}</span>
                                {p.isPendingOrder ? (
                                  <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded font-semibold border border-yellow-500/30">
                                    PENDING LIMIT ORDER
                                  </span>
                                ) : (
                                  <span className="text-[10px] bg-neutral-800 text-neutral-400 px-1.5 py-0.5 rounded font-semibold">
                                    SPOT WALLET
                                  </span>
                                )}
                                {isPendingTracked && (
                                  <span className="text-[10px] bg-blue-500/20 text-sky-400 border border-blue-500/30 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                                    <Check className="w-3 h-3 text-sky-400" />
                                    Tracked in App
                                  </span>
                                )}
                                {hasMultiple && (
                                  <span className="text-[10px] bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                                    {analysis.existingTrades.length} Running Trade{analysis.existingTrades.length > 1 ? 's' : ''}
                                  </span>
                                )}
                             </div>

                             <div className="text-xs text-neutral-400 flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                               <span>Binance Entry: <strong className="text-neutral-200">${formatPrice(p.entryPrice)}</strong></span>
                               <span>Total Coins: <strong className="text-neutral-200">{Math.abs(p.positionAmt).toLocaleString()}</strong></span>
                               {p.feeUsd ? (
                                 <span>Fees: <strong className="text-amber-400">${p.feeUsd.toFixed(4)}</strong></span>
                               ) : null}
                             </div>
                           </div>
                           
                           <div className="text-right">
                             {!p.isPendingOrder && (
                               <div className={`text-sm font-bold ${p.unRealizedProfit >= 0 ? 'text-sky-400' : 'text-slate-400'}`}>
                                 {p.unRealizedProfit >= 0 ? '+' : ''}${p.unRealizedProfit.toFixed(2)}
                               </div>
                             )}
                             <div className="text-[10px] text-neutral-500 mt-0.5">
                               Val: ${(p.usdValue || 0).toFixed(2)}
                             </div>
                           </div>
                         </div>

                         {/* Multi-Trade Breakdown & Unassigned Volume Bar */}
                         {hasMultiple && (
                           <div className="bg-neutral-900/90 border border-neutral-800 rounded-lg p-3 flex flex-col gap-2.5">
                             <div className="flex flex-wrap items-center justify-between text-xs">
                               <div className="text-neutral-400">
                                 Tracked in App: <strong className="text-white">{analysis.trackedCoins.toLocaleString()} coins</strong>
                               </div>
                               <div className="text-neutral-400">
                                 Unassigned Balance: <strong className={analysis.hasUnassigned ? 'text-amber-400' : 'text-neutral-400'}>
                                   {analysis.unassignedCoins > 0 ? `${analysis.unassignedCoins.toLocaleString()} coins ($${analysis.unassignedUsdValue.toFixed(2)})` : '0 (Fully Tracked)'}
                                 </strong>
                               </div>
                             </div>

                             {/* Multi-Trade Action Suite */}
                             <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-neutral-800/80">
                               {/* 1. Adjust / Sync Running Trade */}
                               {onUpdateRunning && primaryTrade && (
                                 <Button 
                                   size="sm" 
                                   onClick={() => onUpdateRunning(primaryTrade.id!, p.entryPrice, p.positionAmt, p.feeUsd)}
                                   className="bg-blue-600 hover:bg-blue-500 text-white text-xs h-8 font-semibold flex items-center gap-1.5"
                                   title="Reconcile and sync this trade directly with Binance wallet total"
                                 >
                                   <RefreshCw className="w-3.5 h-3.5" />
                                   Sync Running Trade
                                 </Button>
                               )}

                               {/* 2. Import as NEW Independent Trade */}
                               <Button 
                                 size="sm" 
                                 onClick={() => {
                                   const qtyToImport = analysis.hasUnassigned ? analysis.unassignedCoins : p.positionAmt;
                                   onSelect(p.symbol, p.entryPrice, qtyToImport, p.feeUsd, p.isPendingOrder, 'TRADE', 'SPOT', p.binanceOrderId);
                                 }}
                                 className="bg-blue-600 hover:bg-blue-500 text-white text-xs h-8 font-semibold flex items-center gap-1 shadow-sm"
                                 title="Create a completely separate, independent trade record with its own stops and targets"
                                >
                                 <Plus className="w-3.5 h-3.5" />
                                 + Import as NEW Trade
                               </Button>

                               {/* 3. DCA Merge into Running Trade */}
                               {onMergeDCA && primaryTrade && analysis.hasUnassigned && (
                                 <Button 
                                   size="sm" 
                                   variant="outline"
                                   onClick={() => onMergeDCA(primaryTrade.id!, analysis.unassignedCoins, p.entryPrice, p.feeUsd)}
                                   className="border-amber-600/60 text-amber-300 hover:bg-amber-950/40 text-xs h-8 font-semibold flex items-center gap-1"
                                   title="DCA / Merge unassigned coins into the existing trade, recalculating average entry"
                                 >
                                   <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
                                   DCA into Running
                                 </Button>
                               )}

                               {/* 4. Import as Holding */}
                               <Button 
                                 size="sm" 
                                 variant="outline" 
                                 onClick={() => {
                                   const qtyToImport = analysis.hasUnassigned ? analysis.unassignedCoins : p.positionAmt;
                                   onSelect(p.symbol, p.entryPrice, qtyToImport, p.feeUsd, p.isPendingOrder, 'HOLDING', 'SPOT', p.binanceOrderId);
                                 }}
                                 className="text-purple-300 border-purple-700/60 hover:bg-purple-950/40 text-xs h-8 font-semibold flex items-center gap-1"
                                 title="Import unassigned coins as a passive long-term holding"
                               >
                                 <Plus className="w-3.5 h-3.5 text-purple-400" />
                                 + New Holding
                               </Button>
                             </div>
                           </div>
                         )}

                         {/* When no prior running trade exists */}
                         {!hasMultiple && (
                           <div className="flex justify-end pt-1 gap-2 border-t border-neutral-800/60">
                             {p.isPendingOrder && isPendingTracked ? (
                               <div className="text-xs text-sky-400 bg-blue-950/30 border border-blue-500/20 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                                 <Check className="w-3.5 h-3.5 text-sky-400" />
                                 <span>Limit Order Already Tracked in App</span>
                               </div>
                             ) : (
                               <>
                                 <Button 
                                   size="sm" 
                                   onClick={() => onSelect(p.symbol, p.entryPrice, p.positionAmt, p.feeUsd, p.isPendingOrder, 'TRADE', 'SPOT', p.binanceOrderId)}
                                   className="bg-blue-600 hover:bg-blue-500 text-white text-xs h-8 font-semibold flex items-center gap-1.5 px-3.5"
                                 >
                                   <CloudDownload className="w-3.5 h-3.5" />
                                   {p.isPendingOrder ? 'Import Limit Order' : 'Import Trade'}
                                 </Button>
                                 <Button 
                                   size="sm" 
                                   variant="outline" 
                                   onClick={() => onSelect(p.symbol, p.entryPrice, p.positionAmt, p.feeUsd, p.isPendingOrder, 'HOLDING', 'SPOT', p.binanceOrderId)}
                                   className="border-purple-500/50 text-purple-300 hover:bg-purple-950/40 text-xs h-8 font-semibold flex items-center gap-1.5 px-3.5"
                                 >
                                   <Coins className="w-3.5 h-3.5" />
                                   Import Holding
                                 </Button>
                               </>
                             )}
                           </div>
                         )}

                         {/* Granular Execution Fills Expansion */}
                         {recentFills.length > 0 && (
                           <div className="pt-1">
                             <button
                               type="button"
                               onClick={() => toggleFillsExpand(p.symbol)}
                               className="text-[11px] text-neutral-400 hover:text-neutral-200 font-medium flex items-center gap-1.5"
                             >
                               {isFillsExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                               <span>View Granular BUY Execution Fills ({recentFills.length})</span>
                             </button>

                             {isFillsExpanded && (
                               <div className="mt-2 bg-neutral-900 border border-neutral-800 rounded-lg p-2.5 flex flex-col gap-2">
                                 <div className="text-[10px] text-neutral-400 uppercase font-semibold">
                                   Recent Order Executions from Binance:
                                 </div>
                                 <div className="flex flex-col gap-1.5">
                                   {recentFills.map((f: any, fIdx: number) => (
                                     <div 
                                       key={fIdx}
                                       className="bg-neutral-950 border border-neutral-800/80 rounded px-2.5 py-1.5 flex items-center justify-between text-xs"
                                     >
                                       <div>
                                         <span className="font-mono text-white font-semibold">{f.qty.toLocaleString()} coins</span> @ <span className="text-sky-400 font-mono">${formatPrice(f.price)}</span>
                                         <span className="text-neutral-500 text-[10px] ml-2">
                                           Order #{f.orderId} • {new Date(f.time).toLocaleDateString()}
                                         </span>
                                       </div>
                                       <Button
                                         size="sm"
                                         variant="outline"
                                         onClick={() => onSelect(p.symbol, f.price, f.qty, f.feeUsd, false, 'TRADE', 'SPOT', f.orderId)}
                                         className="h-6 text-[10px] px-2 border-neutral-700 hover:bg-neutral-800 text-neutral-300 font-semibold"
                                       >
                                         Import Fill
                                       </Button>
                                     </div>
                                   ))}
                                 </div>
                               </div>
                             )}
                           </div>
                         )}
                       </div>
                     );
                   })}
                </div>
              )}
            </>
          ) : (
            /* Binance Alpha / Web3 Tab */
            <div className="flex flex-col gap-4">
              {/* Alpha Explanation Banner */}
              <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-3.5">
                <div className="flex items-start gap-2.5">
                  <Sparkles className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                  <div className="text-xs text-neutral-300 leading-relaxed">
                    <strong className="text-white">Binance Alpha &amp; Web3 Token Discovery:</strong>
                    <br />
                    Tokens like <strong className="text-purple-300">GRASS</strong>, <strong className="text-purple-300">FARTCOIN</strong>, and <strong className="text-purple-300">AI16Z</strong> execute on-chain through decentralized DEX smart contracts (Solana/EVM). Search any token below or pick from our live Alpha catalog.
                  </div>
                </div>
              </div>

              {/* Dynamic Live Alpha Search Bar */}
              <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-3.5 flex flex-col gap-2">
                <label className="text-xs font-bold text-white flex items-center gap-1.5 uppercase tracking-wider">
                  <Search className="w-3.5 h-3.5 text-purple-400" />
                  Live Decentralized Token Search (Solana / BSC / Base)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by Symbol (e.g. GRASS, FARTCOIN, AI16Z) or Contract Address..."
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3.5 py-2.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500 font-mono"
                  />
                  {searchLoading && (
                    <span className="absolute right-3 top-2.5 text-purple-400">
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    </span>
                  )}
                </div>

                {/* Live Search Results Dropdown */}
                {searchResults.length > 0 && (
                  <div className="mt-1 bg-neutral-900 border border-purple-800/60 rounded-lg max-h-48 overflow-y-auto divide-y divide-neutral-800">
                    {searchResults.map((res, sIdx) => (
                      <div 
                        key={sIdx}
                        onClick={() => handleSelectSearchResult(res)}
                        className="p-2.5 hover:bg-neutral-800/70 cursor-pointer flex items-center justify-between text-xs transition-colors"
                      >
                        <div>
                          <div className="flex items-center gap-1.5">
                            <strong className="text-white font-mono">{res.symbol}</strong>
                            <span className="text-[10px] text-neutral-400">({res.name})</span>
                            <span className="text-[9px] bg-purple-950 text-purple-300 border border-purple-800/50 px-1.5 py-0.2 rounded font-mono">
                              {res.chain} • {res.dexId}
                            </span>
                          </div>
                          <div className="text-[10px] text-neutral-500 mt-0.5">
                            Liq: ${(res.liquidityUsd || 0).toLocaleString()} • Vol24h: ${(res.volume24h || 0).toLocaleString()}
                          </div>
                        </div>

                        <div className="text-right flex items-center gap-2">
                          <span className="font-bold text-sky-400 font-mono">
                            ${formatPrice(res.priceUsd)}
                          </span>
                          <span className="text-[10px] bg-purple-600 hover:bg-purple-500 text-white font-semibold px-2 py-1 rounded">
                            Select
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Popular Alpha Tokens Catalog */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Coins className="w-3.5 h-3.5 text-purple-400" />
                    Popular Binance Alpha Tokens
                  </span>
                  {presetLoading && (
                    <span className="text-[10px] text-neutral-400 flex items-center gap-1">
                      <RefreshCw className="w-3 h-3 animate-spin text-purple-400" /> Updating live prices...
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-2 gap-2">
                  {ALPHA_PRESETS.map((preset) => {
                    const isSelected = alphaSymbol === preset.symbol;
                    const price = presetPrices[preset.symbol];
                    return (
                      <div
                        key={preset.symbol}
                        onClick={() => handleSelectPreset(preset)}
                        className={`cursor-pointer rounded-xl p-3 border transition-all text-left flex flex-col justify-between ${
                          isSelected
                            ? 'bg-purple-950/40 border-purple-500 shadow-md shadow-purple-950/30 ring-1 ring-purple-500/50'
                            : 'bg-neutral-950 border-neutral-800 hover:border-neutral-700'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-1 mb-1.5">
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-sm text-white">{preset.name}</span>
                              <span className="text-[9px] px-1 py-0.2 bg-neutral-800 text-neutral-400 rounded font-mono">
                                {preset.chain}
                              </span>
                            </div>
                            <div className="text-[10px] text-neutral-400 font-mono">
                              {preset.symbol}
                            </div>
                          </div>
                          {isSelected && (
                            <span className="w-4 h-4 rounded-full bg-purple-500 text-white flex items-center justify-center shrink-0">
                              <Check className="w-2.5 h-2.5" />
                            </span>
                          )}
                        </div>

                        <div className="flex items-baseline justify-between pt-1 border-t border-neutral-800/60 mt-1">
                          <span className="text-[10px] text-neutral-500">{preset.category}</span>
                          <span className="text-xs font-bold text-sky-400 font-mono">
                            {price !== undefined ? `$${formatPrice(price)}` : '...'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Detected Existing Alpha Trades in App */}
              {runningAlphaTrades.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                    Currently Tracked Alpha Positions ({runningAlphaTrades.length})
                  </span>
                  {runningAlphaTrades.map(trade => (
                    <div 
                      key={trade.id} 
                      className="bg-neutral-950 border border-purple-800/40 rounded-lg p-3 flex items-center justify-between"
                    >
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-sm text-white font-mono">{trade.symbol}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold border ${
                            trade.type === 'HOLDING'
                              ? 'bg-purple-950/50 text-purple-300 border-purple-700/50'
                              : 'bg-blue-950/50 text-blue-300 border-blue-700/50'
                          }`}>
                            {trade.type === 'HOLDING' ? 'SPOT HOLDING' : 'ACTIVE TRADE'}
                          </span>
                        </div>
                        <div className="text-xs text-neutral-400">
                          Entry: <strong className="text-neutral-200">${formatPrice(trade.entryPrice)}</strong> • 
                          Size: <strong className="text-neutral-200">${(trade.totalBuyUsd || 0).toFixed(2)}</strong> ({trade.positionSizeCoins?.toLocaleString()} coins)
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {onToggleTradeType && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onToggleTradeType(trade)}
                            className={`text-xs h-8 font-semibold px-3 ${
                              trade.type === 'HOLDING'
                                ? 'border-blue-700/60 text-blue-300 hover:bg-blue-950/40'
                                : 'border-purple-700/60 text-purple-300 hover:bg-purple-950/40'
                            }`}
                          >
                            {trade.type === 'HOLDING' ? 'Move to Active Trades' : 'Move to Holdings'}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Quick Add / Import Selected Alpha Token */}
              <div className="bg-neutral-950 border border-purple-900/50 rounded-xl p-4 flex flex-col gap-3 shadow-lg shadow-purple-950/10">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-purple-400" />
                    Configure &amp; Import: <span className="text-purple-300 font-mono">{alphaSymbol}</span>
                  </span>
                  {alphaPriceLoading ? (
                    <span className="text-[10px] text-neutral-400 flex items-center gap-1">
                      <RefreshCw className="w-3 h-3 animate-spin text-purple-400" /> Fetching live price...
                    </span>
                  ) : alphaPrice > 0 ? (
                    <span className="text-[11px] text-sky-400 font-bold bg-blue-950/40 border border-blue-800/40 px-2.5 py-0.5 rounded font-mono">
                      Live Price: ${formatPrice(alphaPrice)}
                    </span>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[10px] text-neutral-400 font-semibold uppercase block mb-1">
                      Token Symbol / Pair
                    </label>
                    <input
                      type="text"
                      value={alphaSymbol}
                      onChange={(e) => {
                        const s = e.target.value.toUpperCase();
                        setAlphaSymbol(s);
                        fetchAlphaPrice(s);
                      }}
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500 font-mono"
                      placeholder="GRASSUSDT"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-neutral-400 font-semibold uppercase block mb-1">
                      Position Size (USD)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={alphaUsd}
                      onChange={(e) => handleAlphaUsdChange(e.target.value)}
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500 font-mono"
                      placeholder="90.00"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] text-neutral-400 font-semibold uppercase block mb-1">
                    Coins Amount
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={alphaCoins}
                    onChange={(e) => handleAlphaCoinsChange(e.target.value)}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500 font-mono"
                    placeholder="Auto-calculated from live price &amp; USD"
                  />
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-neutral-800/80">
                  <Button
                    size="sm"
                    onClick={() => handleQuickImportAlpha('HOLDING')}
                    className="flex-1 bg-purple-600 hover:bg-purple-500 text-white text-xs h-9 font-semibold flex items-center justify-center gap-1.5 shadow-md shadow-purple-900/20"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Import as Holding
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleQuickImportAlpha('TRADE')}
                    className="flex-1 border-purple-700/60 hover:bg-purple-950/40 text-purple-200 text-xs h-9 font-semibold flex items-center justify-center gap-1.5"
                  >
                    <CloudDownload className="w-3.5 h-3.5 text-purple-400" />
                    Import as Trade
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
