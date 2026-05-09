import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useStore } from "@/lib/store";
import { toast } from "sonner";
import { Eye, EyeOff, Save, MonitorPlay, Globe, BrainCircuit, Hand, Bot } from "lucide-react";
import { useState } from "react";

function mapRedisKeyToSymbol(redisAssetPart: string): string {
  // Map 1HZ10V to R_10S, etc
  const match1HZ = redisAssetPart.match(/^1HZ(\d+)V$/i);
  if (match1HZ) {
    return `R_${match1HZ[1]}S`;
  }
  
  // Normalize R25S, R_25_S to R_25S
  const matchRS = redisAssetPart.match(/^R_?(\d+)_?S$/i);
  if (matchRS) {
    return `R_${matchRS[1]}S`;
  }

  // Normalize R10, r10 to R_10
  const matchR = redisAssetPart.match(/^R_?(\d+)$/i);
  if (matchR) {
    return `R_${matchR[1]}`;
  }
  
  return redisAssetPart;
}

export default function Settings() {
  const {
    demoToken, realToken, setDemoToken, setRealToken,
    tradingMode, setTradingMode,
    marketType, setMarketType,
    automationMode, setAutomationMode,
    account, setAccount,
    risk, setRisk, resetTrades,
    forex, setForex
  } = useStore();
  const [showD, setShowD] = useState(false);
  const [showR, setShowR] = useState(false);

  return (
    <AppShell>
      <div className="p-3 grid lg:grid-cols-3 gap-3">
        {/* Trading Mode */}
        <div className="panel p-4 space-y-3">
          <div className="text-xs uppercase text-primary tracking-widest">Modo de Trading</div>
          <p className="text-[11px] text-muted-foreground">Escolhe o ambiente de operação. A interface de trading adapta-se automaticamente.</p>

          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => setTradingMode("demo")}
              className={`py-3 text-xs border rounded-sm flex flex-col items-center gap-1 ${tradingMode === "demo" ? "border-primary text-primary bg-secondary/40" : "border-border text-muted-foreground hover:bg-secondary/20"}`}
            >
              <MonitorPlay className="h-4 w-4" /> DEMO
            </button>
            <button
              onClick={() => setTradingMode("real")}
              className={`py-3 text-xs border rounded-sm flex flex-col items-center gap-1 ${tradingMode === "real" ? "border-bear text-bear bg-bear/10" : "border-border text-muted-foreground hover:bg-secondary/20"}`}
            >
              <Globe className="h-4 w-4" /> REAL
            </button>
            <button
              onClick={() => setTradingMode("backtest")}
              className={`py-3 text-xs border rounded-sm flex flex-col items-center gap-1 ${tradingMode === "backtest" ? "border-warning text-warning bg-warning/10" : "border-border text-muted-foreground hover:bg-secondary/20"}`}
            >
              <BrainCircuit className="h-4 w-4" /> BACKTEST
            </button>
          </div>

          <div className="text-[10px] text-muted-foreground border border-border/60 rounded-sm p-2">
            {tradingMode === "demo" && "🎮 Modo Demo: Opera com saldo virtual. Ideal para testar estratégias sem risco."}
            {tradingMode === "real" && "💰 Modo Real: Opera com fundos reais. Usa o token da conta real configurado abaixo."}
            {tradingMode === "backtest" && "📊 Modo Backtest: Simula operações em dados históricos para validar estratégias."}
          </div>
        </div>

        {/* Market Type & Automation */}
        <div className="panel p-4 space-y-3">
          <div className="text-xs uppercase text-primary tracking-widest">Mercado & Automação</div>

          <div>
            <label className="text-[10px] text-muted-foreground">Tipo de Mercado</label>
            <div className="grid grid-cols-2 gap-1 mt-1">
              <button onClick={() => setMarketType("binary")} className={`py-2 text-xs border rounded-sm ${marketType === "binary" ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>Opções Binárias</button>
              <button onClick={() => setMarketType("forex")} className={`py-2 text-xs border rounded-sm ${marketType === "forex" ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>Forex</button>
            </div>
          </div>

          <div>
            <label className="text-[10px] text-muted-foreground">Modo de Automação</label>
            <div className="grid grid-cols-3 gap-1 mt-1">
              <button onClick={() => setAutomationMode("manual")} className={`py-2 text-[10px] border rounded-sm flex items-center justify-center gap-1 ${automationMode === "manual" ? "border-primary text-primary" : "border-border text-muted-foreground"}`}><Hand className="h-3 w-3" /> Manual</button>
              <button onClick={() => setAutomationMode("semi-auto")} className={`py-2 text-[10px] border rounded-sm flex items-center justify-center gap-1 ${automationMode === "semi-auto" ? "border-warning text-warning" : "border-border text-muted-foreground"}`}><BrainCircuit className="h-3 w-3" /> Semi-Auto</button>
              <button onClick={() => setAutomationMode("auto")} className={`py-2 text-[10px] border rounded-sm flex items-center justify-center gap-1 ${automationMode === "auto" ? "border-bull text-bull" : "border-border text-muted-foreground"}`}><Bot className="h-3 w-3" /> Auto</button>
            </div>
          </div>

          {automationMode === "semi-auto" && (
            <div className="text-[10px] text-warning border border-warning/30 rounded-sm p-2">
              ⚡ <strong>Semi-Auto:</strong> O script opera automaticamente quando o preço toca nas zonas de Suporte/Resistência que definires no gráfico. As zonas S/R são guardadas e respeitadas pelo algoritmo.
            </div>
          )}
        </div>

        {/* Tokens */}
        <div className="panel p-4 space-y-3">
          <div className="text-xs uppercase text-primary tracking-widest">Tokens Deriv API</div>
          <p className="text-[11px] text-muted-foreground">Gere os tokens em app.deriv.com → API Token. Eles ficam armazenados no teu navegador.</p>

          <div>
            <label className="text-[10px] text-muted-foreground">Token Conta DEMO</label>
            <div className="flex gap-1">
              <Input type={showD ? "text" : "password"} value={demoToken} onChange={(e) => setDemoToken(e.target.value)} placeholder="abcd1234..." className="h-9 ticker" />
              <Button variant="outline" size="icon" onClick={() => setShowD((s) => !s)}>{showD ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
            </div>
          </div>

          <div>
            <label className="text-[10px] text-muted-foreground">Token Conta REAL</label>
            <div className="flex gap-1">
              <Input type={showR ? "text" : "password"} value={realToken} onChange={(e) => setRealToken(e.target.value)} placeholder="xyz9876..." className="h-9 ticker" />
              <Button variant="outline" size="icon" onClick={() => setShowR((s) => !s)}>{showR ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
            </div>
          </div>

          <div>
            <label className="text-[10px] text-muted-foreground">Conta ativa (legado)</label>
            <div className="grid grid-cols-2 gap-1 mt-1">
              <button onClick={() => setAccount("demo")} className={`py-2 text-xs border rounded-sm ${account === "demo" ? "border-primary text-primary" : "border-border"}`}>DEMO</button>
              <button onClick={() => setAccount("real")} className={`py-2 text-xs border rounded-sm ${account === "real" ? "border-bear text-bear" : "border-border"}`}>REAL</button>
            </div>
          </div>

          <Button className="w-full" onClick={() => toast.success("Tokens salvos localmente")}> <Save className="h-4 w-4 mr-1" /> Salvar tokens</Button>
        </div>

        {/* Forex Settings */}
        <div className="panel p-4 space-y-3">
          <div className="flex items-center justify-between">
             <div className="text-xs uppercase text-primary tracking-widest">Configurações Forex</div>
             <Switch checked={forex.enabled} onCheckedChange={(v) => setForex({ enabled: v })} />
          </div>
          <p className="text-[11px] text-muted-foreground">Parâmetros aplicados quando o tipo de mercado está em Forex.</p>

          <div className={`grid grid-cols-2 gap-2 opacity-${forex.enabled ? '100' : '50'} transition-opacity pointer-events-${forex.enabled ? 'auto' : 'none'}`}>
            <Field label="Lot Size padrão" value={forex.lotSize} step={0.01} onChange={(v) => setForex({ lotSize: v })} />
            <Field label="Alavancagem" value={forex.leverage} onChange={(v) => setForex({ leverage: v })} />
            <Field label="Stop Loss (pips)" value={forex.stopLossPips} onChange={(v) => setForex({ stopLossPips: v })} />
            <Field label="Take Profit (pips)" value={forex.takeProfitPips} onChange={(v) => setForex({ takeProfitPips: v })} />
            <Field label="Spread (pips)" value={forex.spread} step={0.1} onChange={(v) => setForex({ spread: v })} />
          </div>
        </div>

        {/* Redis Settings */}
        <div className="panel p-4 space-y-3">
          <div className="text-xs uppercase text-primary tracking-widest">Fonte de Dados (Redis/Backtest)</div>
          <p className="text-[11px] text-muted-foreground">Configurações para buscar velas históricas ou simuladas.</p>
          
          <div className="space-y-2">
            <div>
              <label className="text-[10px] text-muted-foreground">Host do Redis</label>
              <Input value={useStore(s => s.redis.host)} onChange={(e) => useStore.getState().setRedis({ host: e.target.value })} className="h-8 text-xs ticker" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Porta</label>
              <Input value={useStore(s => s.redis.port)} onChange={(e) => useStore.getState().setRedis({ port: e.target.value })} className="h-8 text-xs ticker" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Chave de Velas (Ex: backtestvelas:R_10:60)</label>
              <Input value={useStore(s => s.redis.key)} onChange={(e) => useStore.getState().setRedis({ key: e.target.value })} className="h-8 text-xs ticker" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Senha (Password)</label>
              <Input type="password" value={useStore(s => s.redis.password || "")} onChange={(e) => useStore.getState().setRedis({ password: e.target.value })} className="h-8 text-xs ticker" />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button onClick={async () => {
              const { redis } = useStore.getState();
              const assetPart = redis.key.split(":")[1];
              const toastId = toast.loading("Buscando...");
              const res = await fetch("/api/redis/fetch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...redis, asset: assetPart })
              });
              const json = await res.json();
              if (json.success) {
                toast.success("Velas carregadas!", { id: toastId });
                const mappedCandles = (json.data.candles as any[]).map((c: any) => ({ o: c.open, h: c.high, l: c.low, c: c.close, t: c.epoch * 1000 }));
                const symbol = mapRedisKeyToSymbol(assetPart);
                useStore.getState().setCustomBacktestData(symbol, mappedCandles);
              } else {
                toast.error("Erro: " + json.error, { id: toastId });
              }
            }} className="text-xs w-full">Buscar Ativo</Button>
            
            <Button onClick={async () => {
              const { redis } = useStore.getState();
              const toastId = toast.loading("Buscando tudo...");
              const res = await fetch("/api/redis/fetch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...redis, asset: "ALL" })
              });
              const json = await res.json();
              if (json.success) {
                toast.success("Todos os ativos carregados!", { id: toastId });
                 Object.entries(json.data).forEach(([key, val]) => {
                     const assetPart = key.split(":")[1];
                     const symbol = mapRedisKeyToSymbol(assetPart);
                     const mapped = ((val as any).candles as any[]).map((c: any) => ({ o: c.open, h: c.high, l: c.low, c: c.close, t: c.epoch * 1000 }));
                     useStore.getState().setCustomBacktestData(symbol, mapped);
                  });
              } else {
                toast.error("Erro: " + json.error, { id: toastId });
              }
            }} className="text-xs w-full bg-secondary text-secondary-foreground hover:bg-secondary/80">Buscar Todos</Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Field({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div>
      <label className="text-[10px] text-muted-foreground">{label}</label>
      <Input type="number" step={step} value={value} onChange={(e) => onChange(+e.target.value)} className="h-9 text-xs ticker" />
    </div>
  );
}
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span>{label}</span>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}
