import { useEffect, useRef, useState } from "react";
import type { Candle } from "@/lib/market";
import { useStore } from "@/lib/store";
import {
  Maximize2,
  Settings2,
  LineChart,
  BarChart2,
  MousePointer2,
  Type,
  Ruler,
  Eye,
  EyeOff,
  Trash2,
  ChevronDown,
  Search,
  Minus,
  TrendingUp,
  LayoutGrid,
  Zap,
  Globe,
  Coins
} from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ASSETS } from "@/lib/market";
import { Input } from "@/components/ui/input";

type Props = {
  asset: string;
  candles: Candle[];
  drawingMode: "support" | "resistance" | "buy_zone" | "sell_zone" | null;
  setDrawingMode: (mode: "support" | "resistance" | "buy_zone" | "sell_zone" | null) => void;
  indicator: string;
  setIndicator: (ind: string) => void;
  overlays?: {
    ma?: (number | null)[];
    ma11?: (number | null)[];
    ma15?: (number | null)[];
    ma200?: (number | null)[];
    ma235?: (number | null)[];
    upper?: (number | null)[];
    lower?: (number | null)[]
  };
  oscillator?: (number | null)[] | null;
  tradingMode: "demo" | "real" | "backtest";
  trades?: import("@/lib/store").Trade[];
  onAssetChange?: (asset: string) => void;
};

export function CandlestickChart({ asset, candles, drawingMode, setDrawingMode, indicator, setIndicator, overlays, oscillator, trades, tradingMode, onAssetChange }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { srLines, srZones, addSR, removeSR, addSRZone, removeSRZone, showSRLines, setShowSRLines, timeframe, setTimeframe } = useStore();

  const [hover, setHover] = useState<{ x: number; y: number; price: number; idx: number } | null>(null);
  const [size, setSize] = useState({ w: 800, h: 480 });

  const [viewCount, setViewCount] = useState(100);
  const [offset, setOffset] = useState(-20);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, offset: 0 });
  const [dragSR, setDragSR] = useState<{ id: string; price: number } | null>(null);
  const [hoverSRId, setHoverSRId] = useState<string | null>(null);
  const [hoverZoneId, setHoverZoneId] = useState<string | null>(null);
  const [pendingZone, setPendingZone] = useState<{ startY: number; startPrice: number } | null>(null);
  const [isAssetSelectorOpen, setIsAssetSelectorOpen] = useState(false);
  const [assetSearch, setAssetSearch] = useState("");

  useEffect(() => {
    const obs = new ResizeObserver((e) => {
      const r = e[0].contentRect;
      setSize({ w: Math.max(320, r.width), h: Math.max(280, r.height) });
    });
    if (wrapRef.current) obs.observe(wrapRef.current);
    return () => obs.disconnect();
  }, []);

  const padL = 0, padR = 60, padT = 20, padB = oscillator ? 80 : 30;
  const innerW = size.w - padL - padR;
  const innerH = size.h - padT - padB;
  const cw = innerW / viewCount;
  const endIdx = candles.length - offset;
  const startIdx = endIdx - viewCount;
  const view = candles.filter((_, i) => i >= startIdx && i < endIdx);

  const min = Math.min(...(view.length ? view.map((c) => c.l) : [0]));
  const max = Math.max(...(view.length ? view.map((c) => c.h) : [100]));
  const range = max - min || 1;
  const padRange = range * 0.15;
  const lo = min - padRange, hi = max + padRange;

  const yOf = (p: number) => padT + (1 - (p - lo) / (hi - lo)) * innerH;
  const priceOf = (y: number) => lo + (1 - (y - padT) / innerH) * (hi - lo);
  const xOf = (idx: number) => padL + (idx - startIdx) * cw + cw / 2;

  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size.w * dpr; cv.height = size.h * dpr;
    cv.style.width = size.w + "px"; cv.style.height = size.h + "px";
    const ctx = cv.getContext("2d")!; ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size.w, size.h);

    // grid
    ctx.strokeStyle = "hsl(220 14% 14%)"; ctx.lineWidth = 1;
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.fillStyle = "hsl(150 8% 45%)";
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      const y = padT + (innerH / steps) * i;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(innerW, y); ctx.stroke();
      const p = lo + (1 - i / steps) * (hi - lo);
      ctx.fillText(typeof p === 'number' ? p.toFixed(p < 10 ? 5 : 2) : '', innerW + 8, y + 3);
    }

    // time grid (simple)
    for (let i = 0; i < viewCount; i += 20) {
      const x = padL + i * cw;
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + innerH); ctx.stroke();
    }

    // overlays
    const drawMA = (data: (number | null)[] | undefined, color: string, width = 1) => {
      if (!data) return;
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      let first = true;
      for (let j = Math.floor(startIdx); j <= Math.ceil(endIdx) + 1; j++) {
        if (j < 0 || j >= data.length) continue;
        const val = data[j];
        if (val == null) continue;
        const x = xOf(j);
        const y = yOf(val);
        if (first) { ctx.moveTo(x, y); first = false; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    drawMA(overlays?.ma, "#fbbf24", 1.5);
    drawMA(overlays?.ma11, "#7dd3fc", 1.5);
    drawMA(overlays?.ma15, "#34d399", 1.5);
    drawMA(overlays?.ma200, "#f43f5e", 2);
    drawMA(overlays?.ma235, "#a855f7", 2);

    if (overlays?.upper && overlays?.lower) {
      ctx.fillStyle = "rgba(59, 130, 246, 0.05)";
      ctx.strokeStyle = "rgba(59, 130, 246, 0.5)";
      ctx.lineWidth = 1;

      // upper
      ctx.beginPath();
      let first = true;
      for (let j = Math.floor(startIdx); j <= Math.ceil(endIdx) + 1; j++) {
        const val = overlays.upper[j];
        if (val == null) continue;
        const x = xOf(j); const y = yOf(val);
        if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // lower
      ctx.beginPath();
      let firstLo = true;
      for (let j = Math.floor(startIdx); j <= Math.ceil(endIdx) + 1; j++) {
        const val = overlays.lower[j];
        if (val == null) continue;
        const x = xOf(j); const y = yOf(val);
        if (firstLo) { ctx.moveTo(x, y); firstLo = false; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    if (oscillator) {
      const oscH = 50;
      const oscY = size.h - oscH - 10;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.1)"; ctx.lineWidth = 1;

      // RSI threshold lines
      ctx.beginPath(); ctx.moveTo(0, oscY + oscH * 0.3); ctx.lineTo(innerW, oscY + oscH * 0.3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, oscY + oscH * 0.7); ctx.lineTo(innerW, oscY + oscH * 0.7); ctx.stroke();

      // RSI labels
      ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "9px Arial";
      ctx.fillText("70", innerW + 4, oscY + oscH * 0.3 + 3);
      ctx.fillText("30", innerW + 4, oscY + oscH * 0.7 + 3);

      ctx.beginPath();
      ctx.strokeStyle = "#8b5cf6"; // purple-500
      ctx.lineWidth = 1.5;
      let firstOsc = true;
      for (let j = Math.floor(startIdx); j <= Math.ceil(endIdx) + 1; j++) {
        if (j < 0 || j >= oscillator.length) continue;
        const val = oscillator[j];
        if (val == null) continue;
        const x = xOf(j);
        const y = oscY + oscH * (1 - (val / 100)); // assuming 0-100 like RSI
        if (firstOsc) { ctx.moveTo(x, y); firstOsc = false; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // candles
    candles.forEach((c, j) => {
      if (j < startIdx - 1 || j > endIdx + 1) return;
      const x = xOf(j);
      const isUp = c.c >= c.o;
      ctx.strokeStyle = isUp ? "#22c55e" : "#ef4444";
      ctx.fillStyle = isUp ? "#22c55e" : "#ef4444";
      ctx.beginPath(); ctx.moveTo(x, yOf(c.h)); ctx.lineTo(x, yOf(c.l)); ctx.stroke();
      const yo = yOf(c.o), yc = yOf(c.c);
      const h = Math.max(1, Math.abs(yc - yo));
      ctx.fillRect(x - cw * 0.3, Math.min(yo, yc), cw * 0.6, h);
    });

    const currentPrice = candles.length > 0 ? candles[candles.length - 1].c : null;

    // SR lines
    srLines.filter((l) => l.asset === asset).forEach((l) => {
      const isSelected = dragSR?.id === l.id || hoverSRId === l.id;
      if (!showSRLines && !isSelected) return;
      if (l.price < lo || l.price > hi) return;
      const price = dragSR?.id === l.id ? dragSR.price : l.price;
      const y = yOf(price);

      const isPriceAbove = currentPrice !== null ? currentPrice > price : l.kind === "support";
      const lineColor = isPriceAbove ? "#22c55e" : "#ef4444";

      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(innerW, y); ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = isSelected ? "#fff" : lineColor;
      ctx.fillRect(innerW, y - 9, padR, 18);
      ctx.fillStyle = isSelected ? "#000" : "#fff";
      ctx.fillText(typeof price === 'number' ? price.toFixed(price < 10 ? 5 : 2) : '', innerW + 4, y + 4);

      if (hoverSRId === l.id && !dragSR) {
        ctx.fillStyle = "#ef4444";
        ctx.beginPath();
        ctx.arc(innerW - 15, y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "white";
        ctx.font = "bold 9px Arial";
        ctx.fillText("X", innerW - 18, y + 3);
      }
    });

    // SR zones
    srZones.filter((z) => z.asset === asset).forEach((z) => {
      const isSelected = hoverZoneId === z.id;
      if (!showSRLines && !isSelected) return;

      const yTop = yOf(z.topPrice);
      const yBottom = yOf(z.bottomPrice);
      const h = yBottom - yTop;

      ctx.fillStyle = z.kind === "buy_zone" ? "rgba(34, 197, 94, 0.15)" : "rgba(239, 68, 68, 0.15)";
      if (isSelected) ctx.fillStyle = z.kind === "buy_zone" ? "rgba(34, 197, 94, 0.3)" : "rgba(239, 68, 68, 0.3)";

      ctx.fillRect(0, yTop, innerW, h);
      ctx.strokeStyle = z.kind === "buy_zone" ? "rgba(34, 197, 94, 0.5)" : "rgba(239, 68, 68, 0.5)";
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.strokeRect(0, yTop, innerW, h);

      if (isSelected) {
        const yMid = yTop + h / 2;
        ctx.fillStyle = "#ef4444";
        ctx.beginPath();
        ctx.arc(innerW - 15, yMid, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "white";
        ctx.font = "bold 9px Arial";
        ctx.fillText("X", innerW - 18, yMid + 3);
      }
    });

    if (pendingZone && hover) {
      const yTop = Math.min(pendingZone.startY, hover.y);
      const yBottom = Math.max(pendingZone.startY, hover.y);
      ctx.fillStyle = drawingMode === "buy_zone" ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)";
      ctx.fillRect(0, yTop, innerW, yBottom - yTop);
      ctx.strokeStyle = drawingMode === "buy_zone" ? "#22c55e" : "#ef4444";
      ctx.strokeRect(0, yTop, innerW, yBottom - yTop);
    }

    // current price line
    const lastReal = candles[candles.length - 1];
    if (lastReal) {
      const y = yOf(lastReal.c);
      ctx.setLineDash([2, 2]);
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(innerW, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = lastReal.c >= lastReal.o ? "#22c55e" : "#ef4444";
      ctx.fillRect(innerW, y - 9, padR, 18);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 10px JetBrains Mono";
      ctx.fillText(typeof lastReal.c === 'number' ? lastReal.c.toFixed(lastReal.c < 10 ? 5 : 2) : '', innerW + 4, y + 4);
    }

    // trades
    if (trades) {
      ctx.font = "bold 9px JetBrains Mono";
      trades.forEach(t => {
        const timeToMatch = t.entryTime || t.ts;

        // Match the closest candle
        let candleIdx = -1;
        let minDiff = Infinity;
        for (let i = 0; i < candles.length; i++) {
          const diff = Math.abs(candles[i].t - timeToMatch);
          if (diff < minDiff) {
            minDiff = diff;
            candleIdx = i;
          }
        }

        // Only draw if within a reasonable timeframe distance (e.g. within 2x interval)
        const intervalMs = candles.length > 1 ? candles[1].t - candles[0].t : 60000;
        if (minDiff > intervalMs * 2) {
          candleIdx = -1;
        }

        if (candleIdx !== -1 && candleIdx >= startIdx - 1 && candleIdx <= endIdx + 1) {
          const x = xOf(candleIdx);
          const isCall = t.type === "CALL" || t.type === "BUY";

          ctx.beginPath();
          if (isCall) {
            const yPos = yOf(candles[candleIdx].l) + 15;
            ctx.fillStyle = "#22c55e";
            ctx.moveTo(x, yPos - 5);
            ctx.lineTo(x - 4, yPos + 3);
            ctx.lineTo(x + 4, yPos + 3);
            ctx.fill();
          } else {
            const yPos = yOf(candles[candleIdx].h) - 15;
            ctx.fillStyle = "#ef4444";
            ctx.moveTo(x, yPos + 5);
            ctx.lineTo(x - 4, yPos - 3);
            ctx.lineTo(x + 4, yPos - 3);
            ctx.fill();
          }
        }

        // Draw horizontal line only for OPEN trades
        if (t.result === "OPEN") {
          const ey = yOf(t.entry);
          ctx.beginPath();
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = t.type === "CALL" || t.type === "BUY" ? "#22c55e" : "#ef4444";
          ctx.lineWidth = 1;
          ctx.moveTo(0, ey);
          ctx.lineTo(innerW, ey);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = t.type === "CALL" || t.type === "BUY" ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)";
          ctx.fillRect(0, ey - 7, 70, 14);
          ctx.fillStyle = t.type === "CALL" || t.type === "BUY" ? "#22c55e" : "#ef4444";
          ctx.fillText(`${t.type} $${t.amount}`, 4, ey + 3);

          if (t.durationS > 0) {
            const expireTimestamp = t.ts + t.durationS * 1000;
            const intMs = candles.length > 1 ? candles[1].t - candles[0].t : 60000;
            const firstVisible = view[0];
            if (firstVisible) {
              const diffMs = expireTimestamp - firstVisible.t;
              const diffCandles = diffMs / intMs;
              const expireIdx = startIdx + diffCandles;
              const exX = xOf(expireIdx);

              if (exX >= 0 && exX <= innerW + 100) {
                ctx.beginPath();
                ctx.setLineDash([2, 4]);
                ctx.strokeStyle = "rgba(255,255,255,0.3)";
                ctx.moveTo(exX, padT);
                ctx.lineTo(exX, innerH + padT);
                ctx.stroke();
                ctx.setLineDash([]);

                const remaining = Math.max(0, Math.ceil((expireTimestamp - Date.now()) / 1000));
                ctx.fillStyle = "rgba(255,255,255,0.7)";
                ctx.fillText(`${remaining}s`, exX + 4, padT + 12);
              }
            }
          }
        }
      });
    }

    if (hover) {
      ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(hover.x, 0); ctx.lineTo(hover.x, innerH + padT); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, hover.y); ctx.lineTo(innerW, hover.y); ctx.stroke();
      ctx.setLineDash([]);

      if (drawingMode) {
        const y = hover.y;
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = drawingMode === "support" ? "#22c55e" : "#ef4444";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(innerW, y); ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = drawingMode === "support" ? "#22c55e" : "#ef4444";
        ctx.fillRect(innerW, y - 9, padR, 18);
        ctx.fillStyle = "#fff";
        ctx.fillText(typeof hover.price === 'number' ? hover.price.toFixed(hover.price < 10 ? 5 : 2) : '', innerW + 4, y + 4);
      }
    }
  }, [size, candles, srLines, showSRLines, asset, overlays, hover, startIdx, endIdx, viewCount, offset, drawingMode, trades]);

  const onPointerMove = (e: React.PointerEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (dragSR) {
      setDragSR({ ...dragSR, price: priceOf(y) });
      return;
    }

    // Hover detection
    const nearSR = srLines.find(l => l.asset === asset && Math.abs(yOf(l.price) - y) < 14);
    setHoverSRId(nearSR?.id || null);

    const nearZone = srZones.find(z => {
      if (z.asset !== asset) return false;
      const yt = yOf(z.topPrice);
      const yb = yOf(z.bottomPrice);
      return y >= yt - 5 && y <= yb + 5 && x < innerW;
    });
    setHoverZoneId(nearZone?.id || null);

    if (isDragging) {
      setOffset(dragStart.offset + (x - dragStart.x) / cw);
    }

    if (x < 0 || x > size.w || y < 0 || y > size.h) { setHover(null); return; }
    setHover({ x, y, price: priceOf(y), idx: Math.floor(startIdx + x / cw) });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check for "X" button click (deletion)
    if (hoverSRId) {
      const line = srLines.find(l => l.id === hoverSRId);
      if (line) {
        const lx = innerW - 15;
        const ly = yOf(line.price);
        if (Math.abs(x - lx) < 15 && Math.abs(y - ly) < 15) {
          removeSR(hoverSRId);
          setHoverSRId(null);
          return;
        }
      }
    }
    if (hoverZoneId) {
      const zone = srZones.find(z => z.id === hoverZoneId);
      if (zone) {
        const lx = innerW - 15;
        const ly = yOf(zone.topPrice + (zone.bottomPrice - zone.topPrice) / 2);
        if (Math.abs(x - lx) < 15 && Math.abs(y - ly) < 15) {
          removeSRZone(hoverZoneId);
          setHoverZoneId(null);
          return;
        }
      }
    }

    const clickedSR = srLines.find(l => {
      if (l.asset !== asset) return false;
      const lineY = yOf(l.price);
      return Math.abs(lineY - y) < 10;
    });

    if (clickedSR) {
      setDragSR({ id: clickedSR.id, price: clickedSR.price });
      setIsDragging(false);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    if (drawingMode === "buy_zone" || drawingMode === "sell_zone") {
      if (!pendingZone) {
        setPendingZone({ startY: y, startPrice: priceOf(y) });
      } else {
        const p1 = pendingZone.startPrice;
        const p2 = priceOf(y);
        addSRZone({
          id: crypto.randomUUID(),
          asset,
          topPrice: Math.max(p1, p2),
          bottomPrice: Math.min(p1, p2),
          kind: drawingMode
        });
        setPendingZone(null);
        setDrawingMode(null);
      }
      return;
    }

    if (drawingMode) {
      if (candles.length < 20) {
        toast.error("Aguarde pelo menos 20 velas para traçar linhas de suporte/resistência.");
        return;
      }
      addSR({ id: crypto.randomUUID(), asset, price: priceOf(y), kind: drawingMode === "support" ? "support" : "resistance" });
      return;
    }

    setIsDragging(true);
    setDragStart({ x, offset });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (dragSR) {
      useStore.getState().updateSR(dragSR.id, { price: dragSR.price });
      setDragSR(null);
    }
    setIsDragging(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#131722] text-[#d1d4dc] border border-[#2a2e39] rounded-sm overflow-hidden select-none font-sans">
      {/* Top Toolbar */}
      <div className="h-10 border-b border-[#2a2e39] flex items-center px-3 gap-4 shrink-0 bg-[#131722]">
        <Popover open={isAssetSelectorOpen} onOpenChange={setIsAssetSelectorOpen}>
          <PopoverTrigger asChild>
            <button 
              className="flex items-center gap-1 font-bold text-sm text-white hover:bg-[#2a2e39] px-2 py-1 rounded transition-colors"
            >
              <span>{asset}</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent 
            align="start" 
            side="bottom" 
            sideOffset={5}
            className="w-[320px] p-0 bg-[#1e222d] border-[#2a2e39] text-[#d1d4dc] shadow-2xl z-[100]"
          >
            <div className="p-3">
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Buscar ativos..."
                  className="pl-9 bg-[#131722] border-[#2a2e39] text-white h-9 text-xs focus:ring-primary/50"
                  value={assetSearch}
                  onChange={(e) => setAssetSearch(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="max-h-[60vh] overflow-y-auto pr-1 custom-scrollbar space-y-4">
                {/* Synthetic Indices */}
                <div>
                  <h4 className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1.5 px-2 flex items-center gap-1">
                    <Zap className="h-2.5 w-2.5 text-amber-500" /> Sintéticos
                  </h4>
                  <div className="grid grid-cols-1 gap-0.5">
                    {ASSETS.filter(a => a.type === "synthetic" && (a.symbol.toLowerCase().includes(assetSearch.toLowerCase()) || a.name.toLowerCase().includes(assetSearch.toLowerCase()))).map(a => (
                      <button
                        key={a.symbol}
                        onClick={() => {
                          onAssetChange?.(a.symbol);
                          setIsAssetSelectorOpen(false);
                          setAssetSearch("");
                        }}
                        className={`flex items-center justify-between p-2 rounded transition-all group ${asset === a.symbol ? 'bg-primary/10 border-l-2 border-primary' : 'hover:bg-[#2a2e39] border-l-2 border-transparent'}`}
                      >
                        <div className="flex flex-col items-start">
                          <span className={`font-bold text-xs ${asset === a.symbol ? 'text-primary' : 'text-white'}`}>{a.symbol}</span>
                          <span className="text-[9px] text-muted-foreground group-hover:text-white/60">{a.name}</span>
                        </div>
                        {asset === a.symbol && <div className="w-1 h-1 rounded-full bg-primary" />}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Forex */}
                <div>
                  <h4 className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1.5 px-2 flex items-center gap-1">
                    <Globe className="h-2.5 w-2.5 text-blue-400" /> Forex
                  </h4>
                  <div className="grid grid-cols-1 gap-0.5">
                    {ASSETS.filter(a => a.type === "forex" && (a.symbol.toLowerCase().includes(assetSearch.toLowerCase()) || a.name.toLowerCase().includes(assetSearch.toLowerCase()))).map(a => (
                      <button
                        key={a.symbol}
                        onClick={() => {
                          onAssetChange?.(a.symbol);
                          setIsAssetSelectorOpen(false);
                          setAssetSearch("");
                        }}
                        className={`flex items-center justify-between p-2 rounded transition-all group ${asset === a.symbol ? 'bg-primary/10 border-l-2 border-primary' : 'hover:bg-[#2a2e39] border-l-2 border-transparent'}`}
                      >
                        <div className="flex flex-col items-start">
                          <span className={`font-bold text-xs ${asset === a.symbol ? 'text-primary' : 'text-white'}`}>{a.symbol}</span>
                          <span className="text-[9px] text-muted-foreground group-hover:text-white/60">{a.name}</span>
                        </div>
                        {asset === a.symbol && <div className="w-1 h-1 rounded-full bg-primary" />}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>
        <div className="h-4 w-px bg-[#2a2e39]" />
        <div className="flex items-center gap-2">
          {["1m", "5m", "15m", "1h", "1d"].map((t) => (
            <button
              key={t}
              onClick={() => setTimeframe(t)}
              className={`px-2 py-1 rounded text-xs hover:bg-[#2a2e39] transition-colors ${t === timeframe ? "text-primary bg-[#2a2e39]" : ""}`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="h-4 w-px bg-[#2a2e39]" />
        <div className="flex items-center gap-2">
          <button className={`p-1.5 rounded hover:bg-[#2a2e39] ${indicator !== "none" ? "text-primary" : ""}`} title="Candles"><BarChart2 className="h-4 w-4" /></button>
          <button className="p-1.5 rounded hover:bg-[#2a2e39]" title="Line"><LineChart className="h-4 w-4" /></button>
        </div>
        <div className="h-4 w-px bg-[#2a2e39]" />
        <div className="relative group">
          <button className="flex items-center gap-1 px-2 py-1 rounded hover:bg-[#2a2e39] text-xs">
            Indicadores ({indicator}) <ChevronDown className="h-3 w-3" />
          </button>
          <div className="absolute top-full left-0 mt-1 w-40 bg-[#1e222d] border border-[#2a2e39] rounded shadow-xl hidden group-hover:block z-50">
            {["none", "sma", "rsi", "bb"].map((k) => (
              <button
                key={k}
                onClick={() => setIndicator(k)}
                className={`w-full text-left px-3 py-2 text-xs hover:bg-[#2a2e39] transition-colors uppercase ${indicator === k ? "text-primary" : ""}`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <button className="p-1.5 rounded hover:bg-[#2a2e39]"><LayoutGrid className="h-4 w-4" /></button>
          <button className="p-1.5 rounded hover:bg-[#2a2e39]"><Settings2 className="h-4 w-4" /></button>
          <button className="p-1.5 rounded hover:bg-[#2a2e39]"><Maximize2 className="h-4 w-4" /></button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 relative">
        {/* Left Toolbar */}
        <div className="w-12 border-r border-[#2a2e39] flex flex-col items-center py-2 gap-3 bg-[#131722] shrink-0">
          <button
            className={`p-2 rounded hover:bg-[#2a2e39] ${!drawingMode ? "bg-[#2a2e39] text-primary" : ""}`}
            onClick={() => setDrawingMode(null)}
          >
            <MousePointer2 className="h-5 w-5" />
          </button>
          <button
            className={`p-2 rounded hover:bg-[#2a2e39] ${drawingMode === "support" ? "bg-[#2a2e39] text-bull" : ""}`}
            onClick={() => setDrawingMode("support")}
            onContextMenu={(e) => { e.preventDefault(); setDrawingMode("buy_zone"); toast.info("Modo Zona de Compra (Retângulo) ativado."); }}
            title="Suporte (Clique direito para Zona de Compra)"
          >
            <TrendingUp className="h-5 w-5" />
          </button>
          <button
            className={`p-2 rounded hover:bg-[#2a2e39] ${drawingMode === "resistance" ? "bg-[#2a2e39] text-bear" : ""}`}
            onClick={() => setDrawingMode("resistance")}
            onContextMenu={(e) => { e.preventDefault(); setDrawingMode("sell_zone"); toast.info("Modo Zona de Venda (Retângulo) ativado."); }}
            title="Resistência (Clique direito para Zona de Venda)"
          >
            <Minus className="h-5 w-5" />
          </button>
          <button
            className={`p-2 rounded hover:bg-[#2a2e39] ${drawingMode === "buy_zone" ? "bg-[#2a2e39] text-bull" : ""}`}
            onClick={() => setDrawingMode("buy_zone")}
            title="Zona de Compra (Retângulo)"
          >
            <div className="w-5 h-4 border-2 border-bull/50 bg-bull/20 rounded-sm" />
          </button>
          <button
            className={`p-2 rounded hover:bg-[#2a2e39] ${drawingMode === "sell_zone" ? "bg-[#2a2e39] text-bear" : ""}`}
            onClick={() => setDrawingMode("sell_zone")}
            title="Zona de Venda (Retângulo)"
          >
            <div className="w-5 h-4 border-2 border-bear/50 bg-bear/20 rounded-sm" />
          </button>
          <button className="p-2 rounded hover:bg-[#2a2e39]"><LayoutGrid className="h-5 w-5" /></button>
          <button className="p-2 rounded hover:bg-[#2a2e39]"><Type className="h-5 w-5" /></button>
          <button className="p-2 rounded hover:bg-[#2a2e39]"><Ruler className="h-5 w-5" /></button>
          <div className="mt-auto flex flex-col gap-3 pb-2">
            <button
              className={`p-2 rounded hover:bg-[#2a2e39] ${!showSRLines ? "text-muted-foreground" : ""}`}
              onClick={() => setShowSRLines(!showSRLines)}
            >
              {showSRLines ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
            </button>
            <button className="p-2 rounded hover:bg-[#2a2e39] text-destructive/70 hover:text-destructive" onClick={() => useStore.getState().clearSR(asset)}><Trash2 className="h-5 w-5" /></button>
          </div>
        </div>

        {/* Chart Area */}
        <div ref={wrapRef} className="flex-1 relative overflow-hidden bg-[#131722] cursor-crosshair">
          <canvas
            ref={ref}
            onPointerMove={onPointerMove}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => !dragSR && !isDragging && setHover(null)}
            onWheel={(e) => { e.preventDefault(); setViewCount((v) => Math.max(10, Math.min(2000, v * (e.deltaY > 0 ? 1.1 : 0.9)))); }}
            className={dragSR ? "cursor-ns-resize" : isDragging ? "cursor-grabbing" : hoverSRId ? "cursor-pointer" : "cursor-crosshair"}
            style={{ touchAction: 'none' }}
          />

          {/* Watermark */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none opacity-[0.03] select-none text-center">
            <div className="text-8xl font-bold tracking-tighter">QUANTTERM</div>
            <div className="text-2xl tracking-[0.5em] mt-2">TRADING PRO</div>
          </div>

          {hover && (
            <div className="absolute right-[60px] top-0 bottom-0 pointer-events-none">
              <div className="absolute bg-[#363a45] text-white text-[10px] px-1.5 py-0.5 rounded-sm" style={{ top: hover.y - 10 }}>
                {typeof hover.price === 'number' ? hover.price.toFixed(hover.price < 10 ? 5 : 2) : ''}
              </div>
            </div>
          )}

          {offset > -15 && (
            <button
              onClick={() => setOffset(-20)}
              className="absolute bottom-6 right-20 bg-[#2a2e39] hover:bg-[#363a45] text-white text-[10px] px-3 py-1.5 rounded border border-[#434651] shadow-xl transition-all flex items-center gap-2"
            >
              <ChevronDown className="h-3 w-3 rotate-180" /> Ir para o Tempo Real
            </button>
          )}
        </div>
      </div>

      {/* Bottom Axis Area */}
      <div className="h-8 border-t border-[#2a2e39] bg-[#131722] flex items-center justify-between px-14 text-[10px] text-muted-foreground">
        <div className="flex gap-12">
          {["15:00", "16:00", "17:00", "18:00", "19:00"].map(t => <span key={t}>{t}</span>)}
        </div>
        <div className="flex items-center gap-4 pr-16">
          <span>UTC+1</span>
          <span>%</span>
          <span>LOG</span>
          <span className="text-primary font-bold">AUTO</span>
        </div>
      </div>
    </div>
  );
}
