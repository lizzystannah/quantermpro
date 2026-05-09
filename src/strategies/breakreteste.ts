import { Strategy, StrategyContext, StrategyResult } from "./index";

// ═══════════════════════════════════════════════════════════════════════════
// ESTRATÉGIA: BREAK & RETEST v7
// Detecta quebras de suporte/resistência e opera no reteste
// ═══════════════════════════════════════════════════════════════════════════

interface SRZone {
  price: number;
  type: 'support' | 'resistance';
  touches: number;
  ultimoToqueIndice: number;
  ultimoToque: number;
}

interface BreakInfo {
  zona: SRZone;
  direcao: 'UP' | 'DOWN';
  indiceQuebra: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// PARÂMETROS
// ═══════════════════════════════════════════════════════════════════════════
const PARAMS = {
  ZONE_LOOKBACK: 150,
  PAVIO_MIN_ZONA_PCT_CORPO: 0.75,
  PAVIO_MIN_GATILHO_PCT_CORPO: 1.00,
  PAVIO_MAX_OPOSTO_PCT_CORPO: 0.50,
  DOJI_MAX_CORPO: 0.000010,
  PAVIO_MIN_DOJI_PCT_RANGE: 0.30,
  MOVIMENTO_CONTRARIO_VELAS: 10,
  MOVIMENTO_CONTRARIO_MIN: 5,
  TOQUE_SEPARACAO_MIN: 3,
  MIN_TOUCHES: 2,
  ZONE_TOLERANCE_PCT: 0.0015,
  RETEST_PRECISION: 0.0001,
  RETEST_MAX_CANDLES: 50,
  BLOQUEIO_VELAS: 8,
  LOOKBACK_REQUIRED: 80,
};

// ═══════════════════════════════════════════════════════════════════════════
// FUNÇÕES UTILITÁRIAS
// ═══════════════════════════════════════════════════════════════════════════
const isBullish = (c: any) => c.c > c.o;
const isBearish = (c: any) => c.c < c.o;
const corpoReal = (c: any) => Math.abs(c.c - c.o);
const range = (c: any) => c.h - c.l;
const minCorpo = (c: any) => Math.min(c.o, c.c);
const maxCorpo = (c: any) => Math.max(c.o, c.c);
const proximos = (a: number, b: number, tol: number) => Math.abs(a - b) / b <= tol;

function houveMovimentoContrario(
  velas: any[],
  indice: number,
  tipoZona: 'support' | 'resistance',
  limite: number
): boolean {
  let velasNaDirecao = 0;
  const fim = Math.min(indice + PARAMS.MOVIMENTO_CONTRARIO_VELAS, limite);
  
  for (let i = indice + 1; i < fim; i++) {
    const v = velas[i];
    if (tipoZona === 'support') {
      if (isBullish(v)) velasNaDirecao++;
    } else {
      if (isBearish(v)) velasNaDirecao++;
    }
  }
  
  return velasNaDirecao >= PARAMS.MOVIMENTO_CONTRARIO_MIN;
}

// ═══════════════════════════════════════════════════════════════════════════
// DETECTAR ZONAS DE SUPORTE E RESISTÊNCIA
// ═══════════════════════════════════════════════════════════════════════════
function detectarZonas(velas: any[], currentIndex: number): SRZone[] {
  const inicio = Math.max(0, currentIndex - PARAMS.ZONE_LOOKBACK);
  const zonas: SRZone[] = [];
  
  for (let i = inicio; i < currentIndex - PARAMS.MOVIMENTO_CONTRARIO_VELAS; i++) {
    const v = velas[i];
    const corpo = corpoReal(v);
    const r = range(v);
    
    if (corpo < 0.000010) continue;
    if (r === 0) continue;
    
    const pavioInf = minCorpo(v) - v.l;
    const pavioSup = v.h - maxCorpo(v);
    
    // SUPORTE: Pavio inferior forte + movimento de alta depois
    if (
      pavioInf >= corpo * PARAMS.PAVIO_MIN_ZONA_PCT_CORPO &&
      v.c > v.l &&
      houveMovimentoContrario(velas, i, 'support', currentIndex)
    ) {
      const zona = zonas.find(
        z => z.type === 'support' && proximos(v.l, z.price, PARAMS.ZONE_TOLERANCE_PCT)
      );
      
      if (zona) {
        if (i - zona.ultimoToqueIndice >= PARAMS.TOQUE_SEPARACAO_MIN) {
          zona.touches++;
          zona.price = (zona.price * (zona.touches - 1) + v.l) / zona.touches;
          zona.ultimoToqueIndice = i;
          zona.ultimoToque = i;
        }
      } else {
        zonas.push({
          price: v.l,
          type: 'support',
          touches: 1,
          ultimoToqueIndice: i,
          ultimoToque: i
        });
      }
    }
    
    // RESISTÊNCIA: Pavio superior forte + movimento de baixa depois
    if (
      pavioSup >= corpo * PARAMS.PAVIO_MIN_ZONA_PCT_CORPO &&
      v.c < v.h &&
      houveMovimentoContrario(velas, i, 'resistance', currentIndex)
    ) {
      const zona = zonas.find(
        z => z.type === 'resistance' && proximos(v.h, z.price, PARAMS.ZONE_TOLERANCE_PCT)
      );
      
      if (zona) {
        if (i - zona.ultimoToqueIndice >= PARAMS.TOQUE_SEPARACAO_MIN) {
          zona.touches++;
          zona.price = (zona.price * (zona.touches - 1) + v.h) / zona.touches;
          zona.ultimoToqueIndice = i;
          zona.ultimoToque = i;
        }
      } else {
        zonas.push({
          price: v.h,
          type: 'resistance',
          touches: 1,
          ultimoToqueIndice: i,
          ultimoToque: i
        });
      }
    }
  }
  
  return zonas.filter(z => z.touches >= PARAMS.MIN_TOUCHES);
}

// ═══════════════════════════════════════════════════════════════════════════
// DETECTAR QUEBRA DE ZONA
// ═══════════════════════════════════════════════════════════════════════════
function detectarQuebra(
  velas: any[],
  currentIndex: number,
  zonas: SRZone[]
): BreakInfo | null {
  const inicio = Math.max(PARAMS.LOOKBACK_REQUIRED, currentIndex - PARAMS.RETEST_MAX_CANDLES);
  let melhorQuebra: BreakInfo | null = null;
  
  for (const zona of zonas) {
    for (let i = Math.max(inicio, zona.ultimoToque + 1); i < currentIndex; i++) {
      const v = velas[i];
      if (corpoReal(v) === 0) continue;
      
      // Quebra de SUPORTE (bearish)
      if (zona.type === 'support' && isBearish(v) && v.c < zona.price) {
        if (!melhorQuebra || i > melhorQuebra.indiceQuebra) {
          melhorQuebra = { zona, direcao: 'DOWN', indiceQuebra: i };
        }
      }
      
      // Quebra de RESISTÊNCIA (bullish)
      if (zona.type === 'resistance' && isBullish(v) && v.c > zona.price) {
        if (!melhorQuebra || i > melhorQuebra.indiceQuebra) {
          melhorQuebra = { zona, direcao: 'UP', indiceQuebra: i };
        }
      }
    }
  }
  
  return melhorQuebra;
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICAR VELA GATILHO (RETEST)
// ═══════════════════════════════════════════════════════════════════════════
function verificarVelaGatilho(
  velas: any[],
  currentIndex: number,
  quebraInfo: BreakInfo
): boolean {
  if (currentIndex < 1) return false;
  
  const vg = velas[currentIndex];
  const { zona, direcao } = quebraInfo;
  const p = zona.price;
  const corpo = corpoReal(vg);
  const r = range(vg);
  const isDoji = corpo < PARAMS.DOJI_MAX_CORPO;
  
  if (r === 0) return false;
  
  // RETEST APÓS QUEBRA DE RESISTÊNCIA → CALL
  if (direcao === 'UP') {
    const pavioInf = minCorpo(vg) - vg.l;
    const pavioSup = vg.h - maxCorpo(vg);
    
    let pavioForteSuficiente: boolean;
    let semRejeicaoOposta: boolean;
    
    if (isDoji) {
      pavioForteSuficiente = pavioInf >= r * PARAMS.PAVIO_MIN_DOJI_PCT_RANGE;
      semRejeicaoOposta = pavioInf > pavioSup;
    } else {
      pavioForteSuficiente = pavioInf >= corpo * PARAMS.PAVIO_MIN_GATILHO_PCT_CORPO;
      semRejeicaoOposta = pavioSup <= corpo * PARAMS.PAVIO_MAX_OPOSTO_PCT_CORPO;
    }
    
    const pavioTocouZona = Math.abs(vg.l - p) / p <= PARAMS.RETEST_PRECISION;
    const fechouAcima = vg.c > p;
    
    return pavioForteSuficiente && pavioTocouZona && fechouAcima && semRejeicaoOposta;
  }
  
  // RETEST APÓS QUEBRA DE SUPORTE → PUT
  if (direcao === 'DOWN') {
    const pavioSup = vg.h - maxCorpo(vg);
    const pavioInf = minCorpo(vg) - vg.l;
    
    let pavioForteSuficiente: boolean;
    let semRejeicaoOposta: boolean;
    
    if (isDoji) {
      pavioForteSuficiente = pavioSup >= r * PARAMS.PAVIO_MIN_DOJI_PCT_RANGE;
      semRejeicaoOposta = pavioSup > pavioInf;
    } else {
      pavioForteSuficiente = pavioSup >= corpo * PARAMS.PAVIO_MIN_GATILHO_PCT_CORPO;
      semRejeicaoOposta = pavioInf <= corpo * PARAMS.PAVIO_MAX_OPOSTO_PCT_CORPO;
    }
    
    const pavioTocouZona = Math.abs(vg.h - p) / p <= PARAMS.RETEST_PRECISION;
    const fechouAbaixo = vg.c < p;
    
    return pavioForteSuficiente && pavioTocouZona && fechouAbaixo && semRejeicaoOposta;
  }
  
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICAR SE JÁ HOUVE ENTRADA RECENTE
// ═══════════════════════════════════════════════════════════════════════════
function jaHouveEntradaParaEsteEvento(
  velas: any[],
  currentIndex: number,
  quebraInfo: BreakInfo
): boolean {
  const inicio = Math.max(
    quebraInfo.indiceQuebra + 1,
    currentIndex - PARAMS.BLOQUEIO_VELAS
  );
  
  for (let i = inicio; i < currentIndex; i++) {
    const vg = velas[i];
    const { zona, direcao } = quebraInfo;
    const p = zona.price;
    const corpo = corpoReal(vg);
    const r = range(vg);
    const isDoji = corpo < PARAMS.DOJI_MAX_CORPO;
    
    if (r === 0) continue;
    
    if (direcao === 'UP') {
      const pavioInf = minCorpo(vg) - vg.l;
      const pavioSup = vg.h - maxCorpo(vg);
      let pfs: boolean, sro: boolean;
      
      if (isDoji) {
        pfs = pavioInf >= r * PARAMS.PAVIO_MIN_DOJI_PCT_RANGE;
        sro = pavioInf > pavioSup;
      } else {
        pfs = pavioInf >= corpo * PARAMS.PAVIO_MIN_GATILHO_PCT_CORPO;
        sro = pavioSup <= corpo * PARAMS.PAVIO_MAX_OPOSTO_PCT_CORPO;
      }
      
      if (pfs && Math.abs(vg.l - p) / p <= PARAMS.RETEST_PRECISION && vg.c > p && sro) {
        return true;
      }
    }
    
    if (direcao === 'DOWN') {
      const pavioSup = vg.h - maxCorpo(vg);
      const pavioInf = minCorpo(vg) - vg.l;
      let pfs: boolean, sro: boolean;
      
      if (isDoji) {
        pfs = pavioSup >= r * PARAMS.PAVIO_MIN_DOJI_PCT_RANGE;
        sro = pavioSup > pavioInf;
      } else {
        pfs = pavioSup >= corpo * PARAMS.PAVIO_MIN_GATILHO_PCT_CORPO;
        sro = pavioInf <= corpo * PARAMS.PAVIO_MAX_OPOSTO_PCT_CORPO;
      }
      
      if (pfs && Math.abs(vg.h - p) / p <= PARAMS.RETEST_PRECISION && vg.c < p && sro) {
        return true;
      }
    }
  }
  
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// ESTRATÉGIA PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════
const BreakRetestStrategy: Strategy = {
  id: "break_retest_v7",
  name: "Break & Retest v7",
  description: "Detecta quebras de suporte/resistência e opera no reteste preciso",
  category: "auto",

  customStatKeys: [
    { key: "metodo", label: "Método" },
    { key: "zonaTipo", label: "Tipo de Zona" },
    { key: "zonaToques", label: "Toques na Zona" },
    { key: "velasDesdQuebra", label: "Velas desde Quebra" },
    { key: "confianca", label: "Confiança" },
  ],

  onTick: (ctx: StrategyContext): StrategyResult | null => {
    const currentIndex = ctx.history.length - 1;

    // Validações básicas
    if (currentIndex < PARAMS.LOOKBACK_REQUIRED) return null;
    if (ctx.hasOpenTrade) return null;

    // 1. Detectar zonas de suporte/resistência
    const zonas = detectarZonas(ctx.history, currentIndex);
    if (zonas.length === 0) return null;

    // 2. Detectar quebra de zona
    const quebraInfo = detectarQuebra(ctx.history, currentIndex, zonas);
    if (!quebraInfo) return null;

    // 3. Verificar se estamos dentro da janela de reteste
    const velasDesdQuebra = currentIndex - quebraInfo.indiceQuebra;
    if (velasDesdQuebra < 1 || velasDesdQuebra > PARAMS.RETEST_MAX_CANDLES) {
      return null;
    }

    // 4. Verificar se a vela atual é um gatilho válido (retest)
    if (!verificarVelaGatilho(ctx.history, currentIndex, quebraInfo)) {
      return null;
    }

    // 5. Evitar entradas duplicadas
    if (jaHouveEntradaParaEsteEvento(ctx.history, currentIndex, quebraInfo)) {
      return null;
    }

    // ✅ SINAL APROVADO
    const { zona, direcao } = quebraInfo;
    const confianca = zona.touches >= 3 ? 'HIGH' : 'MEDIUM';
    const tipoContrato = direcao === 'UP' ? 'CALL' : 'PUT';

    return {
      action: tipoContrato,
      expiryCandles: 1,
      waitForCandleClose: true, // Espera a vela fechar antes de entrar
      customStats: {
        metodo: 'BREAK_RETEST',
        zonaTipo: zona.type,
        zonaToques: zona.touches,
        velasDesdQuebra,
        confianca,
      }
    };
  }
};

export default BreakRetestStrategy;