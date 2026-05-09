import { NavLink } from "react-router-dom";
import { Activity, BarChart3, History, Settings, Zap, Bot, ArrowUp, ArrowDown, X, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { useState, useEffect } from "react";
import { io } from "socket.io-client";

const links = [
  { to: "/trading", label: "Trading", icon: Activity },
  { to: "/strategies", label: "Estratégias", icon: Bot },
  { to: "/robots", label: "Robôs", icon: Cpu },
  { to: "/operations", label: "Operações", icon: History },
  { to: "/stats", label: "Estatísticas", icon: BarChart3 },
  { to: "/settings", label: "Configurações", icon: Settings },
];

function SidebarOperations() {
  const { trades, tradingMode, updateTrade } = useStore();
  const [limit, setLimit] = useState(5);
  const currentTrades = trades.filter((t) => t.mode === tradingMode).sort((a, b) => b.ts - a.ts).slice(0, Math.min(limit, 50));

  return (
    <div className="flex-1 min-h-0 mt-4 flex flex-col border-t border-border pt-2 overflow-hidden">
      <div className="text-[10px] text-muted-foreground uppercase px-2 mb-2 font-bold tracking-wider flex items-center justify-between">
        <div className="flex items-center gap-1"><History className="h-3 w-3" /> Operações</div>
        <select 
          value={limit} 
          onChange={(e) => setLimit(Number(e.target.value))}
          className="bg-secondary/50 border border-border text-foreground text-[9px] rounded-sm py-0.5 px-1 outline-none appearance-none cursor-pointer"
        >
          <option value={5}>5</option>
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
        </select>
      </div>
      <div className="flex-1 overflow-y-auto no-scrollbar px-1 flex flex-col gap-1">
        {currentTrades.length === 0 && <div className="text-center text-xs text-muted-foreground py-4">Nenhuma operação</div>}
        {currentTrades.map(t => (
          <div key={t.id} className="text-xs p-2 rounded bg-secondary/30 relative overflow-hidden group">
            {t.result === "OPEN" && (
              <div className="absolute top-0 left-0 bottom-0 w-1 bg-primary/60 animate-pulse" />
            )}
            <div className="flex justify-between items-center pl-1">
              <span className="font-bold flex items-center gap-1">
                {t.type === "CALL" || t.type === "BUY" ? <ArrowUp className="h-3 w-3 text-bull" /> : <ArrowDown className="h-3 w-3 text-bear" />}
                {t.asset}
              </span>
              <span className={`font-bold ${t.result === "OPEN" ? "text-warning" : (t.pnl ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>
                {t.result === "OPEN" ? (
                  <button 
                    onClick={() => updateTrade(t.id, { result: "LOSS", pnl: -t.amount })} 
                    className="p-1 hover:bg-destructive hover:text-white rounded transition-colors text-muted-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : `${(t.pnl ?? 0) >= 0 ? "+" : ""}${t.pnl?.toFixed(2)}`}
              </span>
            </div>
            <div className="flex justify-between items-center pl-1 mt-1 opacity-60 text-[10px]">
              <span>{t.result === "OPEN" ? "Aberto" : "Fechado"}</span>
              <span>${t.amount}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { tradingMode, balance, marketType, automationMode } = useStore();

  const modeLabel = { demo: "DEMO", real: "REAL", backtest: "BACKTEST" }[tradingMode];
  const modeColor = { demo: "text-primary", real: "text-bear", backtest: "text-warning" }[tradingMode];
  const modeDot = { demo: "bg-primary", real: "bg-bear", backtest: "bg-warning" }[tradingMode];

  const autoLabel = { manual: "", "semi-auto": " · SEMI-AUTO", auto: " · AUTO" }[automationMode];

  useEffect(() => {
    // Check for day change to reset daily management
    const checkReset = () => {
      const { management, resetDailyPnl } = useStore.getState();
      const today = new Date().toISOString().split("T")[0];
      if (management.lastResetDate !== today) {
        resetDailyPnl();
      }
    };
    checkReset();

    const interval = setInterval(() => {
      checkReset();
      const { trades, updateTrade } = useStore.getState();
      const openLiveTrades = trades.filter(t => t.result === "OPEN" && t.mode !== "backtest");
      let changed = false;
      openLiveTrades.forEach(t => {
         // Se for operação de tempo fixo baseada em segundos
         if (t.durationS) {
            // Se já passou o tempo + 3 segundos de tolerância
            const isStale = (Date.now() - t.ts) > (t.durationS * 1000 + 3000);
            if (isStale) {
               updateTrade(t.id, { result: "LOSS", pnl: -t.amount, exit: t.entry });
               changed = true;
            }
         }
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const socket = io();
    const { updateRobot, updateTrade } = useStore.getState();

    socket.on('connect', () => {
      console.log("[Socket] Connected to VPS");
    });

    socket.on('robot-status', ({ robotId, status }) => {
      updateRobot(robotId, { vpsStatus: status });
    });

    socket.on('robot-trade-update', ({ robotId, trade }) => {
      // Direct store update for the trade
      updateTrade(trade.id, trade);
      
      // Update the specific robot's trade list
      const robots = useStore.getState().robots;
      const robot = robots.find(r => r.id === robotId);
      if (robot) {
        const exists = robot.trades.find(t => t.id === trade.id);
        if (!exists) {
          updateRobot(robotId, { trades: [trade, ...robot.trades] });
        } else {
          const newTrades = robot.trades.map(t => t.id === trade.id ? trade : t);
          updateRobot(robotId, { trades: newTrades });
        }
      }
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      <header className="h-12 border-b border-border flex items-center justify-between px-4 panel rounded-none">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <span className="font-bold tracking-widest text-sm glow-text">QUANTTERM CLOUD</span>
          <span className="text-[10px] text-muted-foreground ml-2">v10.0.0</span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 border rounded-sm ml-2 ${modeColor} border-current`}>{modeLabel}{autoLabel}</span>
          <span className="text-[10px] text-muted-foreground ml-1">{marketType === "binary" ? "BINÁRIAS" : "FOREX"}</span>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
          <span>SESSÃO: <span className={modeColor}>{modeLabel}</span></span>
          <span>SALDO: <span className="text-foreground ticker">${balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
          <span className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${modeDot} animate-pulse`} /> ONLINE</span>
        </div>
      </header>
      <div className="flex flex-1 min-h-0">
        <aside className="w-44 shrink-0 border-r border-border bg-sidebar p-2 flex flex-col gap-1 min-h-0">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 px-3 py-2 text-xs rounded-sm border border-transparent transition-colors",
                  isActive
                    ? "bg-secondary border-border text-primary glow-text"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                )
              }
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="uppercase tracking-wider">{label}</span>
            </NavLink>
          ))}
          <SidebarOperations />
          <div className="mt-auto text-[10px] text-muted-foreground p-2 border-t border-border">
            <div>Latência: <span className="text-bull">12ms</span></div>
            <div>Feed: Deriv (sim)</div>
          </div>
        </aside>
        <main className="flex-1 min-w-0 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
