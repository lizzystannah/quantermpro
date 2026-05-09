import { DerivAPI } from "./derivCore";
import { rsi, sma, ema, bollinger, adx, macd, type Candle } from "./market";
import { applyFilterLogic, type StrategyContext, type StrategyResult, type Strategy } from "../strategies";
import fs from "fs";
import path from "path";
import { Server, Socket } from "socket.io";

type AssetState = {
  candles: Candle[];
  lastTradeTime: number;
  lastSignalCandleTs: number;
  ready: boolean;
};

type RobotRuntime = {
  id: string;
  config: any;
  api: DerivAPI;
  assetStates: Record<string, AssetState>;
  tickInterval: NodeJS.Timeout | null;
  lastResult: "WIN" | "LOSS" | null;
  isProcessing: boolean;
  activeContractIds: Set<string>;
  currentStake: number;
  strategyMod: Strategy | null;
};

const runtimes = new Map<string, RobotRuntime>();
let io: Server | null = null;

const SYMBOL_MAP: Record<string, string> = {
  "R_10S": "stpRNG",
  "R_25S": "stpRNG",
  "R_50S": "stpRNG",
  "R_75S": "stpRNG",
  "R_100S": "stpRNG",
};

function getDerivSymbol(s: string) {
  return SYMBOL_MAP[s] || s;
}

export function initServerEngine(socketIo: Server) {
  io = socketIo;
  console.log("Server Robot Engine initialized");
}

export function getRunningRobotStatuses() {
  const statuses: any[] = [];
  runtimes.forEach((runtime, id) => {
    statuses.push({ 
      id, 
      status: "running", 
      message: "Operando na VPS" 
    });
  });
  return statuses;
}

function tfToMs(tf: string): number {
  const map: Record<string, number> = {
    "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000,
    "30m": 1_800_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000
  };
  return map[tf] || 60_000;
}

async function loadStrategy(fileName: string): Promise<Strategy | null> {
  try {
    const filePath = path.join(process.cwd(), "src", "strategies", fileName.endsWith(".ts") ? fileName : `${fileName}.ts`);
    if (!fs.existsSync(filePath)) return null;
    
    // Dynamic import for Node.js
    const mod = await import(filePath);
    return mod.default || null;
  } catch (e) {
    console.error(`Failed to load strategy ${fileName}:`, e);
    return null;
  }
}

export async function startRobotOnServer(config: any, token: string, socket?: Socket) {
  if (runtimes.has(config.id)) {
    await stopRobotOnServer(config.id);
  }

  console.log(`[ServerRobot] Starting ${config.name} (${config.id})`);
  
  const strategyMod = await loadStrategy(config.strategyFileName || config.strategyId);
  if (!strategyMod) {
    socket?.emit("robot-error", { id: config.id, message: "Estratégia não encontrada no servidor." });
    return;
  }

  const api = new DerivAPI();
  const runtime: RobotRuntime = {
    id: config.id,
    config,
    api,
    assetStates: {},
    tickInterval: null,
    lastResult: null,
    isProcessing: false,
    activeContractIds: new Set(),
    currentStake: config.stake || 10,
    strategyMod
  };

  runtimes.set(config.id, runtime);

  api.onTick = (tick) => {
    handleTick(runtime, tick);
  };

  api.onOpenContract = (contract) => {
    handleContractUpdate(runtime, contract);
  };

  api.onBalance = (balance) => {
    io?.emit("robot-balance", { id: config.id, balance });
  };

  try {
    console.log(`[ServerRobot] Connecting to Deriv for ${config.id}...`);
    api.connect(token);
    
    console.log(`[ServerRobot] Waiting for ready state (${config.id})...`);
    await api.readyPromise;
    console.log(`[ServerRobot] Deriv connection READY for ${config.id}`);
    
    const assets = config.assets || [config.asset || "R_100"];
    for (const symbol of assets) {
      const derivSymbol = getDerivSymbol(symbol);
      console.log(`[ServerRobot] Initializing asset ${symbol} (${derivSymbol}) for ${config.id}`);
      
      runtime.assetStates[symbol] = {
        candles: [],
        lastTradeTime: 0,
        lastSignalCandleTs: 0,
        ready: false
      };
      
      console.log(`[ServerRobot] Fetching history for ${derivSymbol}...`);
      const candles = await api.getCandles(derivSymbol, 50, tfToMs(config.timeframe || "1m") / 1000);
      if (candles) {
        console.log(`[ServerRobot] Received ${candles.length} candles for ${derivSymbol}`);
        runtime.assetStates[symbol].candles = candles;
        runtime.assetStates[symbol].ready = true;
      }
      
      console.log(`[ServerRobot] Subscribing to ticks for ${derivSymbol}...`);
      await api.subscribeTicks(derivSymbol);
    }

    console.log(`[ServerRobot] SUCCESS: ${config.name} (${config.id}) is now running.`);
    io?.emit("robot-status", { id: config.id, status: "running", message: "Operando na VPS" });
  } catch (e) {
    console.error(`[ServerRobot] FATAL ERROR starting ${config.id}:`, e);
    socket?.emit("robot-error", { id: config.id, message: "Erro fatal ao iniciar na VPS." });
    runtimes.delete(config.id);
  }
}

export async function stopRobotOnServer(id: string) {
  const runtime = runtimes.get(id);
  if (runtime) {
    runtime.api.disconnect();
    runtimes.delete(id);
    console.log(`[ServerRobot] Stopped ${id}`);
    io?.emit("robot-status", { id, status: "stopped", message: "Parado" });
  }
}

async function handleTick(runtime: RobotRuntime, tick: any) {
  if (!tick || !tick.symbol) return;
  
  // Try to find the symbol in our config map if it's a Deriv symbol
  // But usually tick.symbol will match what we subscribed to.
  // We need to find which internal symbol this maps to.
  let symbol = tick.symbol;
  
  // Find which of our configured assets this tick belongs to
  const configuredSymbol = Object.keys(runtime.assetStates).find(s => getDerivSymbol(s) === tick.symbol) || tick.symbol;
  
  const state = runtime.assetStates[configuredSymbol];
  if (!state || !state.ready) return;

  const tfMs = tfToMs(runtime.config.timeframe || "1m");
  const candleTs = Math.floor(tick.epoch * 1000 / tfMs) * tfMs;
  
  let candles = state.candles;
  const lastCandle = candles[candles.length - 1];

  if (!lastCandle || candleTs > lastCandle.t) {
    // New candle!
    if (lastCandle) {
      // Logic for close of previous candle
      executeStrategy(runtime, symbol);
    }
    
    candles.push({ t: candleTs, o: tick.quote, h: tick.quote, l: tick.quote, c: tick.quote });
    if (candles.length > 100) candles.shift();
  } else {
    // Update current candle
    lastCandle.c = tick.quote;
    lastCandle.h = Math.max(lastCandle.h, tick.quote);
    lastCandle.l = Math.min(lastCandle.l, tick.quote);
  }
}

async function executeStrategy(runtime: RobotRuntime, symbol: string) {
  if (runtime.isProcessing) return;
  const state = runtime.assetStates[symbol];
  const candles = state.candles;
  if (candles.length < 2) return;

  const context: StrategyContext = {
    asset: symbol,
    history: candles,
    lastPrice: candles[candles.length - 1].c,
    balance: 0, // Server doesn't track global balance here
    tradingMode: runtime.config.mode || "demo",
    isBacktest: false,
    intervalMs: tfToMs(runtime.config.timeframe || "1m"),
    candleTimeRemainingMs: 0,
    srLines: [], // To be implemented if needed
    srZones: [],
    hasOpenTrade: runtime.activeContractIds.size > 0,
    indicators: {
      rsi: (p) => rsi(candles.map(c => c.c), p),
      sma: (p) => sma(candles.map(c => c.c), p).map(v => v || 0),
      ema: (p) => ema(candles.map(c => c.c), p).map(v => v || 0),
      bollinger: (p, m) => {
        const res = bollinger(candles.map(c => c.c), p, m);
        return { upper: res.upper.map(v => v || 0), lower: res.lower.map(v => v || 0) };
      },
      adx: (p) => {
        const res = adx(candles, p);
        return { adx: res.adx.map(v => v || 0), plusDi: res.plusDi.map(v => v || 0), minusDi: res.minusDi.map(v => v || 0) };
      },
      macd: (f, s, sig) => {
        const res = macd(candles.map(c => c.c), f, s, sig);
        return { macd: res.macd.map(v => v || 0), signal: res.signal.map(v => v || 0), histogram: res.histogram.map(v => v || 0) };
      }
    }
  };

  try {
    const rawResult = runtime.strategyMod!.onTick(context);
    const result = applyFilterLogic(rawResult, runtime.config.filters, { _rsi: rsi(candles.map(c => c.c), 14).pop() }, runtime.config.globalInvert);

    if (result && result.action) {
      console.log(`[ServerRobot] ${runtime.id} signaling ${result.action} on ${symbol}`);
      const duration = result.duration || runtime.config.durationSeconds || 60;
      
      const derivSymbol = getDerivSymbol(symbol);
      const buyRes = await runtime.api.buyContract(derivSymbol, runtime.currentStake, result.action as any, duration);
      if (buyRes && buyRes.contract_id) {
        runtime.activeContractIds.add(String(buyRes.contract_id));
        io?.emit("robot-trade", { 
          id: runtime.id, 
          trade: {
            id: String(buyRes.contract_id),
            asset: symbol,
            type: result.action,
            amount: runtime.currentStake,
            entry: candles[candles.length - 1].c,
            ts: Date.now(),
            result: "OPEN"
          }
        });
      }
    }
  } catch (e) {
    console.error(`[ServerRobot] Strategy error on ${runtime.id}:`, e);
  }
}

function handleContractUpdate(runtime: RobotRuntime, contract: any) {
  if (!runtime.activeContractIds.has(String(contract.contract_id))) return;

  if (contract.status !== "open") {
    const win = contract.status === "won";
    const pnl = Number(contract.profit);
    
    runtime.activeContractIds.delete(String(contract.contract_id));
    runtime.lastResult = win ? "WIN" : "LOSS";

    io?.emit("robot-trade-update", {
      id: runtime.id,
      contractId: String(contract.contract_id),
      result: win ? "WIN" : "LOSS",
      pnl,
      exit: contract.exit_tick
    });
  }
}
