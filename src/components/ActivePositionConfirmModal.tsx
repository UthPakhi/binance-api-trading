import React from 'react';
import { Button } from './Button';
import { Trade } from '../types';
import { formatPrice, getCleanSymbol } from '../lib/tradeUtils';
import { calculateMergedDCA } from '../lib/tradeIngestion';
import { 
  X, AlertTriangle, Plus, GitMerge, ShieldCheck, 
  TrendingUp, ArrowRight, Layers, Coins 
} from 'lucide-react';

export interface ActivePositionConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  symbol: string;
  newTrade: Partial<Trade>;
  existingPositions: Trade[];
  onConfirmNewTrade: () => void | Promise<void>;
  onConfirmMerge: (targetTradeId: string, mergedData: {
    newPositionSizeCoins: number;
    newEntryPrice: number;
    newTotalBuyUsd: number;
    newFeeUsd: number;
  }) => void | Promise<void>;
}

export function ActivePositionConfirmModal({
  isOpen,
  onClose,
  symbol,
  newTrade,
  existingPositions,
  onConfirmNewTrade,
  onConfirmMerge
}: ActivePositionConfirmModalProps) {
  if (!isOpen) return null;

  const cleanSym = getCleanSymbol(symbol || newTrade.symbol || '');
  const primaryExisting = existingPositions[0];

  const newCoins = newTrade.positionSizeCoins || 0;
  const newEntry = newTrade.entryPrice || 0;
  const newUsd = newTrade.totalBuyUsd || (newCoins * newEntry);
  const newFee = newTrade.feeUsd || 0;

  // Calculate DCA preview if merged into primary
  const dcaPreview = primaryExisting 
    ? calculateMergedDCA(primaryExisting, newCoins, newEntry, newFee)
    : null;

  const isHolding = primaryExisting?.type === 'HOLDING';
  const existingLabel = isHolding ? 'Investment Holding' : 'Active Trade';
  const existingIcon = isHolding ? '💎' : '⚡';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
      <div 
        className="bg-neutral-900 border border-neutral-700/80 rounded-2xl w-full max-w-lg overflow-hidden flex flex-col shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-start px-4 sm:px-5 py-4 border-b border-neutral-800 bg-neutral-950/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-white text-base">
                  Active Position Detected
                </h3>
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                  {cleanSym}
                </span>
              </div>
              <p className="text-xs text-neutral-400 mt-0.5">
                You already have {existingPositions.length > 1 ? `${existingPositions.length} active positions` : `an active ${existingLabel.toLowerCase()}`} for {cleanSym}.
              </p>
            </div>
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={onClose} 
            className="h-8 w-8 text-neutral-400 hover:text-white shrink-0 -mr-1"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Comparison Cards */}
        <div className="p-4 sm:p-5 flex flex-col gap-3.5 max-h-[75vh] overflow-y-auto">
          {/* 1. Existing Active Position */}
          <div className="bg-neutral-950/80 border border-neutral-800 rounded-xl p-3.5 flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-400 font-semibold uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                <span>{existingIcon}</span>
                Existing {existingLabel}
              </span>
              <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
                isHolding 
                  ? 'bg-purple-950/60 text-purple-300 border border-purple-800/80' 
                  : 'bg-blue-950/60 text-blue-300 border border-blue-800/80'
              }`}>
                {isHolding ? 'Investments' : 'Active Trades'}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
              <div className="bg-neutral-900/80 p-2 rounded-lg border border-neutral-800/60">
                <span className="text-[10px] text-neutral-500 block">Current Coins</span>
                <span className="font-mono font-bold text-neutral-200">
                  {(primaryExisting?.positionSizeCoins || 0).toLocaleString()}
                </span>
              </div>
              <div className="bg-neutral-900/80 p-2 rounded-lg border border-neutral-800/60">
                <span className="text-[10px] text-neutral-500 block">Avg Entry</span>
                <span className="font-mono font-bold text-neutral-200">
                  ${formatPrice(primaryExisting?.entryPrice || 0)}
                </span>
              </div>
              <div className="bg-neutral-900/80 p-2 rounded-lg border border-neutral-800/60">
                <span className="text-[10px] text-neutral-500 block">Total Invested</span>
                <span className="font-mono font-bold text-neutral-200">
                  ${(primaryExisting?.totalBuyUsd || 0).toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* 2. New Allocation Being Added */}
          <div className="bg-neutral-950/80 border border-sky-500/30 rounded-xl p-3.5 flex flex-col gap-2 bg-gradient-to-b from-sky-950/10 to-transparent">
            <div className="flex items-center justify-between text-xs">
              <span className="text-sky-300 font-semibold uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5 text-sky-400" />
                New Allocation To Add
              </span>
              <span className="text-[10px] bg-sky-500/20 text-sky-300 px-2 py-0.5 rounded font-bold uppercase tracking-wider border border-sky-500/30">
                Incoming
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
              <div className="bg-neutral-900/80 p-2 rounded-lg border border-neutral-800/60">
                <span className="text-[10px] text-neutral-500 block">New Coins</span>
                <span className="font-mono font-bold text-sky-300">
                  +{newCoins.toLocaleString()}
                </span>
              </div>
              <div className="bg-neutral-900/80 p-2 rounded-lg border border-neutral-800/60">
                <span className="text-[10px] text-neutral-500 block">New Entry</span>
                <span className="font-mono font-bold text-sky-300">
                  ${formatPrice(newEntry)}
                </span>
              </div>
              <div className="bg-neutral-900/80 p-2 rounded-lg border border-neutral-800/60">
                <span className="text-[10px] text-neutral-500 block">Cost (USD)</span>
                <span className="font-mono font-bold text-sky-300">
                  ${newUsd.toFixed(2)}
                </span>
              </div>
            </div>

            {newTrade.stopLoss ? (
              <div className="flex items-center gap-3 text-[11px] text-neutral-400 pt-1">
                <span>Stop Loss: <strong className="text-slate-300 font-mono">${formatPrice(newTrade.stopLoss)}</strong></span>
                {newTrade.takeProfit1 ? (
                  <span>TP1: <strong className="text-blue-400 font-mono">${formatPrice(newTrade.takeProfit1)}</strong></span>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* DCA Preview Info */}
          {dcaPreview && (
            <div className="bg-neutral-950/40 border border-neutral-800/80 rounded-xl px-3 py-2 text-xs flex items-center justify-between text-neutral-400">
              <span className="flex items-center gap-1.5 text-[11px]">
                <GitMerge className="w-3.5 h-3.5 text-purple-400" />
                If merged (DCA):
              </span>
              <div className="flex items-center gap-2 font-mono text-[11px]">
                <span>{dcaPreview.newPositionSizeCoins.toLocaleString()} coins</span>
                <span className="text-neutral-600">•</span>
                <span className="text-purple-300 font-bold">New Avg ${formatPrice(dcaPreview.newEntryPrice)}</span>
              </div>
            </div>
          )}

          {/* Action Choice Buttons */}
          <div className="flex flex-col gap-2.5 pt-2">
            {/* Choice 1: Create as NEW standalone trade */}
            <button
              type="button"
              onClick={() => {
                onConfirmNewTrade();
                onClose();
              }}
              className="group text-left p-3.5 rounded-xl border border-blue-500/40 bg-gradient-to-r from-blue-950/30 to-blue-900/10 hover:from-blue-950/50 hover:border-blue-500/70 transition-all flex items-start gap-3 shadow-sm hover:shadow-blue-950/30"
            >
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-sky-400 border border-blue-500/30 flex items-center justify-center shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
                <Plus className="w-4 h-4 text-sky-400" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm text-white group-hover:text-sky-300 transition-colors">
                    Make as New Standalone Trade
                  </span>
                  <span className="text-[10px] bg-blue-500/20 text-sky-300 px-2 py-0.5 rounded-full font-semibold border border-blue-500/30">
                    Recommended
                  </span>
                </div>
                <p className="text-xs text-neutral-400 mt-0.5 leading-relaxed">
                  Keep this trade completely separate in Active Trades with its own stop loss, take profit targets, and independent PnL. Does not touch your existing {existingLabel.toLowerCase()}.
                </p>
              </div>
            </button>

            {/* Choice 2: Merge into existing */}
            {primaryExisting && dcaPreview && (
              <button
                type="button"
                onClick={() => {
                  onConfirmMerge(primaryExisting.id!, dcaPreview);
                  onClose();
                }}
                className="group text-left p-3.5 rounded-xl border border-neutral-700 hover:border-purple-500/60 bg-neutral-950/60 hover:bg-purple-950/20 transition-all flex items-start gap-3"
              >
                <div className="w-8 h-8 rounded-lg bg-purple-500/15 text-purple-400 border border-purple-500/30 flex items-center justify-center shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
                  <GitMerge className="w-4 h-4 text-purple-400" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-neutral-200 group-hover:text-purple-300 transition-colors">
                      Merge into Existing {existingLabel}
                    </span>
                    <span className="text-[10px] text-neutral-500 font-mono">
                      DCA Blend
                    </span>
                  </div>
                  <p className="text-xs text-neutral-400 mt-0.5 leading-relaxed">
                    Combine the new coins into your existing {existingLabel.toLowerCase()}. Automatically calculates blended average entry price (${formatPrice(dcaPreview.newEntryPrice)}).
                  </p>
                </div>
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-neutral-800 bg-neutral-950 flex justify-end gap-2">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={onClose}
            className="text-neutral-400 hover:text-white text-xs h-8"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
