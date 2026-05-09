import { AppShell } from "@/components/AppShell";
import { type Strategy, type StrategyFilterDef, type StrategyFilterRange } from "@/strategies";
import { Switch } from "@/components/ui/switch";
import { useStore } from "@/lib/store";
import { ASSETS } from "@/lib/market";
import { Bot, Terminal, Shield, Play, Plus, X, AlertTriangle, Trash2, MousePointer2, Pencil, Copy, ChevronDown, ChevronUp, Filter, SlidersHorizontal, ArrowLeftRight, Ban, Repeat2, Check, Cpu } from "lucide-react";
import type { RobotConfig } from "@/lib/store";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const strategyModules = import.meta.glob('@/strategies/*.ts', { eager: true });
const parsedStrategies = Object.entries(strategyModules).map(([path, mod]) => {
  const m = mod as { default?: Strategy };
  const strategy = m.default;
  const fileName = path.split('/').pop()?.replace('.ts', '') || 'unknown';
  
  if (!strategy || !strategy.id || typeof strategy.onTick !== 'function') {
    return { error: true, id: fileName, name: fileName, fileName, description: "Erro: O script não possui exportação padrão ou as funções obrigatórias estão ausentes." };
  }
  return { ...strategy, error: false, fileName };
});

export default function Strategies() {
  const { activeStrategyId, setActiveStrategyId, resetTrades, tradingMode, setAutomationMode, strategyFilters, setStrategyFilter, clearStrategyFilters, strategyInvert, setStrategyInvert, addRobot, risk } = useStore();
  const navigate = useNavigate();
  const [newCode, setNewCode] = useState("");
  const [newId, setNewId] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDocsOpen, setIsDocsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedFilters, setExpandedFilters] = useState<Record<string, boolean>>({});

  // Built-in filter definitions available to ALL strategies
  const BUILTIN_FILTERS: StrategyFilterDef[] = [
    { key: "_asset", label: "Ativos Específicos", type: "multiselect", options: ASSETS.map(a => a.symbol) },
    { key: "_rsi", label: "Faixa RSI", type: "range", defaultMin: 0, defaultMax: 100, step: 5 },
    { key: "_adx", label: "Faixa ADX", type: "range", defaultMin: 0, defaultMax: 100, step: 5 },
    { key: "_macd", label: "MACD Histograma", type: "select", options: ["Bullish (Hist > 0)", "Bearish (Hist < 0)"] },
    { key: "_maTrend", label: "Tendência de Médias", type: "select", options: ["Strong Bullish", "Strong Bearish", "Bullish", "Bearish", "Ranging/Mixed"] },
    { key: "_pattern", label: "Padrão de Velas", type: "multiselect", options: ["Doji", "Hammer/HangingMan", "ShootingStar", "BullishEngulfing", "BearishEngulfing", "BullishHarami", "BearishHarami"] },
    { key: "_expiryCandles", label: "Expiração (candles)", type: "range", defaultMin: 1, defaultMax: 10, step: 1 },
  ];

  /** Auto-generate filter definitions from customStatKeys — data sent to statistics also becomes filterable */
  const getAutoStatFilters = (strategy: Strategy & { error?: boolean }): StrategyFilterDef[] => {
    if (strategy.error || !strategy.customStatKeys) return [];
    const existingCustomKeys = new Set((strategy.customFilterKeys || []).map(f => f.key));
    return strategy.customStatKeys
      .filter(sk => !existingCustomKeys.has(`_stat_${sk.key}`))
      .map(sk => ({
        key: `_stat_${sk.key}`,
        label: `📊 ${sk.label}`,
        type: "multiselect" as const,
        options: [] as string[], // Options are dynamically collected from trades
      }));
  };

  /** Collect unique values for auto-stat filters from existing backtest trades */
  const getStatFilterOptions = (strategyId: string, statKey: string): string[] => {
    const { trades } = useStore.getState();
    const values = new Set<string>();
    trades.filter(t => t.strategyId === strategyId && t.customStats)
      .forEach(t => {
        const rawKey = statKey.replace('_stat_', '');
        const val = t.customStats?.[rawKey];
        if (val !== undefined && val !== null) values.add(String(val));
      });
    return Array.from(values).sort();
  };

  const handleCreateRobot = (strategy: Strategy & { error?: boolean; fileName: string }) => {
    if (strategy.error) return;
    const currentFilters = strategyFilters[strategy.id] || {};
    const isInverted = strategyInvert[strategy.id] || false;
    const robotId = `robot_${strategy.id}_${Date.now()}`;

    // Extract assets from the strategy's _asset filter
    const assetFilter = currentFilters["_asset"];
    let robotAssets: string[] = [];
    if (assetFilter?.enabled && assetFilter.values && assetFilter.values.length > 0) {
      robotAssets = [...assetFilter.values];
    } else {
      // Default: use all available assets from ASSETS list
      robotAssets = ASSETS.map(a => a.symbol);
    }

    const newRobot: RobotConfig = {
      id: robotId,
      name: `${strategy.name} #${Math.floor(Math.random() * 900) + 100}`,
      strategyId: strategy.id,
      strategyFileName: strategy.fileName,
      filters: JSON.parse(JSON.stringify(currentFilters)),
      globalInvert: isInverted,
      active: false,
      mode: "demo",
      timeframe: "1m",
      durationSeconds: 60,
      assets: robotAssets,
      dailyGoal: 50,
      dailyStopLoss: 30,
      stake: risk.defaultStake || 10,
      payout: risk.payout || 87,
      entryAfterWin: false,
      entryAfterLoss: false,
      vdvFilter: false,
      vdvPaused: false,
      vdvWinsCount: 0,
      stakingMode: "fixed",
      sorosMaxStake: 0,
      warmupActive: false,
      currentDailyPnl: 0,
      totalPnl: 0,
      lastResetDate: new Date().toISOString().split("T")[0],
      trades: [],
      createdAt: Date.now(),
    };
    addRobot(newRobot);
    toast.success(`Robô "${newRobot.name}" criado com ${robotAssets.length} ativo(s)! Vá à página de Robôs para configurar e ativar.`);
  };

  useEffect(() => {
    if (!isDialogOpen) {
      setNewCode("");
      setNewId("");
      setIsEditing(false);
      setEditingId(null);
    }
  }, [isDialogOpen]);

  useEffect(() => {
    const match = newCode.match(/id:\s*['"]([^'"]+)['"]/);
    if (match && match[1] && !newId && !isEditing) {
       setNewId(match[1]);
    }
  }, [newCode, newId, isEditing]);

  const handleOpenEdit = async (id: string, copy = false) => {
    try {
      const res = await fetch(`/api/strategies/${id}`);
      if (res.ok) {
        const data = await res.json();
        setNewCode(data.code);
        if (copy) {
          setNewId(id + "_copy");
          setIsEditing(false);
          setEditingId(null);
        } else {
          setNewId(id);
          setIsEditing(true);
          setEditingId(id);
        }
        setIsDialogOpen(true);
      } else {
        toast.error("Estratégia padrão não pode ser editada via UI. Crie uma cópia.");
      }
    } catch (e) {
      toast.error("Erro ao carregar código.");
    }
  };

  const handleCopyToClipboard = async (id: string, code?: string) => {
    try {
      let textToCopy = code;
      if (!textToCopy) {
        const res = await fetch(`/api/strategies/${id}`);
        if (res.ok) {
          const data = await res.json();
          textToCopy = data.code;
        }
      }
      
      if (textToCopy) {
        await navigator.clipboard.writeText(textToCopy);
        toast.success("Código copiado para a área de transferência!");
      } else {
        toast.error("Não foi possível carregar o código para cópia.");
      }
    } catch (e) {
      toast.error("Erro ao copiar código.");
    }
  };

  const handleCreate = async () => {
    if (!newId || !newCode) {
       toast.error("Preencha o ID e o código.");
       return;
    }
    try {
      const res = await fetch("/api/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: newId, code: newCode })
      });
      if (res.ok) {
        toast.success("Estratégia salva com sucesso!");
        setIsDialogOpen(false);
        setNewCode("");
        setNewId("");
        setTimeout(() => window.location.reload(), 500);
      } else {
        const err = await res.json();
        toast.error(err.error || "Erro ao salvar.");
      }
    } catch(e) {
      toast.error("Backend não configurado. Você está no ambiente estático?");
    }
  };

  const handleDelete = async (fileName: string, strategyId: string) => {
    if (!confirm("Tem certeza que deseja apagar esta estratégia?")) return;
    try {
      const res = await fetch(`/api/strategies/${fileName}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Estratégia apagada com sucesso!");
        if (activeStrategyId === strategyId) setActiveStrategyId(null);
        setTimeout(() => window.location.reload(), 500);
      } else {
        const err = await res.json();
        toast.error(err.error || "Erro ao apagar");
      }
    } catch(e) {
      toast.error("Erro ao apagar.");
    }
  };

  const renderStrategyCard = (strategy: Strategy & { error?: boolean, fileName: string }) => {
    const isActive = activeStrategyId === strategy.id;
    const isSemiAuto = strategy.category === "semi-auto";

    if (strategy.error) {
      return (
        <div key={strategy.id} className="panel p-4 flex flex-col gap-3 transition-colors border border-destructive/70 bg-destructive/10 relative rounded-lg">
          <div className="flex items-center justify-between">
            <div className="font-bold text-base text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {strategy.name}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleOpenEdit(strategy.fileName, false)}
                className="text-[10px] bg-muted-foreground/10 text-muted-foreground p-1.5 rounded transition-colors hover:bg-white hover:text-black"
                title="Editar Script"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                onClick={() => handleDelete(strategy.fileName, strategy.id!)}
                className="text-[10px] bg-destructive/10 text-destructive p-1.5 rounded transition-colors hover:bg-destructive hover:text-white"
                title="Apagar"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
          <p className="text-xs text-destructive/80 mb-2">{strategy.description}</p>
        </div>
      );
    }

    const isInverted = strategyInvert[strategy.id] || false;

    return (
      <div 
        key={strategy.id} 
        className={`panel p-4 flex flex-col gap-3 transition-colors ${isActive ? 'border-primary shadow-[0_0_15px_rgba(34,197,94,0.1)]' : ''} ${isInverted ? 'ring-1 ring-amber-500/30' : ''}`}
      >
        <div className="flex items-center justify-between">
          <div className="font-bold text-base text-white flex flex-col">
            {strategy.name}
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-normal">
              {isSemiAuto ? "Semi-Automático" : "100% Automático"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Global Invert Toggle */}
            <button
              onClick={() => setStrategyInvert(strategy.id, !isInverted)}
              className={`p-1.5 rounded border transition-all duration-200 ${
                isInverted 
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.15)]' 
                  : 'bg-background border-border/50 text-muted-foreground hover:text-white hover:border-amber-500/30'
              }`}
              title={isInverted ? "Sinais INVERTIDOS — clique para desativar" : "Clique para INVERTER todos os sinais"}
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
            </button>
            <Switch 
              checked={isActive} 
              onCheckedChange={(v) => {
                if (v) {
                  resetTrades("backtest");
                  setActiveStrategyId(strategy.id);
                  setAutomationMode(isSemiAuto ? "semi-auto" : "auto");
                  toast.success(`Estratégia "${strategy.name}" ativada. Histórico de backtest limpo.`);
                } else {
                  setActiveStrategyId(null);
                  setAutomationMode("manual");
                  toast.warning(`Estratégia "${strategy.name}" desativada.`);
                }
              }} 
            />
          </div>
        </div>

        {isInverted && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-[9px] text-amber-400">
            <ArrowLeftRight className="h-3 w-3" />
            <span className="font-bold uppercase">Inversão Global Ativa</span>
            <span className="text-amber-400/60">— Todos os sinais serão invertidos</span>
          </div>
        )}
        
        <p className="text-xs text-muted-foreground line-clamp-2">
          {strategy.description}
        </p>
        
        <p className="text-[10px] text-muted-foreground">
          ID: <code className="text-primary bg-primary/10 px-1 rounded">{strategy.id}</code>
        </p>

        <div className="flex-1"></div>

        {/* Expandable Filters Panel */}
        <div className="border-t border-border/50 mt-2">
          <button
            onClick={() => setExpandedFilters(prev => ({ ...prev, [strategy.id]: !prev[strategy.id] }))}
            className="w-full flex items-center justify-between py-2 text-[10px] text-muted-foreground hover:text-white transition-colors"
          >
            <span className="flex items-center gap-1.5 font-bold uppercase">
              <SlidersHorizontal className="h-3 w-3" />
              Filtros
              {Object.keys(strategyFilters[strategy.id] || {}).filter(k => strategyFilters[strategy.id]?.[k]?.enabled).length > 0 && (
                <span className="bg-primary/20 text-primary px-1.5 rounded-full text-[9px]">
                  {Object.keys(strategyFilters[strategy.id] || {}).filter(k => strategyFilters[strategy.id]?.[k]?.enabled).length}
                </span>
              )}
            </span>
            {expandedFilters[strategy.id] ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>

          {expandedFilters[strategy.id] && (
            <div className="pb-3 space-y-2">
              {/* Combine built-in + custom + auto-stat filters */}
              {[...BUILTIN_FILTERS, ...(strategy.customFilterKeys || []), ...getAutoStatFilters(strategy)].map(fd => {
                // For auto-stat filters, dynamically inject collected options
                const finalFd = fd.key.startsWith('_stat_') && fd.options?.length === 0
                  ? { ...fd, options: getStatFilterOptions(strategy.id, fd.key) }
                  : fd;
                const filterVal = strategyFilters[strategy.id]?.[finalFd.key];
                const enabled = filterVal?.enabled || false;
                const filterAction = filterVal?.action || "allow";
                const ranges = filterVal?.ranges || [];

                const addRange = () => {
                  const newRange: StrategyFilterRange = {
                    id: crypto.randomUUID(),
                    min: finalFd.defaultMin ?? 0,
                    max: finalFd.defaultMax ?? 100,
                    action: "allow",
                  };
                  setStrategyFilter(strategy.id, finalFd.key, {
                    ...filterVal,
                    enabled: true,
                    ranges: [...ranges, newRange],
                  });
                };

                const updateRange = (rangeId: string, updates: Partial<StrategyFilterRange>) => {
                  setStrategyFilter(strategy.id, finalFd.key, {
                    ...filterVal!,
                    ranges: ranges.map(r => r.id === rangeId ? { ...r, ...updates } : r),
                  });
                };

                const removeRange = (rangeId: string) => {
                  setStrategyFilter(strategy.id, finalFd.key, {
                    ...filterVal!,
                    ranges: ranges.filter(r => r.id !== rangeId),
                  });
                };

                const cycleAction = (current: "allow" | "ignore" | "invert") => {
                  const order: ("allow" | "ignore" | "invert")[] = ["allow", "ignore", "invert"];
                  const idx = order.indexOf(current);
                  return order[(idx + 1) % order.length];
                };

                const actionIcon = (action: "allow" | "ignore" | "invert") => {
                  if (action === "ignore") return <Ban className="h-3 w-3" />;
                  if (action === "invert") return <ArrowLeftRight className="h-3 w-3" />;
                  return <Check className="h-3 w-3" />;
                };

                const actionColor = (action: "allow" | "ignore" | "invert") => {
                  if (action === "ignore") return "bg-red-500/20 border-red-500/50 text-red-400";
                  if (action === "invert") return "bg-amber-500/20 border-amber-500/50 text-amber-400";
                  return "bg-emerald-500/20 border-emerald-500/50 text-emerald-400";
                };

                const actionLabel = (action: "allow" | "ignore" | "invert") => {
                  if (action === "ignore") return "Ignorar";
                  if (action === "invert") return "Inverter";
                  return "Operar";
                };

                return (
                  <div key={finalFd.key} className={`rounded border p-2 transition-colors ${enabled ? "border-primary/50 bg-primary/5" : "border-border/30 bg-[#131722]"}`}>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] font-bold text-muted-foreground uppercase">{finalFd.label}</label>
                      <div className="flex items-center gap-1.5">
                        {/* Per-filter invert toggle (for select/multiselect types) */}
                        {enabled && (finalFd.type === "select" || finalFd.type === "multiselect") && (
                          <button
                            onClick={() => {
                              const nextAction = cycleAction(filterAction);
                              setStrategyFilter(strategy.id, finalFd.key, { ...filterVal!, action: nextAction });
                            }}
                            className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[8px] font-bold uppercase transition-all ${actionColor(filterAction)}`}
                            title={`Ação: ${actionLabel(filterAction)} — clique para alternar`}
                          >
                            {actionIcon(filterAction)}
                            {actionLabel(filterAction)}
                          </button>
                        )}
                        <Switch
                          checked={enabled}
                          onCheckedChange={(v) => {
                            setStrategyFilter(strategy.id, finalFd.key, {
                              ...filterVal,
                              enabled: v,
                              ranges: filterVal?.ranges || (finalFd.type === "range" ? [{
                                id: crypto.randomUUID(),
                                min: finalFd.defaultMin ?? 0,
                                max: finalFd.defaultMax ?? 100,
                                action: "allow" as const,
                              }] : []),
                            });
                          }}
                        />
                      </div>
                    </div>

                    {/* RANGE type — supports multiple ranges */}
                    {enabled && finalFd.type === "range" && (
                      <div className="space-y-1.5 mt-1">
                        {ranges.map((range, idx) => (
                          <div key={range.id} className={`flex items-center gap-1.5 p-1.5 rounded border transition-all ${actionColor(range.action).replace(/\/20/g, '/10').replace(/\/50/g, '/20')}`}>
                            {/* Action toggle button */}
                            <button
                              onClick={() => updateRange(range.id, { action: cycleAction(range.action) })}
                              className={`flex items-center gap-0.5 px-1 py-0.5 rounded border text-[8px] font-bold uppercase transition-all shrink-0 ${actionColor(range.action)}`}
                              title={`${actionLabel(range.action)} — clique para alternar`}
                            >
                              {actionIcon(range.action)}
                              <span className="hidden sm:inline">{actionLabel(range.action)}</span>
                            </button>
                            {/* Min input */}
                            <input
                              type="number"
                              step={finalFd.step || 1}
                              value={range.min}
                              onChange={(e) => updateRange(range.id, { min: Number(e.target.value) })}
                              className="w-14 bg-background border rounded px-1 py-0.5 text-[10px] text-center"
                            />
                            <span className="text-[8px] text-muted-foreground">até</span>
                            {/* Max input */}
                            <input
                              type="number"
                              step={finalFd.step || 1}
                              value={range.max}
                              onChange={(e) => updateRange(range.id, { max: Number(e.target.value) })}
                              className="w-14 bg-background border rounded px-1 py-0.5 text-[10px] text-center"
                            />
                            {/* Remove range button */}
                            {ranges.length > 1 && (
                              <button
                                onClick={() => removeRange(range.id)}
                                className="p-0.5 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                                title="Remover faixa"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        ))}
                        {/* Add range button */}
                        <button
                          onClick={addRange}
                          className="w-full flex items-center justify-center gap-1 py-1 rounded border border-dashed border-border/50 text-[9px] text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
                        >
                          <Plus className="h-3 w-3" />
                          Adicionar Faixa
                        </button>
                      </div>
                    )}

                    {enabled && finalFd.type === "select" && finalFd.options && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {finalFd.options.map(opt => (
                          <button
                            key={opt}
                            onClick={() => setStrategyFilter(strategy.id, finalFd.key, { ...filterVal!, value: filterVal?.value === opt ? undefined : opt })}
                            className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${filterVal?.value === opt ? "bg-primary/20 text-primary border-primary/50" : "bg-background border-border/50 text-muted-foreground hover:text-white"}`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    )}

                    {enabled && finalFd.type === "multiselect" && finalFd.options && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {finalFd.options.map(opt => {
                          const selected = filterVal?.values?.includes(opt) || false;
                          return (
                            <button
                              key={opt}
                              onClick={() => {
                                const current = filterVal?.values || [];
                                const next = selected ? current.filter(v => v !== opt) : [...current, opt];
                                setStrategyFilter(strategy.id, finalFd.key, { ...filterVal!, values: next });
                              }}
                              className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${selected ? "bg-primary/20 text-primary border-primary/50" : "bg-background border-border/50 text-muted-foreground hover:text-white"}`}
                            >
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {Object.keys(strategyFilters[strategy.id] || {}).some(k => strategyFilters[strategy.id]?.[k]?.enabled) && (
                <button
                  onClick={() => clearStrategyFilters(strategy.id)}
                  className="text-[9px] text-destructive hover:underline"
                >
                  Limpar todos os filtros
                </button>
              )}
            </div>
          )}
        </div>

        <div className="pt-2 border-t border-border/50 flex justify-between items-center mt-auto">
           <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
             <Terminal className="h-3 w-3" />
             Pronto
           </div>
           <div className="flex items-center gap-2">
             <button
               onClick={() => handleCreateRobot(strategy)}
               className="text-[10px] bg-cyan-500/10 text-cyan-400 px-2 py-1 rounded flex items-center gap-1 hover:bg-cyan-500 hover:text-white transition-colors border border-cyan-500/30"
               title="Criar Robô de Produção"
             >
               <Cpu className="h-3 w-3" /> Criar Robô
             </button>
             <button
               onClick={() => handleOpenEdit(strategy.fileName, false)}
               className="text-[10px] bg-muted-foreground/10 text-muted-foreground p-1.5 rounded transition-colors hover:bg-white hover:text-black"
               title="Editar Script"
             >
               <Pencil className="h-3 w-3" />
             </button>
              <button
                onClick={() => handleCopyToClipboard(strategy.fileName)}
                className="text-[10px] bg-muted-foreground/10 text-muted-foreground p-1.5 rounded transition-colors hover:bg-white hover:text-black"
                title="Copiar Código"
              >
                <Copy className="h-3 w-3" />
              </button>
              <button
                onClick={() => handleOpenEdit(strategy.fileName, true)}
                className="text-[10px] bg-muted-foreground/10 text-muted-foreground p-1.5 rounded transition-colors hover:bg-white hover:text-black"
                title="Duplicar Script"
              >
                <Repeat2 className="h-3 w-3" />
              </button>
             <button
               onClick={() => handleDelete(strategy.fileName, strategy.id!)}
               className="text-[10px] bg-destructive/10 text-destructive p-1.5 rounded transition-colors hover:bg-destructive hover:text-white"
               title="Apagar"
             >
               <Trash2 className="h-3 w-3" />
             </button>
             {isActive && (
               <button
                 onClick={() => navigate("/trading")}
                 className="text-[10px] bg-primary/20 text-primary px-2 py-1 rounded flex items-center gap-1 hover:bg-primary hover:text-primary-foreground transition-colors"
               >
                 <Play className="h-3 w-3" /> Trading
               </button>
             )}
           </div>
        </div>
      </div>
    );
  };

  const autoStrategies = parsedStrategies.filter(s => s.category !== "semi-auto" && !s.error);
  const semiAutoStrategies = parsedStrategies.filter(s => s.category === "semi-auto" && !s.error);
  const errorStrategies = parsedStrategies.filter(s => s.error);

  return (
    <AppShell>
      <div className="p-4 max-w-5xl mx-auto">
        <div className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Bot className="h-6 w-6 text-primary" />
              Estratégias de Trading
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Ativa robôs 100% automáticos ou ferramentas de auxílio semi-automático.
            </p>
          </div>
          
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setIsDocsOpen(true)} className="gap-2"><Shield className="h-4 w-4" /> Documentação</Button>
            <Button onClick={() => setIsDialogOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> Novo Script</Button>
          </div>

          {/* Documentation Dialog */}
          <Dialog open={isDocsOpen} onOpenChange={setIsDocsOpen}>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto border-border/50">
              <DialogHeader>
                <div className="flex items-center justify-between">
                  <DialogTitle className="flex items-center gap-2"><Shield className="h-5 w-5 text-primary" /> Documentação — Como Criar Estratégias</DialogTitle>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="h-8 gap-2 text-xs" 
                    onClick={() => handleCopyToClipboard("", `import { Strategy, StrategyContext, StrategyResult } from "./index";

const MinhaEstrategia: Strategy = {
  id: "minha_estrategia",        // ID único (será o nome do arquivo)
  name: "Minha Estratégia",      // Nome exibido na UI
  description: "Descrição...",   // Breve descrição
  category: "auto",              // "auto" ou "semi-auto"

  // Opcional: Definir chaves de customStats para painéis na página Stats
  customStatKeys: [
    { key: "metodo", label: "Método Utilizado" },
    { key: "confluencia", label: "Nível de Confluência" }
  ],

  // NOVO: Definir filtros customizados que aparecem na página de Estratégias
  customFilterKeys: [
    { key: "min_confluence", label: "Confluência Mínima", type: "range", defaultMin: 0, defaultMax: 5, step: 1 },
    { key: "method_filter", label: "Método", type: "multiselect", options: ["RSI_Bounce", "SR_Touch", "BB_Squeeze"] },
  ],

  onTick: (ctx: StrategyContext): StrategyResult | null => {
    // Ler filtros configurados pelo utilizador
    const filters = ctx.activeFilters || {};
    
    // Exemplo: verificar filtro de confluência
    // if (filters.min_confluence?.enabled) {
    //   if (confluencia < (filters.min_confluence.min || 0)) return null;
    // }

    return null;
  }
};

export default MinhaEstrategia;`)}
                  >
                    <Copy className="h-3.5 w-3.5" /> Copiar Tudo
                  </Button>
                </div>
              </DialogHeader>
              <div className="prose prose-invert prose-sm max-w-none space-y-4 text-sm mt-4">
                <h3 className="text-primary font-bold text-lg">Estrutura Obrigatória</h3>
                <p className="text-muted-foreground">Cada estratégia é um arquivo <code>.ts</code> na pasta <code>src/strategies/</code>. Deve exportar um objeto <code>default</code> com a seguinte interface:</p>
                <pre className="bg-[#0d1117] p-4 rounded-lg text-xs overflow-x-auto border border-border/50">{`import { Strategy, StrategyContext, StrategyResult } from "./index";

const MinhaEstrategia: Strategy = {
  id: "minha_estrategia",        // ID único (será o nome do arquivo)
  name: "Minha Estratégia",      // Nome exibido na UI
  description: "Descrição...",   // Breve descrição
  category: "auto",              // "auto" ou "semi-auto"

  // Opcional: Definir chaves de customStats para painéis na página Stats
  customStatKeys: [
    { key: "metodo", label: "Método Utilizado" },
    { key: "confluencia", label: "Nível de Confluência" }
  ],

  // NOVO: Definir filtros customizados que aparecem na página de Estratégias
  customFilterKeys: [
    { key: "min_confluence", label: "Confluência Mínima", type: "range", defaultMin: 0, defaultMax: 5, step: 1 },
    { key: "method_filter", label: "Método", type: "multiselect", options: ["RSI_Bounce", "SR_Touch", "BB_Squeeze"] },
  ],

  onTick: (ctx: StrategyContext): StrategyResult | null => {
    // Ler filtros configurados pelo utilizador
    const filters = ctx.activeFilters || {};
    
    // Exemplo: verificar filtro de confluência
    // if (filters.min_confluence?.enabled) {
    //   if (confluencia < (filters.min_confluence.min || 0)) return null;
    // }

    return null;
  }
};

export default MinhaEstrategia;`}</pre>

                <h3 className="text-primary font-bold text-lg mt-6">StrategyContext — Dados Disponíveis</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border border-border/50">
                    <thead className="bg-[#1a1e29]"><tr><th className="p-2 text-left">Campo</th><th className="p-2 text-left">Tipo</th><th className="p-2 text-left">Descrição</th></tr></thead>
                    <tbody className="divide-y divide-border/30">
                      <tr><td className="p-2"><code>asset</code></td><td className="p-2">string</td><td className="p-2">Símbolo do ativo (ex: "R_100")</td></tr>
                      <tr><td className="p-2"><code>history</code></td><td className="p-2">Candle[]</td><td className="p-2">Array de velas com {"{t, o, h, l, c}"}</td></tr>
                      <tr><td className="p-2"><code>lastPrice</code></td><td className="p-2">number</td><td className="p-2">Preço atual (close da última vela)</td></tr>
                      <tr><td className="p-2"><code>balance</code></td><td className="p-2">number</td><td className="p-2">Saldo atual da conta</td></tr>
                      <tr><td className="p-2"><code>tradingMode</code></td><td className="p-2">string</td><td className="p-2">"real", "demo" ou "backtest"</td></tr>
                      <tr><td className="p-2"><code>isBacktest</code></td><td className="p-2">boolean</td><td className="p-2">true se estiver em modo backtest</td></tr>
                      <tr><td className="p-2"><code>intervalMs</code></td><td className="p-2">number</td><td className="p-2">Duração da vela em ms (60000=1m, 300000=5m)</td></tr>
                      <tr><td className="p-2"><code>candleTimeRemainingMs</code></td><td className="p-2">number</td><td className="p-2">Tempo restante até a vela atual fechar (ms). No backtest = 0</td></tr>
                      <tr><td className="p-2"><code>hasOpenTrade</code></td><td className="p-2">boolean</td><td className="p-2">Se já existe um trade aberto neste ativo</td></tr>
                      <tr><td className="p-2"><code>srLines</code></td><td className="p-2">array</td><td className="p-2">Linhas de suporte/resistência do ativo</td></tr>
                      <tr><td className="p-2"><code>srZones</code></td><td className="p-2">array</td><td className="p-2">Zonas de compra/venda do ativo</td></tr>
                      <tr><td className="p-2"><code>activeFilters</code></td><td className="p-2">Record</td><td className="p-2">Filtros configurados pelo utilizador na página de Estratégias. Cada chave tem {"{enabled, min?, max?, value?, values?}"}</td></tr>
                    </tbody>
                  </table>
                </div>

                <h3 className="text-primary font-bold text-lg mt-6">Indicadores Disponíveis</h3>
                <pre className="bg-[#0d1117] p-4 rounded-lg text-xs overflow-x-auto border border-border/50">{`// RSI (Relative Strength Index)
const rsiArr = ctx.indicators.rsi(14);
const lastRsi = rsiArr[rsiArr.length - 1];

// SMA (Simple Moving Average)
const sma20 = ctx.indicators.sma(20);

// EMA (Exponential Moving Average)
const ema9 = ctx.indicators.ema(9);

// Bollinger Bands
const bb = ctx.indicators.bollinger(20, 2);
const upperBB = bb.upper[bb.upper.length - 1];
const lowerBB = bb.lower[bb.lower.length - 1];

// ADX (Average Directional Index)
const adxData = ctx.indicators.adx(14);
const lastAdx = adxData.adx[adxData.adx.length - 1];
const plusDi = adxData.plusDi[adxData.plusDi.length - 1];
const minusDi = adxData.minusDi[adxData.minusDi.length - 1];

// MACD
const macdData = ctx.indicators.macd(12, 26, 9);
const macdLine = macdData.macd[macdData.macd.length - 1];
const signalLine = macdData.signal[macdData.signal.length - 1];
const histogram = macdData.histogram[macdData.histogram.length - 1];`}</pre>

                <h3 className="text-primary font-bold text-lg mt-6">StrategyResult — Retorno do Sinal</h3>
                <pre className="bg-[#0d1117] p-4 rounded-lg text-xs overflow-x-auto border border-border/50">{`return {
  action: "CALL",          // "CALL" | "PUT" | "BUY" | "SELL" | null
  duration: 60,            // Duração em segundos (default: 60)
  expiryCandles: 1,        // Quantas velas até expirar (backtest)
  stake: 10,               // Valor da aposta (opcional, usa o padrão se omitido)

  // NOVO: Esperar a vela fechar antes de entrar (para live/demo)
  waitForCandleClose: true,

  // NOVO: Estatísticas customizadas por trade
  customStats: {
    metodo: "Bounce_Suporte",
    confluencia: 3,
    sinal_forte: true
  }
};`}</pre>

                <h3 className="text-primary font-bold text-lg mt-6">Custom Stats — Dados Extras nas Estatísticas</h3>
                <p className="text-muted-foreground">Cada chave no objeto <code>customStats</code> cria automaticamente um painel na página de Estatísticas. Isto permite rastrear métricas personalizadas da sua estratégia.</p>
                <pre className="bg-[#0d1117] p-4 rounded-lg text-xs overflow-x-auto border border-border/50">{`// Exemplo: Estratégia com 2 métodos internos
onTick: (ctx) => {
  const rsi = ctx.indicators.rsi(14);
  const lastRsi = rsi[rsi.length - 1];
  const sma20 = ctx.indicators.sma(20);
  const lastSma = sma20[sma20.length - 1];

  // Método 1: RSI Oversold
  if (lastRsi < 30 && ctx.lastPrice > lastSma) {
    return {
      action: "CALL",
      expiryCandles: 1,
      customStats: { metodo: "RSI_Oversold", filtro_ma: "Acima_SMA20" }
    };
  }

  // Método 2: Bounce no Suporte
  const nearSupport = ctx.srLines.some(l =>
    l.type === "support" && Math.abs(ctx.lastPrice - l.price) / l.price < 0.001
  );
  if (nearSupport) {
    return {
      action: "CALL",
      expiryCandles: 2,
      customStats: { metodo: "Bounce_Suporte", filtro_ma: "N/A" }
    };
  }

  return null;
}`}</pre>

                <h3 className="text-primary font-bold text-lg mt-6">Sincronização com Velas (Live/Demo)</h3>
                <p className="text-muted-foreground">Para entrar apenas quando a vela atual fechar, use <code>waitForCandleClose: true</code>. O sistema irá agendar a ordem para logo após o fechamento da vela.</p>
                <pre className="bg-[#0d1117] p-4 rounded-lg text-xs overflow-x-auto border border-border/50">{`// Verificar se a vela atual tocou no suporte
// Esperar fechar antes de entrar
if (tocouNoSuporte) {
  return {
    action: "CALL",
    duration: -1,  // -1 = expira no fim da próxima vela
    waitForCandleClose: true,  // Espera a vela fechar
    customStats: { metodo: "SR_Touch" }
  };
}`}</pre>

                <h3 className="text-primary font-bold text-lg mt-6">Boas Práticas</h3>
                <ul className="list-disc list-inside text-muted-foreground space-y-1">
                  <li>Sempre verificar <code>ctx.hasOpenTrade</code> para evitar múltiplas ordens no mesmo ativo</li>
                  <li>Verificar <code>ctx.history.length</code> mínimo antes de usar indicadores (ex: RSI precisa de pelo menos 15 velas)</li>
                  <li>Usar <code>ctx.isBacktest</code> para lógica específica de backtest vs live</li>
                  <li>Usar <code>customStats</code> para rastrear qual "sub-método" da estratégia gerou cada trade</li>
                  <li>O campo <code>expiryCandles</code> controla quantas velas o trade dura no backtest</li>
                  <li>Use <code>duration: -1</code> para expirar no fim da vela atual</li>
                </ul>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDocsOpen(false)}>Fechar</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

             <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                 <DialogContent className="max-w-4xl border-border/50">
                <DialogHeader>
                   <DialogTitle>{isEditing ? `Editando: ${editingId}` : "Novo Script"}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="grid gap-1.5">
                    <label className="text-xs text-muted-foreground uppercase font-bold">ID da Estratégia (nome do arquivo)</label>
                    <input 
                      className="w-full bg-background border rounded px-3 py-2 text-sm" 
                      placeholder="ID (ex: minha_estratégia)" 
                      value={newId} 
                      onChange={e => setNewId(e.target.value)} 
                      disabled={isEditing}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <label className="text-xs text-muted-foreground uppercase font-bold">Código TypeScript</label>
                    <Textarea className="font-mono h-[50vh] text-xs bg-background" value={newCode} onChange={e => setNewCode(e.target.value)} placeholder="export default { id: '...', name: '...', category: 'auto', ... }" />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancelar</Button>
                  <Button onClick={handleCreate}>{isEditing ? "Atualizar" : "Salvar"}</Button>
                </DialogFooter>
             </DialogContent>
          </Dialog>
        </div>

        <Tabs defaultValue="auto" className="space-y-6">
          <TabsList className="bg-card w-full justify-start border-b border-border rounded-none h-auto p-0 mb-4 bg-transparent">
            <TabsTrigger value="auto" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 py-3">
              <Bot className="h-4 w-4 mr-2" />
              100% Automático
            </TabsTrigger>
            <TabsTrigger value="semi-auto" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 py-3">
              <MousePointer2 className="h-4 w-4 mr-2" />
              Semi-Automático
            </TabsTrigger>
          </TabsList>

          <TabsContent value="auto" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 outline-none">
            {autoStrategies.map(renderStrategyCard)}
            {autoStrategies.length === 0 && (
              <div className="col-span-full py-20 text-center border border-dashed border-border rounded-lg text-muted-foreground/50">
                Sem estratégias automáticas disponíveis.
              </div>
            )}
          </TabsContent>

          <TabsContent value="semi-auto" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 outline-none">
            {semiAutoStrategies.map(renderStrategyCard)}
            {semiAutoStrategies.length === 0 && (
              <div className="col-span-full py-20 text-center border border-dashed border-border rounded-lg text-muted-foreground/50">
                Sem estratégias semi-automáticas. Ative a estratégia de S/R.
              </div>
            )}
          </TabsContent>
        </Tabs>

        {errorStrategies.length > 0 && (
          <div className="mt-8">
            <h2 className="text-sm font-semibold text-muted-foreground mb-4 uppercase tracking-wider flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Erros de Compilação
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {errorStrategies.map(renderStrategyCard)}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
