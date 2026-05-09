export type Candle = {
  t: number; // timestamp ms
  o: number;
  h: number;
  l: number;
  c: number;
};

export type Asset = {
  symbol: string;
  name: string;
  type: "synthetic" | "forex";
  vol: number; // volatility
  base: number;
};

export const ASSETS: Asset[] = [
  // Synthetic Indices — Volatility
  { symbol: "R_100", name: "Volatility 100 Index", type: "synthetic", vol: 0.012, base: 1200 },
  { symbol: "R_75", name: "Volatility 75 Index", type: "synthetic", vol: 0.009, base: 850 },
  { symbol: "R_50", name: "Volatility 50 Index", type: "synthetic", vol: 0.006, base: 320 },
  { symbol: "R_25", name: "Volatility 25 Index", type: "synthetic", vol: 0.004, base: 180 },
  { symbol: "R_10", name: "Volatility 10 Index", type: "synthetic", vol: 0.002, base: 95 },
  { symbol: "stpRNG", name: "Step Index", type: "synthetic", vol: 0.0015, base: 100 },

  // Forex
  { symbol: "EURUSD", name: "Euro / Dólar", type: "forex", vol: 0.0006, base: 1.0850 },
  { symbol: "GBPUSD", name: "Libra / Dólar", type: "forex", vol: 0.0008, base: 1.2710 },
  { symbol: "USDJPY", name: "Dólar / Iene", type: "forex", vol: 0.0007, base: 152.4 },
  { symbol: "AUDUSD", name: "Dólar Australiano / Dólar", type: "forex", vol: 0.0007, base: 0.6520 },
  { symbol: "USDCAD", name: "Dólar / Dólar Canadense", type: "forex", vol: 0.0007, base: 1.3620 },
  { symbol: "USDCHF", name: "Dólar / Franco Suíço", type: "forex", vol: 0.0007, base: 0.9040 },
  { symbol: "EURGBP", name: "Euro / Libra", type: "forex", vol: 0.0006, base: 0.8530 },
  { symbol: "EURJPY", name: "Euro / Iene", type: "forex", vol: 0.0008, base: 165.3 },
  { symbol: "GBPJPY", name: "Libra / Iene", type: "forex", vol: 0.0009, base: 193.8 },
  { symbol: "NZDUSD", name: "Dólar Neozelandês / Dólar", type: "forex", vol: 0.0008, base: 0.5980 },
  // Commodities
  { symbol: "XAUUSD", name: "Ouro / Dólar", type: "forex", vol: 0.0015, base: 2310 },
  { symbol: "XAGUSD", name: "Prata / Dólar", type: "forex", vol: 0.002, base: 27.5 },
  { symbol: "USOIL", name: "Petróleo WTI", type: "forex", vol: 0.0018, base: 78.5 },
];

// Seeded PRNG so candles are stable for backtests
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateCandles(asset: Asset, count: number, seed = 42, intervalMs = 60_000): Candle[] {
  const rand = mulberry32(seed + (asset?.symbol?.length || 5) * 7);
  const out: Candle[] = [];
  let price = asset.base;
  const now = Date.now();
  for (let i = count - 1; i >= 0; i--) {
    const t = now - i * intervalMs;
    const drift = (rand() - 0.5) * asset.vol * price;
    const o = price;
    const c = Math.max(0.0001, o + drift + (rand() - 0.5) * asset.vol * price * 0.6);
    const h = Math.max(o, c) + rand() * asset.vol * price * 0.5;
    const l = Math.min(o, c) - rand() * asset.vol * price * 0.5;
    out.push({ t, o, h, l, c });
    price = c;
  }
  return out;
}

export function nextCandle(prev: Candle, asset: Asset, intervalMs = 60_000): Candle {
  const rand = Math.random;
  const o = prev.c;
  const drift = (rand() - 0.5) * asset.vol * o * 1.2;
  const c = Math.max(0.0001, o + drift);
  const h = Math.max(o, c) + rand() * asset.vol * o * 0.6;
  const l = Math.min(o, c) - rand() * asset.vol * o * 0.6;
  return { t: prev.t + intervalMs, o, h, l, c };
}

// Indicators
export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = [null];
  let gains = 0, losses = 0;
  for (let i = 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const g = Math.max(0, diff);
    const l = Math.max(0, -diff);
    if (i <= period) {
      gains += g; losses += l;
      if (i === period) {
        const rs = gains / Math.max(losses, 1e-9);
        out.push(100 - 100 / (1 + rs));
      } else out.push(null);
    } else {
      gains = (gains * (period - 1) + g) / period;
      losses = (losses * (period - 1) + l) / period;
      const rs = gains / Math.max(losses, 1e-9);
      out.push(100 - 100 / (1 + rs));
    }
  }
  return out;
}

export function bollinger(values: number[], period = 20, mult = 2) {
  const ma = sma(values, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1 || ma[i] == null) { upper.push(null); lower.push(null); continue; }
    const slice = values.slice(i - period + 1, i + 1);
    const m = ma[i] as number;
    const variance = slice.reduce((a, b) => a + (b - m) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper.push(m + mult * sd);
    lower.push(m - mult * sd);
  }
  return { ma, upper, lower };
}

export function ema(data: number[], period: number): (number | null)[] {
  if (data.length < period) return data.map(() => null);
  const result: (number | null)[] = [];
  const k = 2 / (period + 1);
  let initialSma = 0;
  for (let i = 0; i < period; i++) initialSma += data[i];
  initialSma /= period;
  
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else if (i === period - 1) {
      result.push(initialSma);
    } else {
      const prev = result[i - 1] as number;
      result.push(data[i] * k + prev * (1 - k));
    }
  }
  return result;
}

export function adx(candles: Candle[], period: number = 14) {
  const result = { adx: [] as (number | null)[], plusDi: [] as (number | null)[], minusDi: [] as (number | null)[] };
  if (candles.length < period + 1) {
    return {
      adx: candles.map(() => null),
      plusDi: candles.map(() => null),
      minusDi: candles.map(() => null),
    };
  }

  const tr = [0];
  const plusDm = [0];
  const minusDm = [0];

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].h;
    const low = candles[i].l;
    const prevHigh = candles[i - 1].h;
    const prevLow = candles[i - 1].l;
    const prevClose = candles[i - 1].c;

    tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));

    const upMove = high - prevHigh;
    const downMove = prevLow - low;

    if (upMove > downMove && upMove > 0) plusDm.push(upMove);
    else plusDm.push(0);

    if (downMove > upMove && downMove > 0) minusDm.push(downMove);
    else minusDm.push(0);
  }

  const smooth = (data: number[]) => {
    const smoothed = [0];
    let sum = 0;
    for (let i = 1; i < period; i++) sum += data[i];
    for (let i = 1; i < data.length; i++) {
      if (i < period) {
        smoothed.push(sum);
      } else if (i === period) {
        sum += data[i];
        smoothed.push(sum);
      } else {
        smoothed.push(smoothed[i - 1] - (smoothed[i - 1] / period) + data[i]);
      }
    }
    return smoothed;
  };

  const str = smooth(tr);
  const splusDm = smooth(plusDm);
  const sminusDm = smooth(minusDm);

  const dx = [0];
  for (let i = 1; i < candles.length; i++) {
    if (i < period) {
      result.plusDi.push(null);
      result.minusDi.push(null);
      dx.push(0);
    } else {
      const pDi = 100 * (splusDm[i] / (str[i] || 1));
      const mDi = 100 * (sminusDm[i] / (str[i] || 1));
      result.plusDi.push(pDi);
      result.minusDi.push(mDi);
      dx.push(100 * (Math.abs(pDi - mDi) / (pDi + mDi || 1)));
    }
  }

  // adx is smoothed dx
  for (let i = 0; i < candles.length; i++) {
    if (i < period * 2 - 1) {
      result.adx.push(null);
    } else if (i === period * 2 - 1) {
      let sum = 0;
      for (let j = period; j <= i; j++) sum += dx[j];
      result.adx.push(sum / period);
    } else {
      const prevAdx = result.adx[i - 1] as number;
      result.adx.push((prevAdx * (period - 1) + dx[i]) / period);
    }
  }
  
  result.adx.unshift(null); // padding for index 0
  if (result.adx.length > candles.length) result.adx.pop();

  return result;
}

export function fmtPrice(v: number, asset?: Asset) {
  const decimals = asset?.type === "forex" ? (asset.symbol.includes("JPY") ? 3 : 5) : 2;
  return v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function macd(data: number[], fast = 12, slow = 26, signal = 9) {
  const fastEma = ema(data, fast);
  const slowEma = ema(data, slow);
  
  const macdLine = data.map((_, i) => {
    if (fastEma[i] === null || slowEma[i] === null) return null;
    return fastEma[i]! - slowEma[i]!;
  });
  
  const validMacdValues = macdLine.filter(v => v !== null) as number[];
  const signalEma = ema(validMacdValues, signal);
  let signalIdx = 0;
  
  const signalLine = macdLine.map(v => {
    if (v === null) return null;
    return signalEma[signalIdx++] ?? null;
  });
  
  const histogram = macdLine.map((v, i) => {
    if (v === null || signalLine[i] === null) return null;
    return v - signalLine[i]!;
  });
  
  return { macd: macdLine, signal: signalLine, histogram };
}

export function getPattern(candles: Candle[], index: number): string | null {
  if (index < 2) return null;
  const c = candles[index];
  const p1 = candles[index - 1]; // prev 1

  const body = Math.abs(c.o - c.c);
  const upperShadow = c.c > c.o ? c.h - c.c : c.h - c.o;
  const lowerShadow = c.c > c.o ? c.o - c.l : c.c - c.l;
  const isBullish = c.c > c.o;
  const isBearish = c.c < c.o;

  const p1Body = Math.abs(p1.o - p1.c);
  const p1Bullish = p1.c > p1.o;
  const p1Bearish = p1.c < p1.o;

  // Doji
  if (body < (c.h - c.l) * 0.1) return "Doji";
  
  // Hammer / Hanging Man (lower shadow at least 2x body, upper shadow very small)
  if (lowerShadow > body * 2 && upperShadow < body * 0.5) return "Hammer/HangingMan";
  
  // Shooting Star / Inverted Hammer
  if (upperShadow > body * 2 && lowerShadow < body * 0.5) return "ShootingStar";

  // Engulfing
  if (p1Bearish && isBullish && c.c > p1.o && c.o < p1.c) return "BullishEngulfing";
  if (p1Bullish && isBearish && c.c < p1.o && c.o > p1.c) return "BearishEngulfing";

  // Harami (inside bar)
  if (p1Bullish && isBearish && c.o < p1.c && c.c > p1.o) return "BearishHarami";
  if (p1Bearish && isBullish && c.o > p1.c && c.c < p1.o) return "BullishHarami";

  return null;
}
