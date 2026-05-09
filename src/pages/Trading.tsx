import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { CandlestickChart } from "@/components/CandlestickChart";
import { ASSETS, bollinger, fmtPrice, generateCandles, nextCandle, rsi, sma, ema, adx, macd, getPattern, type Candle } from "@/lib/market";
import { runFullBacktest } from "@/lib/backtest";
import { useStore } from "@/lib/store";
import { derivAPI } from "@/lib/derivCore";
import { applyFilterLogic } from "@/strategies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowDown, ArrowUp, Minus, Plus, Trash2, PanelLeftClose, PanelLeftOpen, Bot, Hand, BrainCircuit, Play, Pause, StepForward, StepBack, X, TrendingUp, TrendingDown } from "lucide-react";
import { toast } from "sonner";
import { type Trade } from "@/lib/store";

type Indicator = "none" | "sma" | "rsi" | "bb";

// Component for rendering a trade row with progress bar
function TradeRow({ t, handleCloseTrade, backtestIdx }: { t: Trade, handleCloseTrade: (id: string, isApi: boolean) => void, backtestIdx: number }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (t.result !== "OPEN") { setProgress(100); return; }
    if (t.marketType === "forex") return;

    if (t.mode === "backtest") {
      if (t.entryCandleIdx != null && t.expiryCandles != null && t.expiryCandles > 0) {
        const elapsed = backtestIdx - t.entryCandleIdx;
        setProgress(Math.min(100, Math.max(0, (elapsed / t.expiryCandles) * 100)));
      }
      return;
    }

    // Live mode
    let aff: number;
    const durationMs = (t.durationS || 1) * 1000;
    const update = () => {
      const elapsed = Date.now() - t.ts;
      const pc = Math.min(100, Math.max(0, (elapsed / durationMs) * 100));
      setProgress(pc);
      if (pc < 100) aff = requestAnimationFrame(update);
    };
    aff = requestAnimationFrame(update);
    return () => cancelAnimationFrame(aff);
  }, [t.result, t.mode, t.marketType, t.entryCandleIdx, t.expiryCandles, t.durationS, t.ts, backtestIdx]);

  return (
    <tr className="border-b border-border/20 hover:bg-[#2a2e39] relative">
      <td className="py-1.5 font-medium cursor-help relative pl-1" title={new Date(t.ts).toLocaleTimeString()}>
        <div className="flex items-center gap-1">
          {t.type === "CALL" || t.type === "BUY" ? <ArrowUp className="h-2.5 w-2.5 text-bull" /> : <ArrowDown className="h-2.5 w-2.5 text-bear" />}
          {t.asset}
        </div>
        {t.result === "OPEN" && (
          <div className="absolute bottom-0 left-0 h-[2px] bg-primary/60 transition-all rounded-r" style={{ width: `${progress}%` }} />
        )}
      </td>
      <td className={`py-1.5 text-center ${(t.result === "OPEN") ? "text-warning" : (t.pnl ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>
        {t.result === "OPEN" ? "--" : `${(t.pnl ?? 0) >= 0 ? "+" : ""}${t.pnl?.toFixed(2)}`}
      </td>
      <td className={`py-1.5 text-center font-bold ${t.result === "WIN" ? "text-bull" : t.result === "LOSS" ? "text-bear" : "text-warning"}`}>
        {t.result === "OPEN" ? (
          <button
            onClick={() => handleCloseTrade(t.id, String(t.id).length < 20)}
            className="inline-flex items-center p-0.5 rounded bg-foreground/10 hover:bg-destructive hover:text-white transition-colors"
            title="Fechar agora"
          >
            <X className="h-3 w-3" />
          </button>
        ) : t.result}
      </td>
    </tr>
  );
}

// Fixed starting balance for ALL batch backtests — ensures deterministic, repeatable results
const BACKTEST_START_BALANCE = 10000;

// In-memory cache for backtest results so they persist across page navigations
const backtestResultsCacheRef = { current: new Map<string, { trades: Trade[], timestamp: number }>() };

export default function Trading() {
  const {
    demoToken, realToken,
    tradingMode, marketType, automationMode, setAutomationMode,
    assetsSidebarOpen, toggleAssetsSidebar,
    srLines, srZones, clearSR, risk, addTrade, updateTrade, addPnl, balance, setBalance, trades, forex,
    management, setManagement,
    timeframe, activeStrategyId, customBacktestData, setCustomBacktestData,
    lastSelectedAsset, setLastSelectedAsset,
    backtestIndices, setBacktestIndex,
    strategyFilters, strategyInvert
  } = useStore();

  const [assetSym, setAssetSym] = useState(lastSelectedAsset || ASSETS[0]?.symbol || "");
  const [indicator, setIndicator] = useState<Indicator>("sma");
  const [stake, setStake] = useState(risk.defaultStake);
  const [duration, setDuration] = useState(60);
  const [lotSize, setLotSize] = useState(forex.lotSize);
  const [slPips, setSlPips] = useState(forex.stopLossPips);
  const [tpPips, setTpPips] = useState(forex.takeProfitPips);

  const lastResultRef = useRef<"WIN" | "LOSS" | null>(null);
  const lastSRCandleProcessedRef = useRef<Record<string, number>>({});
  const allAssetsCandlesRef = useRef<Record<string, Candle[]>>({});

  const trackedSymbolsSet = useMemo(() => {
    const s = new Set<string>();
    srLines.forEach(l => s.add(l.asset));
    srZones.forEach(z => s.add(z.asset));
    s.add(assetSym);
    return Array.from(s);
  }, [srLines, srZones, assetSym]);

  const autoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const placeOrderRef = useRef<typeof placeOrder | null>(null);
  const timeoutsRef = useRef<Record<string, NodeJS.Timeout>>({});

  useEffect(() => {
    if (assetSym && assetSym !== lastSelectedAsset) {
      setLastSelectedAsset(assetSym);
    }
  }, [assetSym, lastSelectedAsset, setLastSelectedAsset]);

  const asset = ASSETS.find((a) => a.symbol === assetSym) || ASSETS[0];

  // Clean up stale local trades on mount
  useEffect(() => {
    const sTrades = useStore.getState().trades || [];
    sTrades.forEach(t => {
      if (t.result === "OPEN" && t.mode !== "backtest") {
        const isStale = t.durationS ? (Date.now() - t.ts) > (t.durationS * 1000 + 5000) : false;
        if (isStale) {
          updateTrade(t.id, { result: "LOSS", pnl: -t.amount, exit: t.entry });
        }
      }
    });
  }, [updateTrade]);
  const currentModeTrades = useMemo(() => {
    let modeTrades = trades.filter(t => t.mode === tradingMode);
    if (tradingMode === "backtest") {
      // Isolate trades to ONLY the active strategy
      modeTrades = modeTrades.filter(t => t.strategyId === (activeStrategyId || "manual"));
    }
    return modeTrades;
  }, [trades, tradingMode, activeStrategyId]);

  const intervalMs = useMemo(() => {
    switch (timeframe) {
      case "1m": return 60_000;
      case "5m": return 300_000;
      case "15m": return 900_000;
      case "1h": return 3_600_000;
      case "1d": return 86_400_000;
      default: return 60_000;
    }
  }, [timeframe]);

  const [liveCandles, setLiveCandles] = useState<Candle[]>(() => generateCandles(asset, 5000, 42, intervalMs));
  const fallbackMaxBacktest = 5000;
  const backtestData = useMemo(() => {
    const currentAsset = ASSETS.find((a) => a.symbol === assetSym);
    if (!currentAsset) return [];
    return generateCandles(currentAsset, fallbackMaxBacktest, (currentAsset?.symbol?.length || 5) * 13, intervalMs);
  }, [assetSym, intervalMs]);

  const currentBacktestData = customBacktestData[assetSym] || backtestData;
  const currentMaxBacktest = currentBacktestData.length;

  const [backtestIdx, setBacktestIdxState] = useState(() => backtestIndices[assetSym] ?? 500);
  const backtestIdxRef = useRef(backtestIdx);
  useEffect(() => { backtestIdxRef.current = backtestIdx; }, [backtestIdx]);

  const setBacktestIdx = useCallback((val: number | ((prev: number) => number)) => {
    setBacktestIdxState(val);
  }, []);

  // Synchronize index when asset changes
  useEffect(() => {
    const savedIdx = backtestIndices[assetSym] ?? 500;
    setBacktestIdxState(savedIdx);
  }, [assetSym, backtestIndices]);

  useEffect(() => {
    setBacktestIndex(assetSym, backtestIdx);
  }, [assetSym, backtestIdx, setBacktestIndex]);

  const [backtestPlaying, setBacktestPlaying] = useState(false);
  const [backtestSpeed, setBacktestSpeed] = useState(1);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [isLoadingBacktest, setIsLoadingBacktest] = useState(false);
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [allAssetsProgress, setAllAssetsProgress] = useState("");

  // Deriv connection & Candle init
  const hasHistory = !!customBacktestData[assetSym];
  useEffect(() => {
    let activeToken = undefined;
    if (tradingMode === "demo" && demoToken) activeToken = demoToken;
    else if (tradingMode === "real" && realToken) activeToken = realToken;

    derivAPI.connect(activeToken);

    if (tradingMode === "backtest") {
      setLiveCandles(generateCandles(asset, 5000, (asset?.symbol?.length || 5) * 13, intervalMs));
      setBacktestPlaying(false);

      if (!hasHistory && assetSym) {
        setIsLoadingBacktest(true);
        let isSubscribedBacktest = true;
        (async () => {
          try {
            const candlesData = await derivAPI.getCandles(assetSym, 5000, intervalMs / 1000);
            if (isSubscribedBacktest && candlesData && candlesData.length) {
              const parsed: Candle[] = candlesData.map((c: { epoch: number, open: number, high: number, low: number, close: number }) => ({
                t: c.epoch * 1000,
                o: c.open, h: c.high, l: c.low, c: c.close
              }));
              setCustomBacktestData(assetSym, parsed);
            }
          } catch (e) {
            console.error("Failed to fetch backtest history", e);
          } finally {
            if (isSubscribedBacktest) setIsLoadingBacktest(false);
          }
        })();
        return () => { isSubscribedBacktest = false; };
      }
    }
  }, [assetSym, demoToken, realToken, tradingMode, intervalMs, asset, hasHistory, setCustomBacktestData]);

  // Unified Multi-Asset Tick & Data Handler
  useEffect(() => {
    if (tradingMode === "backtest") return;

    let isSubscribed = true;

    derivAPI.onTick = (tick) => {
      if (!tick) return;
      const symbol = tick.symbol;

      if (allAssetsCandlesRef.current[symbol]) {
        const cs = allAssetsCandlesRef.current[symbol];
        const last = { ...cs[cs.length - 1] };
        const now = tick.epoch * 1000;

        let updated: Candle[];
        if (now - last.t >= intervalMs) {
          const c: Candle = { t: last.t + intervalMs, o: last.c, h: tick.quote, l: tick.quote, c: tick.quote };
          updated = [...cs.slice(-4999), c];
        } else {
          last.c = tick.quote;
          last.h = Math.max(last.h, tick.quote);
          last.l = Math.min(last.l, tick.quote);
          updated = [...cs.slice(0, -1), last];
        }
        allAssetsCandlesRef.current[symbol] = updated;

        if (symbol === assetSym) {
          setLiveCandles(updated);
        }
      }
    };

    derivAPI.onBalance = (b) => { setBalance(b); };
    derivAPI.onLatency = (ms) => { setLatencyMs(ms); };
    derivAPI.onOpenContract = (contract: { contract_id: number | string, status: string, profit: number, exit_tick?: number, sell_price?: number }) => {
      const id = String(contract.contract_id);
      const st = contract.status;
      const profit = contract.profit;

      if (st === "won" || st === "lost" || st === "sold") {
        updateTrade(id, {
          result: profit > 0 ? "WIN" : "LOSS",
          pnl: profit,
          exit: contract.exit_tick || contract.sell_price
        });
      } else if (st === "open") {
        updateTrade(id, { pnl: profit });
      }
    };

    // Auto-subscribe to tracked symbols
    trackedSymbolsSet.forEach(async (symbol) => {
      if (!allAssetsCandlesRef.current[symbol]) {
        try {
          const candlesData = await derivAPI.getCandles(symbol, 500, intervalMs / 1000);
          if (isSubscribed && candlesData && candlesData.length) {
            const parsed: Candle[] = candlesData.map((c: { epoch: number, open: number, high: number, low: number, close: number }) => ({
              t: c.epoch * 1000,
              o: c.open, h: c.high, l: c.low, c: c.close
            }));
            allAssetsCandlesRef.current[symbol] = parsed;
            if (symbol === assetSym) setLiveCandles(parsed);
          }
        } catch (e) {
          console.error(`Failed background init for ${symbol}`, e);
        }
      }
      derivAPI.subscribeTicks(symbol).catch(() => { });
    });

    return () => {
      isSubscribed = false;
      derivAPI.onTick = null;
      derivAPI.onBalance = null;
      derivAPI.onLatency = null;
      derivAPI.onOpenContract = null;
    };
  }, [tradingMode, intervalMs, assetSym, trackedSymbolsSet, setBalance, updateTrade]);

  const [draw, setDraw] = useState<"support" | "resistance" | "buy_zone" | "sell_zone" | null>(null);

  const handleCloseTrade = async (id: string, isApiOrder: boolean) => {
    const trade = trades.find((t) => t.id === id);
    if (!trade || trade.result !== "OPEN") return;

    if (isApiOrder && derivAPI.token && derivAPI.ws?.readyState === WebSocket.OPEN) {
      try {
        toast.info(`Buscando fechar ordem API Deriv...`);
        await derivAPI.sellContract(Number(id), 0); // sell at market
        toast.success(`Ordem enviada para fechamento!`);
        return;
      } catch (e: unknown) {
        toast.error(`Deriv API Erro: ${(e as Error).message || "Falha ao fechar ordem"}`);
        return;
      }
    }

    // Local manual close
    if (timeoutsRef.current[id]) {
      clearTimeout(timeoutsRef.current[id]);
      delete timeoutsRef.current[id];
    }

    const exitPrice = lastPrice;
    let win = false;
    let pnl = 0;

    if (trade.type === "CALL" || trade.type === "PUT") { // Binary
      if (trade.mode === "backtest" && trade.entryCandleIdx !== undefined && trade.expiryCandles !== undefined) {
        const elapsedCandles = backtestIdx - trade.entryCandleIdx;
        win = trade.type === "CALL" ? exitPrice > trade.entry : exitPrice < trade.entry;
        const proportion = trade.expiryCandles > 0 ? Math.min(elapsedCandles / trade.expiryCandles, 1) : 1;
        if (win) {
          pnl = trade.amount * (risk.payout / 100) * proportion * 0.8;
        } else {
          pnl = -trade.amount * (0.2 + 0.8 * proportion);
        }
        win = pnl > 0;
      } else {
        win = trade.type === "CALL" ? exitPrice > trade.entry : exitPrice < trade.entry;
        const elapsedMs = Date.now() - trade.ts;
        const durationMs = trade.durationS * 1000;
        const proportion = durationMs > 0 ? Math.min(elapsedMs / durationMs, 1) : 1;

        if (win) {
          pnl = trade.amount * (risk.payout / 100) * proportion * 0.8;
        } else {
          pnl = -trade.amount * (0.2 + 0.8 * proportion);
        }
        win = pnl > 0;
      }
    } else { // Forex
      const pipValue = trade.asset.includes("JPY") ? 0.01 : 0.0001;
      const pips = trade.type === "BUY" ? (exitPrice - trade.entry) / pipValue : (trade.entry - exitPrice) / pipValue;
      pnl = pips * (trade.amount * 100000 * pipValue);
      win = pnl > 0;
    }

    lastResultRef.current = win ? "WIN" : "LOSS";
    addPnl(pnl);
    updateTrade(id, { exit: exitPrice, result: win ? "WIN" : "LOSS", pnl });
    toast[win ? "success" : "error"](`${win ? "WIN" : "LOSS"} (Manual) ${trade.asset} · ${pnl > 0 ? "+" : ""}${pnl.toFixed(2)}`);
  };

  // tick
  useEffect(() => {
    if (tradingMode === "backtest") {
      if (!backtestPlaying) return;
      const t = 1000 / backtestSpeed;
      const id = setInterval(() => {
        setBacktestIdx(v => {
          if (v >= currentMaxBacktest) {
            setBacktestPlaying(false);
            return currentMaxBacktest;
          }
          return v + 1;
        });
      }, t);
      return () => clearInterval(id);
    } else {
      // Synthetic fallback if no live data is arriving
      const lastTickLocal = Date.now();
      const id = setInterval(() => {
        // Only run synthetic if Deriv WS is apparently not pushing (simplification)
        if (derivAPI.ws?.readyState === WebSocket.OPEN) return;

        setLiveCandles((cs) => {
          if (!cs || cs.length === 0) return cs;
          const last = cs[cs.length - 1];
          const currentAsset = ASSETS.find((a) => a.symbol === assetSym) || ASSETS[0];
          if (!currentAsset) return cs;
          return [...cs.slice(-4999), nextCandle(last, currentAsset, intervalMs)];
        });
      }, 1500);
      return () => clearInterval(id);
    }
  }, [assetSym, intervalMs, tradingMode, backtestPlaying, backtestSpeed, currentMaxBacktest, setBacktestIdx]);

  const isLoading = tradingMode === "backtest" && isLoadingBacktest;

  const candles = useMemo(() => {
    if (tradingMode === "backtest") {
      if (isLoading) return [];
      return currentBacktestData.slice(0, backtestIdx);
    }
    return liveCandles;
  }, [tradingMode, currentBacktestData, backtestIdx, liveCandles, isLoading]);

  const latestCandlesRef = useRef(candles);
  latestCandlesRef.current = candles;

  const closes = useMemo(() => candles.map((c) => c.c), [candles]);

  // Reinitialize backtester when strategy changes
  const prevStrategyRef = useRef<string | null>(activeStrategyId);
  useEffect(() => {
    if (tradingMode === "backtest") {
      // Only clear trades if strategy actually changed (not on re-mount)
      if (prevStrategyRef.current !== activeStrategyId) {
        setBacktestIdx(500);
        setBacktestPlaying(false);
        useStore.setState(s => ({
          trades: s.trades.filter(t => t.mode !== "backtest")
        }));
      }
      prevStrategyRef.current = activeStrategyId;
    }
  }, [activeStrategyId, tradingMode, setBacktestIdx, setBacktestPlaying]);

  // NOTE: Full backtest is NO LONGER run automatically.
  // It only runs when the user explicitly clicks "Rodar Todos" or "Rodar Ativo Atual".
  // Results are cached in memory so navigating between pages doesn't re-trigger processing.

  // Helper: find strategy module by ID
  const findStrategyModule = useCallback(() => {
    if (!activeStrategyId) return null;
    const modules = import.meta.glob('@/strategies/*.ts', { eager: true });
    for (const path in modules) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = modules[path] as any;
      if (mod.default && mod.default.id === activeStrategyId && mod.default.onTick) {
        return mod.default;
      }
    }
    return null;
  }, [activeStrategyId]);

  // Run backtest on CURRENT asset only (on-demand)
  const runCurrentAssetBacktest = useCallback(() => {
    if (tradingMode !== "backtest" || !activeStrategyId) {
      toast.error("Selecione uma estratégia e esteja no modo Backtest.");
      return;
    }

    // Use ONLY real data (same source as "Rodar Todos") — never synthetic
    const realData = customBacktestData[assetSym] as Candle[] | undefined;
    if (!realData || realData.length <= 20) {
      toast.error(`Sem dados reais para ${assetSym}. Carregue dados do Redis ou Deriv primeiro.`);
      return;
    }

    const stratMod = findStrategyModule();
    if (!stratMod) {
      toast.error("Estratégia não encontrada!");
      return;
    }

    const tf = useStore.getState().timeframe;
    toast.info(`⏳ Processando backtest em ${assetSym}...`);

    setTimeout(() => {
      // Get current filters for this strategy
      const currentFilters = useStore.getState().strategyFilters[activeStrategyId!] || undefined;
      const currentInvert = useStore.getState().strategyInvert[activeStrategyId!] || false;

      // FIXED balance — same as "Rodar Todos" uses, so results are identical
      const newTrades = runFullBacktest(
        realData,
        assetSym,
        stratMod,
        BACKTEST_START_BALANCE,
        risk,
        forex,
        marketType as "binary" | "forex",
        intervalMs,
        srLines,
        srZones,
        currentFilters,
        currentInvert
      );
      newTrades.forEach(t => { t.timeframe = tf; });

      // Cache the result
      const cacheKey = `${assetSym}_${activeStrategyId}`;
      backtestResultsCacheRef.current.set(cacheKey, { trades: newTrades, timestamp: Date.now() });

      // Replace ONLY this asset's trades for this strategy
      useStore.setState(s => {
        const otherTrades = s.trades.filter(t => !(t.mode === "backtest" && t.asset === assetSym && t.strategyId === activeStrategyId));
        return { trades: [...otherTrades, ...newTrades] };
      });

      const wins = newTrades.filter(t => t.result === "WIN").length;
      const total = newTrades.length;
      const wr = total > 0 ? ((wins / total) * 100).toFixed(1) : "0";
      toast.success(`✅ ${assetSym}: ${total} trades · WR: ${wr}%`);
    }, 50);
  }, [tradingMode, activeStrategyId, customBacktestData, assetSym, marketType, intervalMs, risk, forex, srLines, srZones, findStrategyModule]);

  // Run backtest on ALL assets at once (only those with Redis data)
  // This is now async with progress tracking to avoid freezing the UI
  const runAllAssetsBacktest = useCallback(() => {
    if (tradingMode !== "backtest" || !activeStrategyId) {
      toast.error("Selecione uma estratégia e esteja no modo Backtest.");
      return;
    }

    const stratMod = findStrategyModule();
    if (!stratMod) {
      toast.error("Estratégia não encontrada!");
      return;
    }

    // Only backtest assets that have real data loaded
    const assetsWithData = Object.keys(customBacktestData).filter(
      sym => (customBacktestData[sym] as Candle[])?.length > 20
    );

    if (assetsWithData.length === 0) {
      toast.error("Nenhum ativo com dados carregados. Busque dados do Redis/Deriv primeiro.");
      return;
    }

    setIsProcessingAll(true);
    setAllAssetsProgress(`Iniciando... 0/${assetsWithData.length}`);

    const allNewTrades: Trade[] = [];
    const tf = useStore.getState().timeframe;
    let idx = 0;

    const processNext = () => {
      if (idx >= assetsWithData.length) {
        // All done — REPLACE ALL backtest trades for this strategy
        useStore.setState(s => {
          const otherTrades = s.trades.filter(t => !(t.mode === "backtest" && t.strategyId === activeStrategyId));
          return { trades: [...otherTrades, ...allNewTrades] };
        });

        // Cache results
        assetsWithData.forEach(sym => {
          const cacheKey = `${sym}_${activeStrategyId}`;
          const symTrades = allNewTrades.filter(t => t.asset === sym);
          backtestResultsCacheRef.current.set(cacheKey, { trades: symTrades, timestamp: Date.now() });
        });

        const wins = allNewTrades.filter(t => t.result === "WIN").length;
        const total = allNewTrades.length;
        const wr = total > 0 ? ((wins / total) * 100).toFixed(1) : "0";

        setIsProcessingAll(false);
        setAllAssetsProgress("");
        toast.success(`✅ Backtest concluído: ${assetsWithData.length} ativos · ${total} trades · WR: ${wr}%`);
        return;
      }

      const sym = assetsWithData[idx];
      setAllAssetsProgress(`Processando ${sym}... ${idx + 1}/${assetsWithData.length}`);

      const cData = customBacktestData[sym] as Candle[];
      // Get current filters for this strategy
      const currentFilters = useStore.getState().strategyFilters[activeStrategyId!] || undefined;
      const currentInvert = useStore.getState().strategyInvert[activeStrategyId!] || false;

      // FIXED balance — deterministic results
      const trades = runFullBacktest(
        cData,
        sym,
        stratMod,
        BACKTEST_START_BALANCE,
        risk,
        forex,
        marketType as "binary" | "forex",
        intervalMs,
        srLines,
        srZones,
        currentFilters,
        currentInvert
      );
      trades.forEach(t => { t.timeframe = tf; });
      allNewTrades.push(...trades);

      idx++;
      setTimeout(processNext, 10);
    };

    setTimeout(processNext, 100);
  }, [tradingMode, activeStrategyId, marketType, customBacktestData, intervalMs, risk, forex, srLines, srZones, findStrategyModule]);

  const overlays = useMemo(() => {
    const defaultMAs = {
      ma11: sma(closes, 11),
      ma15: sma(closes, 15),
      ma200: sma(closes, 200),
      ma235: sma(closes, 235)
    };
    if (indicator === "sma") return { ...defaultMAs, ma: sma(closes, 20) };
    if (indicator === "bb") return { ...defaultMAs, ...bollinger(closes, 20, 2) };
    return defaultMAs;
  }, [closes, indicator]);
  const rsiArr = useMemo(() => rsi(closes), [closes]);
  const lastPrice = candles[candles.length - 1]?.c ?? 0;

  // gestão: parar após N perdas/vitórias seguidas (Risk legado)
  const recentResults = currentModeTrades.slice(0, 10).map((t) => t.result);
  const lossStreak = (() => { let n = 0; for (const r of recentResults) { if (r === "LOSS") n++; else break; } return n; })();
  const winStreak = (() => { let n = 0; for (const r of recentResults) { if (r === "WIN") n++; else break; } return n; })();

  const riskBlocked = risk.enabled ? (
    (risk.stopAfterLosses > 0 && lossStreak >= risk.stopAfterLosses) ||
    (risk.stopAfterWins > 0 && winStreak >= risk.stopAfterWins)
  ) : false;

  const managementBlocked = useMemo(() => {
    if (!management.enabled) return false;
    if (management.currentDailyPnl >= management.dailyGoal) return "META_ATINGIDA";
    if (management.currentDailyPnl <= -management.dailyStopLoss) return "STOP_LOSS";
    if (management.vdvPaused) return "VDV_PAUSED";
    return false;
  }, [management]);

  const blocked = !!riskBlocked || !!managementBlocked;

  const checkManagementFilters = useCallback((dir: "CALL" | "PUT" | "BUY" | "SELL", customCandles?: Candle[]) => {
    if (!management.enabled) return true;

    const candlesToUse = customCandles || candles;
    if (candlesToUse.length === 0) return true;

    const targetCloses = candlesToUse.map(c => c.c);
    const targetLastPrice = targetCloses[targetCloses.length - 1];

    // Technical filters
    if (management.rsiFilter) {
      const rArr = rsi(targetCloses, management.rsiPeriod);
      const r = rArr[rArr.length - 1];
      if (r !== null) {
        if (dir === "CALL" || dir === "BUY") {
          if (r > management.rsiOverbought) return false;
        } else {
          if (r < management.rsiOversold) return false;
        }
      }
    }

    if (management.maFilter) {
      const ma = management.maType === "sma" ? sma(targetCloses, management.maPeriod) : ema(targetCloses, management.maPeriod);
      const lastMA = ma[ma.length - 1];
      if (lastMA) {
        if (dir === "CALL" || dir === "BUY") {
          if (targetLastPrice < lastMA) return false;
        } else {
          if (targetLastPrice > lastMA) return false;
        }
      }
    }

    if (management.macFilter) {
      const maShort = sma(targetCloses, management.macShortPeriod);
      const maLong = sma(targetCloses, management.macLongPeriod);
      const s = maShort[maShort.length - 1];
      const l = maLong[maLong.length - 1];
      if (s && l) {
        if (dir === "CALL" || dir === "BUY") {
          if (s < l) return false;
        } else {
          if (s > l) return false;
        }
      }
    }

    if (management.adxFilter && candlesToUse.length > management.adxPeriod) {
      const adxData = adx(candlesToUse, management.adxPeriod);
      const lastADX = adxData.adx[adxData.adx.length - 1];
      if (lastADX !== null && lastADX < management.adxThreshold) return false;
    }

    return true;
  }, [management, candles, lastPrice]);

  // Keep placeOrder ref up to date to avoid stale closure in interval
  useEffect(() => {
    placeOrderRef.current = placeOrder;
  });

  // Semi-auto / Auto script logic
  const runSemiAutoLogic = useCallback(() => {
    if (automationMode === "manual" || blocked) return;

    if (automationMode === "auto" && tradingMode === "backtest") return;

    const modules = import.meta.glob('@/strategies/*.ts', { eager: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let strategyModule: any = null;

    if (activeStrategyId) {
      for (const path in modules) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mod = modules[path] as any;
        if (mod.default && mod.default.id === activeStrategyId) {
          strategyModule = mod.default;
          break;
        }
      }
    }

    if (!strategyModule) return;

    const isSemiAutoStrategy = strategyModule?.category === "semi-auto";
    const shouldRunActiveStrategy = strategyModule && (
      automationMode === "auto" || (automationMode === "semi-auto" && isSemiAutoStrategy)
    );

    if (!shouldRunActiveStrategy) return;

    // Determine tracked symbols and their current candles based on mode
    let symbolsToProcess: { symbol: string, currentCandles: Candle[] }[] = [];

    if (tradingMode === "backtest") {
      const cData = useStore.getState().customBacktestData[assetSym] as Candle[];
      if (cData && backtestIdxRef.current > 0) {
        symbolsToProcess.push({
          symbol: assetSym,
          currentCandles: cData.slice(0, backtestIdxRef.current)
        });
      }
    } else {
      const trackedSymbols = Object.keys(allAssetsCandlesRef.current);
      symbolsToProcess = trackedSymbols.map(symbol => ({
        symbol,
        currentCandles: allAssetsCandlesRef.current[symbol]
      }));
    }

    for (const { symbol, currentCandles } of symbolsToProcess) {
      if (currentCandles.length < 2) continue;

      const symbolAsset = ASSETS.find(a => a.symbol === symbol) || asset;

      const lastCandleTime = currentCandles[currentCandles.length - 1]?.t || Date.now();
      const candleTimeRemainingMs = tradingMode === "backtest" ? 0 : Math.max(0, (lastCandleTime + intervalMs) - Date.now());

      const context = {
        asset: symbol,
        history: currentCandles.map(c => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c })),
        lastPrice: currentCandles[currentCandles.length - 1]?.c || 0,
        balance,
        tradingMode,
        isBacktest: tradingMode === "backtest",
        intervalMs,
        candleTimeRemainingMs,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        srLines: (useStore.getState().srLines || []).filter(l => l.asset === symbol).map(l => ({ id: l.id, price: l.price, type: l.kind as any, asset: l.asset })),
        srZones: (useStore.getState().srZones || []).filter(z => z.asset === symbol).map(z => ({ id: z.id, p1: z.topPrice, p2: z.bottomPrice, type: z.kind === "buy_zone" ? "support" : "resistance" as const, asset: z.asset })),
        activeFilters: activeStrategyId ? (useStore.getState().strategyFilters[activeStrategyId] || undefined) : undefined,
        indicators: {
          rsi: (period: number) => rsi(currentCandles.map(c => c.c), period),
          sma: (period: number) => sma(currentCandles.map(c => c.c), period).map(v => v || 0),
          ema: (period: number) => ema(currentCandles.map(c => c.c), period).map(v => v || 0),
          bollinger: (period: number, multiplier: number) => bollinger(currentCandles.map(c => c.c), period, multiplier) as { upper: number[]; lower: number[] },
          adx: (period: number) => adx(currentCandles, period) as { adx: number[]; plusDi: number[]; minusDi: number[] },
          macd: (fast: number, slow: number, signal: number) => macd(currentCandles.map(c => c.c), fast, slow, signal) as { macd: number[]; signal: number[]; histogram: number[] }
        },
        hasOpenTrade: (useStore.getState().trades || []).some(
          t => t.result === "OPEN" && t.mode === tradingMode && t.asset === symbol
        ),
        updateSR: useStore.getState().updateSR,
        toast: toast
      };

      const rawResult = strategyModule.onTick(context);

      // Apply filter logic (ranges with ignore/invert + global invert)
      const closes = currentCandles.map(c => c.c);
      const rsiArr = rsi(closes, 14);
      const adxData = adx(currentCandles, 14);
      const indicatorValues: Record<string, number | string | null | undefined> = {
        _rsi: rsiArr[rsiArr.length - 1],
        _adx: adxData.adx[adxData.adx.length - 1],
        _expiryCandles: rawResult?.expiryCandles ?? null,
        _asset: symbol,
      };
      const currentFilters = activeStrategyId ? (useStore.getState().strategyFilters[activeStrategyId] || undefined) : undefined;
      const currentInvert = activeStrategyId ? (useStore.getState().strategyInvert[activeStrategyId] || false) : false;
      const result = applyFilterLogic(rawResult, currentFilters, indicatorValues, currentInvert);

      if (result && result.action) {
        // If strategy wants candle-synced entry, schedule it
        if (result.waitForCandleClose && candleTimeRemainingMs > 1000) {
          setTimeout(() => {
            placeOrderRef.current?.(result.action!, true, result.duration, result.stake, result.expiryCandles, symbol);
          }, candleTimeRemainingMs + 200); // +200ms buffer after candle close
        } else {
          placeOrderRef.current?.(result.action, true, result.duration, result.stake, result.expiryCandles, symbol);
        }
      }

      // Update last processed candle ref since strategy executed
      if (currentCandles[currentCandles.length - 2]) {
        lastSRCandleProcessedRef.current[symbol] = currentCandles[currentCandles.length - 2].t;
      }
    }
  }, [automationMode, srLines, asset.symbol, blocked, balance, activeStrategyId, tradingMode, asset]);

  useEffect(() => {
    if (automationMode === "manual") {
      if (autoIntervalRef.current) { clearInterval(autoIntervalRef.current); autoIntervalRef.current = null; }
      return;
    }

    // For backtest, we shouldn't use absolute time intervals if playing fast
    // Actually we will handle backtest explicitly in another effect, so we don't interfere
    // But for live mode:
    if (tradingMode !== "backtest") {
      autoIntervalRef.current = setInterval(() => {
        runSemiAutoLogic();
      }, 1000);
      return () => { if (autoIntervalRef.current) clearInterval(autoIntervalRef.current); };
    }
  }, [automationMode, runSemiAutoLogic, tradingMode]);



  const placeOrder = async (dir: "CALL" | "PUT" | "BUY" | "SELL", fromAuto = false, customDuration?: number, customStake?: number, customExpiryCandles?: number, assetOverride?: string) => {
    if (blocked) {
      const msg = managementBlocked === "META_ATINGIDA" ? "Meta diária atingida" :
        managementBlocked === "STOP_LOSS" ? "Stop loss diário atingido" :
          managementBlocked === "VDV_PAUSED" ? "Pausa VDV ativa (aguardando 2 wins)" :
            `Bloqueio de gestão (${lossStreak}L/${winStreak}W)`;
      toast.error(msg);
      return;
    }

    const orderAsset = assetOverride ? (ASSETS.find(a => a.symbol === assetOverride) || asset) : asset;
    const orderCandles = assetOverride ? (allAssetsCandlesRef.current[assetOverride] || candles) : candles;
    const orderLastPrice = orderCandles[orderCandles.length - 1]?.c || lastPrice;

    // Sequence filters (Risk legado or Management novo)
    const entryAfterWin = management.enabled ? management.entryAfterWin : risk.entryAfterWin;
    const entryAfterLoss = management.enabled ? management.entryAfterLoss : risk.entryAfterLoss;

    if (entryAfterWin && lastResultRef.current !== "WIN") { toast("Aguardando vitória anterior"); return; }
    if (entryAfterLoss && lastResultRef.current !== "LOSS") { toast("Aguardando derrota anterior"); return; }

    // Management Technical Filters (Always uses active chart candles for checkManagementFilters if not careful, 
    // but strategy already decided internally. However management filters are global UI config.
    // Fixed technical filter check to use orderCandles:
    if (management.enabled && !checkManagementFilters(dir, orderCandles)) {
      toast.info(`A estratégia deu sinal em ${orderAsset.symbol}, mas o filtro de gestão bloqueou a entrada.`);
      return;
    }

    // Use custom duration & stake if provided, otherwise fallback to UI stated ones
    let finalDuration = customDuration ?? duration;
    const finalStake = customStake ?? stake;
    const finalLotSize = customStake ?? lotSize;

    // Handle "End of Candle" sync
    if (finalDuration === -1) {
      if (tradingMode === "backtest") {
        // In backtest, -1 means it expires at the end of the current candle index
        finalDuration = Math.ceil(intervalMs / 1000);
      } else {
        const lastCandle = orderCandles[orderCandles.length - 1];
        if (lastCandle) {
          const nextCandleT = lastCandle.t + intervalMs;
          const remainingS = Math.floor((nextCandleT - Date.now()) / 1000);
          // Ensure at least 1s, but typically Deriv requires more for some contracts. 
          // If less than 5s, maybe add one more candle? For now, just cap at 1s.
          finalDuration = Math.max(1, remainingS);
        } else {
          finalDuration = 60; // fallback
        }
      }
    }

    const entry = orderLastPrice;
    const ts = Date.now();
    const entryTime = orderCandles[orderCandles.length - 1]?.t || ts;
    let id = crypto.randomUUID();

    let isApiOrder = false;
    const isLiveMode = tradingMode === "demo" || tradingMode === "real";

    if (isLiveMode && derivAPI.token && derivAPI.ws?.readyState === WebSocket.OPEN) {
      if (marketType === "binary") {
        try {
          toast.info(`🛒 Enviando ordem API Deriv (${orderAsset.symbol})...`);
          const callStart = Date.now();
          const buyRes = await derivAPI.buyContract(orderAsset.symbol, finalStake, dir as "CALL" | "PUT", finalDuration, "s");
          if (buyRes && buyRes.contract_id) {
            const sendLatency = Date.now() - callStart;
            id = String(buyRes.contract_id);
            isApiOrder = true;
            toast.success(`Ordem em ${orderAsset.symbol} enviada com sucesso! Latência API: ${sendLatency}ms`);
            setLatencyMs(sendLatency);
          }
        } catch (e: unknown) {
          const err = e as Error;
          toast.error(`Deriv API Erro (${orderAsset.symbol}): ${err.message || "Falha ao abrir ordem"}`);
          return;
        }
      }
    }

    const orderCloses = orderCandles.map(c => c.c);
    const rsiVal = rsi(orderCloses, management.rsiPeriod)[orderCloses.length - 1];

    // Compute remaining indicators dynamically for snapshot
    const lastCandleIdx = orderCandles.length - 1;
    const adxData = adx(orderCandles, 14);
    const macdData = macd(orderCloses, 12, 26, 9);
    const ma9 = sma(orderCloses, 9);
    const ma21 = sma(orderCloses, 21);
    const pattern = getPattern(orderCandles, lastCandleIdx);

    const sh = {
      rsi: rsiVal,
      adx: adxData.adx[adxData.adx.length - 1],
      macd: macdData.macd[macdData.macd.length - 1],
      histogram: macdData.histogram[macdData.histogram.length - 1],
      pattern: pattern,
      ma9: ma9[ma9.length - 1],
      ma21: ma21[ma21.length - 1]
    };

    // For backtesting, convert duration to expiryCandles
    let expiryCandles = customExpiryCandles;
    if (expiryCandles === undefined) {
      if (customDuration === -1 || (customDuration === undefined && duration === -1)) {
        expiryCandles = 1; // Expire at the end of current candle
      } else {
        expiryCandles = isLiveMode ? undefined : Math.ceil((finalDuration * 1000) / intervalMs) || 1;
      }
    }

    if (marketType === "binary") {
      toast.success(`Ordem ${dir} ${orderAsset.symbol} · stake $${finalStake} ${isApiOrder ? '(API)' : '(Sim)'}`);
      addTrade({
        id, asset: orderAsset.symbol, type: dir as "CALL" | "PUT", amount: finalStake, entry, result: "OPEN",
        ts, entryTime, durationS: finalDuration, indicator, snapshot: sh, mode: tradingMode,
        entryCandleIdx: tradingMode === "backtest" ? backtestIdx : undefined,
        expiryCandles,
        strategyId: activeStrategyId || undefined
      });

      if (!isApiOrder && isLiveMode) {
        timeoutsRef.current[id] = setTimeout(() => {
          const tState = (useStore.getState().trades || []).find(t => t.id === id);
          if (!tState || tState.result !== "OPEN") return; // closed manually
          if (timeoutsRef.current[id]) delete timeoutsRef.current[id];
          const latestCs = allAssetsCandlesRef.current[orderAsset.symbol] || orderCandles;
          const exitPrice = latestCs[latestCs.length - 1]?.c ?? entry;
          const supports = (useStore.getState().srLines || []).filter((l) => l.asset === orderAsset.symbol && l.kind === "support").map((l) => l.price);
          const resistances = (useStore.getState().srLines || []).filter((l) => l.asset === orderAsset.symbol && l.kind === "resistance").map((l) => l.price);

          const win = dir === "CALL" ? exitPrice > entry : exitPrice < entry;
          const pnl = win ? finalStake * (useStore.getState().risk.payout / 100) : -finalStake;
          lastResultRef.current = win ? "WIN" : "LOSS";
          useStore.getState().addPnl(pnl);
          useStore.getState().updateTrade(id, { exit: exitPrice, result: win ? "WIN" : "LOSS", pnl });
          toast[win ? "success" : "error"](`${win ? "WIN" : "LOSS"} ${orderAsset.symbol} · ${pnl > 0 ? "+" : ""}${pnl.toFixed(2)}`);
        }, finalDuration * 1000);
      }
    } else {
      // Forex order
      const pipValue = orderAsset.symbol.includes("JPY") ? 0.01 : 0.0001;
      const slPrice = dir === "BUY" ? entry - slPips * pipValue : entry + slPips * pipValue;
      const tpPrice = dir === "BUY" ? entry + tpPips * pipValue : entry - tpPips * pipValue;

      toast.success(`Ordem ${dir} ${orderAsset.symbol} · ${finalLotSize} lot ${isApiOrder ? '(API)' : '(Sim)'}`);
      addTrade({
        id, asset: orderAsset.symbol, type: dir as "BUY" | "SELL", amount: finalLotSize, entry, result: "OPEN",
        ts, entryTime, durationS: 0, indicator, snapshot: sh, mode: tradingMode,
        entryCandleIdx: tradingMode === "backtest" ? backtestIdx : undefined,
        strategyId: activeStrategyId || undefined
      });

      if (!isApiOrder && isLiveMode) {
        timeoutsRef.current[id] = setTimeout(() => {
          const tState = (useStore.getState().trades || []).find(t => t.id === id);
          if (!tState || tState.result !== "OPEN") return; // closed manually
          if (timeoutsRef.current[id]) delete timeoutsRef.current[id];
          const latestCs = allAssetsCandlesRef.current[orderAsset.symbol] || orderCandles;
          const exitPrice = latestCs[latestCs.length - 1]?.c ?? entry;
          const pips = dir === "BUY" ? (exitPrice - entry) / pipValue : (entry - exitPrice) / pipValue;
          const pnl = pips * (finalLotSize * 100000 * pipValue);
          const win = pnl > 0;
          lastResultRef.current = win ? "WIN" : "LOSS";
          useStore.getState().addPnl(pnl);
          useStore.getState().updateTrade(id, { exit: exitPrice, result: win ? "WIN" : "LOSS", pnl });
          toast[win ? "success" : "error"](`${win ? "WIN" : "LOSS"} ${orderAsset.symbol} · ${pnl > 0 ? "+" : ""}${pnl.toFixed(2)} · ${pips.toFixed(1)} pips`);
        }, 3000);
      }
    }
  };

  // -------------------------------------------------------------
  // Backtest engine loop: Evaluates every candle change
  // -------------------------------------------------------------
  useEffect(() => {
    if (tradingMode !== "backtest") return;

    // 1. Evaluate open trades
    const openTrades = (useStore.getState().trades || []).filter(t => t.mode === "backtest" && t.result === "OPEN");
    openTrades.forEach(t => {
      const isBinary = t.type === "CALL" || t.type === "PUT";
      if (isBinary) {
        // Binary logic uses expiryCandles
        if (t.entryCandleIdx !== undefined && t.expiryCandles !== undefined) {
          if (backtestIdx >= t.entryCandleIdx + t.expiryCandles) {
            const exitPrice = lastPrice; // last price of the current candle

            // Support/Resistance cheat
            const supports = (srLines || []).filter((l) => l.asset === t.asset && l.kind === "support").map((l) => l.price);
            const resistances = (srLines || []).filter((l) => l.asset === t.asset && l.kind === "resistance").map((l) => l.price);
            const nearSup = (supports || []).some((p) => Math.abs(t.entry - p) / t.entry < 0.002);
            const nearRes = (resistances || []).some((p) => Math.abs(t.entry - p) / t.entry < 0.002);

            const win = t.type === "CALL" ? exitPrice > t.entry : exitPrice < t.entry;

            const pnl = win ? t.amount * (risk.payout / 100) : -t.amount;
            lastResultRef.current = win ? "WIN" : "LOSS";
            addPnl(pnl);
            updateTrade(t.id, { exit: exitPrice, result: win ? "WIN" : "LOSS", pnl });
            toast[win ? "success" : "error"](`[Backtest] ${win ? "WIN" : "LOSS"} ${t.asset} · ${pnl > 0 ? "+" : ""}${pnl.toFixed(2)}`);
          }
        }
      } else {
        // Forex logic backtest
        if (t.entryCandleIdx !== undefined) {
          const exitPrice = lastPrice;
          const pipValue = t.asset.includes("JPY") ? 0.01 : 0.0001;
          const pips = t.type === "BUY" ? (exitPrice - t.entry) / pipValue : (t.entry - exitPrice) / pipValue;

          const fConf = useStore.getState().forex;
          let shouldClose = false;

          if (fConf.enabled) {
            if (pips <= -fConf.stopLossPips) shouldClose = true;
            if (pips >= fConf.takeProfitPips) shouldClose = true;
          }

          if (t.expiryCandles && backtestIdx >= t.entryCandleIdx + t.expiryCandles) {
            shouldClose = true;
          }

          if (!fConf.enabled && !t.expiryCandles && backtestIdx >= t.entryCandleIdx + 20) { // arbitrary default if no SL/TP and no expiry
            shouldClose = true;
          }

          if (shouldClose) {
            const pnl = pips * (t.amount * 100000 * pipValue);
            const win = pnl > 0;
            lastResultRef.current = win ? "WIN" : "LOSS";
            addPnl(pnl);
            updateTrade(t.id, { exit: exitPrice, result: win ? "WIN" : "LOSS", pnl });
            toast[win ? "success" : "error"](`[Backtest] ${win ? "WIN" : "LOSS"} ${t.asset} · ${pnl > 0 ? "+" : ""}${pnl.toFixed(2)} · ${pips.toFixed(1)} pips`);
          }
        }
      }
    });

    // 2. Evaluate Strategy
    if (automationMode !== "manual" && backtestPlaying) {
      // Small timeout to allow state changes to flush before next candle
      const stratTimeout = setTimeout(() => {
        runSemiAutoLogic();
      }, 0);
      return () => clearTimeout(stratTimeout);
    }
  }, [backtestIdx, tradingMode, runSemiAutoLogic, lastPrice, srLines, addPnl, updateTrade, risk.payout, automationMode, backtestPlaying]);

  const modeLabel = { demo: "DEMO", real: "REAL", backtest: "BACKTEST" }[tradingMode];
  const modeColor = { demo: "text-primary", real: "text-bear", backtest: "text-warning" }[tradingMode];

  // Stats for the current mode
  const stats = useMemo(() => {
    let relevantTrades = currentModeTrades;
    if (automationMode !== "manual" && activeStrategyId) {
      relevantTrades = relevantTrades.filter(t => t.strategyId === activeStrategyId);
    }
    const closedTrades = relevantTrades.filter(t => t.result && t.result !== "OPEN");
    const wins = closedTrades.filter(t => t.result === "WIN");
    const losses = closedTrades.filter(t => t.result === "LOSS");
    const totalProfit = wins.reduce((acc, t) => acc + (t.pnl || 0), 0);
    const totalLoss = Math.abs(losses.reduce((acc, t) => acc + (t.pnl || 0), 0));
    const winrate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : (totalProfit > 0 ? Infinity : 0);

    return {
      wins: wins.length,
      losses: losses.length,
      total: closedTrades.length,
      winrate,
      totalProfit,
      totalLoss,
      net: totalProfit - totalLoss,
      profitFactor
    };
  }, [currentModeTrades, automationMode, activeStrategyId]);

  const [sliderIndex, setSliderIndex] = useState(backtestIdx);
  useEffect(() => { setSliderIndex(backtestIdx); }, [backtestIdx]);

  if (!asset || !asset.symbol) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center">
          <div className="text-muted-foreground">Carregando ativos...</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex flex-col lg:flex-row gap-2 p-2 h-auto lg:h-[calc(100vh-3rem)] overflow-auto lg:overflow-hidden">
        {/* left: assets — collapsible */}
        <div className={`${assetsSidebarOpen ? "w-full lg:w-64" : "hidden lg:flex lg:w-10"} flex flex-col gap-2 transition-all duration-300 shrink-0`}>
          {assetsSidebarOpen ? (
            <>
              <div className="panel p-2 overflow-auto flex-1 shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Ativos</div>
                  <button onClick={toggleAssetsSidebar} className="text-muted-foreground hover:text-foreground">
                    <PanelLeftClose className="h-3.5 w-3.5 hidden lg:block" />
                    <X className="h-3.5 w-3.5 lg:hidden" />
                  </button>
                </div>
                {(["synthetic", "forex"] as const).map((kind) => (
                  <div key={kind} className="mb-3">
                    <div className="text-[10px] text-primary mb-1">{kind === "synthetic" ? "SINTÉTICOS" : "FOREX"}</div>
                    {ASSETS.filter((a) => a.type === kind).map((a) => {
                      const activeTradeHere = currentModeTrades.find(t => t.asset === a.symbol && t.result === "OPEN");
                      return (
                        <button
                          key={a.symbol}
                          onClick={() => setAssetSym(a.symbol)}
                          className={`relative w-full text-left px-2 py-1.5 text-xs rounded-sm mb-0.5 border ${a.symbol === assetSym ? "border-primary bg-secondary text-primary" : "border-transparent hover:bg-secondary/60"}`}
                        >
                          {activeTradeHere && (
                            <div className="absolute -left-1 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-warning shadow-[0_0_8px_rgba(234,179,8,0.8)] animate-pulse" />
                          )}
                          <div className="flex justify-between">
                            <span className="font-bold">{a.symbol}</span>
                            <span className="ticker text-muted-foreground">{fmtPrice(a.base, a)}</span>
                          </div>
                          <div className="text-[10px] text-muted-foreground truncate">{a.name}</div>
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center pt-2">
              <button
                onClick={toggleAssetsSidebar}
                className="p-2 rounded-md border border-border bg-card text-muted-foreground hover:text-primary hover:border-primary/50 transition-all shadow-panel"
                title="Mostrar ativos"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {/* center: chart */}
        <div className="flex-1 flex flex-col gap-2 min-h-[450px] lg:min-h-0 min-w-0 transition-all duration-300">
          <div className="flex-1 min-h-0 relative">
            {!assetsSidebarOpen && (
              <button
                onClick={toggleAssetsSidebar}
                className="lg:hidden absolute top-2 left-2 z-20 p-2 rounded-md border border-border bg-card/80 backdrop-blur text-muted-foreground hover:text-primary transition-all shadow-panel"
                title="Mostrar ativos"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
            )}
            <CandlestickChart
              asset={asset.symbol}
              candles={candles}
              drawingMode={draw}
              setDrawingMode={setDraw}
              indicator={indicator}
              setIndicator={setIndicator}
              overlays={overlays}
              oscillator={indicator === "rsi" ? rsiArr : null}
              tradingMode={tradingMode}
              trades={currentModeTrades.filter((t) => t.asset === asset.symbol)}
              onAssetChange={setAssetSym}
            />
            {tradingMode === "backtest" && (
              <div className="absolute bottom-12 left-[10%] right-[10%] bg-[#131722]/80 border border-[#2a2e39] rounded-sm p-3 shadow-xl backdrop-blur-sm z-10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      setBacktestIdx(v => {
                        const newIdx = Math.max(0, v - 1);
                        return newIdx;
                      });
                      setBacktestPlaying(false);
                    }}
                    className="p-1.5 hover:bg-[#2a2e39] rounded text-muted-foreground hover:text-white"
                    title="Recuar 1 Candle (Reseta histórico)"
                  >
                    <StepBack className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setBacktestPlaying(p => !p)}
                    className="h-8 w-8 flex items-center justify-center bg-primary text-primary-foreground rounded-full hover:brightness-110 shadow-lg"
                  >
                    {!backtestPlaying ? <Play className="h-4 w-4 ml-0.5" fill="currentColor" /> : <Pause className="h-4 w-4" fill="currentColor" />}
                  </button>
                  <button
                    onClick={() => { setBacktestIdx(v => Math.min(currentMaxBacktest, v + 1)); setBacktestPlaying(false); }}
                    className="p-1.5 hover:bg-[#2a2e39] rounded text-muted-foreground hover:text-white"
                    title="Avançar 1 Candle"
                  >
                    <StepForward className="h-4 w-4" />
                  </button>

                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground ml-4">
                    <span className="w-24 text-right">{sliderIndex} / {currentMaxBacktest} velas</span>
                    <input
                      type="range"
                      min={10}
                      max={currentMaxBacktest}
                      value={sliderIndex}
                      onChange={(e) => { setSliderIndex(+e.target.value); }}
                      onPointerUp={(e) => { setBacktestIdx(sliderIndex); setBacktestPlaying(false); }}
                      onTouchEnd={(e) => { setBacktestIdx(sliderIndex); setBacktestPlaying(false); }}
                      className="w-48 xl:w-64 accent-primary cursor-pointer"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground font-bold">VELOCIDADE:</span>
                  {[1, 2, 5, 10, 50].map(s => (
                    <button
                      key={s}
                      onClick={() => setBacktestSpeed(s)}
                      className={`px-2 py-1 rounded text-[10px] font-bold transition-colors ${backtestSpeed === s ? "bg-primary text-primary-foreground shadow-md" : "bg-[#2a2e39] text-muted-foreground hover:bg-[#363a45] hover:text-white"}`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Stats Block */}
          {(tradingMode === "backtest" || (activeStrategyId && automationMode !== "manual")) && (
            <div className="panel p-2 mb-2">
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-[10px] text-muted-foreground uppercase font-bold">Estatísticas</span>
                {tradingMode === "backtest" && (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={runCurrentAssetBacktest}
                      disabled={isProcessingAll}
                      className="text-[10px] bg-secondary text-secondary-foreground px-2 py-1 rounded shadow hover:brightness-110 flex items-center gap-1 transition-all font-bold disabled:opacity-40"
                    >
                      <Play className="h-3 w-3" fill="currentColor" /> Rodar Ativo
                    </button>
                    <button
                      onClick={runAllAssetsBacktest}
                      disabled={isProcessingAll}
                      className="text-[10px] bg-primary text-primary-foreground px-2.5 py-1 rounded shadow hover:brightness-110 flex items-center gap-1.5 transition-all font-bold disabled:opacity-40"
                    >
                      <Play className="h-3 w-3" fill="currentColor" /> Rodar Todos
                    </button>
                  </div>
                )}
              </div>

              {/* Processing indicator */}
              {isProcessingAll && (
                <div className="mb-2 p-2 border border-warning/40 rounded-sm bg-warning/5 flex items-center gap-2">
                  <div className="animate-spin h-3 w-3 border-2 border-warning border-t-transparent rounded-full" />
                  <span className="text-[10px] text-warning font-bold">{allAssetsProgress}</span>
                </div>
              )}

              <div className="flex justify-between gap-1 text-[10px] text-center">
                <div className="flex-1 bg-[#131722] rounded p-1">
                  <div className="text-muted-foreground">Trades</div>
                  <div className="font-bold">{stats.total}</div>
                </div>
                <div className="flex-1 bg-[#131722] rounded p-1">
                  <div className="text-muted-foreground">Winrate</div>
                  <div className={`font-bold ${stats.winrate > 50 ? "text-bull" : "text-bear"}`}>
                    {stats.winrate.toFixed(1)}%
                  </div>
                </div>
                <div className="flex-1 bg-[#131722] rounded p-1">
                  <div className="text-muted-foreground">Net P&L</div>
                  <div className={`font-bold ${stats.net >= 0 ? "text-bull" : "text-bear"}`}>
                    {stats.net >= 0 ? "+" : ""}{stats.net.toFixed(2)}
                  </div>
                </div>
                <div className="flex-1 bg-[#131722] rounded p-1 hidden xl:block">
                  <div className="text-muted-foreground">Fator L.</div>
                  <div className={`font-bold ${stats.profitFactor > 1 ? "text-bull" : "text-bear"}`}>
                    {stats.profitFactor.toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* right: order panel — narrower */}
        <div className="w-full lg:w-[260px] flex flex-col gap-2 shrink-0">
          {/* Market type selector */}
          <div className="panel p-2">
            <div className="text-[10px] uppercase text-muted-foreground mb-1">Tipo de Mercado</div>
            <div className="grid grid-cols-2 gap-1">
              <button onClick={() => useStore.getState().setMarketType("binary")} className={`text-[10px] py-1.5 border rounded-sm ${marketType === "binary" ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>Opções Binárias</button>
              <button onClick={() => useStore.getState().setMarketType("forex")} className={`text-[10px] py-1.5 border rounded-sm ${marketType === "forex" ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>Forex</button>
            </div>
          </div>

          {/* Automation mode */}
          <div className="panel p-2">
            <div className="text-[10px] uppercase text-muted-foreground mb-1">Automação</div>
            <div className="grid grid-cols-3 gap-1">
              <button onClick={() => setAutomationMode("manual")} className={`text-[10px] py-1.5 border rounded-sm flex items-center justify-center gap-1 ${automationMode === "manual" ? "border-primary text-primary" : "border-border text-muted-foreground"}`}><Hand className="h-3 w-3" /> Manual</button>
              <button onClick={() => setAutomationMode("semi-auto")} className={`text-[10px] py-1.5 border rounded-sm flex items-center justify-center gap-1 ${automationMode === "semi-auto" ? "border-warning text-warning" : "border-border text-muted-foreground"}`}><BrainCircuit className="h-3 w-3" /> Semi</button>
              <button onClick={() => setAutomationMode("auto")} className={`text-[10px] py-1.5 border rounded-sm flex items-center justify-center gap-1 ${automationMode === "auto" ? "border-bull text-bull" : "border-border text-muted-foreground"}`}><Bot className="h-3 w-3" /> Auto</button>
            </div>
            {automationMode !== "manual" && (
              <div className="mt-1.5 text-[10px] text-warning border border-warning/30 rounded-sm p-1.5">
                {automationMode === "semi-auto" ? "⚡ Modo Semi-Auto: O script opera respeitando as zonas S/R." : "🤖 Modo Auto: Operações via Estratégia Ativa."}
              </div>
            )}
          </div>

          <div className="panel p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase text-muted-foreground">Painel de Ordem</div>
              {latencyMs !== null && tradingMode !== "backtest" && (
                <div className={`text-[10px] ${latencyMs < 200 ? "text-bull" : latencyMs < 500 ? "text-warning" : "text-bear"}`}>
                  Ping: {latencyMs}ms
                </div>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground">Saldo {modeLabel}</div>
            <div className="text-xl font-bold ticker text-primary glow-text mb-3">${balance.toFixed(2)}</div>

            {marketType === "binary" ? (
              <>
                <label className="text-[10px] text-muted-foreground">Stake (USD)</label>
                <div className="flex items-center gap-1 mb-2">
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setStake((s) => Math.max(1, s - 1))}><Minus className="h-3 w-3" /></Button>
                  <Input value={stake} onChange={(e) => setStake(Number(e.target.value) || 0)} className="h-8 text-center ticker" />
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setStake((s) => s + 1)}><Plus className="h-3 w-3" /></Button>
                </div>

                <label className="text-[10px] text-muted-foreground">Duração (s)</label>
                <div className="grid grid-cols-5 gap-1 mb-3">
                  {[15, 30, 60, 300].map((d) => (
                    <button key={d} onClick={() => setDuration(d)} className={`text-[10px] py-1 border rounded-sm ${duration === d ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>{d}s</button>
                  ))}
                  <button
                    onClick={() => setDuration(-1)}
                    className={`text-[10px] py-1 border rounded-sm ${duration === -1 ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
                    title="Expira no fechamento da vela atual"
                  >
                    Fim Vela
                  </button>
                </div>

                <div className="text-[10px] text-muted-foreground mb-1">Retorno: <span className="text-foreground">+{risk.payout}%</span></div>

                <button
                  disabled={blocked}
                  onClick={() => placeOrder("CALL")}
                  className="w-full mb-2 py-3 rounded-sm bg-bull text-primary-foreground font-bold uppercase tracking-wider hover:brightness-110 disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  <ArrowUp className="h-4 w-4" /> CALL · +${(stake * risk.payout / 100).toFixed(2)}
                </button>
                <button
                  disabled={blocked}
                  onClick={() => placeOrder("PUT")}
                  className="w-full py-3 rounded-sm bg-bear text-destructive-foreground font-bold uppercase tracking-wider hover:brightness-110 disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  <ArrowDown className="h-4 w-4" /> PUT · +${(stake * risk.payout / 100).toFixed(2)}
                </button>
              </>
            ) : (
              <>
                <label className="text-[10px] text-muted-foreground">Lot Size</label>
                <div className="flex items-center gap-1 mb-2">
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setLotSize((s) => Math.max(0.01, +(s - 0.01).toFixed(2)))}><Minus className="h-3 w-3" /></Button>
                  <Input value={lotSize} onChange={(e) => setLotSize(Number(e.target.value) || 0)} className="h-8 text-center ticker" />
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setLotSize((s) => +(s + 0.01).toFixed(2))}><Plus className="h-3 w-3" /></Button>
                </div>

                <label className="text-[10px] text-muted-foreground">Stop Loss (pips)</label>
                <div className="flex items-center gap-1 mb-2">
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setSlPips((s) => Math.max(1, s - 1))}><Minus className="h-3 w-3" /></Button>
                  <Input value={slPips} onChange={(e) => setSlPips(Number(e.target.value) || 0)} className="h-8 text-center ticker" />
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setSlPips((s) => s + 1)}><Plus className="h-3 w-3" /></Button>
                </div>

                <label className="text-[10px] text-muted-foreground">Take Profit (pips)</label>
                <div className="flex items-center gap-1 mb-3">
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setTpPips((s) => Math.max(1, s - 1))}><Minus className="h-3 w-3" /></Button>
                  <Input value={tpPips} onChange={(e) => setTpPips(Number(e.target.value) || 0)} className="h-8 text-center ticker" />
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setTpPips((s) => s + 1)}><Plus className="h-3 w-3" /></Button>
                </div>

                <div className="text-[10px] text-muted-foreground mb-1">Alavancagem: <span className="text-foreground">1:{forex.leverage}</span> · Spread: <span className="text-foreground">{forex.spread}p</span></div>

                <button
                  disabled={blocked}
                  onClick={() => placeOrder("BUY")}
                  className="w-full mb-2 py-3 rounded-sm bg-bull text-primary-foreground font-bold uppercase tracking-wider hover:brightness-110 disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  <ArrowUp className="h-4 w-4" /> BUY
                </button>
                <button
                  disabled={blocked}
                  onClick={() => placeOrder("SELL")}
                  className="w-full py-3 rounded-sm bg-bear text-destructive-foreground font-bold uppercase tracking-wider hover:brightness-110 disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  <ArrowDown className="h-4 w-4" /> SELL
                </button>
              </>
            )}

            {blocked && (
              <div className="mt-2 text-[10px] text-warning border border-warning/40 p-2 rounded-sm">
                ⚠ Bloqueado por gestão de risco ({lossStreak} perdas / {winStreak} vitórias seguidas)
              </div>
            )}
          </div>

          <div className="panel p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase text-muted-foreground">Linhas e Zonas S/R ({asset.symbol})</div>
              <div className="flex gap-1">
                <button
                  onClick={() => setDraw(draw === "support" ? null : "support")}
                  className={`p-1 rounded border transition-colors ${draw === "support" ? "bg-bull border-bull text-white" : "border-border text-muted-foreground hover:bg-bull/10"}`}
                  title="Traçar Suporte"
                >
                  <TrendingUp className="h-3 w-3" />
                </button>
                <button
                  onClick={() => setDraw(draw === "resistance" ? null : "resistance")}
                  className={`p-1 rounded border transition-colors ${draw === "resistance" ? "bg-bear border-bear text-white" : "border-border text-muted-foreground hover:bg-bear/10"}`}
                  title="Traçar Resistência"
                >
                  <TrendingDown className="h-3 w-3" />
                </button>
                <button
                  onClick={() => setDraw(draw === "buy_zone" ? null : "buy_zone")}
                  className={`p-1 rounded border transition-colors ${draw === "buy_zone" ? "bg-bull border-bull text-white" : "border-border text-muted-foreground hover:bg-bull/10"}`}
                  title="Traçar Zona de Compra"
                >
                  <div className="w-3 h-2 border border-current rounded-sm" />
                </button>
                <button
                  onClick={() => setDraw(draw === "sell_zone" ? null : "sell_zone")}
                  className={`p-1 rounded border transition-colors ${draw === "sell_zone" ? "bg-bear border-bear text-white" : "border-border text-muted-foreground hover:bg-bear/10"}`}
                  title="Traçar Zona de Venda"
                >
                  <div className="w-3 h-2 border border-current rounded-sm" />
                </button>
                <div className="w-px h-4 bg-border mx-0.5 self-center" />
                <button
                  onClick={() => useStore.getState().clearSR(asset.symbol)}
                  className="p-1 rounded border border-border text-muted-foreground hover:bg-destructive/20 hover:text-destructive hover:border-destructive transition-colors"
                  title="Apagar todos os traçados"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
            <div className="space-y-1 max-h-48 overflow-auto border-t border-border/30 pt-2">
              {srLines.filter((l) => l.asset === asset.symbol).map((l) => (
                <div key={l.id} className="flex justify-between items-center group text-[11px] ticker">
                  <div className="flex items-center gap-1">
                    <span className={l.kind === "support" ? "text-bull" : "text-bear"}>{l.kind === "support" ? "SUP" : "RES"}</span>
                    <span>{l.price.toFixed(asset.type === "forex" ? 5 : 2)}</span>
                  </div>
                  <button
                    onClick={() => useStore.getState().removeSR(l.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {srZones.filter((z) => z.asset === asset.symbol).map((z) => (
                <div key={z.id} className="flex justify-between items-center group text-[11px] ticker border-t border-border/10 pt-1">
                  <div className="flex items-center gap-1">
                    <span className={z.kind === "buy_zone" ? "text-bull" : "text-bear"}>{z.kind === "buy_zone" ? "ZONA-C" : "ZONA-V"}</span>
                    <span>{z.bottomPrice.toFixed(2)} - {z.topPrice.toFixed(2)}</span>
                  </div>
                  <button
                    onClick={() => useStore.getState().removeSRZone(z.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {(srLines.filter((l) => l.asset === asset.symbol).length === 0 && srZones.filter((z) => z.asset === asset.symbol).length === 0) && (
                <div className="text-[10px] text-muted-foreground italic text-center py-2">Sem traçados ativos.</div>
              )}
            </div>
          </div>

          <div className="panel p-3 text-[11px]">
            <div className="text-[10px] uppercase text-muted-foreground mb-2">Gestão Ativa</div>
            <div className="flex justify-between"><span>Stop Loss</span><span className="text-bear">${risk.stopLoss}</span></div>
            <div className="flex justify-between"><span>Take Profit</span><span className="text-bull">${risk.takeProfit}</span></div>
            <div className="flex justify-between"><span>Parar após perdas</span><span>{risk.stopAfterLosses}</span></div>
            <div className="flex justify-between"><span>Martingale</span><span>{risk.martingale ? "ON" : "OFF"}</span></div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
