import { AppShell } from "@/components/AppShell";
import { useStore, type RobotConfig } from "@/lib/store";
import { getRobotRuntime } from "@/lib/robotEngine";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import {
  Cpu,
  Power,
  PowerOff,
  Trash2,
  Target,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  History,
  Settings2,
  ArrowUp,
  ArrowDown,
  Monitor,
  Wifi,
  Clock,
  BarChart2,
  Layers,
  AlertCircle,
  Server,
  Cloud,
  CloudOff
} from "lucide-react";
import { io, Socket } from "socket.io-client";

const socket: Socket = io(window.location.origin);

const TIMEFRAMES = ["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"];

// Live runtime status badge — refreshes every 2 s
function RuntimeBadge({ robotId, isVps }: { robotId: string, isVps?: boolean }) {
  const [status, setStatus] = useState<{ connected: boolean; candleCount: number; ready: boolean; assetCount: number; message?: string } | null>(null);

  useEffect(() => {
    if (isVps) {
      const onStatus = (data: any) => {
        if (data.id === robotId) {
          setStatus({
            connected: data.status === "running",
            ready: data.status === "running",
            assetCount: 0, // Server status can be improved later
            candleCount: 0,
            message: data.message
          });
        }
      };
      socket.on("robot-status", onStatus);
      return () => { socket.off("robot-status", onStatus); };
    } else {
      const update = () => setStatus(getRobotRuntime(robotId));
      update();
      const iv = setInterval(update, 2000);
      return () => clearInterval(iv);
    }
  }, [robotId, isVps]);

  if (isVps && status?.message) {
    return (
      <span className="flex items-center gap-1 text-[9px] text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-full border border-cyan-500/20">
        <Cloud className="h-2.5 w-2.5 animate-pulse" /> {status.message}
      </span>
    );
  }

  if (!status) {
    return (
      <span className="flex items-center gap-1 text-[9px] text-muted-foreground bg-secondary/30 px-2 py-0.5 rounded-full">
        <AlertCircle className="h-2.5 w-2.5" /> Offline
      </span>
    );
  }

  if (!status.connected) {
    return (
      <span className="flex items-center gap-1 text-[9px] text-warning bg-warning/10 px-2 py-0.5 rounded-full">
        <Signal className="h-2.5 w-2.5 animate-pulse" /> Conectando…
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 text-[9px] text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-full border border-cyan-500/20">
      <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
      {status.ready ? `${status.assetCount} ativos · ${status.candleCount} velas` : "Carregando…"}
    </span>
  );
}

export default function Robots() {
  const { robots, updateRobot, removeRobot, resetRobotDaily, importRobotTrades, clearRobotTrades, addRobotTrade, updateRobotTrade, demoToken, realToken } = useStore();
  const [expandedConfig, setExpandedConfig] = useState<Record<string, boolean>>({});
  const [expandedTrades, setExpandedTrades] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const onTrade = ({ id, trade }: any) => {
      addRobotTrade(id, trade);
    };
    const onTradeUpdate = ({ id, contractId, result, pnl, exit }: any) => {
      updateRobotTrade(id, contractId, { result, pnl, exit });
    };

    socket.on("robot-trade", onTrade);
    socket.on("robot-trade-update", onTradeUpdate);

    return () => {
      socket.off("robot-trade", onTrade);
      socket.off("robot-trade-update", onTradeUpdate);
    };
  }, [addRobotTrade, updateRobotTrade]);

  const toggleConfig = (id: string) =>
    setExpandedConfig((prev) => ({ ...prev, [id]: !prev[id] }));
  const toggleTrades = (id: string) =>
    setExpandedTrades((prev) => ({ ...prev, [id]: !prev[id] }));

  const handleDelete = (robot: RobotConfig) => {
    if (!confirm(`Apagar robô "${robot.name}"? Esta ação é irreversível.`)) return;
    removeRobot(robot.id);
    toast.success(`Robô "${robot.name}" removido.`);
  };

  const renderRobotCard = (robot: RobotConfig) => {
    const robotAssets = robot.assets?.length ? robot.assets : ((robot as any).asset ? [(robot as any).asset] : ["R_100"]);
    const winTrades   = robot.trades.filter((t) => t.result === "WIN").length;
    const lossTrades  = robot.trades.filter((t) => t.result === "LOSS").length;
    const openTrades  = robot.trades.filter((t) => t.result === "OPEN").length;
    const totalTrades = winTrades + lossTrades;
    const winRate     = totalTrades > 0 ? ((winTrades / totalTrades) * 100).toFixed(1) : "0.0";

    // Best hours analysis
    const hourStats: Record<number, { wins: number; total: number }> = {};
    robot.trades.filter(t => t.result === "WIN" || t.result === "LOSS").forEach(t => {
      const h = new Date(t.ts).getHours();
      if (!hourStats[h]) hourStats[h] = { wins: 0, total: 0 };
      hourStats[h].total++;
      if (t.result === "WIN") hourStats[h].wins++;
    });
    const bestHours = Object.entries(hourStats)
      .map(([h, s]) => ({ hour: Number(h), wr: s.total > 0 ? (s.wins / s.total) * 100 : 0, total: s.total }))
      .filter(h => h.total >= 2)
      .sort((a, b) => b.wr - a.wr)
      .slice(0, 5);

    const dailyProgress =
      robot.dailyGoal > 0
        ? Math.min(100, (robot.currentDailyPnl / robot.dailyGoal) * 100)
        : 0;
    const dailyLossProgress =
      robot.dailyStopLoss > 0
        ? Math.min(100, (Math.abs(Math.min(0, robot.currentDailyPnl)) / robot.dailyStopLoss) * 100)
        : 0;

    return (
      <div
        key={robot.id}
        className={`panel rounded-lg overflow-hidden transition-all duration-300 ${
          robot.active
            ? "border-cyan-500/50 shadow-[0_0_20px_rgba(6,182,212,0.1)]"
            : "border-border/50 opacity-80"
        }`}
      >
        {/* ── Header ── */}
        <div className={`px-4 py-3 flex items-center justify-between ${robot.active ? "bg-cyan-500/5" : "bg-secondary/20"}`}>
          <div className="flex items-center gap-3">
            <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
              robot.active ? "bg-cyan-500/20 text-cyan-400" : "bg-muted-foreground/10 text-muted-foreground"
            }`}>
              <Cpu className="h-4 w-4" />
            </div>
            <div>
              <div className="font-bold text-sm text-white flex items-center gap-2">
                {robot.name}
                {robot.active && <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />}
                {openTrades > 0 && (
                  <span className="text-[9px] bg-warning/20 text-warning border border-warning/30 px-1.5 rounded-full">
                    {openTrades} aberta{openTrades > 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground flex items-center gap-2 flex-wrap">
                <code className="text-primary bg-primary/10 px-1 rounded">{robot.strategyId}</code>
                <span className="flex items-center gap-1 text-muted-foreground/70">
                  <BarChart2 className="h-2.5 w-2.5" />{robotAssets.length} ativo(s)
                </span>
                <span className="flex items-center gap-1 text-muted-foreground/70">
                  <Layers className="h-2.5 w-2.5" />{robot.timeframe}
                </span>
                <span className="flex items-center gap-1 text-muted-foreground/70">
                  <Clock className="h-2.5 w-2.5" />{robot.durationSeconds}s
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-2">
              {/* Demo / Real toggle */}
              <button
                onClick={() => updateRobot(robot.id, { mode: robot.mode === "demo" ? "real" : "demo" })}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase border transition-all ${
                  robot.mode === "real"
                    ? "bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20"
                    : "bg-primary/10 text-primary border-primary/30 hover:bg-primary/20"
                }`}
              >
                {robot.mode === "real" ? <Wifi className="h-3 w-3" /> : <Monitor className="h-3 w-3" />}
                {robot.mode === "real" ? "REAL" : "DEMO"}
              </button>
              {/* Active toggle */}
              <Switch
                checked={robot.active}
                onCheckedChange={(v) => {
                  updateRobot(robot.id, { active: v });
                  if (robot.vpsExecution) {
                    if (v) {
                      socket.emit("start-robot", { config: robot, token: robot.mode === "real" ? realToken : demoToken });
                    } else {
                      socket.emit("stop-robot", robot.id);
                    }
                  }
                  toast.info(v ? `Robô "${robot.name}" activado.` : `Robô "${robot.name}" parado.`);
                }}
              />
            </div>
            {robot.active && <RuntimeBadge robotId={robot.id} isVps={robot.vpsExecution} />}
          </div>
        </div>

        {/* ── PnL Summary ── */}
        <div className="px-4 py-3 grid grid-cols-4 gap-3 border-b border-border/30">
          <div className="text-center">
            <div className="text-[9px] text-muted-foreground uppercase">PnL Hoje</div>
            <div className={`text-sm font-bold ticker ${robot.currentDailyPnl >= 0 ? "text-bull" : "text-bear"}`}>
              {robot.currentDailyPnl >= 0 ? "+" : ""}${robot.currentDailyPnl.toFixed(2)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-[9px] text-muted-foreground uppercase">PnL Total</div>
            <div className={`text-sm font-bold ticker ${robot.totalPnl >= 0 ? "text-bull" : "text-bear"}`}>
              {robot.totalPnl >= 0 ? "+" : ""}${robot.totalPnl.toFixed(2)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-[9px] text-muted-foreground uppercase">Win Rate</div>
            <div className="text-sm font-bold text-white">{winRate}%</div>
          </div>
          <div className="text-center">
            <div className="text-[9px] text-muted-foreground uppercase">Trades</div>
            <div className="text-sm font-bold text-white">{totalTrades}</div>
          </div>
        </div>

        {/* ── Daily Progress Bars ── */}
        <div className="px-4 py-2 space-y-2">
          <div className="flex items-center gap-2">
            <Target className="h-3 w-3 text-bull shrink-0" />
            <div className="flex-1">
              <div className="flex justify-between text-[9px] mb-0.5">
                <span className="text-muted-foreground">Meta Diária</span>
                <span className="text-bull font-bold">${robot.currentDailyPnl.toFixed(2)} / ${robot.dailyGoal}</span>
              </div>
              <div className="h-1.5 bg-border/30 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-500"
                  style={{ width: `${Math.max(0, dailyProgress)}%` }}
                />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-3 w-3 text-bear shrink-0" />
            <div className="flex-1">
              <div className="flex justify-between text-[9px] mb-0.5">
                <span className="text-muted-foreground">Stop Loss Diário</span>
                <span className="text-bear font-bold">{Math.abs(Math.min(0, robot.currentDailyPnl)).toFixed(2)} / ${robot.dailyStopLoss}</span>
              </div>
              <div className="h-1.5 bg-border/30 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-red-500 to-red-400 rounded-full transition-all duration-500"
                  style={{ width: `${dailyLossProgress}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── Expandable Config ── */}
        <div className="border-t border-border/30">
          <button
            onClick={() => toggleConfig(robot.id)}
            className="w-full flex items-center justify-between px-4 py-2 text-[10px] text-muted-foreground hover:text-white transition-colors"
          >
            <span className="flex items-center gap-1.5 font-bold uppercase">
              <Settings2 className="h-3 w-3" /> Configurações
            </span>
            {expandedConfig[robot.id] ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>

          {expandedConfig[robot.id] && (
            <div className="px-4 pb-4 space-y-4">

              {/* ── Operação ── */}
              <div className="space-y-2">
                <div className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider border-b border-border/30 pb-1">
                  Operação
                </div>
                {/* Assets list (read-only, from strategy) */}
                <div className="space-y-1">
                  <label className="text-[9px] text-muted-foreground font-bold uppercase flex items-center gap-1">
                    <BarChart2 className="h-2.5 w-2.5" /> Ativos (definidos pela estratégia)
                  </label>
                  <div className="flex flex-wrap gap-1 p-2 bg-secondary/20 rounded border border-border/30">
                    {robotAssets.map(a => (
                      <span key={a} className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-mono">{a}</span>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {/* Timeframe */}
                  <div className="space-y-1">
                    <label className="text-[9px] text-muted-foreground font-bold uppercase flex items-center gap-1">
                      <Layers className="h-2.5 w-2.5" /> Time Frame
                    </label>
                    <select
                      value={robot.timeframe}
                      onChange={(e) => updateRobot(robot.id, { timeframe: e.target.value })}
                      className="w-full h-8 text-xs bg-secondary/50 border border-border rounded-md px-2 outline-none text-foreground cursor-pointer"
                    >
                      {TIMEFRAMES.map((tf) => (
                        <option key={tf} value={tf}>{tf}</option>
                      ))}
                    </select>
                  </div>
                  {/* Duration */}
                  <div className="space-y-1">
                    <label className="text-[9px] text-muted-foreground font-bold uppercase flex items-center gap-1">
                      <Clock className="h-2.5 w-2.5" /> Duração (s)
                    </label>
                    <Input
                      type="number"
                      value={robot.durationSeconds}
                      onChange={(e) => updateRobot(robot.id, { durationSeconds: +e.target.value })}
                      className="h-8 text-xs ticker"
                      min={5}
                      step={5}
                    />
                  </div>
                </div>
                <p className="text-[9px] text-muted-foreground/70 leading-relaxed">
                  Os ativos são definidos pelos filtros da estratégia. O robô opera em todos os ativos listados.
                </p>

                {/* VPS Toggle */}
                <div className="flex items-center justify-between p-2.5 bg-cyan-500/5 border border-cyan-500/20 rounded-sm">
                  <div className="flex items-center gap-2">
                    <div className={`h-7 w-7 rounded flex items-center justify-center ${robot.vpsExecution ? 'bg-cyan-500 text-white' : 'bg-secondary text-muted-foreground'}`}>
                      <Server className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-[10px] font-bold text-white flex items-center gap-1">
                        EXECUÇÃO NA VPS 
                        {robot.vpsExecution ? <Cloud className="h-2.5 w-2.5 text-cyan-400" /> : <CloudOff className="h-2.5 w-2.5 text-muted-foreground" />}
                      </div>
                      <div className="text-[9px] text-muted-foreground">Roda 24h em background na Hostinger.</div>
                    </div>
                  </div>
                  <Switch
                    checked={!!robot.vpsExecution}
                    onCheckedChange={(v) => {
                      if (robot.active) {
                        toast.error("Pare o robô antes de mudar o local de execução.");
                        return;
                      }
                      updateRobot(robot.id, { vpsExecution: v });
                      toast.success(v ? "Execução movida para a VPS." : "Execução movida para o Navegador.");
                    }}
                  />
                </div>
              </div>

              {/* ── Gestão Financeira ── */}
              <div className="space-y-2">
                <div className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider border-b border-border/30 pb-1">
                  Gestão Financeira
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[9px] text-muted-foreground font-bold uppercase">Meta Diária ($)</label>
                    <Input
                      type="number"
                      value={robot.dailyGoal}
                      onChange={(e) => updateRobot(robot.id, { dailyGoal: +e.target.value })}
                      className="h-8 text-xs ticker"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-muted-foreground font-bold uppercase">Stop Loss ($)</label>
                    <Input
                      type="number"
                      value={robot.dailyStopLoss}
                      onChange={(e) => updateRobot(robot.id, { dailyStopLoss: +e.target.value })}
                      className="h-8 text-xs ticker text-bear border-bear/30"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-muted-foreground font-bold uppercase">Stake Base ($)</label>
                    <Input
                      type="number"
                      value={robot.stake}
                      onChange={(e) => updateRobot(robot.id, { stake: +e.target.value })}
                      className="h-8 text-xs ticker"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-muted-foreground font-bold uppercase">Payout (%)</label>
                    <Input
                      type="number"
                      value={robot.payout}
                      onChange={(e) => updateRobot(robot.id, { payout: +e.target.value })}
                      className="h-8 text-xs ticker"
                    />
                  </div>
                </div>

                {/* Staking Mode */}
                <div className="space-y-1.5 p-2.5 bg-secondary/20 border border-border/30 rounded-sm">
                  <label className="text-[9px] text-muted-foreground font-bold uppercase flex items-center gap-1">
                    <Target className="h-2.5 w-2.5" /> Modo de Aposta Progressiva
                  </label>
                  <div className="flex gap-1.5">
                    {(["fixed", "soros", "reinvest"] as const).map(mode => (
                      <button
                        key={mode}
                        onClick={() => updateRobot(robot.id, { stakingMode: mode })}
                        className={`flex-1 py-1 text-[9px] font-bold uppercase rounded border transition-all ${
                          (robot.stakingMode ?? "fixed") === mode
                            ? "bg-primary/20 text-primary border-primary/40"
                            : "bg-secondary/30 text-muted-foreground border-border/30 hover:text-white"
                        }`}
                      >
                        {mode === "fixed" ? "Fixo" : mode === "soros" ? "Soros" : "Reinvestir"}
                      </button>
                    ))}
                  </div>
                  {(robot.stakingMode === "soros" || robot.stakingMode === "reinvest") && (
                    <div className="space-y-1">
                      <label className="text-[9px] text-muted-foreground font-bold uppercase">Stake Máximo ($) <span className="text-muted-foreground/50 normal-case">(0 = sem limite)</span></label>
                      <Input
                        type="number"
                        value={robot.sorosMaxStake ?? 0}
                        onChange={(e) => updateRobot(robot.id, { sorosMaxStake: +e.target.value })}
                        className="h-8 text-xs ticker"
                        min={0}
                        step={10}
                      />
                      <p className="text-[9px] text-muted-foreground/70 leading-relaxed">
                        {robot.stakingMode === "soros"
                          ? "Soros: após cada vitória, reinveste o lucro na próxima operação. Reinicia após perda."
                          : "Reinvestir: após cada vitória, duplica o valor apostado. Reinicia após perda."}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Filtros de Sequência ── */}
              <div className="space-y-2">
                <div className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider border-b border-border/30 pb-1">
                  Filtros de Sequência
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[10px] font-medium">Entrar após Vitória</div>
                      <div className="text-[9px] text-muted-foreground">Op. de aquecimento em DEMO até obter WIN.</div>
                    </div>
                    <Switch
                      checked={robot.entryAfterWin}
                      onCheckedChange={(v) => updateRobot(robot.id, { entryAfterWin: v, warmupActive: v })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[10px] font-medium">Entrar após Derrota</div>
                      <div className="text-[9px] text-muted-foreground">Op. de aquecimento em DEMO até obter LOSS.</div>
                    </div>
                    <Switch
                      checked={robot.entryAfterLoss}
                      onCheckedChange={(v) => updateRobot(robot.id, { entryAfterLoss: v, warmupActive: v })}
                    />
                  </div>
                  {robot.warmupActive && (robot.entryAfterWin || robot.entryAfterLoss) && (
                    <div className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-warning/10 border border-warning/20">
                      <Monitor className="h-3 w-3 text-warning" />
                      <span className="text-[9px] text-warning font-bold">
                        AQUECIMENTO DEMO — aguardando {robot.entryAfterWin ? "WIN" : "LOSS"} para ativar modo real
                      </span>
                    </div>
                  )}
                </div>

                <div className="bg-secondary/20 border border-border p-3 rounded-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <History className="h-3.5 w-3.5 text-primary" />
                      <div className="text-[10px] font-bold">FILTRO VDV</div>
                    </div>
                    <Switch
                      checked={robot.vdvFilter}
                      onCheckedChange={(v) => updateRobot(robot.id, { vdvFilter: v })}
                    />
                  </div>
                  <p className="text-[9px] text-muted-foreground leading-relaxed">
                    Pausa entradas no padrão{" "}
                    <span className="text-bull">W</span>-
                    <span className="text-bear">L</span>-
                    <span className="text-bull">W</span>-
                    <span className="text-bear">L</span>.
                  </p>
                  {robot.vdvPaused && (
                    <div className="text-[9px] text-warning flex items-center gap-1">
                      <RotateCcw className="h-3 w-3" /> Pausado — Reinicia após 2 vitórias.
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-[10px] h-7 gap-1"
                  onClick={() => { resetRobotDaily(robot.id); toast.success("PnL diário reiniciado."); }}
                >
                  <RotateCcw className="h-3 w-3" /> Reset Diário
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-[10px] h-7 gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={() => { if (confirm("Limpar todo o histórico deste robô?")) { clearRobotTrades(robot.id); toast.success("Histórico limpo."); } }}
                >
                  <Trash2 className="h-3 w-3" /> Limpar Histórico
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ── Best Hours ── */}
        {bestHours.length > 0 && (
          <div className="border-t border-border/30 px-4 py-2">
            <div className="text-[9px] text-muted-foreground uppercase font-bold mb-1.5 flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" /> Melhores Horários
            </div>
            <div className="flex flex-wrap gap-1.5">
              {bestHours.map(h => (
                <span key={h.hour} className={`text-[9px] px-2 py-0.5 rounded border ${
                  h.wr >= 60 ? "bg-bull/10 text-bull border-bull/20" : h.wr >= 50 ? "bg-primary/10 text-primary border-primary/20" : "bg-secondary/30 text-muted-foreground border-border/30"
                }`}>
                  {String(h.hour).padStart(2, "0")}:00 — {h.wr.toFixed(0)}% ({h.total} ops)
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── Expandable Trade History ── */}
        <div className="border-t border-border/30">
          <button
            onClick={() => toggleTrades(robot.id)}
            className="w-full flex items-center justify-between px-4 py-2 text-[10px] text-muted-foreground hover:text-white transition-colors"
          >
            <span className="flex items-center gap-1.5 font-bold uppercase">
              <History className="h-3 w-3" /> Operações do Robô
              {robot.trades.length > 0 && (
                <span className="bg-primary/20 text-primary px-1.5 rounded-full text-[9px]">
                  {robot.trades.length}
                </span>
              )}
            </span>
            {expandedTrades[robot.id] ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>

          {expandedTrades[robot.id] && (
            <div className="px-4 pb-3 space-y-1">
              {/* Action buttons row */}
              <div className="flex gap-1.5 mb-2">
                {robot.trades.filter(t => t.result !== "OPEN").length > 0 && (
                  <button
                    onClick={() => {
                      const closed = robot.trades.filter(t => t.result !== "OPEN").length;
                      importRobotTrades(robot.id);
                      toast.success(`${closed} operações importadas! Veja em Estatísticas (filtro: DEMO ou REAL).`);
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded border border-dashed border-primary/40 text-[10px] text-primary font-bold hover:bg-primary/10 transition-colors"
                  >
                    <BarChart2 className="h-3 w-3" /> Importar para Estatísticas
                  </button>
                )}
                {robot.trades.filter(t => t.result === "OPEN").length > 0 && (
                  <button
                    onClick={() => {
                      const openTrades = robot.trades.filter(t => t.result === "OPEN");
                      const { updateRobotTrade } = useStore.getState();
                      openTrades.forEach(t => updateRobotTrade(robot.id, t.id, { result: "LOSS", pnl: -t.amount, exit: t.entry }));
                      toast.warning(`${openTrades.length} operação(ões) abertas fechadas como LOSS.`);
                    }}
                    className="flex items-center justify-center gap-1 py-1.5 px-2 rounded border border-dashed border-warning/40 text-[10px] text-warning font-bold hover:bg-warning/10 transition-colors"
                  >
                    <AlertCircle className="h-3 w-3" /> Fechar Abertas ({robot.trades.filter(t => t.result === "OPEN").length})
                  </button>
                )}
              </div>
              <div className="max-h-52 overflow-y-auto no-scrollbar space-y-1">
                {robot.trades.length === 0 && (
                  <div className="text-center text-[10px] text-muted-foreground py-6">
                    Nenhuma operação registada neste robô.
                  </div>
                )}
                {robot.trades.slice(0, 50).map((t) => (
                  <div key={t.id} className={`flex items-center justify-between text-[10px] py-1.5 px-2 rounded ${
                    t.result === "OPEN" ? "bg-warning/5 border border-warning/20" : "bg-secondary/20"
                  }`}>
                    <span className="flex items-center gap-1.5">
                      {t.type === "CALL" || t.type === "BUY" ? (
                        <ArrowUp className="h-3 w-3 text-bull" />
                      ) : (
                        <ArrowDown className="h-3 w-3 text-bear" />
                      )}
                      <span className="font-medium">{t.asset}</span>
                      {t.timeframe && (
                        <span className="text-[8px] text-muted-foreground/60">{t.timeframe}</span>
                      )}
                      <span className="text-[8px] text-muted-foreground/40">
                        {new Date(t.ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {t.result === "OPEN" && (
                        <span className="text-[8px] text-warning animate-pulse">ABERTA</span>
                      )}
                    </span>
                    <span className={`font-bold ${
                      t.result === "OPEN"
                        ? "text-warning"
                        : (t.pnl ?? 0) >= 0 ? "text-bull" : "text-bear"
                    }`}>
                      {t.result === "OPEN"
                        ? `$${t.amount.toFixed(2)}`
                        : `${(t.pnl ?? 0) >= 0 ? "+" : ""}$${(t.pnl ?? 0).toFixed(2)}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-4 py-2 border-t border-border/30 flex items-center justify-between">
          <div className="text-[9px] text-muted-foreground">
            Criado em {new Date(robot.createdAt).toLocaleDateString("pt-BR")}
          </div>
          <button
            onClick={() => handleDelete(robot)}
            className="text-[10px] bg-destructive/10 text-destructive p-1.5 rounded transition-colors hover:bg-destructive hover:text-white"
            title="Apagar Robô"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    );
  };

  const activeRobots   = robots.filter((r) => r.active);
  const inactiveRobots = robots.filter((r) => !r.active);
return (
    <AppShell>
      <div className="p-4 max-w-6xl mx-auto">
        <header className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div className="w-full flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                <Cpu className="h-6 w-6 text-cyan-400" />
                Robôs de Produção
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                Operam de forma autónoma — independente da página activa ou de backtests em curso.
              </p>
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => {
                const socket = io();
                const { robots, demoToken, realToken } = useStore.getState();
                robots.forEach(robot => {
                  if (robot.active) {
                    socket.emit("start-robot", { 
                      config: robot, 
                      token: robot.mode === "real" ? realToken : demoToken 
                    });
                  }
                });
                toast.success("Sincronização com VPS enviada!");
              }}
              className="gap-2 text-[10px]"
            >
              <RotateCcw className="h-3 w-3" /> SINCRONIZAR COM VPS
            </Button>
          </div>
          <div className="flex items-center gap-3 bg-secondary/30 p-2 rounded-sm border border-border">
            <div className="text-right px-2">
              <div className="text-[10px] text-muted-foreground uppercase">Robôs Activos</div>
              <div className="text-lg font-bold text-cyan-400 ticker">{activeRobots.length}</div>
            </div>
            <div className="h-10 w-px bg-border" />
            <div className="text-right px-2">
              <div className="text-[10px] text-muted-foreground uppercase">Total</div>
              <div className="text-lg font-bold text-white ticker">{robots.length}</div>
            </div>
          </div>
        </header>

        {robots.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-center border border-dashed border-border rounded-lg">
            <Cpu className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <h2 className="text-lg font-bold text-muted-foreground mb-2">Sem Robôs</h2>
            <p className="text-sm text-muted-foreground/60 max-w-md">
              Vá à página de{" "}
              <span className="text-primary font-bold">Estratégias</span>, configure os filtros
              desejados e clique em{" "}
              <span className="text-cyan-400 font-bold">"Criar Robô"</span> para colocar uma
              estratégia em produção.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {activeRobots.length > 0 && (
              <div>
                <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Power className="h-3.5 w-3.5 text-cyan-400" /> Robôs Activos ({activeRobots.length})
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {activeRobots.map(renderRobotCard)}
                </div>
              </div>
            )}

            {inactiveRobots.length > 0 && (
              <div>
                <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                  <PowerOff className="h-3.5 w-3.5 text-muted-foreground" /> Robôs Inactivos ({inactiveRobots.length})
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {inactiveRobots.map(renderRobotCard)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
