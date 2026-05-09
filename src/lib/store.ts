import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { StrategyFilterValue } from "@/strategies";

export type Trade = {
  id: string;
  asset: string;
  type: "CALL" | "PUT" | "BUY" | "SELL";
  amount: number;
  entry: number;
  exit?: number;
  result?: "WIN" | "LOSS" | "OPEN";
  pnl?: number;
  ts: number;
  entryTime?: number;
  durationS: number;
  mode: "demo" | "real" | "backtest";
  entryCandleIdx?: number;
  expiryCandles?: number;
  indicator?: string;
  snapshot?: Record<string, unknown>;
  strategyId?: string;
  /** Custom stats from strategy — each key is a stat category */
  customStats?: Record<string, string | number | boolean>;
  /** Timeframe used (e.g. "1m", "5m") */
  timeframe?: string;
  /** Robot ID that placed this trade (for attribution) */
  robotId?: string;
  /** True if this trade was placed in warmup mode (before entry condition was met) */
  warmup?: boolean;
};

export type SRLine = { id: string; asset: string; price: number; kind: "support" | "resistance" };

export type SRZone = { id: string; asset: string; topPrice: number; bottomPrice: number; kind: "buy_zone" | "sell_zone" };

export type TradingMode = "demo" | "real" | "backtest";
export type MarketType = "binary" | "forex";
export type AutomationMode = "manual" | "semi-auto" | "auto";

export type RiskConfig = {
  enabled: boolean;
  stopLoss: number;
  takeProfit: number;
  defaultStake: number;
  payout: number; // % return for binary win
  martingale: boolean;
  martingaleFactor: number;
  stopAfterLosses: number;
  stopAfterWins: number;
  entryAfterWin: boolean;
  entryAfterLoss: boolean;
};

export type ManagementConfig = {
  enabled: boolean;
  dailyGoal: number;
  dailyStopLoss: number;

  // Operational Filters
  rsiFilter: boolean;
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;

  maFilter: boolean;
  maPeriod: number;
  maType: "sma" | "ema";

  macFilter: boolean; // Moving Average Cross
  macShortPeriod: number;
  macLongPeriod: number;

  adxFilter: boolean;
  adxPeriod: number;
  adxThreshold: number;

  // Pattern filters (VDV)
  vdvFilter: boolean; // Win-Loss-Win-Loss pause
  vdvPaused: boolean;
  vdvWinsCount: number; // Tracking wins to restart (needs 2 wins to restart)

  // Strategy sequencing
  entryAfterWin: boolean;
  entryAfterLoss: boolean;

  currentDailyPnl: number;
  lastResetDate: string; // YYYY-MM-DD
};

export type ForexConfig = {
  enabled: boolean;
  lotSize: number;
  leverage: number;
  stopLossPips: number;
  takeProfitPips: number;
  spread: number;
};

export type RobotConfig = {
  id: string;
  name: string;
  /** Strategy ID this robot was created from */
  strategyId: string;
  /** Snapshot of the strategy script filename */
  strategyFileName: string;
  /** Snapshot of the filters at creation time */
  filters: Record<string, StrategyFilterValue>;
  /** Whether global invert was active */
  globalInvert: boolean;
  /** Robot active state */
  active: boolean;
  /** Demo or Real trading */
  mode: "demo" | "real";
  /** Timeframe for candle reading (e.g. "1m", "5m", "15m", "1h") */
  timeframe: string;
  /** Trade duration in seconds */
  durationSeconds: number;
  /** Assets to trade (from strategy filters) */
  assets: string[];
  /** Management settings embedded in the robot */
  dailyGoal: number;
  dailyStopLoss: number;
  stake: number;
  payout: number;
  entryAfterWin: boolean;
  entryAfterLoss: boolean;
  vdvFilter: boolean;
  vdvPaused: boolean;
  vdvWinsCount: number;
  /** Runtime PnL tracking */
  currentDailyPnl: number;
  totalPnl: number;
  lastResetDate: string;
  /** Staking progression mode */
  stakingMode: "fixed" | "soros" | "reinvest";
  /** Maximum stake cap for Soros/Reinvest modes (0 = no cap) */
  sorosMaxStake: number;
  /** True while entry condition (entryAfterWin/Loss) has not yet been met.
   *  In this state the robot trades on DEMO with base stake regardless of mode. */
  warmupActive: boolean;
  /** Robot's own trade history */
  trades: Trade[];
  /** Creation timestamp */
  createdAt: number;
  /** Whether this robot runs on the VPS (Node.js) or locally (Browser) */
  vpsExecution: boolean;
  /** Live connection status for VPS execution */
  vpsStatus?: 'offline' | 'connecting' | 'online' | 'error';
};

type Store = {
  demoToken: string;
  realToken: string;
  setDemoToken: (v: string) => void;
  setRealToken: (v: string) => void;

  // Trading mode: demo, real, or backtest
  tradingMode: TradingMode;
  setTradingMode: (m: TradingMode) => void;

  // Market type: binary or forex
  marketType: MarketType;
  setMarketType: (m: MarketType) => void;

  // Automation mode
  automationMode: AutomationMode;
  setAutomationMode: (m: AutomationMode) => void;

  // Sidebar visibility
  assetsSidebarOpen: boolean;
  toggleAssetsSidebar: () => void;

  account: "demo" | "real";
  setAccount: (a: "demo" | "real") => void;

  balance: number;
  addPnl: (v: number) => void;
  setBalance: (v: number) => void;

  trades: Trade[];
  addTrade: (t: Trade) => void;
  updateTrade: (id: string, updates: Partial<Trade>) => void;
  resetTrades: (mode?: TradingMode) => void;

  srLines: SRLine[];
  srZones: SRZone[];
  showSRLines: boolean;
  setShowSRLines: (v: boolean) => void;
  addSR: (s: SRLine) => void;
  updateSR: (id: string, updates: Partial<SRLine>) => void;
  removeSR: (id: string) => void;
  addSRZone: (z: SRZone) => void;
  updateSRZone: (id: string, updates: Partial<SRZone>) => void;
  removeSRZone: (id: string) => void;
  clearSR: (asset: string) => void;

  timeframe: string;
  setTimeframe: (v: string) => void;

  risk: RiskConfig;
  setRisk: (r: Partial<RiskConfig>) => void;

  management: ManagementConfig;
  setManagement: (m: Partial<ManagementConfig>) => void;
  resetDailyPnl: () => void;

  forex: ForexConfig;
  setForex: (f: Partial<ForexConfig>) => void;

  redis: { host: string; port: string; key: string; password?: string };
  setRedis: (r: Partial<{ host: string; port: string; key: string; password?: string }>) => void;

  activeStrategyId: string | null;
  setActiveStrategyId: (id: string | null) => void;

  lastSelectedAsset: string | null;
  setLastSelectedAsset: (asset: string) => void;

  backtestIndices: Record<string, number>;
  setBacktestIndex: (asset: string, idx: number) => void;

  customBacktestData: Record<string, unknown[]>;
  setCustomBacktestData: (asset: string, candles: unknown[]) => void;

  /** Per-strategy filter configurations, keyed by strategyId */
  strategyFilters: Record<string, Record<string, StrategyFilterValue>>;
  setStrategyFilter: (strategyId: string, filterKey: string, value: StrategyFilterValue) => void;
  clearStrategyFilters: (strategyId: string) => void;

  /** Global invert toggle per strategy — reverses ALL signals */
  strategyInvert: Record<string, boolean>;
  setStrategyInvert: (strategyId: string, invert: boolean) => void;

  /** Production robots */
  robots: RobotConfig[];
  addRobot: (robot: RobotConfig) => void;
  updateRobot: (id: string, updates: Partial<RobotConfig>) => void;
  removeRobot: (id: string) => void;
  addRobotTrade: (robotId: string, trade: Trade) => void;
  updateRobotTrade: (robotId: string, tradeId: string, updates: Partial<Trade>) => void;
  resetRobotDaily: (robotId: string) => void;
  importRobotTrades: (robotId: string) => void;
  clearRobotTrades: (robotId: string) => void;
};

export const useStore = create<Store>()(
  persist(
    (set) => ({
      demoToken: "",
      realToken: "",
      setDemoToken: (v) => set({ demoToken: v }),
      setRealToken: (v) => set({ realToken: v }),

      tradingMode: "demo",
      setTradingMode: (m) => set({ tradingMode: m }),

      marketType: "binary",
      setMarketType: (m) => set({ marketType: m }),

      automationMode: "manual",
      setAutomationMode: (m) => set({ automationMode: m }),

      assetsSidebarOpen: true,
      toggleAssetsSidebar: () => set((s) => ({ assetsSidebarOpen: !s.assetsSidebarOpen })),

      account: "demo",
      setAccount: (a) => set({ account: a }),

      balance: 10000,
      addPnl: (v) => set((s) => {
        const isWin = v > 0;
        const newDailyPnl = s.management.currentDailyPnl + v;

        let newVdvPaused = s.management.vdvPaused;
        let newVdvWinsCount = s.management.vdvWinsCount;

        if (s.management.vdvFilter) {
          if (newVdvPaused) {
            if (isWin) {
              newVdvWinsCount += 1;
              if (newVdvWinsCount >= 2) {
                newVdvPaused = false;
                newVdvWinsCount = 0;
              }
            } else {
              newVdvWinsCount = 0;
            }
          } else {
            // Check for W-L-W-L pattern in recent trades
            // recent[0] is the current trade result (just updated before addPnl likely)
            // But wait, addPnl is usually called after updateTrade.
            // Let's look at the results of the last 4 trades.
            const results = s.trades.map(t => t.result).slice(0, 4);
            // Patterns: [L, W, L, W] (newest to oldest) matches W-L-W-L sequence
            if (results[0] === "LOSS" && results[1] === "WIN" && results[2] === "LOSS" && results[3] === "WIN") {
              newVdvPaused = true;
              newVdvWinsCount = 0;
            }
          }
        }

        return {
          balance: s.balance + v,
          management: {
            ...s.management,
            currentDailyPnl: newDailyPnl,
            vdvPaused: newVdvPaused,
            vdvWinsCount: newVdvWinsCount
          }
        };
      }),
      setBalance: (v) => set({ balance: v }),

      trades: [],
      addTrade: (t) => set((s) => ({ trades: [t, ...s.trades].slice(0, 500) })),
      updateTrade: (id, updates) => set((s) => ({ trades: s.trades.map(t => t.id === id ? { ...t, ...updates } : t) })),
      resetTrades: (mode) => set((s) => ({ trades: mode ? s.trades.filter(t => t.mode !== mode) : [] })),

      srLines: [],
      srZones: [],
      showSRLines: true,
      setShowSRLines: (v) => set({ showSRLines: v }),
      addSR: (s) => set((st) => ({ srLines: [...st.srLines, s] })),
      updateSR: (id, updates) => set((st) => ({ srLines: st.srLines.map((l) => l.id === id ? { ...l, ...updates } : l) })),
      removeSR: (id) => set((st) => ({ srLines: st.srLines.filter((l) => l.id !== id) })),
      addSRZone: (z) => set((st) => ({ srZones: [...st.srZones, z] })),
      updateSRZone: (id, updates) => set((st) => ({ srZones: st.srZones.map((z) => z.id === id ? { ...z, ...updates } : z) })),
      removeSRZone: (id) => set((st) => ({ srZones: st.srZones.filter((z) => z.id !== id) })),
      clearSR: (asset) => set((st) => ({ srLines: st.srLines.filter((l) => l.asset !== asset), srZones: st.srZones.filter((z) => z.asset !== asset) })),

      timeframe: "1m",
      setTimeframe: (v) => set({ timeframe: v }),

      risk: {
        enabled: false,
        stopLoss: 200,
        takeProfit: 500,
        defaultStake: 10,
        payout: 87,
        martingale: false,
        martingaleFactor: 2.2,
        stopAfterLosses: 2,
        stopAfterWins: 0,
        entryAfterWin: false,
        entryAfterLoss: false,
      },
      setRisk: (r) => set((s) => ({ risk: { ...s.risk, ...r } })),

      management: {
        enabled: false,
        dailyGoal: 50,
        dailyStopLoss: 30,
        rsiFilter: false,
        rsiPeriod: 14,
        rsiOverbought: 70,
        rsiOversold: 30,
        maFilter: false,
        maPeriod: 20,
        maType: "sma",
        macFilter: false,
        macShortPeriod: 9,
        macLongPeriod: 21,
        adxFilter: false,
        adxPeriod: 14,
        adxThreshold: 25,
        vdvFilter: false,
        vdvPaused: false,
        vdvWinsCount: 0,
        entryAfterWin: false,
        entryAfterLoss: false,
        currentDailyPnl: 0,
        lastResetDate: new Date().toISOString().split("T")[0],
      },
      setManagement: (m) => set((s) => ({ management: { ...s.management, ...m } })),
      resetDailyPnl: () => set((s) => ({ management: { ...s.management, currentDailyPnl: 0, vdvPaused: false, vdvWinsCount: 0, lastResetDate: new Date().toISOString().split("T")[0] } })),

      forex: {
        enabled: false,
        lotSize: 0.01,
        leverage: 100,
        stopLossPips: 20,
        takeProfitPips: 40,
        spread: 0.5,
      },
      setForex: (f) => set((s) => ({ forex: { ...s.forex, ...f } })),

      redis: { host: "127.0.0.1", port: "6379", key: "deriv:candles:R_100", password: "" },
      setRedis: (r) => set((s) => ({ redis: { ...s.redis, ...r } })),

      activeStrategyId: null,
      setActiveStrategyId: (id) => set({ activeStrategyId: id }),

      lastSelectedAsset: null,
      setLastSelectedAsset: (asset) => set({ lastSelectedAsset: asset }),

      backtestIndices: {},
      setBacktestIndex: (asset, idx) => set((s) => ({
        backtestIndices: { ...s.backtestIndices, [asset]: idx }
      })),

      customBacktestData: {},
      setCustomBacktestData: (asset, candles) => set((s) => ({
        customBacktestData: { ...s.customBacktestData, [asset]: candles }
      })),

      strategyFilters: {},
      setStrategyFilter: (strategyId, filterKey, value) => set((s) => ({
        strategyFilters: {
          ...s.strategyFilters,
          [strategyId]: {
            ...(s.strategyFilters[strategyId] || {}),
            [filterKey]: value
          }
        }
      })),
      clearStrategyFilters: (strategyId) => set((s) => {
        const updated = { ...s.strategyFilters };
        delete updated[strategyId];
        return { strategyFilters: updated };
      }),

      strategyInvert: {},
      setStrategyInvert: (strategyId, invert) => set((s) => ({
        strategyInvert: { ...s.strategyInvert, [strategyId]: invert }
      })),

      robots: [],
      addRobot: (robot) => set((s) => ({ robots: [...s.robots, robot] })),
      updateRobot: (id, updates) => set((s) => ({
        robots: s.robots.map(r => r.id === id ? { ...r, ...updates } : r)
      })),
      removeRobot: (id) => set((s) => ({ robots: s.robots.filter(r => r.id !== id) })),
      addRobotTrade: (robotId, trade) => set((s) => ({
        robots: s.robots.map(r => r.id === robotId ? { ...r, trades: [trade, ...r.trades].slice(0, 200) } : r)
      })),
      updateRobotTrade: (robotId, tradeId, updates) => set((s) => ({
        robots: s.robots.map(r => r.id === robotId ? {
          ...r,
          trades: r.trades.map(t => t.id === tradeId ? { ...t, ...updates } : t)
        } : r)
      })),
      resetRobotDaily: (robotId) => set((s) => ({
        robots: s.robots.map(r => r.id === robotId ? {
          ...r,
          currentDailyPnl: 0,
          vdvPaused: false,
          vdvWinsCount: 0,
          lastResetDate: new Date().toISOString().split("T")[0]
        } : r)
      })),
      importRobotTrades: (robotId) => set((s) => {
        const robot = s.robots.find(r => r.id === robotId);
        if (!robot) return s;
        const closedTrades = robot.trades.filter(t => t.result === "WIN" || t.result === "LOSS");
        // Avoid duplicates by checking existing IDs
        const existingIds = new Set(s.trades.map(t => t.id));
        const newTrades = closedTrades
          .filter(t => !existingIds.has(t.id))
          .map(t => ({
            ...t,
            // Ensure these are always set for Stats page
            robotId,
            mode: robot.mode as "demo" | "real" | "backtest",
            strategyId: t.strategyId || robot.strategyId,
          }));
        if (newTrades.length === 0) return s;
        return { trades: [...newTrades, ...s.trades].slice(0, 2000) };
      }),
      clearRobotTrades: (robotId) => set((s) => ({
        robots: s.robots.map(r => r.id === robotId ? { ...r, trades: [], totalPnl: 0, currentDailyPnl: 0 } : r)
      })),
    }),
    {
      name: "quantterm-store",
      partialize: (state) => Object.fromEntries(
        Object.entries(state).filter(([key]) => !['customBacktestData', 'backtestIndices', 'liveCandles'].includes(key))
      ),
    }
  )
);

