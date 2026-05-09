import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useStore, type Trade } from "@/lib/store";

const RSI_BANDS = ["<30 (Oversold)", "30-40", "40-50", "50-60", "60-70", ">70 (Overbought)"];
function getRsiBucket(rsi?: number) {
  if (rsi == null) return "N/A";
  if (rsi < 30) return "<30 (Oversold)";
  if (rsi < 40) return "30-40";
  if (rsi < 50) return "40-50";
  if (rsi < 60) return "50-60";
  if (rsi <= 70) return "60-70";
  return ">70 (Overbought)";
}

const ADX_BANDS = ["<20 (Weak)", "20-25", "25-30", "30-40", ">40 (Strong)"];
function getAdxBucket(adx?: number) {
  if (adx == null) return "N/A";
  if (adx < 20) return "<20 (Weak)";
  if (adx < 25) return "20-25";
  if (adx < 30) return "25-30";
  if (adx < 40) return "30-40";
  return ">40 (Strong)";
}

const MACD_BANDS = ["Bullish (Hist > 0)", "Bearish (Hist < 0)"];
function getMacdBucket(hist?: number) {
  if (hist == null) return "N/A";
  return hist > 0 ? "Bullish (Hist > 0)" : "Bearish (Hist < 0)";
}

const MA_TREND_BANDS = [
  "Strong Bullish (> all MAs)", 
  "Bullish (>21, >200)", 
  "Bearish (<21, <200)", 
  "Strong Bearish (< all MAs)", 
  "Ranging/Mixed"
];
function getMaTrendBucket(entry: number, m9?: number, m21?: number, m200?: number, m235?: number) {
  if (m9 == null || m21 == null || m200 == null) return "N/A";
  const aboveAll = entry > m9 && entry > m21 && entry > m200 && (!m235 || (entry > m235));
  const belowAll = entry < m9 && entry < m21 && entry < m200 && (!m235 || (entry < m235));
  if (aboveAll) return "Strong Bullish (> all MAs)";
  if (belowAll) return "Strong Bearish (< all MAs)";
  if (entry > m21 && entry > m200) return "Bullish (>21, >200)";
  if (entry < m21 && entry < m200) return "Bearish (<21, <200)";
  return "Ranging/Mixed";
}

function getPatternBucket(pattern?: string) {
  return pattern || "Sem Padrão";
}

type Filters = {
  asset: string | null;
  strategy: string | null;
  type: string | null;
  rsi: string | null;
  adx: string | null;
  macd: string | null;
  maTrend: string | null;
  pattern: string | null;
  timeframe: string | null;
};

export default function Stats() {
  const { trades, tradingMode, activeStrategyId } = useStore();
  const [modeFilter, setModeFilter] = useState<"all" | "backtest" | "demo" | "real">(tradingMode);
  const [f, setF] = useState<Filters>({
    asset: null, 
    strategy: tradingMode === "backtest" ? (activeStrategyId || null) : null, 
    type: null, rsi: null, adx: null, macd: null, maTrend: null, pattern: null, timeframe: null
  });

  const toggleFilter = (key: keyof Filters, val: string) => {
    setF(prev => ({ ...prev, [key]: prev[key] === val ? null : val }));
  };

  // First filter by mode, THEN apply granular filters
  const modeFilteredTrades = useMemo(() => {
    if (modeFilter === "all") return trades;
    return trades.filter(t => t.mode === modeFilter);
  }, [trades, modeFilter]);

  const filtered = useMemo(() => {
    return modeFilteredTrades.filter((t) => {
      const sh = (t.snapshot || {}) as Record<string, number | string | undefined>;
      if (f.asset && t.asset !== f.asset) return false;
      if (f.strategy && (t.strategyId || "Manual") !== f.strategy) return false;
      if (f.type) {
        const tradeDir = (t.type === "CALL" || t.type === "BUY") ? "BUY" : "SELL";
        if (tradeDir !== f.type) return false;
      }
      if (f.rsi && getRsiBucket(sh.rsi) !== f.rsi) return false;
      if (f.adx && getAdxBucket(sh.adx) !== f.adx) return false;
      if (f.macd && getMacdBucket(sh.histogram) !== f.macd) return false;
      if (f.maTrend && getMaTrendBucket(t.entry, sh.ma9, sh.ma21, sh.ma200, sh.ma235) !== f.maTrend) return false;
      if (f.pattern && getPatternBucket(sh.pattern) !== f.pattern) return false;
      if (f.timeframe && (t.timeframe || "1m") !== f.timeframe) return false;
      return true;
    });
  }, [modeFilteredTrades, f]);

  const totals = useMemo(() => {
    const closed = filtered.filter(t => t.result === "WIN" || t.result === "LOSS");
    const wins = closed.filter(t => t.result === "WIN").length;
    const losses = closed.filter(t => t.result === "LOSS").length;
    const pnl = closed.reduce((a, b) => a + (b.pnl ?? 0), 0);
    
    // BUY = CALL or BUY, SELL = PUT or SELL
    const buyTrades = closed.filter(t => t.type === "CALL" || t.type === "BUY");
    const sellTrades = closed.filter(t => t.type === "PUT" || t.type === "SELL");
    const buyWins = buyTrades.filter(t => t.result === "WIN").length;
    const sellWins = sellTrades.filter(t => t.result === "WIN").length;
    
    return {
      trades: closed.length,
      wins,
      losses,
      pnl,
      wr: closed.length ? (wins / closed.length) * 100 : 0,
      buyCount: buyTrades.length,
      sellCount: sellTrades.length,
      buyWins,
      sellWins,
      buyWr: buyTrades.length ? (buyWins / buyTrades.length) * 100 : 0,
      sellWr: sellTrades.length ? (sellWins / sellTrades.length) * 100 : 0,
      buyPnl: buyTrades.reduce((a, b) => a + (b.pnl ?? 0), 0),
      sellPnl: sellTrades.reduce((a, b) => a + (b.pnl ?? 0), 0),
    };
  }, [filtered]);

  function buildStats(extractor: (t: Trade) => string, possibleBuckets?: string[]) {
    const m: Record<string, { trades: number; pnl: number; wins: number; typeWins: Record<string, number>; typeTrades: Record<string, number> }> = {};
    if (possibleBuckets) {
      possibleBuckets.forEach(b => m[b] = { trades: 0, pnl: 0, wins: 0, typeWins: {}, typeTrades: {} });
    }
    filtered.forEach((t) => {
      if (t.result !== "WIN" && t.result !== "LOSS") return; // Ignore OPEN trades for statistics

      const k = extractor(t);
      if (!m[k]) m[k] = { trades: 0, pnl: 0, wins: 0, typeWins: {}, typeTrades: {} };
      m[k].trades++; 
      m[k].pnl += t.pnl ?? 0; 
      if (t.result === "WIN") m[k].wins++;
      
      const typeStr = t.type === "CALL" || t.type === "BUY" ? "BUY" : "SELL";
      m[k].typeTrades[typeStr] = (m[k].typeTrades[typeStr] || 0) + 1;
      if (t.result === "WIN") {
        m[k].typeWins[typeStr] = (m[k].typeWins[typeStr] || 0) + 1;
      }
    });

    return Object.entries(m)
      .map(([k, v]) => ({ 
        label: k, 
        ...v, 
        wr: v.trades ? (v.wins / v.trades) * 100 : 0 ,
        wrBuy: v.typeTrades["BUY"] ? (v.typeWins["BUY"] || 0) / v.typeTrades["BUY"] * 100 : 0,
        wrSell: v.typeTrades["SELL"] ? (v.typeWins["SELL"] || 0) / v.typeTrades["SELL"] * 100 : 0,
      }))
      .sort((a, b) => b.trades - a.trades);
  }

  const byRsi = buildStats(t => getRsiBucket((t.snapshot as any)?.rsi), RSI_BANDS);
  const byAdx = buildStats(t => getAdxBucket((t.snapshot as any)?.adx), ADX_BANDS);
  const byMacd = buildStats(t => getMacdBucket((t.snapshot as any)?.histogram), MACD_BANDS);
  const byMa = buildStats(t => getMaTrendBucket(t.entry, (t.snapshot as any)?.ma9, (t.snapshot as any)?.ma21, (t.snapshot as any)?.ma200, (t.snapshot as any)?.ma235), MA_TREND_BANDS);
  const byPattern = buildStats(t => getPatternBucket((t.snapshot as any)?.pattern));
  const byAsset = buildStats(t => t.asset);
  const byStrategy = buildStats(t => t.strategyId || "Manual");
  const byHour = buildStats(t => {
    const h = new Date(t.ts).getHours();
    return `${String(h).padStart(2, "0")}:00`;
  });

  // Discover all custom stat keys from trades
  const customStatKeys = useMemo(() => {
    const keys = new Set<string>();
    trades.forEach(t => {
      if (t.customStats) {
        Object.keys(t.customStats).forEach(k => keys.add(k));
      }
    });
    return Array.from(keys);
  }, [trades]);

  const customStatPanels = customStatKeys.map(key => ({
    key,
    label: `Custom: ${key}`,
    data: buildStats(t => String(t.customStats?.[key] ?? "N/A"))
  }));

  return (
    <AppShell>
      <div className="p-3 space-y-3 pb-24">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 mb-2">
           <h2 className="text-xl font-bold">Estatísticas Operacionais</h2>
           <div className="flex items-center gap-2">
             {/* Mode filter tabs */}
             <div className="flex rounded-md border border-border/50 overflow-hidden">
               {(["backtest", "demo", "real", "all"] as const).map(mode => (
                 <button
                   key={mode}
                   onClick={() => setModeFilter(mode)}
                   className={`px-3 py-1.5 text-[10px] font-bold uppercase transition-colors ${
                     modeFilter === mode
                       ? mode === "backtest" ? "bg-warning/20 text-warning border-warning"
                         : mode === "real" ? "bg-bear/20 text-bear"
                         : mode === "demo" ? "bg-primary/20 text-primary"
                         : "bg-white/10 text-white"
                       : "text-muted-foreground hover:bg-secondary/40"
                   }`}
                 >
                   {mode === "all" ? "TODOS" : mode.toUpperCase()}
                 </button>
               ))}
             </div>
             {/* Timeframe filter */}
             <div className="flex rounded-md border border-border/50 overflow-hidden">
               {["1m", "5m", "15m", "1h", "1d"].map(tf => (
                 <button
                   key={tf}
                   onClick={() => setF(prev => ({ ...prev, timeframe: prev.timeframe === tf ? null : tf }))}
                   className={`px-2.5 py-1.5 text-[10px] font-bold uppercase transition-colors ${
                     f.timeframe === tf
                       ? "bg-primary/20 text-primary"
                       : "text-muted-foreground hover:bg-secondary/40"
                   }`}
                 >
                   {tf}
                 </button>
               ))}
             </div>
             {Object.values(f).some(v => v !== null) && (
               <button onClick={() => setF({ asset: null, strategy: null, type: null, rsi: null, adx: null, macd: null, maTrend: null, pattern: null, timeframe: null })} className="bg-primary/20 text-primary px-3 py-1 rounded text-xs hover:bg-primary/30">
                 Limpar Filtros
               </button>
             )}
           </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
          <Tile label="Total Trades" value={totals.trades} />
          <Tile label="Win Rate" value={`${totals.wr.toFixed(1)}%`} color={totals.wr >= 55 ? "text-bull" : "text-warning"} />
          <Tile label="P&L Total" value={`${totals.pnl >= 0 ? "+" : ""}$${totals.pnl.toFixed(2)}`} color={totals.pnl >= 0 ? "text-bull" : "text-bear"} />
          <Tile label="Vitórias / Derrotas" value={`${totals.wins} / ${totals.losses}`} color="text-white" />
          <button onClick={() => toggleFilter("type", "BUY")} className={`stat-tile bg-[#1a1e29] border rounded p-4 flex flex-col justify-center shadow-sm text-left transition-colors ${f.type === "BUY" ? "border-[#00ff88] bg-[#00ff88]/10" : "border-border/50 hover:border-[#00ff88]/50"}`}>
            <div className="text-[10px] text-[#00ff88] uppercase tracking-wide mb-1 opacity-80">COMPRA (BUY/CALL)</div>
            <div className="text-lg font-black ticker text-[#00ff88]">{totals.buyCount} ops</div>
            <div className="text-[10px] text-muted-foreground">WR: {totals.buyWr.toFixed(1)}% · {totals.buyWins}W/{totals.buyCount - totals.buyWins}L · P&L: {totals.buyPnl >= 0 ? "+" : ""}{totals.buyPnl.toFixed(2)}</div>
          </button>
          <button onClick={() => toggleFilter("type", "SELL")} className={`stat-tile bg-[#1a1e29] border rounded p-4 flex flex-col justify-center shadow-sm text-left transition-colors ${f.type === "SELL" ? "border-[#ff3366] bg-[#ff3366]/10" : "border-border/50 hover:border-[#ff3366]/50"}`}>
            <div className="text-[10px] text-[#ff3366] uppercase tracking-wide mb-1 opacity-80">VENDA (SELL/PUT)</div>
            <div className="text-lg font-black ticker text-[#ff3366]">{totals.sellCount} ops</div>
            <div className="text-[10px] text-muted-foreground">WR: {totals.sellWr.toFixed(1)}% · {totals.sellWins}W/{totals.sellCount - totals.sellWins}L · P&L: {totals.sellPnl >= 0 ? "+" : ""}{totals.sellPnl.toFixed(2)}</div>
          </button>
          <Tile label="Vitórias" value={totals.wins} color="text-bull" />
          <Tile label="Derrotas" value={totals.losses} color="text-bear" />
        </div>

        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          <StatPanel title="Por Estratégia" data={byStrategy} filterKey="strategy" currentFilter={f.strategy} onToggle={toggleFilter} />
          <StatPanel title="Por Horário" data={byHour} filterKey="hour" currentFilter={null} onToggle={() => {}} />
          <StatPanel title="Por Faixa de RSI" data={byRsi} filterKey="rsi" currentFilter={f.rsi} onToggle={toggleFilter} />
          <StatPanel title="Por Faixa de ADX" data={byAdx} filterKey="adx" currentFilter={f.adx} onToggle={toggleFilter} />
          <StatPanel title="Por MACD (Histograma)" data={byMacd} filterKey="macd" currentFilter={f.macd} onToggle={toggleFilter} />
          <StatPanel title="Por Tendência de Médias (9, 21, 200, 235)" data={byMa} filterKey="maTrend" currentFilter={f.maTrend} onToggle={toggleFilter} />
          <StatPanel title="Por Padrão de Candles" data={byPattern} filterKey="pattern" currentFilter={f.pattern} onToggle={toggleFilter} />
          <StatPanel title="Por Ativo" data={byAsset} filterKey="asset" currentFilter={f.asset} onToggle={toggleFilter} />
          {customStatPanels.map(p => (
            <StatPanel key={p.key} title={p.label} data={p.data} filterKey={p.key} currentFilter={null} onToggle={() => {}} />
          ))}
        </div>

        <div className="panel p-3">
          <div className="text-[10px] uppercase text-muted-foreground mb-2 flex items-center gap-2">
            <div>Operações Filtradas ({filtered.length})</div>
            <div className="flex gap-1">
              {Object.entries(f).filter(([_, v]) => v != null).map(([k, v]) => (
                <span key={k} className="bg-secondary px-2 rounded-sm text-white">{v}</span>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] ticker whitespace-nowrap">
              <thead className="text-muted-foreground"><tr><th className="text-left">HORA</th><th>ATIVO</th><th>ESTRATÉGIA</th><th>DIR</th><th>STAKE</th><th>RSI</th><th>ADX</th><th>MACD Hist</th><th>PADRÃO</th><th>P&L</th><th>RES</th></tr></thead>
              <tbody>
                {filtered.slice(0, 50).map((t) => {
                  const sh = t.snapshot as any || {};
                  return (
                    <tr key={t.id} className="border-t border-border/60 hover:bg-secondary/30">
                      <td className="py-1">{new Date(t.ts).toLocaleString()}</td>
                      <td className="text-center text-primary">{t.asset}</td>
                      <td className="text-center text-muted-foreground">{t.strategyId || "Manual"}</td>
                      <td className={`text-center font-bold ${t.type === "CALL" || t.type === "BUY" ? "text-bull" : "text-bear"}`}>{t.type}</td>
                      <td className="text-center">${t.amount}</td>
                      <td className="text-center">{sh.rsi?.toFixed(1) || "-"}</td>
                      <td className="text-center">{sh.adx?.toFixed(1) || "-"}</td>
                      <td className="text-center">{sh.histogram?.toFixed(4) || "-"}</td>
                      <td className="text-center">{sh.pattern || "-"}</td>
                      <td className={`text-center font-bold ${(t.pnl ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>{(t.pnl ?? 0) >= 0 ? "+" : ""}{t.pnl?.toFixed(2)}</td>
                      <td className={`text-center font-bold ${t.result === "WIN" ? "text-bull" : "text-bear"}`}>{t.result}</td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && <tr><td colSpan={10} className="text-center py-6 text-muted-foreground">Nenhuma operação atende aos filtros</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function StatPanel({ title, data, filterKey, currentFilter, onToggle }: any) {
  return (
    <div className="panel p-3 flex flex-col max-h-[300px]">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase text-muted-foreground font-bold shrink-0">{title}</div>
      </div>
      <div className="overflow-y-auto flex-1 custom-scrollbar">
        <table className="w-full text-[11px] ticker text-center">
          <thead className="text-muted-foreground sticky top-0 bg-[#131722]">
            <tr>
              <th className="text-left font-normal pb-1">FAIXA</th>
              <th className="font-normal pb-1">OP.</th>
              <th className="font-normal pb-1">WR</th>
              <th className="font-normal pb-1 text-[#00ff88]" colSpan={2}>COMPRA</th>
              <th className="font-normal pb-1 text-[#ff3366]" colSpan={2}>VENDA</th>
            </tr>
            <tr className="text-[9px]">
              <th></th><th></th><th></th>
              <th className="font-normal text-[#00ff88]/60">QTD</th>
              <th className="font-normal text-[#00ff88]/60">WR</th>
              <th className="font-normal text-[#ff3366]/60">QTD</th>
              <th className="font-normal text-[#ff3366]/60">WR</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r: any) => (
              <tr 
                key={r.label} 
                onClick={() => onToggle(filterKey, r.label)} 
                className={`border-t border-border/60 cursor-pointer transition-colors ${currentFilter === r.label ? "bg-primary/20" : "hover:bg-secondary/60"}`}
              >
                <td className={`py-1 text-left ${currentFilter === r.label ? "text-primary font-bold" : "text-white"}`}>{r.label === "N/A" ? "Indisp." : r.label}</td>
                <td>{r.trades}</td>
                <td className={r.wr >= 55 ? "text-bull" : (r.trades > 0 && r.wr < 50 ? "text-bear" : "")}>{r.trades > 0 ? `${r.wr.toFixed(0)}%` : "-"}</td>
                <td className="text-[#00ff88]/60">{r.typeTrades["BUY"] || 0}</td>
                <td className="text-[#00ff88]/80">{r.typeTrades["BUY"] > 0 ? `${r.wrBuy.toFixed(0)}%` : "-"}</td>
                <td className="text-[#ff3366]/60">{r.typeTrades["SELL"] || 0}</td>
                <td className="text-[#ff3366]/80">{r.typeTrades["SELL"] > 0 ? `${r.wrSell.toFixed(0)}%` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tile({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div className="stat-tile bg-[#1a1e29] border border-border/50 rounded p-4 flex flex-col justify-center shadow-sm">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1 opacity-80">{label}</div>
      <div className={`text-2xl font-black ticker tracking-tight ${color ?? "text-white"}`}>{value}</div>
    </div>
  );
}
