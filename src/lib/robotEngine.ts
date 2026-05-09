/**
 * Robot Engine — Autonomous trading loop for production robots.
 *
 * Initialised ONCE at app startup (main.tsx) so it keeps running regardless
 * of which page the user is navigating.  Each active robot gets its own
 * Deriv WS connection, candle feed and strategy-execution loop.
 *
 * Key design decisions:
 * - Trades are added ONLY to robot.trades (isolated history).
 *   Users can import robot trades to global stats manually.
 * - Each trade is tagged with a robotId for proper attribution.
 * - Multi-asset: one robot can trade multiple assets via a shared WS connection.
 * - Candle-boundary synchronisation: trades are only triggered at the close
 *   of a candle (within a short window after a new candle opens).
 * - Timeframe and duration are fully configurable per-robot.
 */

import { DerivAPI } from "./derivCore";
import { useStore, type RobotConfig, type Trade } from "./store";
import { rsi, sma, ema, bollinger, adx, macd, type Candle } from "./market";
import { applyFilterLogic, type StrategyContext, type StrategyResult } from "@/strategies";

// ─── Types ───────────────────────────────────────────────────────────────────

type AssetState = {
  candles: Candle[];
  lastTradeTime: number;
  lastSignalCandleTs: number;
  ready: boolean;
};

type RobotRuntime = {
  api: DerivAPI;
  assetStates: Record<string, AssetState>;
  tickInterval: ReturnType<typeof setInterval> | null;
  lastResult: "WIN" | "LOSS" | null;
  isProcessing: boolean;
  /** Contract IDs placed by THIS robot — used to filter onOpenContract events. */
  activeContractIds: Set<string>;
  /** Contract IDs placed during warmup — their results update lastResult only, not PnL. */
  warmupContractIds: Set<string>;
  /** Current compound stake (resets on LOSS, grows on WIN for Soros/Reinvest modes). */
  currentStake: number;
};

const runtimes = new Map<string, RobotRuntime>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Get assets list from a robot config (backward compat with old `asset` field) */
function getRobotAssets(robot: RobotConfig): string[] {
  if (robot.assets && robot.assets.length > 0) return robot.assets;
  // Backward compatibility: old robots had `asset: string`
  const legacyAsset = (robot as Record<string, unknown>).asset;
  if (typeof legacyAsset === "string" && legacyAsset) return [legacyAsset];
  return ["R_100"];
}

function tfToMs(tf: string): number {
  switch (tf) {
    case "1m": return 60_000;
    case "3m": return 180_000;
    case "5m": return 300_000;
    case "15m": return 900_000;
    case "30m": return 1_800_000;
    case "1h": return 3_600_000;
    case "4h": return 14_400_000;
    case "1d": return 86_400_000;
    default: return 60_000;
  }
}

function tfToGranularity(tf: string): number {
  return tfToMs(tf) / 1000;
}

// ─── Strategy discovery ───────────────────────────────────────────────────────

function findStrategyModule(strategyId: string) {
  const modules = import.meta.glob("@/strategies/*.ts", { eager: true });
  for (const path in modules) {
    const mod = modules[path] as Record<string, unknown>;
    const def = mod.default as { id?: string; onTick?: unknown } | undefined;
    if (def && def.id === strategyId && def.onTick) {
      return def;
    }
  }
  return null;
}

// ─── VDV pattern helper ───────────────────────────────────────────────────────

function handleVdv(robot: RobotConfig, result: "WIN" | "LOSS"): Partial<RobotConfig> {
  let vdvPaused = robot.vdvPaused;
  let vdvWinsCount = robot.vdvWinsCount;

  if (vdvPaused) {
    if (result === "WIN") {
      vdvWinsCount += 1;
      if (vdvWinsCount >= 2) {
        vdvPaused = false;
        vdvWinsCount = 0;
      }
    } else {
      vdvWinsCount = 0;
    }
  } else {
    const recentResults = robot.trades.slice(0, 4).map((t) => t.result);
    if (
      recentResults[0] === "LOSS" && recentResults[1] === "WIN" &&
      recentResults[2] === "LOSS" && recentResults[3] === "WIN"
    ) {
      vdvPaused = true;
      vdvWinsCount = 0;
    }
  }

  return { vdvPaused, vdvWinsCount };
}

// ─── Stake compounding helper ──────────────────────────────────────────────────

/**
 * Compute the next stake based on staking mode and trade result.
 * - fixed:   always robot.stake
 * - soros:   WIN → compound (current + profit); LOSS → reset to robot.stake
 * - reinvest: WIN → double (current * 2);     LOSS → reset to robot.stake
 * Cap at sorosMaxStake if set (> 0).
 */
function computeNextStake(
  robot: RobotConfig,
  runtime: RobotRuntime,
  result: "WIN" | "LOSS",
  profit: number
): number {
  const base = robot.stake;
  const cap = robot.sorosMaxStake > 0 ? robot.sorosMaxStake : Infinity;

  if (robot.stakingMode === "soros") {
    if (result === "WIN") {
      return Math.min(runtime.currentStake + Math.abs(profit), cap);
    }
    return base; // reset on loss
  }

  if (robot.stakingMode === "reinvest") {
    if (result === "WIN") {
      return Math.min(runtime.currentStake * 2, cap);
    }
    return base; // reset on loss
  }

  return base; // fixed mode
}

/**
 * Determine whether warmup mode should be active after a trade result.
 * warmupActive = true when entry condition is enabled but NOT yet met.
 */
function computeWarmupActive(robot: RobotConfig, lastResult: "WIN" | "LOSS"): boolean {
  if (!robot.entryAfterWin && !robot.entryAfterLoss) return false;
  if (robot.entryAfterWin) return lastResult !== "WIN";
  if (robot.entryAfterLoss) return lastResult !== "LOSS";
  return false;
}

// ─── Start a single robot ─────────────────────────────────────────────────────

function startRobot(robot: RobotConfig) {
  if (runtimes.has(robot.id)) return;

  const stratMod = findStrategyModule(robot.strategyId);
  if (!stratMod) {
    console.error(`[RobotEngine] Strategy "${robot.strategyId}" not found for robot "${robot.name}".`);
    return;
  }

  const store = useStore.getState();
  const token = robot.mode === "demo" ? store.demoToken : store.realToken;
  const assets = getRobotAssets(robot);

  const api = new DerivAPI();
  const assetStates: Record<string, AssetState> = {};
  for (const asset of assets) {
    assetStates[asset] = {
      candles: [],
      lastTradeTime: 0,
      lastSignalCandleTs: 0,
      ready: false,
    };
  }

  const runtime: RobotRuntime = {
    api,
    assetStates,
    tickInterval: null,
    lastResult: null,
    isProcessing: false,
    activeContractIds: new Set(),
    warmupContractIds: new Set(),
    currentStake: robot.stake,
  };

  runtimes.set(robot.id, runtime);

  api.connect(token || undefined);

  const intervalMs = tfToMs(robot.timeframe);
  const granularity = tfToGranularity(robot.timeframe);

  // ── Handle settled contracts → update robot trade history ──
  api.onOpenContract = (contract: Record<string, unknown>) => {
    const contractId = String(contract.contract_id);
    const status = contract.status as string | undefined;
    const profit = (contract.profit as number) ?? 0;

    // Ignore contracts not placed by this robot
    if (!runtime.activeContractIds.has(contractId)) return;

    if (status === "won" || status === "lost" || status === "sold") {
      const tradeResult: "WIN" | "LOSS" = profit > 0 ? "WIN" : "LOSS";
      const isWarmup = runtime.warmupContractIds.has(contractId);

      // Always update the trade record with the real result
      useStore.getState().updateRobotTrade(robot.id, contractId, {
        result: tradeResult,
        pnl: isWarmup ? 0 : profit,  // warmup trades show 0 PnL
        exit: (contract.exit_tick ?? contract.sell_price) as number | undefined,
      });

      runtime.lastResult = tradeResult;

      if (!isWarmup) {
        // Update robot daily/total PnL only for real trades
        const currentRobot = useStore.getState().robots.find((r) => r.id === robot.id);
        if (currentRobot) {
          // Compute next stake based on stakingMode
          const nextStake = computeNextStake(currentRobot, runtime, tradeResult, profit);
          runtime.currentStake = nextStake;

          // Update warmupActive: re-enter warmup if condition broken
          const warmupActive = computeWarmupActive(currentRobot, tradeResult);

          useStore.getState().updateRobot(robot.id, {
            currentDailyPnl: currentRobot.currentDailyPnl + profit,
            totalPnl: currentRobot.totalPnl + profit,
            warmupActive,
            ...(currentRobot.vdvFilter ? handleVdv(currentRobot, tradeResult) : {}),
          });
        }
      } else {
        // Warmup trade settled: check if condition now met to exit warmup
        const currentRobot = useStore.getState().robots.find((r) => r.id === robot.id);
        if (currentRobot) {
          const warmupActive = computeWarmupActive(currentRobot, tradeResult);
          if (!warmupActive) {
            // Exit warmup — next trade will be real
            useStore.getState().updateRobot(robot.id, { warmupActive: false });
          }
        }
      }

      runtime.activeContractIds.delete(contractId);
      runtime.warmupContractIds.delete(contractId);
      runtime.lastResult = tradeResult;
    }
  };

  // ── Initialise candles and tick subscriptions for ALL assets ──
  const init = async () => {
    try {
      if (api.readyPromise) await api.readyPromise;

      for (const asset of assets) {
        try {
          const candlesData = await api.getCandles(asset, 500, granularity);
          if (candlesData && candlesData.length) {
            assetStates[asset].candles = candlesData.map((c: Record<string, number>) => ({
              t: c.epoch * 1000,
              o: c.open,
              h: c.high,
              l: c.low,
              c: c.close,
            }));
          }
          await api.subscribeTicks(asset);
          assetStates[asset].ready = true;
          console.log(`[RobotEngine] ${robot.name}: subscribed to ${asset}`);
        } catch (e) {
          console.error(`[RobotEngine] ${robot.name}: failed to init asset ${asset}:`, e);
        }
      }

      // Handle ticks for all assets
      api.onTick = (tick) => {
        if (!tick) return;
        const asset = tick.symbol;
        const state = assetStates[asset];
        if (!state) return;

        const cs = state.candles;
        if (cs.length === 0) return;

        const last = { ...cs[cs.length - 1] };
        const now = tick.epoch * 1000;

        if (now - last.t >= intervalMs) {
          const newCandle: Candle = {
            t: last.t + intervalMs,
            o: last.c,
            h: tick.quote,
            l: tick.quote,
            c: tick.quote,
          };
          state.candles = [...cs.slice(-499), newCandle];
        } else {
          last.c = tick.quote;
          last.h = Math.max(last.h, tick.quote);
          last.l = Math.min(last.l, tick.quote);
          state.candles = [...cs.slice(0, -1), last];
        }
      };

      // ── Strategy loop — runs every second, iterates all assets ──
      runtime.tickInterval = setInterval(() => {
        for (const asset of assets) {
          if (!assetStates[asset]?.ready) continue;
          tickRobotForAsset(
            robot.id,
            asset,
            stratMod as { onTick: (ctx: StrategyContext) => StrategyResult },
            intervalMs
          );
        }
      }, 1000);

      console.log(
        `[RobotEngine] Robot "${robot.name}" started | assets: ${assets.join(", ")} | TF: ${robot.timeframe} | duration: ${robot.durationSeconds}s | mode: ${robot.mode}`
      );
    } catch (e) {
      console.error(`[RobotEngine] Failed to initialise robot "${robot.name}":`, e);
    }
  };

  init();
}

// ─── Stop a single robot ──────────────────────────────────────────────────────

function stopRobot(robotId: string) {
  const runtime = runtimes.get(robotId);
  if (!runtime) return;
  if (runtime.tickInterval) clearInterval(runtime.tickInterval);
  runtime.api.disconnect();
  runtimes.delete(robotId);
  console.log(`[RobotEngine] Robot "${robotId}" stopped.`);
}

// ─── One execution tick for a robot on a specific asset ──────────────────────

function tickRobotForAsset(
  robotId: string,
  asset: string,
  stratMod: { onTick: (ctx: StrategyContext) => StrategyResult },
  intervalMs: number
) {
  const runtime = runtimes.get(robotId);
  if (!runtime || runtime.isProcessing) return;

  const assetState = runtime.assetStates[asset];
  if (!assetState || !assetState.ready) return;

  const store = useStore.getState();
  const robot = store.robots.find((r) => r.id === robotId);
  if (!robot || !robot.active) {
    stopRobot(robotId);
    return;
  }

  // ── Daily reset check ──
  const today = new Date().toISOString().split("T")[0];
  if (robot.lastResetDate !== today) {
    store.resetRobotDaily(robotId);
    return;
  }

  // ── Management guards ──
  if (robot.currentDailyPnl >= robot.dailyGoal) return;
  if (robot.currentDailyPnl <= -robot.dailyStopLoss) return;
  if (robot.vdvPaused) return;

  // ── Entry-sequence: determine if this trade is a warmup trade ──
  // Instead of skipping, we place warmup trades on DEMO with base stake.
  // They update runtime.lastResult but don’t count toward real PnL.
  const isWarmup = robot.warmupActive ||
    (robot.entryAfterWin && runtime.lastResult !== "WIN" && runtime.lastResult !== null) ||
    (robot.entryAfterLoss && runtime.lastResult !== "LOSS" && runtime.lastResult !== null);

  // On very first trade (lastResult = null) with entry condition set, also warmup
  const isFirstTradeWarmup = runtime.lastResult === null &&
    (robot.entryAfterWin || robot.entryAfterLoss);

  const shouldWarmup = isWarmup || isFirstTradeWarmup;

  // ── No double-entry on this asset ──
  const hasOpenTrade = robot.trades.some((t) => t.result === "OPEN" && t.asset === asset);
  if (hasOpenTrade) return;

  const cs = assetState.candles;
  if (cs.length < 30) return;

  const now = Date.now();
  const lastCandle = cs[cs.length - 1];
  const lastCandleTs = lastCandle?.t ?? now;

  // ── Candle-boundary synchronisation ──
  // Fire a signal on the first tick of a new candle (within 10 seconds)
  const msSinceNewCandle = now - lastCandleTs;
  const isAtCandleBoundary = msSinceNewCandle < 10000 && lastCandleTs !== assetState.lastSignalCandleTs;
  if (!isAtCandleBoundary) return;

  // ── Global cooldown (no more than one trade per candle on this asset) ──
  if (now - assetState.lastTradeTime < intervalMs * 0.9) return;

  runtime.isProcessing = true;

  try {
    const candleTimeRemainingMs = Math.max(0, (lastCandleTs + intervalMs) - now);

    const context: StrategyContext = {
      asset,
      history: cs.map((c) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c })),
      lastPrice: lastCandle?.c ?? 0,
      balance: store.balance,
      tradingMode: robot.mode,
      isBacktest: false,
      intervalMs,
      candleTimeRemainingMs,
      srLines: store.srLines.filter((l) => l.asset === asset).map((l) => ({
        id: l.id, price: l.price, type: l.kind as "support" | "resistance", asset: l.asset,
      })),
      srZones: store.srZones.filter((z) => z.asset === asset).map((z) => ({
        id: z.id, p1: z.topPrice, p2: z.bottomPrice,
        type: z.kind === "buy_zone" ? "support" : "resistance" as const, asset: z.asset,
      })),
      hasOpenTrade: false,
      activeFilters: robot.filters,
      updateSR: store.updateSR,
      toast: { 
        success: (msg) => console.log(`[RobotEngine] ${robot.name}: ${msg}`), 
        info: (msg) => console.log(`[RobotEngine] ${robot.name}: ${msg}`), 
        error: (msg) => console.error(`[RobotEngine] ${robot.name}: ${msg}`) 
      },
      indicators: {
        rsi: (period) => rsi(cs.map((c) => c.c), period),
        sma: (period) => sma(cs.map((c) => c.c), period).map((v) => v ?? 0),
        ema: (period) => ema(cs.map((c) => c.c), period).map((v) => v ?? 0),
        bollinger: (period, multiplier) => bollinger(cs.map((c) => c.c), period, multiplier) as never,
        adx: (period) => adx(cs, period) as never,
        macd: (fast, slow, signal) => macd(cs.map((c) => c.c), fast, slow, signal) as never,
      },
    };

    const rawResult = (stratMod.onTick as (ctx: StrategyContext) => StrategyResult)(context);

    // ── Apply per-robot filters ──
    const closes = cs.map((c) => c.c);
    const rsiArr = rsi(closes, 14);
    const adxData = adx(cs, 14);
    const indicatorValues: Record<string, number | string | null | undefined> = {
      _rsi: rsiArr[rsiArr.length - 1],
      _adx: adxData.adx[adxData.adx.length - 1],
      _expiryCandles: rawResult?.expiryCandles ?? null,
      _asset: asset,
    };
    const result = applyFilterLogic(rawResult, robot.filters, indicatorValues, robot.globalInvert);

    if (result && result.action) {
      // Mark this candle as processed BEFORE the async order to prevent double-entry
      assetState.lastSignalCandleTs = lastCandleTs;
      assetState.lastTradeTime = now;
      placeRobotOrder(robot, runtime, assetState, asset, result, intervalMs, shouldWarmup);
    }
  } catch (e) {
    console.error(`[RobotEngine] Error in tick for robot "${robot.name}" on ${asset}:`, e);
  } finally {
    runtime.isProcessing = false;
  }
}

async function placeRobotOrder(
  robot:      RobotConfig,
  runtime:    RobotRuntime,
  assetState: AssetState,
  asset:      string,
  result:     StrategyResult,
  intervalMs: number,
  isWarmup:   boolean = false
) {
  if (!result.action) return;

  let dir = result.action;
  if (dir === "BUY")  dir = "CALL";
  if (dir === "SELL") dir = "PUT";

  // ── Compute effective duration ──
  let finalDuration = result.duration ?? robot.durationSeconds;
  const ts = Date.now();
  if (finalDuration === -1) {
    const lastCandle = assetState.candles[assetState.candles.length - 1];
    const nextCandleT = lastCandle ? lastCandle.t + intervalMs : ts + intervalMs;
    finalDuration = Math.max(1, Math.floor((nextCandleT - ts) / 1000));
  }

  // ── Compute effective stake ──
  // Warmup trades always use base stake; real trades use compounded stake.
  const finalStake = isWarmup
    ? robot.stake
    : (result.stake ?? runtime.currentStake);

  // ── Effective mode: warmup always goes to DEMO ──
  const effectiveMode: "demo" | "real" = isWarmup ? "demo" : robot.mode;

  const store = useStore.getState();
  const token = effectiveMode === "demo" ? store.demoToken : store.realToken;
  const entry = assetState.candles[assetState.candles.length - 1]?.c ?? 0;

  let tradeId    = `${robot.id}_${crypto.randomUUID()}`;
  let isApiOrder = false;

  // ── Try to place via Deriv API ──
  if (token && runtime.api.ws?.readyState === WebSocket.OPEN) {
    try {
      const buyRes = await runtime.api.buyContract(
        asset, finalStake, dir as "CALL" | "PUT", finalDuration, "s"
      );
      if (buyRes && buyRes.contract_id) {
        tradeId    = String(buyRes.contract_id);
        isApiOrder = true;
        // Register in this robot's active contract set for attribution
        runtime.activeContractIds.add(tradeId);
        if (isWarmup) runtime.warmupContractIds.add(tradeId);
        console.log(
          `[RobotEngine] ${robot.name}${isWarmup ? " [WARMUP]" : ""}: ${dir} ${asset} $${finalStake} for ${finalDuration}s | contract ${tradeId}`
        );
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[RobotEngine] ${robot.name}: API order failed — ${msg}`);
      return;
    }
  }

  // ── Build trade record ──
  const trade: Trade = {
    id:          tradeId,
    asset,
    type:        dir as "CALL" | "PUT",
    amount:      finalStake,
    entry,
    result:      "OPEN",
    ts,
    entryTime:   ts,
    durationS:   finalDuration,
    mode:        effectiveMode,
    strategyId:  robot.strategyId,
    timeframe:   robot.timeframe,
    customStats: result.customStats,
    robotId:     robot.id,
    warmup:      isWarmup || undefined,
  };

  // Store ONLY in robot's own history (isolated)
  useStore.getState().addRobotTrade(robot.id, trade);

  // ── Simulate settlement for non-API orders ──
  if (!isApiOrder) {
    setTimeout(() => {
      const rt = runtimes.get(robot.id);
      if (!rt) return;

      const cs = rt.assetStates[asset]?.candles ?? [];
      const currentStore = useStore.getState();
      const currentRobot = currentStore.robots.find((r) => r.id === robot.id);
      if (!currentRobot) return;

      const robotTrade = currentRobot.trades.find((t) => t.id === tradeId);
      if (!robotTrade || robotTrade.result !== "OPEN") return;

      const exitPrice   = cs[cs.length - 1]?.c ?? entry;
      const win         = dir === "CALL" ? exitPrice > entry : exitPrice < entry;
      const tradeResult: "WIN" | "LOSS" = win ? "WIN" : "LOSS";
      const rawPnl      = win ? finalStake * (currentRobot.payout / 100) : -finalStake;
      const recordedPnl = isWarmup ? 0 : rawPnl;

      currentStore.updateRobotTrade(robot.id, tradeId, {
        exit: exitPrice, result: tradeResult, pnl: recordedPnl
      });

      rt.lastResult = tradeResult;

      if (!isWarmup) {
        // Update stake compounding based on mode
        rt.currentStake = computeNextStake(currentRobot, rt, tradeResult, rawPnl);

        // Re-evaluate warmupActive for next trade
        const warmupActive = computeWarmupActive(currentRobot, tradeResult);

        currentStore.updateRobot(robot.id, {
          currentDailyPnl: currentRobot.currentDailyPnl + rawPnl,
          totalPnl:        currentRobot.totalPnl + rawPnl,
          warmupActive,
          ...(currentRobot.vdvFilter ? handleVdv(currentRobot, tradeResult) : {}),
        });
      } else {
        // Warmup settled — check if condition now met to exit warmup
        const warmupActive = computeWarmupActive(currentRobot, tradeResult);
        if (!warmupActive) {
          currentStore.updateRobot(robot.id, { warmupActive: false });
        }
      }

      console.log(
        `[RobotEngine] ${currentRobot.name}${isWarmup ? " [WARMUP]" : ""}: ${tradeResult} | ${asset} | ${recordedPnl >= 0 ? "+" : ""}$${recordedPnl.toFixed(2)}`
      );
    }, finalDuration * 1000);
  }
}

// ─── Engine lifecycle ─────────────────────────────────────────────────────────

/** Compute a fingerprint of the parts of a robot config that require an engine restart. */
function robotFingerprint(r: RobotConfig): string {
  return `${r.active}|${r.vpsExecution}|${r.mode}|${r.timeframe}|${r.strategyId}|${(r.assets ?? []).slice().sort().join(",")}`;
}

// Track last-seen fingerprint per robot so we can detect real config changes
const _fingerprints = new Map<string, string>();

/** Reconcile running runtimes with the current store state.
 *  Only starts/stops/restarts based on operational config — ignores trade/PnL changes. */
export function syncRobotEngine() {
  const { robots } = useStore.getState();

  for (const robot of robots) {
    const fp = robotFingerprint(robot);
    const prevFp = _fingerprints.get(robot.id);

    const isBrowser = typeof window !== "undefined";
    if (!isBrowser && robot.active) {
      if (!runtimes.has(robot.id)) {
        // Not running — start it
        _fingerprints.set(robot.id, fp);
        startRobot(robot);
      } else if (prevFp !== undefined && prevFp !== fp) {
        // Config changed while running — restart
        console.log(`[RobotEngine] Config changed for "${robot.name}" — restarting.`);
        stopRobot(robot.id);
        _fingerprints.set(robot.id, fp);
        startRobot(robot);
      } else {
        // Already running, no change
        _fingerprints.set(robot.id, fp);
      }
    } else {
      // Robot is inactive OR we are in browser
      if (runtimes.has(robot.id)) {
        stopRobot(robot.id);
      }
      _fingerprints.delete(robot.id);
    }
  }

  // Stop runtimes for robots that no longer exist
  for (const [id] of runtimes) {
    if (!robots.find((r) => r.id === id)) {
      stopRobot(id);
      _fingerprints.delete(id);
    }
  }
}

let _unsubscribe: (() => void) | null = null;

/**
 * Call once at app startup (main.tsx).
 * Sets up an initial sync and watches the store for robot changes.
 */
export function initRobotEngine() {
  if (_unsubscribe) return;

  // On startup: close out any stale OPEN trades from previous sessions
  // (prevents ghost orders accumulating across page reloads)
  const store = useStore.getState();
  for (const robot of store.robots) {
    const staleOpenTrades = robot.trades.filter((t) => t.result === "OPEN");
    if (staleOpenTrades.length > 0) {
      console.log(`[RobotEngine] Clearing ${staleOpenTrades.length} stale OPEN trade(s) for robot "${robot.name}"`);
      for (const trade of staleOpenTrades) {
        store.updateRobotTrade(robot.id, trade.id, { result: "LOSS", pnl: -trade.amount, exit: trade.entry });
      }
    }
  }

  syncRobotEngine();

  _unsubscribe = useStore.subscribe((state, prevState) => {
    // Only react when the number of robots changes OR when any robot's
    // operational fingerprint changes — NOT for trade/PnL updates.
    const prevRobots = prevState.robots;
    const nextRobots = state.robots;

    if (prevRobots === nextRobots) return;

    // Fast path: length changed (robot added or removed)
    if (prevRobots.length !== nextRobots.length) {
      syncRobotEngine();
      return;
    }

    // Check if any operational field changed
    const operationalChange = nextRobots.some((r) => {
      const prev = prevRobots.find((p) => p.id === r.id);
      if (!prev) return true;
      return robotFingerprint(r) !== robotFingerprint(prev);
    });

    if (operationalChange) {
      syncRobotEngine();
    }
  });

  console.log("[RobotEngine] Initialised — watching for robot changes.");
}

export function destroyRobotEngine() {
  if (_unsubscribe) {
    _unsubscribe();
    _unsubscribe = null;
  }
  for (const [id] of runtimes) {
    stopRobot(id);
  }
  console.log("[RobotEngine] Destroyed.");
}

/** Expose runtime status to the UI. */
export function getRobotRuntime(robotId: string): {
  connected: boolean;
  candleCount: number;
  ready: boolean;
  assetCount: number;
} | null {
  const rt = runtimes.get(robotId);
  if (!rt) return null;
  const totalCandles = Object.values(rt.assetStates).reduce((sum, s) => sum + s.candles.length, 0);
  const allReady = Object.values(rt.assetStates).every((s) => s.ready);
  return {
    connected: rt.api.ws?.readyState === WebSocket.OPEN,
    candleCount: totalCandles,
    ready: allReady,
    assetCount: Object.keys(rt.assetStates).length,
  };
}
