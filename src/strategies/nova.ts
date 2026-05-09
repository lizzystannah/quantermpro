import { Strategy, StrategyContext, StrategyResult } from "./index";

// ─────────────────────────────────────────────────────────────────────────────
// FAIXAS RSI — 6 zonas classificadas
// ─────────────────────────────────────────────────────────────────────────────
// Zona 1: 0  – 20  → Sobrevenda Extrema
// Zona 2: 20 – 30  → Sobrevenda
// Zona 3: 30 – 45  → Zona Baixa
// Zona 4: 45 – 55  → Neutro
// Zona 5: 55 – 70  → Zona Alta
// Zona 6: 70 – 80  → Sobrecompra
// Zona 7: 80 – 100 → Sobrecompra Extrema

function classifyRSI(rsi: number): string {
  if (rsi <= 20)             return "Sobrevenda Extrema (0–20)";
  if (rsi > 20 && rsi <= 30) return "Sobrevenda (20–30)";
  if (rsi > 30 && rsi <= 45) return "Zona Baixa (30–45)";
  if (rsi > 45 && rsi <= 55) return "Neutro (45–55)";
  if (rsi > 55 && rsi <= 70) return "Zona Alta (55–70)";
  if (rsi > 70 && rsi <= 80) return "Sobrecompra (70–80)";
  return                            "Sobrecompra Extrema (80–100)";
}

// ─────────────────────────────────────────────────────────────────────────────
// FAIXAS CONVERGÊNCIA RSI — 6 zonas classificadas
// ─────────────────────────────────────────────────────────────────────────────
// Diferença = RSI_M1 - RSI_M5
//
// Zona 1: diff ≤ -15       → Divergência Forte Baixa
// Zona 2: -15 < diff ≤ -6  → Divergência Moderada Baixa
// Zona 3: -6  < diff ≤ -2  → Leve Divergência Baixa
// Zona 4: -2  < diff <  2  → Convergente
// Zona 5:  2  ≤ diff <  6  → Leve Divergência Alta
// Zona 6:  6  ≤ diff <  15 → Divergência Moderada Alta
// Zona 7:  diff ≥ 15       → Divergência Forte Alta

function classifyRSIConvergencia(rsiM5: number, rsiM1: number): string {
  const diff = parseFloat((rsiM1 - rsiM5).toFixed(2));

  if (diff <= -15)              return `Divergência Forte Baixa (≤ -15) [${diff}]`;
  if (diff > -15 && diff <= -6) return `Divergência Moderada Baixa (-15 a -6) [${diff}]`;
  if (diff > -6  && diff <= -2) return `Leve Divergência Baixa (-6 a -2) [${diff}]`;
  if (diff > -2  && diff <   2) return `Convergente (-2 a +2) [${diff}]`;
  if (diff >=  2 && diff <   6) return `Leve Divergência Alta (+2 a +6) [${diff}]`;
  if (diff >=  6 && diff <  15) return `Divergência Moderada Alta (+6 a +15) [${diff}]`;
  return                               `Divergência Forte Alta (≥ +15) [${diff}]`;
}

// ─────────────────────────────────────────────────────────────────────────────
// FAIXAS MOMENTUM — 6 zonas classificadas
// ─────────────────────────────────────────────────────────────────────────────
// Variação percentual em 10 velas
//
// Zona 1: mom ≤ -1.0%          → Queda Forte
// Zona 2: -1.0% < mom ≤ -0.4%  → Queda Moderada
// Zona 3: -0.4% < mom ≤ -0.1%  → Queda Leve
// Zona 4: -0.1% < mom <  +0.1% → Neutro
// Zona 5: +0.1% ≤ mom <  +0.4% → Alta Leve
// Zona 6: +0.4% ≤ mom <  +1.0% → Alta Moderada
// Zona 7:  mom ≥ +1.0%         → Alta Forte

function calcMomentum(history: { c: number }[], period: number): number | null {
  if (history.length < period + 1) return null;
  const current = history[history.length - 1].c;
  const past    = history[history.length - 1 - period].c;
  if (past === 0) return null;
  return parseFloat((((current - past) / past) * 100).toFixed(4));
}

function classifyMomentum(mom: number | null): string {
  if (mom === null)               return "N/A";
  if (mom <= -1.0)                return "Queda Forte (≤ -1.0%)";
  if (mom > -1.0 && mom <= -0.4) return "Queda Moderada (-1.0% a -0.4%)";
  if (mom > -0.4 && mom <= -0.1) return "Queda Leve (-0.4% a -0.1%)";
  if (mom > -0.1 && mom <   0.1) return "Neutro (-0.1% a +0.1%)";
  if (mom >=  0.1 && mom <  0.4) return "Alta Leve (+0.1% a +0.4%)";
  if (mom >=  0.4 && mom <  1.0) return "Alta Moderada (+0.4% a +1.0%)";
  return                                "Alta Forte (≥ +1.0%)";
}

// ─────────────────────────────────────────────────────────────────────────────
// FAIXAS BOLLINGER BANDS — 6 zonas classificadas
// ─────────────────────────────────────────────────────────────────────────────
// Posição relativa do preço dentro das bandas
//
// A largura da banda é dividida em 6 faixas simétricas:
//
// Zona 1: preço > upper + buffer          → Rompimento Superior
// Zona 2: upper - 15% largura < p ≤ upper → Topo da Banda (70%–100%)
// Zona 3: meio + 5% < p ≤ upper - 15%    → Metade Superior (50%–70%)
// Zona 4: meio - 5% ≤ p ≤ meio + 5%      → Centro da Banda (45%–55%)
// Zona 5: lower + 15% ≤ p < meio - 5%    → Metade Inferior (30%–50%)
// Zona 6: lower ≤ p < lower + 15%        → Fundo da Banda (0%–30%)
// Zona 7: preço < lower - buffer          → Rompimento Inferior

function calcBBPosition(
  price: number,
  upper: number,
  lower: number,
  middle: number
): string {
  const width  = upper - lower;
  if (width === 0) return "Banda Plana";

  // posição relativa de 0% (fundo) a 100% (topo)
  const pct = parseFloat((((price - lower) / width) * 100).toFixed(1));

  if (price > upper)                         return `Rompimento Superior (>${100}%) [${pct}%]`;
  if (pct > 85)                              return `Topo da Banda (85–100%) [${pct}%]`;
  if (pct > 60 && pct <= 85)                 return `Metade Superior (60–85%) [${pct}%]`;
  if (pct >= 40 && pct <= 60)                return `Centro da Banda (40–60%) [${pct}%]`;
  if (pct >= 15 && pct < 40)                 return `Metade Inferior (15–40%) [${pct}%]`;
  if (pct >= 0  && pct < 15)                 return `Fundo da Banda (0–15%) [${pct}%]`;
  return                                            `Rompimento Inferior (<0%) [${pct}%]`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFLUÊNCIA BB × RSI — 5 níveis
// ─────────────────────────────────────────────────────────────────────────────
// Avalia o quanto a posição do BB confirma o sinal RSI
//
// Nível 5 — Máxima:  RSI extremo + Rompimento de banda oposta
// Nível 4 — Alta:    RSI extremo + Fundo/Topo da banda
// Nível 3 — Média:   RSI sobrevenda/compra + Metade inferior/superior
// Nível 2 — Baixa:   RSI na zona + Centro da banda
// Nível 1 — Mínima:  Sinais opostos entre RSI e BB

function calcBBConfluencia(
  action: "CALL" | "PUT",
  bbPos: string,
  rsiM5: number
): string {

  const isCall = action === "CALL";

  // Rompimento de banda (máxima confluência)
  if (isCall && bbPos.startsWith("Rompimento Inferior"))  return "Confluência Máxima (Nível 5)";
  if (!isCall && bbPos.startsWith("Rompimento Superior")) return "Confluência Máxima (Nível 5)";

  // Fundo/Topo da banda + RSI extremo
  if (isCall && bbPos.startsWith("Fundo") && rsiM5 <= 30) return "Confluência Alta (Nível 4)";
  if (!isCall && bbPos.startsWith("Topo") && rsiM5 >= 70) return "Confluência Alta (Nível 4)";

  // Metade inferior/superior + RSI moderado
  if (isCall && bbPos.startsWith("Metade Inferior"))      return "Confluência Média (Nível 3)";
  if (!isCall && bbPos.startsWith("Metade Superior"))     return "Confluência Média (Nível 3)";

  // Centro da banda
  if (bbPos.startsWith("Centro"))                         return "Confluência Baixa (Nível 2)";

  // Sinais opostos (preço no lado contrário ao sinal)
  if (isCall && (bbPos.startsWith("Topo") || bbPos.startsWith("Metade Superior")))  
    return "Confluência Mínima (Nível 1)";
  if (!isCall && (bbPos.startsWith("Fundo") || bbPos.startsWith("Metade Inferior")))
    return "Confluência Mínima (Nível 1)";

  return "Confluência Baixa (Nível 2)";
}

// ─────────────────────────────────────────────────────────────────────────────
// ESTRATÉGIA PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

const RSIStepStrategy: Strategy = {
  id: "step",
  name: "RSI Reversão",
  description:
    "Opera reversão quando RSI(14) < 30 (CALL) ou > 70 (PUT). " +
    "Estatísticas enriquecidas: RSI M5/M1 com faixas, Convergência RSI, " +
    "Momentum classificado e Bollinger Bands com 6 zonas.",

  // ── Painéis de estatísticas ───────────────────────────────────────────────
  customStatKeys: [
    { key: "rsi_m5_valor",      label: "RSI M5 — Valor"            },
    { key: "rsi_m5_faixa",      label: "RSI M5 — Faixa"            },
    { key: "rsi_m1_valor",      label: "RSI M1 — Valor"            },
    { key: "rsi_m1_faixa",      label: "RSI M1 — Faixa"            },
    { key: "rsi_convergencia",  label: "Convergência RSI"           },
    { key: "momentum_valor",    label: "Momentum % (10 velas)"      },
    { key: "momentum_faixa",    label: "Momentum — Faixa"          },
    { key: "bb_superior",       label: "BB — Banda Superior"        },
    { key: "bb_medio",          label: "BB — Banda Média"           },
    { key: "bb_inferior",       label: "BB — Banda Inferior"        },
    { key: "bb_posicao",        label: "BB — Posição (faixa)"       },
    { key: "bb_confluencia",    label: "BB × RSI — Confluência"     },
  ],

  // ── Filtros opcionais na UI ───────────────────────────────────────────────
  customFilterKeys: [
    {
      key: "filtro_rsi_m5_faixa",
      label: "RSI M5 — Faixa permitida",
      type: "multiselect",
      options: [
        "Sobrevenda Extrema (0–20)",
        "Sobrevenda (20–30)",
        "Zona Baixa (30–45)",
        "Neutro (45–55)",
        "Zona Alta (55–70)",
        "Sobrecompra (70–80)",
        "Sobrecompra Extrema (80–100)",
      ],
    },
    {
      key: "filtro_rsi_m1_faixa",
      label: "RSI M1 — Faixa permitida",
      type: "multiselect",
      options: [
        "Sobrevenda Extrema (0–20)",
        "Sobrevenda (20–30)",
        "Zona Baixa (30–45)",
        "Neutro (45–55)",
        "Zona Alta (55–70)",
        "Sobrecompra (70–80)",
        "Sobrecompra Extrema (80–100)",
      ],
    },
    {
      key: "filtro_rsi_convergencia",
      label: "Convergência RSI — Faixa permitida",
      type: "multiselect",
      options: [
        "Divergência Forte Baixa (≤ -15)",
        "Divergência Moderada Baixa (-15 a -6)",
        "Leve Divergência Baixa (-6 a -2)",
        "Convergente (-2 a +2)",
        "Leve Divergência Alta (+2 a +6)",
        "Divergência Moderada Alta (+6 a +15)",
        "Divergência Forte Alta (≥ +15)",
      ],
    },
    {
      key: "filtro_momentum_faixa",
      label: "Momentum — Faixa permitida",
      type: "multiselect",
      options: [
        "Queda Forte (≤ -1.0%)",
        "Queda Moderada (-1.0% a -0.4%)",
        "Queda Leve (-0.4% a -0.1%)",
        "Neutro (-0.1% a +0.1%)",
        "Alta Leve (+0.1% a +0.4%)",
        "Alta Moderada (+0.4% a +1.0%)",
        "Alta Forte (≥ +1.0%)",
      ],
    },
    {
      key: "filtro_bb_confluencia",
      label: "BB × RSI — Confluência mínima",
      type: "multiselect",
      options: [
        "Confluência Máxima (Nível 5)",
        "Confluência Alta (Nível 4)",
        "Confluência Média (Nível 3)",
        "Confluência Baixa (Nível 2)",
        "Confluência Mínima (Nível 1)",
      ],
    },
    {
      key: "filtro_bb_posicao",
      label: "BB — Posição permitida",
      type: "multiselect",
      options: [
        "Rompimento Superior (>100%)",
        "Topo da Banda (85–100%)",
        "Metade Superior (60–85%)",
        "Centro da Banda (40–60%)",
        "Metade Inferior (15–40%)",
        "Fundo da Banda (0–15%)",
        "Rompimento Inferior (<0%)",
      ],
    },
  ],

  // ── onTick ────────────────────────────────────────────────────────────────
  onTick: (context: StrategyContext): StrategyResult | null => {

    if (context.history.length < 27) return null;
    if (context.hasOpenTrade)        return null;

    // ── RSI M5 (14 períodos) — OPERACIONAL PRINCIPAL ───────────────────────
    const rsiArrM5 = context.indicators.rsi(14);
    if (!rsiArrM5 || rsiArrM5.length === 0) return null;
    const rsiM5       = parseFloat(rsiArrM5[rsiArrM5.length - 1].toFixed(2));
    const rsiM5Faixa  = classifyRSI(rsiM5);

    // ── RSI M1 (5 períodos) — dado adicional ──────────────────────────────
    const rsiArrM1 = context.indicators.rsi(5);
    if (!rsiArrM1 || rsiArrM1.length === 0) return null;
    const rsiM1       = parseFloat(rsiArrM1[rsiArrM1.length - 1].toFixed(2));
    const rsiM1Faixa  = classifyRSI(rsiM1);

    // ── Convergência RSI ───────────────────────────────────────────────────
    const rsiConvergencia = classifyRSIConvergencia(rsiM5, rsiM1);

    // ── Momentum ───────────────────────────────────────────────────────────
    const momentumValor  = calcMomentum(context.history, 10);
    const momentumFaixa  = classifyMomentum(momentumValor);

    // ── Bollinger Bands ────────────────────────────────────────────────────
    const bb = context.indicators.bollinger(20, 2);
    if (!bb || !bb.upper || bb.upper.length === 0) return null;

    const bbSuperior = parseFloat(bb.upper[bb.upper.length  - 1].toFixed(5));
    const bbInferior = parseFloat(bb.lower[bb.lower.length  - 1].toFixed(5));
    const bbMedio    = parseFloat(
      bb.middle
        ? bb.middle[bb.middle.length - 1].toFixed(5)
        : ((bbSuperior + bbInferior) / 2).toFixed(5)
    );
    const bbPosicao = calcBBPosition(context.lastPrice, bbSuperior, bbInferior, bbMedio);

    // ── Decisão — RSI é soberano ───────────────────────────────────────────
    let action: "CALL" | "PUT" | null = null;
    if (rsiM5 < 30)      action = "CALL";
    else if (rsiM5 > 70) action = "PUT";
    if (!action)         return null;

    // ── Confluência BB × RSI ───────────────────────────────────────────────
    const bbConfluencia = calcBBConfluencia(action, bbPosicao, rsiM5);

    // ── Aplicação de filtros opcionais ─────────────────────────────────────
    const filters = context.activeFilters || {};

    // Helper: verifica se o valor está dentro dos permitidos pelo filtro
    const passFilter = (filterKey: string, value: string): boolean => {
      const f = filters[filterKey];
      if (!f?.enabled) return true;                          // filtro desligado → passa
      const permitidos: string[] = f.values || [];
      if (permitidos.length === 0) return true;              // nenhum selecionado → passa
      // compara pelo prefixo da faixa (ignora o valor numérico no final)
      return permitidos.some(p => value.startsWith(p.split(" [")[0]));
    };

    if (!passFilter("filtro_rsi_m5_faixa",       rsiM5Faixa))     return null;
    if (!passFilter("filtro_rsi_m1_faixa",       rsiM1Faixa))     return null;
    if (!passFilter("filtro_rsi_convergencia",   rsiConvergencia)) return null;
    if (!passFilter("filtro_momentum_faixa",     momentumFaixa))   return null;
    if (!passFilter("filtro_bb_confluencia",     bbConfluencia))   return null;
    if (!passFilter("filtro_bb_posicao",         bbPosicao))       return null;

    // ── Retorno ────────────────────────────────────────────────────────────
    return {
      action,
      duration:           60,
      expiryCandles:      1,
      waitForCandleClose: true,

      customStats: {
        rsi_m5_valor:     rsiM5,
        rsi_m5_faixa:     rsiM5Faixa,
        rsi_m1_valor:     rsiM1,
        rsi_m1_faixa:     rsiM1Faixa,
        rsi_convergencia: rsiConvergencia,
        momentum_valor:   momentumValor !== null ? `${momentumValor}%` : "N/A",
        momentum_faixa:   momentumFaixa,
        bb_superior:      bbSuperior,
        bb_medio:         bbMedio,
        bb_inferior:      bbInferior,
        bb_posicao:       bbPosicao,
        bb_confluencia:   bbConfluencia,
      },
    };
  },
};

export default RSIStepStrategy;