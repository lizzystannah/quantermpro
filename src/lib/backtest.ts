import { Candle, rsi, sma, ema, bollinger, adx, macd, getPattern } from "@/lib/market";
import { Trade, RiskConfig, ForexConfig, SRLine, SRZone } from "@/lib/store";
import { StrategyContext, StrategyResult, StrategyFilterValue, applyFilterLogic } from "@/strategies";

export function runFullBacktest(
  candles: Candle[], 
  assetSym: string, 
  strategyMod: { id?: string, onTick: (ctx: StrategyContext) => StrategyResult | null } | null, 
  balance: number, 
  riskConf: RiskConfig, 
  forexConf: ForexConfig, 
  marketType: "binary" | "forex", 
  intervalMs: number,
  srLines: SRLine[] = [],
  srZones: SRZone[] = [],
  activeFilters?: Record<string, StrategyFilterValue>,
  globalInvert: boolean = false
): Trade[] {
  if (!strategyMod) return [];
  const trades: Trade[] = [];
  let currentBalance = balance;
  let activeTrade: Trade | null = null;
  
  const cArray = candles.map(c => c.c);
  const allRsi = rsi(cArray, 14);
  const allSma9 = sma(cArray, 9);
  const allSma21 = sma(cArray, 21);
  const allEma20 = ema(cArray, 20);
  const allBoll = bollinger(cArray, 20, 2);
  const allAdx = adx(candles, 14);
  const allMacd = macd(cArray, 12, 26, 9);
  const allSma200 = sma(cArray, 200);
  const allSma235 = sma(cArray, 235);

  for (let i = 22; i < candles.length; i++) {
    if (activeTrade) {
       const t = activeTrade;
       const lastPrice = candles[i].c;
       let shouldClose = false;
       let win = false;
       let pnl = 0;
       const exitPrice = lastPrice;

       if (marketType === "binary" && (t.type === "CALL" || t.type === "PUT")) {
          if (t.entryCandleIdx !== undefined && t.expiryCandles !== undefined) {
             if (i >= t.entryCandleIdx + t.expiryCandles) {
                win = t.type === "CALL" ? lastPrice > t.entry : lastPrice < t.entry;
                pnl = win ? t.amount * (riskConf.payout / 100) : -t.amount;
                shouldClose = true;
             }
          }
       } else {
          // Forex
          if (t.entryCandleIdx !== undefined) {
             const pipValue = assetSym.includes("JPY") ? 0.01 : 0.0001;
             const pips = t.type === "BUY" ? (lastPrice - t.entry) / pipValue : (t.entry - lastPrice) / pipValue;
             
             if (forexConf.enabled) {
                if (pips <= -forexConf.stopLossPips) shouldClose = true;
                if (pips >= forexConf.takeProfitPips) shouldClose = true;
             }
             if (t.expiryCandles && i >= t.entryCandleIdx + t.expiryCandles) {
                shouldClose = true;
             }
             if (!forexConf.enabled && !t.expiryCandles && i >= t.entryCandleIdx + 20) {
                shouldClose = true;
             }
             
             if (shouldClose) {
                pnl = pips * (t.amount * 100000 * pipValue);
                win = pnl > 0;
             }
          }
       }

       if (shouldClose) {
          activeTrade.result = win ? "WIN" : "LOSS";
          activeTrade.pnl = pnl;
          activeTrade.exit = exitPrice;
          trades.push({...activeTrade});
          currentBalance += pnl;
          activeTrade = null;
       }
    }

    if (activeTrade) continue;

    const context: StrategyContext = {
      asset: assetSym,
      history: candles.slice(0, i + 1).map(c => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c })),
      lastPrice: candles[i].c,
      balance: currentBalance,
      tradingMode: "backtest",
      isBacktest: true,
      intervalMs,
      candleTimeRemainingMs: 0, // In backtest, candle is always "closed"
      srLines: srLines.filter(l => l.asset === assetSym).map(l => ({ id: l.id, price: l.price, type: l.kind as "support" | "resistance", asset: l.asset })),
      srZones: srZones.filter(z => z.asset === assetSym).map(z => ({ id: z.id, p1: z.topPrice, p2: z.bottomPrice, type: z.kind === "buy_zone" ? "support" : "resistance", asset: z.asset })),
      hasOpenTrade: activeTrade !== null,
      activeFilters: activeFilters,
      updateSR: () => {},
      toast: {
        success: () => {},
        info: () => {},
        error: () => {}
      },
      indicators: {
        rsi: (period: number) => allRsi.slice(0, i + 1),
        sma: (period: number) => {
           if (period === 9) return allSma9.slice(0, i + 1).map(v => v || 0);
           if (period === 21) return allSma21.slice(0, i + 1).map(v => v || 0);
           return sma(cArray.slice(0, i + 1), period).map(v => v || 0);
        },
        ema: (period: number) => {
           if (period === 20) return allEma20.slice(0, i + 1).map(v => v || 0);
           return ema(cArray.slice(0, i + 1), period).map(v => v || 0);
        },
        bollinger: (period: number, mult: number) => {
           if (period === 20 && mult === 2) return { upper: allBoll.upper.slice(0, i + 1).map(v => v || 0), lower: allBoll.lower.slice(0, i + 1).map(v => v || 0) };
           const b = bollinger(cArray.slice(0, i + 1), period, mult);
           return { upper: b.upper.map(v => v || 0), lower: b.lower.map(v => v || 0) };
        },
        adx: (period: number) => {
           if (period === 14) return { adx: allAdx.adx.slice(0, i + 1).map(v => v || 0), plusDi: allAdx.plusDi.slice(0, i + 1).map(v => v || 0), minusDi: allAdx.minusDi.slice(0, i + 1).map(v => v || 0) };
           const a = adx(candles.slice(0, i + 1), period);
           return { adx: a.adx.map(v => v || 0), plusDi: a.plusDi.map(v => v || 0), minusDi: a.minusDi.map(v => v || 0) };
        },
        macd: (fast: number, slow: number, signal: number) => {
           if (fast === 12 && slow === 26 && signal === 9) return { macd: allMacd.macd.slice(0, i + 1).map(v => v || 0), signal: allMacd.signal.slice(0, i + 1).map(v => v || 0), histogram: allMacd.histogram.slice(0, i + 1).map(v => v || 0) };
           const m = macd(cArray.slice(0, i + 1), fast, slow, signal);
           return { macd: m.macd.map(v => v || 0), signal: m.signal.map(v => v || 0), histogram: m.histogram.map(v => v || 0) };
        }
      }
    };

    const rawRes = strategyMod.onTick(context);
    
    // Apply filter logic (ranges with ignore/invert + global invert)
    const indicatorValues: Record<string, number | string | null | undefined> = {
      _rsi: allRsi[i],
      _adx: allAdx.adx[i],
      _expiryCandles: rawRes?.expiryCandles ?? null,
      _asset: assetSym,
    };
    const res = applyFilterLogic(rawRes, activeFilters, indicatorValues, globalInvert);
    
    if (res && res.action) {
       let dir = res.action;
       if (marketType === "binary") {
         if (dir === "BUY" || dir === "SELL") dir = dir === "BUY" ? "CALL" : "PUT";
       } else {
         if (dir === "CALL" || dir === "PUT") dir = dir === "CALL" ? "BUY" : "SELL";
       }

       const amount = res.stake ?? (marketType === "binary" ? riskConf.defaultStake : forexConf.lotSize);
       
       const sh = {
         rsi: allRsi[i],
         adx: allAdx.adx[i],
         macd: allMacd.macd[i],
         histogram: allMacd.histogram[i],
         pattern: getPattern(candles, i),
         ma9: allSma9[i],
         ma21: allSma21[i],
         ma200: allSma200[i],
         ma235: allSma235[i]
       };

       activeTrade = {
          id: Math.random().toString(36).substring(7),
          asset: assetSym,
          type: dir as "CALL" | "PUT" | "BUY" | "SELL",
          amount,
          entry: candles[i].c,
          ts: candles[i].t,
          entryTime: candles[i].t,
          durationS: res.duration || 60,
          mode: "backtest",
          entryCandleIdx: i,
          expiryCandles: res.expiryCandles || (res.duration ? Math.ceil((res.duration * 1000) / intervalMs) : 1),
          result: "OPEN",
          strategyId: strategyMod.id || "strategy",
          snapshot: sh,
          customStats: res.customStats
       };
    }
  }

  return trades;
}
