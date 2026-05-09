import { Strategy, StrategyContext, StrategyResult } from "./index";

// ═══════════════════════════════════════════════════════════════════════════
// ESTRATÉGIA: ORDER BLOCK v6 - SMART MONEY CONCEPTS (OTIMIZADA)
// ═══════════════════════════════════════════════════════════════════════════

interface Candle {
  t: number; o: number; h: number; l: number; c: number;
}

interface OrderBlock {
  index: number;
  tipo: 'BEARISH' | 'BULLISH';
  zonaOBSuperior: number;
  zonaOBInferior: number;
  corpoVela: number;
  direcaoVela: string;
}

interface FVG {
  confirmado: boolean;
  tipo?: 'FVG_CLASSICO' | 'IMBALANCE_CONSECUTIVO';
  direcao?: string;
  nivelSuperior?: number;
  nivelInferior?: number;
  tamanho?: number;
  indexCentral?: number;
  motivo?: string;
}

interface QuebraEstrutura {
  confirmado: boolean;
  tipo?: 'BoS' | 'CHoCH';
  direcao?: string;
  nivelQuebrado?: number;
  indexQuebraAbsoluto?: number;
  velasAteQuebra?: number;
  indexReferencia?: number;
  motivo?: string;
}

interface Liquidez {
  confirmado: boolean;
  tipo?: 'EQUAL_HIGHS' | 'EQUAL_LOWS';
  nivelLiquidez?: number;
  nivelCaptura?: number;
  toquesCount?: number;
  toques?: Array<{ index: number; preco: number }>;
  capturada?: boolean;
  indexCaptura?: number | null;
  motivo?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO
// ═══════════════════════════════════════════════════════════════════════════
const CFG = {
  janelaMediaCorpo: 20,
  minMultiplicadorCorpoOB: 1.0,
  velasMovExpressivo: 4,
  minMultiplicadorMovExpressivo: 1.5,
  janelaFVG: 6,
  toleranciaEqualHL: 0.003,
  minToquesLiquidez: 2,
  minRatioRejeicao: 0.5,
  maxVelasAtePivot: 30,
  minVelasAtePivot: 3,
  expiracaoMin: 3,
  expiracaoMax: 5,

  // ── NOVOS LIMITES DE PERFORMANCE ──────────────────────────────────────
  // Quantas velas para trás analisar na busca de OBs (evita O(n) crescente)
  lookbackOB: 80,
  // Máximo de candidatos OB a processar por tick (os mais recentes têm prioridade)
  maxCandidatosProcessar: 5,
  // Janela máxima após o OB para buscar BoS/CHoCH
  maxVelasAposOBParaQuebra: 60,
  // Janela máxima após o BoS para buscar liquidez
  maxVelasAposBoSParaLiquidez: 50,
};

// ═══════════════════════════════════════════════════════════════════════════
// FUNÇÕES AUXILIARES
// ═══════════════════════════════════════════════════════════════════════════

function velaValida(v: Candle | undefined): v is Candle {
  return (
    v != null &&
    typeof v.h === 'number' && isFinite(v.h) &&
    typeof v.l === 'number' && isFinite(v.l) &&
    typeof v.o === 'number' && isFinite(v.o) &&
    typeof v.c === 'number' && isFinite(v.c) &&
    v.h >= v.l
  );
}

function corpo(v: Candle): number { return Math.abs(v.c - v.o); }
function pavioSup(v: Candle): number { return v.h - Math.max(v.o, v.c); }
function pavioInf(v: Candle): number { return Math.min(v.o, v.c) - v.l; }

function direcaoVela(v: Candle): 'ALTA' | 'BAIXA' | 'DOJI' {
  if (v.c > v.o) return 'ALTA';
  if (v.c < v.o) return 'BAIXA';
  return 'DOJI';
}

// OTIMIZAÇÃO: pré-calcula array de médias para evitar recalcular por candidato
function calcularMediasCorpo(velas: Candle[], janela: number): Float64Array {
  const medias = new Float64Array(velas.length);
  let soma = 0;
  let count = 0;

  for (let i = 0; i < velas.length; i++) {
    soma += corpo(velas[i]);
    count++;
    if (count > janela) soma -= corpo(velas[i - janela]);
    medias[i] = count >= janela ? soma / janela : soma / count;
  }

  return medias;
}

// ═══════════════════════════════════════════════════════════════════════════
// PASSO 1 — IDENTIFICAR ORDER BLOCKS
// OTIMIZAÇÃO: só analisa as últimas CFG.lookbackOB velas
// ═══════════════════════════════════════════════════════════════════════════
function identificarCandidatosOB(velas: Candle[], mediasCorpo: Float64Array): OrderBlock[] {
  const candidatos: OrderBlock[] = [];
  const n = velas.length;

  // Janela limitada: procura OBs só dentro do lookback definido
  const inicio = Math.max(CFG.janelaMediaCorpo, n - 1 - CFG.lookbackOB);
  const limiteMax = n - 2; // reserva última vela para P5

  for (let i = inicio; i <= limiteMax; i++) {
    const vela = velas[i];
    if (!velaValida(vela)) continue;
    if (direcaoVela(vela) === 'DOJI') continue;

    const corpoAtual = corpo(vela);
    const mediaAntes = mediasCorpo[i - 1] || 0;
    if (mediaAntes > 0 && corpoAtual < mediaAntes * CFG.minMultiplicadorCorpoOB) continue;

    // Garante que temos velas suficientes após o OB
    if (i + CFG.velasMovExpressivo >= n) continue;

    let somaMovimento = 0;
    let countBaixa = 0;
    let countAlta = 0;
    let todasValidas = true;

    for (let j = i + 1; j <= i + CFG.velasMovExpressivo; j++) {
      const vj = velas[j];
      if (!velaValida(vj)) { todasValidas = false; break; }
      somaMovimento += corpo(vj);
      const dir = direcaoVela(vj);
      if (dir === 'BAIXA') countBaixa++;
      else if (dir === 'ALTA') countAlta++;
    }

    if (!todasValidas) continue;
    if (corpoAtual > 0 && somaMovimento < corpoAtual * CFG.minMultiplicadorMovExpressivo) continue;
    if (countBaixa === countAlta) continue;

    const direcaoMov = countBaixa > countAlta ? 'BAIXA' : 'ALTA';
    const dir = direcaoVela(vela);
    const isBearish = dir === 'ALTA' && direcaoMov === 'BAIXA';
    const isBullish = dir === 'BAIXA' && direcaoMov === 'ALTA';
    if (!isBearish && !isBullish) continue;

    candidatos.push({
      index: i,
      tipo: isBearish ? 'BEARISH' : 'BULLISH',
      zonaOBSuperior: Math.max(vela.o, vela.c),
      zonaOBInferior: Math.min(vela.o, vela.c),
      corpoVela: corpoAtual,
      direcaoVela: dir
    });
  }

  return candidatos;
}

// ═══════════════════════════════════════════════════════════════════════════
// PASSO 2 — FVG / IMBALANCE APÓS O OB
// ═══════════════════════════════════════════════════════════════════════════
function verificarFVG(velas: Candle[], indexOB: number, tipoOB: 'BEARISH' | 'BULLISH'): FVG {
  const n = velas.length;
  const inicioFVG = indexOB + 2;
  const fimFVG = Math.min(indexOB + CFG.janelaFVG, n - 2);

  for (let i = inicioFVG; i <= fimFVG; i++) {
    const vA = velas[i - 1];
    const vB = velas[i];
    const vC = velas[i + 1];
    if (!velaValida(vA) || !velaValida(vB) || !velaValida(vC)) continue;

    if (tipoOB === 'BEARISH' && vA.l > vC.h) {
      return { confirmado: true, tipo: 'FVG_CLASSICO', direcao: 'BEARISH', nivelSuperior: vA.l, nivelInferior: vC.h, tamanho: vA.l - vC.h, indexCentral: i };
    }
    if (tipoOB === 'BULLISH' && vA.h < vC.l) {
      return { confirmado: true, tipo: 'FVG_CLASSICO', direcao: 'BULLISH', nivelSuperior: vC.l, nivelInferior: vA.h, tamanho: vC.l - vA.h, indexCentral: i };
    }
  }

  // Fallback: imbalance consecutivo — janela já é pequena (velasMovExpressivo)
  const direcaoEsperada = tipoOB === 'BEARISH' ? 'BAIXA' : 'ALTA';
  let consecutivos = 0;
  const fimSlice = Math.min(indexOB + 1 + CFG.velasMovExpressivo, n);
  for (let i = indexOB + 1; i < fimSlice; i++) {
    if (velaValida(velas[i]) && direcaoVela(velas[i]) === direcaoEsperada) consecutivos++;
  }

  if (consecutivos >= 2) {
    return { confirmado: true, tipo: 'IMBALANCE_CONSECUTIVO', direcao: tipoOB };
  }

  return { confirmado: false, motivo: 'Nenhum FVG ou Imbalance encontrado após o OB' };
}

// ═══════════════════════════════════════════════════════════════════════════
// PASSO 3 — QUEBRA DE ESTRUTURA (BoS / CHoCH)
// OTIMIZAÇÃO: janela limitada após OB (maxVelasAposOBParaQuebra)
// ═══════════════════════════════════════════════════════════════════════════
function verificarQuebraEstrutura(velas: Candle[], indexOB: number, tipoOB: 'BEARISH' | 'BULLISH'): QuebraEstrutura {
  let ultimoTopo: { index: number; preco: number } | null = null;
  let ultimoFundo: { index: number; preco: number } | null = null;

  const limiteMax = indexOB - CFG.minVelasAtePivot;
  const limiteMin = Math.max(2, indexOB - CFG.maxVelasAtePivot);

  // Busca pivot antes do OB (janela já estava limitada pela config original)
  for (let i = limiteMax; i >= limiteMin; i--) {
    const vP = velas[i - 1];
    const vC = velas[i];
    const vN = velas[i + 1];
    if (!velaValida(vP) || !velaValida(vC) || !velaValida(vN)) continue;

    if (!ultimoTopo && vC.h > vP.h && vC.h > vN.h) ultimoTopo = { index: i, preco: vC.h };
    if (!ultimoFundo && vC.l < vP.l && vC.l < vN.l) ultimoFundo = { index: i, preco: vC.l };
    if (ultimoTopo && ultimoFundo) break;
  }

  // OTIMIZAÇÃO: janela máxima após OB para BoS
  const fimBusca = Math.min(velas.length, indexOB + 1 + CFG.maxVelasAposOBParaQuebra);

  for (let i = indexOB + 1; i < fimBusca; i++) {
    const v = velas[i];
    if (!velaValida(v)) continue;

    if (tipoOB === 'BEARISH' && ultimoFundo && v.c < ultimoFundo.preco) {
      const velasAteQuebra = i - indexOB;
      return { confirmado: true, tipo: velasAteQuebra <= 6 ? 'CHoCH' : 'BoS', direcao: 'BEARISH', nivelQuebrado: ultimoFundo.preco, indexQuebraAbsoluto: i, velasAteQuebra, indexReferencia: ultimoFundo.index };
    }
    if (tipoOB === 'BULLISH' && ultimoTopo && v.c > ultimoTopo.preco) {
      const velasAteQuebra = i - indexOB;
      return { confirmado: true, tipo: velasAteQuebra <= 6 ? 'CHoCH' : 'BoS', direcao: 'BULLISH', nivelQuebrado: ultimoTopo.preco, indexQuebraAbsoluto: i, velasAteQuebra, indexReferencia: ultimoTopo.index };
    }
  }

  return {
    confirmado: false,
    motivo: !ultimoTopo && !ultimoFundo
      ? `Nenhum pivot estrutural encontrado entre ${CFG.minVelasAtePivot} e ${CFG.maxVelasAtePivot} velas antes do OB`
      : 'Nenhuma quebra de estrutura encontrada após o OB'
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PASSO 4 — LIQUIDEZ GERADA E CAPTURADA
// OTIMIZAÇÃO: janela limitada após BoS (maxVelasAposBoSParaLiquidez)
// ═══════════════════════════════════════════════════════════════════════════
function verificarLiquidez(velas: Candle[], indexBoS: number, tipoOB: 'BEARISH' | 'BULLISH'): Liquidez {
  const n = velas.length;
  const indexFim = n - 2;

  if (indexBoS >= indexFim - 1) {
    return { confirmado: false, motivo: 'Sem velas suficientes após o BoS para verificar liquidez' };
  }

  // OTIMIZAÇÃO: limitar janela de busca de liquidez
  const fimBusca = Math.min(indexFim, indexBoS + CFG.maxVelasAposBoSParaLiquidez);

  if (tipoOB === 'BEARISH') {
    const topos: Array<{ index: number; preco: number }> = [];

    for (let i = indexBoS + 1; i <= fimBusca - 1; i++) {
      const vP = velas[i - 1], vC = velas[i], vN = velas[i + 1];
      if (!velaValida(vP) || !velaValida(vC) || !velaValida(vN)) continue;
      if (vC.h >= vP.h && vC.h >= vN.h) topos.push({ index: i, preco: vC.h });
    }

    if (topos.length < CFG.minToquesLiquidez) return { confirmado: false, motivo: 'Topos insuficientes para Equal Highs' };

    const grupoEH = encontrarEqualHLConsecutivos(topos, velas, CFG.toleranciaEqualHL, 'BEARISH');
    if (!grupoEH || grupoEH.membros.length < CFG.minToquesLiquidez) return { confirmado: false, motivo: 'Topos não formam Equal Highs consecutivos válidos' };

    grupoEH.membros.sort((a, b) => a.index - b.index);
    const ultimoToque = grupoEH.membros[grupoEH.membros.length - 1];
    const nivelMaximo = Math.max(...grupoEH.membros.map(m => m.preco));
    const nivelCaptura = nivelMaximo + nivelMaximo * CFG.toleranciaEqualHL;

    let capturada = false;
    let indexCaptura: number | null = null;

    for (let i = ultimoToque.index + 1; i <= fimBusca; i++) {
      if (!velaValida(velas[i])) continue;
      if (velas[i].h > nivelCaptura) { capturada = true; indexCaptura = i; break; }
    }

    return {
      confirmado: capturada, tipo: 'EQUAL_HIGHS', nivelLiquidez: nivelMaximo, nivelCaptura,
      toquesCount: grupoEH.membros.length, toques: grupoEH.membros.map(t => ({ index: t.index, preco: t.preco })),
      capturada, indexCaptura,
      motivo: capturada ? 'Equal Highs capturados' : 'Equal Highs gerados mas não capturados'
    };
  }

  if (tipoOB === 'BULLISH') {
    const fundos: Array<{ index: number; preco: number }> = [];

    for (let i = indexBoS + 1; i <= fimBusca - 1; i++) {
      const vP = velas[i - 1], vC = velas[i], vN = velas[i + 1];
      if (!velaValida(vP) || !velaValida(vC) || !velaValida(vN)) continue;
      if (vC.l <= vP.l && vC.l <= vN.l) fundos.push({ index: i, preco: vC.l });
    }

    if (fundos.length < CFG.minToquesLiquidez) return { confirmado: false, motivo: 'Fundos insuficientes para Equal Lows' };

    const grupoEL = encontrarEqualHLConsecutivos(fundos, velas, CFG.toleranciaEqualHL, 'BULLISH');
    if (!grupoEL || grupoEL.membros.length < CFG.minToquesLiquidez) return { confirmado: false, motivo: 'Fundos não formam Equal Lows consecutivos válidos' };

    grupoEL.membros.sort((a, b) => a.index - b.index);
    const ultimoToque = grupoEL.membros[grupoEL.membros.length - 1];
    const nivelMinimo = Math.min(...grupoEL.membros.map(m => m.preco));
    const nivelCaptura = nivelMinimo - nivelMinimo * CFG.toleranciaEqualHL;

    let capturada = false;
    let indexCaptura: number | null = null;

    for (let i = ultimoToque.index + 1; i <= fimBusca; i++) {
      if (!velaValida(velas[i])) continue;
      if (velas[i].l < nivelCaptura) { capturada = true; indexCaptura = i; break; }
    }

    return {
      confirmado: capturada, tipo: 'EQUAL_LOWS', nivelLiquidez: nivelMinimo, nivelCaptura,
      toquesCount: grupoEL.membros.length, toques: grupoEL.membros.map(f => ({ index: f.index, preco: f.preco })),
      capturada, indexCaptura,
      motivo: capturada ? 'Equal Lows capturados' : 'Equal Lows gerados mas não capturados'
    };
  }

  return { confirmado: false, motivo: 'Tipo OB desconhecido' };
}

// OTIMIZAÇÃO: encontrarEqualHLConsecutivos com early-exit no loop interno
function encontrarEqualHLConsecutivos(
  pontos: Array<{ index: number; preco: number }>,
  velas: Candle[],
  toleranciaDecimal: number,
  tipoOB: 'BEARISH' | 'BULLISH'
): { precoRef: number; membros: Array<{ index: number; preco: number }> } | null {
  if (pontos.length === 0) return null;

  const ordenados = [...pontos].sort((a, b) => a.index - b.index);
  let melhorGrupo: { precoRef: number; membros: Array<{ index: number; preco: number }> } | null = null;

  for (let startIdx = 0; startIdx < ordenados.length; startIdx++) {
    // Early-exit: impossível superar melhor grupo atual
    if (melhorGrupo && (ordenados.length - startIdx) < melhorGrupo.membros.length) break;

    const ref = ordenados[startIdx];
    const tol = ref.preco * toleranciaDecimal;
    const membros = [ref];

    for (let j = startIdx + 1; j < ordenados.length; j++) {
      const candidato = ordenados[j];
      if (Math.abs(candidato.preco - ref.preco) > tol) continue;

      const ultimoMembro = membros[membros.length - 1];
      let quebrou = false;

      for (let k = ultimoMembro.index + 1; k < candidato.index; k++) {
        if (!velaValida(velas[k])) continue;
        if (tipoOB === 'BEARISH' && velas[k].h > ref.preco + tol) { quebrou = true; break; }
        if (tipoOB === 'BULLISH' && velas[k].l < ref.preco - tol) { quebrou = true; break; }
      }

      if (!quebrou) membros.push(candidato);
    }

    if (!melhorGrupo || membros.length > melhorGrupo.membros.length) {
      melhorGrupo = { precoRef: ref.preco, membros };
    }
  }

  return melhorGrupo;
}

// ═══════════════════════════════════════════════════════════════════════════
// PASSO 5 — TOQUE NO OB + REJEIÇÃO NA ÚLTIMA VELA
// ═══════════════════════════════════════════════════════════════════════════
function verificarToqueERejeicao(
  velas: Candle[],
  ob: OrderBlock,
  indexCaptura: number | null
): { confirmado: boolean; tocouZona?: boolean; rejeitou?: boolean; ratioRejeicao?: number; motivo?: string } {
  const ultimaVela = velas[velas.length - 1];
  const indexUltima = velas.length - 1;

  if (!velaValida(ultimaVela)) return { confirmado: false, motivo: 'Última vela inválida' };
  if (indexCaptura !== null && indexUltima <= indexCaptura) return { confirmado: false, motivo: 'Última vela não é posterior à captura de liquidez' };

  const { zonaOBSuperior, zonaOBInferior, tipo } = ob;
  const tocouZona = ultimaVela.l <= zonaOBSuperior && ultimaVela.h >= zonaOBInferior;

  if (!tocouZona) return { confirmado: false, tocouZona: false, motivo: `Última vela não tocou a zona do OB ${tipo.toLowerCase()}` };

  if (tipo === 'BEARISH') {
    const corpoVela = corpo(ultimaVela);
    const corpoRef = corpoVela > 0 ? corpoVela : (ultimaVela.h - ultimaVela.l) * 0.1 || 0.0001;
    const pS = pavioSup(ultimaVela);
    const ratioRejeicao = pS / corpoRef;
    const direcaoCorreta = direcaoVela(ultimaVela) === 'BAIXA';
    const pavioConfirma = pS >= corpoRef * CFG.minRatioRejeicao;
    const fechouAbaixo = ultimaVela.c < zonaOBSuperior;
    const rejeitou = direcaoCorreta && pavioConfirma && fechouAbaixo;
    return { confirmado: rejeitou, tocouZona: true, rejeitou, ratioRejeicao: Math.round(ratioRejeicao * 100) / 100, motivo: rejeitou ? 'Rejeição BEARISH confirmada' : 'Rejeição BEARISH não confirmada' };
  }

  if (tipo === 'BULLISH') {
    const corpoVela = corpo(ultimaVela);
    const corpoRef = corpoVela > 0 ? corpoVela : (ultimaVela.h - ultimaVela.l) * 0.1 || 0.0001;
    const pI = pavioInf(ultimaVela);
    const ratioRejeicao = pI / corpoRef;
    const direcaoCorreta = direcaoVela(ultimaVela) === 'ALTA';
    const pavioConfirma = pI >= corpoRef * CFG.minRatioRejeicao;
    const fechouAcima = ultimaVela.c > zonaOBInferior;
    const rejeitou = direcaoCorreta && pavioConfirma && fechouAcima;
    return { confirmado: rejeitou, tocouZona: true, rejeitou, ratioRejeicao: Math.round(ratioRejeicao * 100) / 100, motivo: rejeitou ? 'Rejeição BULLISH confirmada' : 'Rejeição BULLISH não confirmada' };
  }

  return { confirmado: false, motivo: 'Tipo OB desconhecido' };
}

// ═══════════════════════════════════════════════════════════════════════════
// ESTRATÉGIA PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════
const OrderBlockV6Strategy: Strategy = {
  id: "order_block_v6_smc",
  name: "Order Block v6 - Smart Money Concepts",
  description: "Sistema completo ICT: OB → FVG → BoS → Liquidez → Rejeição (5 passos cronológicos)",
  category: "auto",

  customStatKeys: [
    { key: "tipoOB", label: "Tipo OB" },
    { key: "fvgTipo", label: "FVG Tipo" },
    { key: "quebraEstrutura", label: "Quebra" },
    { key: "tipoLiquidez", label: "Liquidez" },
    { key: "toquesLiquidez", label: "Toques Liq." },
    { key: "ratioRejeicao", label: "Ratio Rejeição" },
    { key: "passosValidados", label: "Passos OK" },
  ],

  customFilterKeys: [
    { key: "min_passos", label: "Mínimo de Passos Validados", type: "range", defaultMin: 5, defaultMax: 5, step: 1 },
    { key: "tipo_ob", label: "Tipo de OB", type: "multiselect", options: ["BEARISH", "BULLISH"] },
    { key: "tipo_quebra", label: "Tipo de Quebra", type: "multiselect", options: ["BoS", "CHoCH"] },
  ],

  onTick: (ctx: StrategyContext): StrategyResult | null => {
    const velas = ctx.history;
    const n = velas.length;

    const minVelas = CFG.janelaMediaCorpo + CFG.velasMovExpressivo + 10;
    if (n - 1 < minVelas) return null;
    if (ctx.hasOpenTrade) return null;

    const filters = ctx.activeFilters || {};

    // Pré-calcula médias de corpo uma única vez por tick
    const mediasCorpo = calcularMediasCorpo(velas, CFG.janelaMediaCorpo);

    // 1. Identificar OBs — janela limitada a lookbackOB
    const candidatosOB = identificarCandidatosOB(velas, mediasCorpo);
    if (candidatosOB.length === 0) return null;

    // Processa do mais recente para o mais antigo, com limite de candidatos
    const candidatosOrdenados = candidatosOB.reverse().slice(0, CFG.maxCandidatosProcessar);

    for (const ob of candidatosOrdenados) {
      // Filtro: tipo de OB
      if (filters.tipo_ob?.enabled && filters.tipo_ob.values) {
        if (!filters.tipo_ob.values.includes(ob.tipo)) continue;
      }

      let passosValidados = 1;

      // 2. FVG
      const fvg = verificarFVG(velas, ob.index, ob.tipo);
      if (!fvg.confirmado) continue;
      passosValidados++;

      // 3. Quebra de Estrutura
      const quebraEstrutura = verificarQuebraEstrutura(velas, ob.index, ob.tipo);
      if (!quebraEstrutura.confirmado) continue;
      passosValidados++;

      if (filters.tipo_quebra?.enabled && filters.tipo_quebra.values) {
        if (!filters.tipo_quebra.values.includes(quebraEstrutura.tipo!)) continue;
      }

      // 4. Liquidez
      const liquidez = verificarLiquidez(velas, quebraEstrutura.indexQuebraAbsoluto!, ob.tipo);
      if (!liquidez.confirmado) continue;
      passosValidados++;

      // 5. Toque + Rejeição
      const toqueRejeicao = verificarToqueERejeicao(velas, ob, liquidez.indexCaptura!);
      if (!toqueRejeicao.confirmado) continue;
      passosValidados++;

      // Filtro: mínimo de passos
      if (filters.min_passos?.enabled) {
        const minPassos = filters.min_passos.min ?? 5;
        if (passosValidados < minPassos) continue;
      }

      // ✅ TODOS OS 5 PASSOS VALIDADOS
      return {
        action: ob.tipo === 'BEARISH' ? 'PUT' : 'CALL',
        expiryCandles: CFG.expiracaoMin,
        waitForCandleClose: true,
        customStats: {
          tipoOB: ob.tipo,
          fvgTipo: fvg.tipo || 'N/A',
          quebraEstrutura: quebraEstrutura.tipo || 'N/A',
          tipoLiquidez: liquidez.tipo || 'N/A',
          toquesLiquidez: liquidez.toquesCount || 0,
          ratioRejeicao: toqueRejeicao.ratioRejeicao || 0,
          passosValidados
        }
      };
    }

    return null;
  }
};

export default OrderBlockV6Strategy;