import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStore } from "@/lib/store";
import { toast } from "sonner";
import { 
  ShieldCheck, 
  Target, 
  TrendingUp, 
  TrendingDown, 
  BarChart3, 
  Settings2, 
  Info,
  Timer,
  Zap,
  Activity,
  Waves,
  History,
  RotateCcw
} from "lucide-react";

export default function Management() {
  const { management, setManagement, resetDailyPnl, balance } = useStore();

  const handleToggle = (key: keyof typeof management) => {
    setManagement({ [key]: !management[key] });
  };

  const handleChange = (key: keyof typeof management, value: any) => {
    setManagement({ [key]: value });
  };

  return (
    <AppShell>
      <div className="p-4 max-w-6xl mx-auto space-y-6">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight glow-text">GESTÃO DE BANCA</h1>
            <p className="text-xs text-muted-foreground">Configura os limites de perda, metas e filtros operacionais.</p>
          </div>
          <div className="flex items-center gap-2 bg-secondary/30 p-2 rounded-sm border border-border">
            <div className="text-right px-2">
              <div className="text-[10px] text-muted-foreground uppercase">Resultado Hoje</div>
              <div className={`text-lg font-bold ticker ${management.currentDailyPnl >= 0 ? "text-bull" : "text-bear"}`}>
                {management.currentDailyPnl >= 0 ? "+" : ""}${management.currentDailyPnl.toFixed(2)}
              </div>
            </div>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => { resetDailyPnl(); toast.success("Gestão diária reiniciada"); }}>
              <RotateCcw className="h-4 w-4" />
            </Button>
            <div className="h-10 w-px bg-border mx-1" />
            <div className="flex items-center gap-2 ml-2">
              <span className="text-[10px] uppercase font-bold text-muted-foreground">Ativar Gestão</span>
              <Switch checked={management.enabled} onCheckedChange={(v) => handleChange("enabled", v)} />
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Daily Goals & Limits */}
          <div className="lg:col-span-2 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="panel p-4 space-y-4 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-2 opacity-10">
                  <Target className="h-12 w-12" />
                </div>
                <div className="flex items-center gap-2 text-primary font-bold text-xs uppercase tracking-widest">
                  <Target className="h-3 w-3" /> Meta de Gain Diário
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-muted-foreground">Meta Atual</span>
                    <span className="text-bull font-bold">${management.dailyGoal}</span>
                  </div>
                  <Slider 
                    value={[management.dailyGoal]} 
                    max={500} 
                    step={5} 
                    onValueChange={([v]) => handleChange("dailyGoal", v)} 
                  />
                  <div className="flex items-center gap-2 mt-4">
                    <Input 
                      type="number" 
                      value={management.dailyGoal} 
                      onChange={(e) => handleChange("dailyGoal", +e.target.value)}
                      className="h-9 ticker text-center" 
                    />
                    <span className="text-xs text-muted-foreground">USD</span>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">O robô irá parar automaticamente ao atingir este lucro nas últimas 24h.</p>
              </div>

              <div className="panel p-4 space-y-4 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-2 opacity-10 text-bear">
                  <ShieldCheck className="h-12 w-12" />
                </div>
                <div className="flex items-center gap-2 text-bear font-bold text-xs uppercase tracking-widest">
                  <ShieldCheck className="h-3 w-3" /> Stop Loss Diário
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-muted-foreground">Stop Atual</span>
                    <span className="text-bear font-bold">${management.dailyStopLoss}</span>
                  </div>
                  <Slider 
                    value={[management.dailyStopLoss]} 
                    max={300} 
                    step={5} 
                    onValueChange={([v]) => handleChange("dailyStopLoss", v)} 
                  />
                  <div className="flex items-center gap-2 mt-4">
                    <Input 
                      type="number" 
                      value={management.dailyStopLoss} 
                      onChange={(e) => handleChange("dailyStopLoss", +e.target.value)}
                      className="h-9 ticker text-center text-bear border-bear/30" 
                    />
                    <span className="text-xs text-muted-foreground">USD</span>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">Proteção de capital: Para as operações se o prejuízo atingir este valor.</p>
              </div>
            </div>

            <div className="panel p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-border/40 pb-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest">
                  <Zap className="h-3.5 w-3.5 text-warning" /> Sequência de Entradas
                </div>
                <Info className="h-3 w-3 text-muted-foreground cursor-help" />
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <div className="text-xs font-medium">Entrar após Vitória</div>
                      <div className="text-[10px] text-muted-foreground">Aguardar um Win para iniciar ciclo.</div>
                    </div>
                    <Switch checked={management.entryAfterWin} onCheckedChange={(v) => handleChange("entryAfterWin", v)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <div className="text-xs font-medium">Entrar após Derrota</div>
                      <div className="text-[10px] text-muted-foreground">Aguardar um Loss para iniciar ciclo.</div>
                    </div>
                    <Switch checked={management.entryAfterLoss} onCheckedChange={(v) => handleChange("entryAfterLoss", v)} />
                  </div>
                </div>

                <div className="bg-secondary/20 border border-border p-3 rounded-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <History className="h-3.5 w-3.5 text-primary" />
                      <div className="text-xs font-bold">FILTRO VDV</div>
                    </div>
                    <Switch checked={management.vdvFilter} onCheckedChange={(v) => handleChange("vdvFilter", v)} />
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Pausa as entradas se detectar o padrão <span className="text-bull">W</span>-<span className="text-bear">L</span>-<span className="text-bull">W</span>-<span className="text-bear">L</span> que indica acumulação de perdas. 
                  </p>
                  <div className="flex items-center gap-2">
                    <div className={`h-1.5 flex-1 rounded-full ${management.vdvPaused ? "bg-bear animate-pulse" : "bg-border"}`} />
                    <span className="text-[9px] uppercase font-bold">{management.vdvPaused ? "Entradas Pausadas" : "Ativo"}</span>
                  </div>
                  {management.vdvPaused && (
                    <div className="text-[10px] text-warning flex items-center gap-1">
                      <RotateCcw className="h-3 w-3" /> Reinicia após 2 vitórias consecutivas.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Operational Filters Column */}
          <div className="space-y-4">
            <div className="panel p-4 space-y-4 h-full">
              <div className="text-xs font-bold uppercase tracking-widest border-b border-border/40 pb-2 flex items-center gap-2">
                <Settings2 className="h-3.5 w-3.5 text-primary" /> Filtros de Indicadores
              </div>

              {/* RSI Filter */}
              <div className="space-y-3 p-3 rounded-sm border border-border/40 bg-secondary/10">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-bold flex items-center gap-2 uppercase">
                    <Activity className="h-3 w-3" /> RSI Filter
                  </div>
                  <Switch checked={management.rsiFilter} onCheckedChange={(v) => handleChange("rsiFilter", v)} />
                </div>
                <div className={`space-y-3 transition-opacity ${management.rsiFilter ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[9px] text-muted-foreground font-bold">Sobrevenda</label>
                      <Input type="number" value={management.rsiOversold} onChange={(e) => handleChange("rsiOversold", +e.target.value)} className="h-8 text-xs ticker" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] text-muted-foreground font-bold">Sobrecompra</label>
                      <Input type="number" value={management.rsiOverbought} onChange={(e) => handleChange("rsiOverbought", +e.target.value)} className="h-8 text-xs ticker" />
                    </div>
                  </div>
                </div>
              </div>

              {/* MA Filter */}
              <div className="space-y-3 p-3 rounded-sm border border-border/40 bg-secondary/10">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-bold flex items-center gap-2 uppercase">
                    <Waves className="h-3 w-3" /> Média Móvel
                  </div>
                  <Switch checked={management.maFilter} onCheckedChange={(v) => handleChange("maFilter", v)} />
                </div>
                <div className={`space-y-3 transition-opacity ${management.maFilter ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
                  <div className="grid grid-cols-2 gap-2">
                    <Button 
                      variant={management.maType === "sma" ? "default" : "outline"}
                      className="h-7 text-[10px]"
                      onClick={() => handleChange("maType", "sma")}
                    >SMA</Button>
                    <Button 
                      variant={management.maType === "ema" ? "default" : "outline"}
                      className="h-7 text-[10px]"
                      onClick={() => handleChange("maType", "ema")}
                    >EMA</Button>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-muted-foreground font-bold">Período</label>
                    <Input type="number" value={management.maPeriod} onChange={(e) => handleChange("maPeriod", +e.target.value)} className="h-8 text-xs ticker" />
                  </div>
                </div>
              </div>

              {/* Cross Filter */}
              <div className="space-y-3 p-3 rounded-sm border border-border/40 bg-secondary/10">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-bold flex items-center gap-2 uppercase">
                    <Timer className="h-3 w-3" /> Cruzamento MAC
                  </div>
                  <Switch checked={management.macFilter} onCheckedChange={(v) => handleChange("macFilter", v)} />
                </div>
                <div className={`grid grid-cols-2 gap-2 transition-opacity ${management.macFilter ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
                  <div className="space-y-1">
                    <label className="text-[9px] text-muted-foreground font-bold">Curta</label>
                    <Input type="number" value={management.macShortPeriod} onChange={(e) => handleChange("macShortPeriod", +e.target.value)} className="h-8 text-xs ticker" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-muted-foreground font-bold">Longa</label>
                    <Input type="number" value={management.macLongPeriod} onChange={(e) => handleChange("macLongPeriod", +e.target.value)} className="h-8 text-xs ticker" />
                  </div>
                </div>
              </div>

              {/* ADX Filter */}
              <div className="space-y-3 p-3 rounded-sm border border-border/40 bg-secondary/10">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-bold flex items-center gap-2 uppercase">
                    <BarChart3 className="h-3 w-3" /> ADX Trend
                  </div>
                  <Switch checked={management.adxFilter} onCheckedChange={(v) => handleChange("adxFilter", v)} />
                </div>
                <div className={`space-y-1 transition-opacity ${management.adxFilter ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
                  <label className="text-[9px] text-muted-foreground font-bold">Força Mínima (ADX &gt; X)</label>
                  <Input type="number" value={management.adxThreshold} onChange={(e) => handleChange("adxThreshold", +e.target.value)} className="h-8 text-xs ticker" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="panel p-4 flex items-center justify-between bg-primary/5 border-primary/20">
          <div className="flex items-center gap-3">
             <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
                <Activity className="h-5 w-5 text-primary" />
             </div>
             <div>
                <div className="text-xs font-bold uppercase tracking-widest">Resumo Operacional</div>
                <div className="text-[10px] text-muted-foreground">A estratégia em ação terá prioridade sobre os filtros de gestão.</div>
             </div>
          </div>
          <Button onClick={() => { toast.success("Configurações de gestão aplicadas!"); }} className="glow">
             APLICAR CONFIGURAÇÕES
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
