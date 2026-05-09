import { type Candle } from "@/lib/market";

export interface StrategyContext {
  asset: string;
  history: { t: number; o: number; h: number; l: number; c: number }[];
  lastPrice: number;
  balance: number;
  tradingMode: string;
  isBacktest: boolean;
  intervalMs: number;
  candleTimeRemainingMs: number;
  srLines: { id: string; price: number; type: "support" | "resistance"; asset: string }[];
  srZones: { id: string; p1: number; p2: number; type: "support" | "resistance"; asset: string }[];
  hasOpenTrade: boolean;
  activeFilters?: Record<string, StrategyFilterValue>;
  updateSR?: (id: string, updates: any) => void;
  toast?: {
    success: (msg: string) => void;
    info: (msg: string) => void;
    error: (msg: string) => void;
  };
  indicators: {
    rsi: (period: number) => (number | null)[];
    sma: (period: number) => number[];
    ema: (period: number) => number[];
    bollinger: (period: number, multiplier: number) => { upper: number[]; lower: number[] };
    adx: (period: number) => { adx: number[]; plusDi: number[]; minusDi: number[] };
    macd: (fast: number, slow: number, signal: number) => { macd: number[]; signal: number[]; histogram: number[] };
  };
}

export interface StrategyResult {
  action: "CALL" | "PUT" | "BUY" | "SELL" | null;
  stake?: number;
  duration?: number;
  expiryCandles?: number;
  customStats?: Record<string, any>;
}

export interface Strategy {
  id: string;
  name: string;
  description: string;
  category: "auto" | "semi-auto";
  onTick: (context: StrategyContext) => StrategyResult | null;
}

export interface StrategyFilterRange {
  min: number;
  max: number;
  action: "ignore" | "invert";
}

export interface StrategyFilterValue {
  enabled: boolean;
  ranges: StrategyFilterRange[];
}

/**
 * Applies multi-range filter logic (ignore/invert) and global inversion to a strategy signal.
 */
export function applyFilterLogic(
  rawResult: StrategyResult | null,
  filters: Record<string, StrategyFilterValue> | undefined,
  indicatorValues: Record<string, any>,
  globalInvert: boolean
): StrategyResult | null {
  if (!rawResult || !rawResult.action) return null;

  let action = rawResult.action;

  if (filters) {
    for (const [key, filter] of Object.entries(filters)) {
      if (!filter.enabled) continue;
      const val = indicatorValues[key];
      if (val === undefined || val === null) continue;

      for (const range of filter.ranges) {
        if (val >= range.min && val <= range.max) {
          if (range.action === "ignore") return null;
          if (range.action === "invert") {
            action = invertAction(action);
          }
        }
      }
    }
  }

  if (globalInvert) {
    action = invertAction(action);
  }

  return { ...rawResult, action };
}

function invertAction(action: "CALL" | "PUT" | "BUY" | "SELL"): "CALL" | "PUT" | "BUY" | "SELL" {
  if (action === "CALL") return "PUT";
  if (action === "PUT") return "CALL";
  if (action === "BUY") return "SELL";
  if (action === "SELL") return "BUY";
  return action;
}
