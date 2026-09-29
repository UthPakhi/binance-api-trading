import React, { useState } from 'react';
import { Trade, DisciplineTag } from '../types';
import { DISCIPLINE_TAGS, formatCurrency, getTradeEffectiveRisk } from '../lib/tradeUtils';
import { X, Check, Brain, ShieldAlert, Award } from 'lucide-react';
import { Button } from './Button';

interface DisciplineReviewModalProps {
  trade: Trade | null;
  isOpen: boolean;
  onClose: () => void;
  onSaveTag: (tradeId: string, tag: DisciplineTag, note?: string) => Promise<void>;
}

export function DisciplineReviewModal({
  trade,
  isOpen,
  onClose,
  onSaveTag
}: DisciplineReviewModalProps) {
  const [selectedTag, setSelectedTag] = useState<DisciplineTag | null>(trade?.disciplineTag || null);
  const [note, setNote] = useState<string>(trade?.disciplineNotes || '');
  const [saving, setSaving] = useState(false);

  // Sync state if trade changes
  React.useEffect(() => {
    if (trade) {
      setSelectedTag(trade.disciplineTag || null);
      setNote(trade.disciplineNotes || '');
    }
  }, [trade]);

  if (!isOpen || !trade || !trade.id) return null;

  const realizedPnL = trade.realizedProfitUsd !== undefined ? trade.realizedProfitUsd : 0;
  const isWin = realizedPnL >= 0;
  const risk = getTradeEffectiveRisk(trade);
  const rMultiple = risk > 0 ? (realizedPnL / risk).toFixed(2) : null;

  const handleSelectTagAndSave = async (tag: DisciplineTag) => {
    setSelectedTag(tag);
    setSaving(true);
    try {
      await onSaveTag(trade.id!, tag, note);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleManualSave = async () => {
    if (!selectedTag) return;
    setSaving(true);
    try {
      await onSaveTag(trade.id!, selectedTag, note);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const tagList = Object.values(DISCIPLINE_TAGS);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[92vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-neutral-800/80 flex items-center justify-between bg-neutral-950/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <Brain className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>Discipline Check</span>
                <span className="text-xs px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 font-mono">
                  {trade.symbol}
                </span>
              </h3>
              <p className="text-[11px] text-neutral-400">
                Log the psychological execution of this trade to track your discipline score.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-white p-1 rounded-lg hover:bg-neutral-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-4">
          {/* Quick Trade Outcome Summary */}
          <div className="bg-neutral-950/80 p-3 rounded-xl border border-neutral-800 flex items-center justify-between">
            <div>
              <span className="text-[10px] text-neutral-500 font-semibold uppercase tracking-wider block">Outcome</span>
              <div className={`text-base font-bold font-mono ${isWin ? 'text-sky-400' : 'text-slate-400'}`}>
                {isWin ? '+' : ''}{formatCurrency(realizedPnL)}
                {rMultiple && (
                  <span className={`text-xs ml-1.5 px-1.5 py-0.5 rounded font-semibold ${isWin ? 'bg-blue-500/20 text-sky-300' : 'bg-slate-800 text-slate-300'}`}>
                    {isWin ? '+' : ''}{rMultiple}R
                  </span>
                )}
              </div>
            </div>

            <div className="text-right">
              <span className="text-[10px] text-neutral-500 font-semibold uppercase tracking-wider block">Exit Price</span>
              <span className="text-xs font-mono font-bold text-neutral-200">
                ${trade.exitPrice?.toLocaleString() || trade.entryPrice?.toLocaleString()}
              </span>
            </div>
          </div>

          {/* 1-Click Discipline Selection */}
          <div>
            <label className="text-xs font-semibold text-neutral-300 block mb-2">
              How was this trade executed? <span className="text-neutral-500 font-normal">(1-click to save)</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {tagList.map(tag => {
                const isSelected = selectedTag === tag.key;
                return (
                  <button
                    key={tag.key}
                    type="button"
                    disabled={saving}
                    onClick={() => handleSelectTagAndSave(tag.key)}
                    className={`p-2.5 rounded-xl border text-left transition-all relative flex flex-col justify-between ${
                      isSelected
                        ? `${tag.badgeClass} ring-1 ring-current bg-opacity-25`
                        : 'bg-neutral-950/50 hover:bg-neutral-800/60 border-neutral-800/80 text-neutral-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5 font-bold text-xs">
                        <span>{tag.icon}</span>
                        <span>{tag.label}</span>
                      </div>
                      {tag.isPlanned ? (
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-blue-500/10 text-sky-400 border border-blue-500/20 font-medium">
                          Planned
                        </span>
                      ) : (
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
                          Deviation
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-neutral-400 leading-tight">
                      {tag.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Optional Reflection Note */}
          <div>
            <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider block mb-1">
              Reflective Note / Lesson <span className="text-neutral-600 font-normal lowercase">(optional)</span>
            </label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. Waited for 15m candle close confirmation; executed according to rulebook."
              rows={2}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-2.5 text-xs text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-purple-500 transition-colors resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-neutral-800/80 bg-neutral-950/40 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-xs text-neutral-500 hover:text-neutral-300"
          >
            Skip for Now
          </Button>

          {selectedTag && (
            <Button
              size="sm"
              disabled={saving}
              onClick={handleManualSave}
              className="text-xs bg-purple-600 hover:bg-purple-500 text-white font-semibold px-4"
            >
              <Check className="w-3.5 h-3.5 mr-1.5" />
              {saving ? 'Saving...' : 'Save Tag & Note'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
