export interface Trade {
  id?: string;
  userId: string;
  symbol: string;
  portfolioSize: number;
  riskPercent: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit1?: number;
  takeProfit2?: number;
  takeProfit3?: number;
  
  // Computed stats stored for history
  riskAmount: number;
  positionSizeCoins: number;
  isLong?: boolean;
  totalBuyUsd: number;
  tp1RR?: number;
  tp1Profit?: number;
  
  // New fields for exit strategy
  tp1Percent?: number;
  tp2Percent?: number;
  tp3Percent?: number;
  totalProfitUsd?: number;
  totalProfitPkr?: number;
  pkrRate?: number;
  
  feeUsd?: number;
  buyFeeUsd?: number;
  sellFeeUsd?: number;
  totalFeesUsd?: number;
  soldCoins?: number;
  blendedBreakevenPrice?: number;

  // Execution tracking & precision
  binanceOrderId?: number | string;
  clientOrderId?: string;
  slippagePercent?: number;
  worstCaseLossUsd?: number;

  status?: string;
  type?: 'TRADE' | 'HOLDING';
  category?: string;
  market?: 'SPOT' | 'ALPHA' | 'FUTURES';
  isAlpha?: boolean;
  isDemo?: boolean;
  feeTier?: FeeTierId;
  realizedProfitUsd?: number;
  exitPrice?: number;
  totalSellUsd?: number;
  notifiedMilestones?: string[];
  notes?: string;

  // Trading psychology & discipline fields
  disciplineTag?: DisciplineTag;
  disciplineNotes?: string;
  
  createdAt: number;
  filledAt?: number;
  closedAt?: number;
  slUpdatedAt?: number;
  updatedAt?: number;
}

export type DisciplineTag = 
  | 'PLAN_FOLLOWED'    // 🎯 Executed per plan
  | 'FOMO_CHASED'      // ⚡ Chased entry / FOMO
  | 'ANXIETY_EXIT'     // 😰 Exited early due to anxiety / fear
  | 'MOVED_SL'         // 🛑 Widened SL / broke risk limit
  | 'GREED_OVERHELD'   // 🚀 Held too long / greed
  | 'REVENGE_TRADE';   // 🔄 Revenge trade

export type PnlViewMode = 'DOLLAR' | 'R_MULTIPLE' | 'PERCENT' | 'ZEN';

export type TradeRiskType = 'HARD_STOP' | 'BREAKEVEN' | 'PORTFOLIO_UNIT' | 'POSITION_COST';

export interface RecommendedStops {
  conservative: number; // e.g. -3% or 1:3 RR stop
  balanced: number;     // e.g. -5% or 1:2 RR stop
  aggressive: number;   // e.g. -10% or 1:1.5 RR stop
}

export interface TradeRiskFramework {
  riskType: TradeRiskType;
  effectiveRiskAmount: number;      // Risk denominator used for R calculations
  maxDownsideExposure: number;      // Full capital at risk if price -> 0
  portfolioRiskUnit: number;        // 1R = Portfolio * (riskPercent || 1%)
  isUnprotected: boolean;           // True if no hard stop loss is set
  isBreakeven: boolean;             // True if stop loss protects entry price
  impliedStopLoss: number | null;   // Benchmark stop loss (e.g. 1:2 RR or -5%)
  impliedRiskReward: number | null; // Calculated or implied R:R to TP1
  benchmarkLabel: string;           // Descriptive label for how risk is framed
  recommendedStops: RecommendedStops | null;
}

export interface BinanceBalanceInfo {
  totalEquity: number;
  usdtTotal: number;
  usdtFree: number;
  usdtLocked: number;
  futTotal?: number;
  fundingTotal?: number;
  assets?: Array<{ asset: string; free: number; locked: number; total: number; usdValue: number }>;
  lastUpdated: number;
}

export type FeeTierId = 'BINANCE_STANDARD' | 'BINANCE_BNB' | 'VIP_1' | 'VIP_2' | 'ZERO_FEE' | 'CUSTOM';

export interface FeeTierProfile {
  id: FeeTierId;
  name: string;
  makerFeeRate: number; // e.g. 0.001 for 0.1%
  takerFeeRate: number; // e.g. 0.001 for 0.1%
  description: string;
}

export const FEE_TIERS: Record<FeeTierId, FeeTierProfile> = {
  BINANCE_STANDARD: {
    id: 'BINANCE_STANDARD',
    name: 'Standard (0.10%)',
    makerFeeRate: 0.001,
    takerFeeRate: 0.001,
    description: 'Binance standard spot fee'
  },
  BINANCE_BNB: {
    id: 'BINANCE_BNB',
    name: 'BNB 25% Off (0.075%)',
    makerFeeRate: 0.00075,
    takerFeeRate: 0.00075,
    description: '25% discount using BNB deduction'
  },
  VIP_1: {
    id: 'VIP_1',
    name: 'VIP 1 (0.075% / 0.09%)',
    makerFeeRate: 0.00075,
    takerFeeRate: 0.0009,
    description: 'Binance VIP 1 volume tier'
  },
  VIP_2: {
    id: 'VIP_2',
    name: 'VIP 2 (0.06% / 0.08%)',
    makerFeeRate: 0.0006,
    takerFeeRate: 0.0008,
    description: 'Binance VIP 2 volume tier'
  },
  ZERO_FEE: {
    id: 'ZERO_FEE',
    name: 'Zero Fee (0.00%)',
    makerFeeRate: 0,
    takerFeeRate: 0,
    description: 'FDUSD / USDC promo pairs'
  },
  CUSTOM: {
    id: 'CUSTOM',
    name: 'Custom Fee Rate',
    makerFeeRate: 0.001,
    takerFeeRate: 0.001,
    description: 'User-specified fee rate'
  }
};

export interface OfflineAction {
  id: string;
  type: 'CREATE_TRADE' | 'UPDATE_TRADE' | 'DELETE_TRADE';
  tradeId?: string;
  data?: any;
  timestamp: number;
}
