import { Strategy, StrategyContext, StrategyResult } from "./index";

// ═══════════════════════════════════════════════════════════════════════════
// ESTRATÉGIA: PADRÕES OPERACIONAIS v2.8 (CÁLCULO INTERNO M1)
// 
// Adaptação completa da estratégia n8n:
// - Detecta linhas S/R (simulando M10) usando pivôs do M1
// - Calcula zonas S/R do M1
// - Padrões A e B (com/sem viés)
// - Operacionais C, D e E
// ═══════════════════════════════════════════════════════════════════════════

interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

interface ZonaSR {
  preco: number;
  tipo: 'suporte' | 'resistencia';
  toques: number;
  indiceMaisRecente: number;
  forca: number;
}

interface LinhaPivo {
  nivel: number;
  tipo: 'suporte' | 'resistencia';
  direcaoRompimento: 'CIMA' | 'BAIXO' | null;
  indice: number;
  forca: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO
// ═══════════════════════════════════════════════════════════════════════════
const CONFIG = {
  // Padrões de entrada
  MIN_VELAS_CONTRARIAS_COM_VIES: 2,
  MIN_VELAS_CONTRARIAS_SEM_VIES: 3,
  MIN_VELAS_ACIMA_MEDIA: 2,
  MAX_VELAS_SEQUENCIA_ANALISAR: 15,
  FATOR_DESPROPORCIONAL: 2.5,
  
  // Scores
  SCORE_PADRAO_A_COM_VIES: 95,
  SCORE_PADRAO_B_COM_VIES: 70,
  SCORE_PADRAO_A_SEM_VIES: 80,
  SCORE_PADRAO_B_SEM_VIES: 55,
  
  // Zonas e linhas
  ZONA_LOOKBACK: 100,
  ZONA_TOLERANCE_PCT: 0.002,
  MIN_TOQUES_ZONA: 2,
  PAVIO_DESPROPORCIONAL_PCT: 0.60,
  
  // Pivôs (simulando M10)
  PIVO_LOOKBACK: 200,
  PIVO_JANELA: 10,           // Velas antes/depois para confirmar pivô
  PIVO_MIN_FORCA: 3,         // Mínimo de toques para considerar pivô
  
  // Operacionais
  MAX_VELAS_BUSCA_ROMPIMENTO_E: 5,
};

// ═══════════════════════════════════════════════════════════════════════════
// FUNÇÕES AUXILIARES BASE
// ═══════════════════════════════════════════════════════════════════════════

const isVelaCompra = (c: Candle) => c.c > c.o;
const isVelaVenda = (c: Candle) => c.c < c.o;
const corpoVela = (c: Candle) => Math.abs(c.c - c.o);
const range = (c: Candle) => c.h - c.l;
const minCorpo = (c: Candle) => Math.min(c.o, c.c);
const maxCorpo = (c: Candle) => Math.max(c.o, c.c);

function direcaoVela(c: Candle): 'COMPRA' | 'VENDA' | 'DOJI' {
  if (c.c > c.o) return 'COMPRA';
  if (c.c < c.o) return 'VENDA';
  return 'DOJI';
}

function calcularMediaCorpo(velas: Candle[]): number {
  if (velas.length === 0) return 0;
  return velas.reduce((acc, v) => acc + corpoVela(v), 0) / velas.length;
}

function isVelaDesproporcional(vela: Candle, mediaCorpo: number, fator: number): boolean {
  return corpoVela(vela) > mediaCorpo * fator;
}

// ═══════════════════════════════════════════════════════════════════════════
// DETECTAR PIVÔS (SIMULANDO LINHAS M10)
// ═══════════════════════════════════════════════════════════════════════════
function detectarPivos(velas: Candle[], currentIndex: number): LinhaPivo[] {
  const inicio = Math.max(0, currentIndex - CONFIG.PIVO_LOOKBACK);
  const pivos: LinhaPivo[] = [];
  const janela = CONFIG.PIVO_JANELA;

  for (let i = inicio + janela; i < currentIndex - janela; i++) {
    const vela = velas[i];
    
    // Verificar se é pivô de ALTA (mínima local)
    let isPivoAlta = true;
    for (let j = i - janela; j <= i + janela; j++) {
      if (j === i) continue;
      if (velas[j].l < vela.l) {
        isPivoAlta = false;
        break;
      }
    }

    if (isPivoAlta) {
      // Verificar se já existe pivô próximo
      const pivoExistente = pivos.find(
        p => p.tipo === 'suporte' && 
        Math.abs(p.nivel - vela.l) / vela.l <= CONFIG.ZONA_TOLERANCE_PCT
      );

      if (pivoExistente) {
        pivoExistente.forca++;
        pivoExistente.nivel = (pivoExistente.nivel * (pivoExistente.forca - 1) + vela.l) / pivoExistente.forca;
      } else {
        pivos.push({
          nivel: vela.l,
          tipo: 'suporte',
          direcaoRompimento: null,
          indice: i,
          forca: 1
        });
      }
    }

    // Verificar se é pivô de BAIXA (máxima local)
    let isPivoBaixa = true;
    for (let j = i - janela; j <= i + janela; j++) {
      if (j === i) continue;
      if (velas[j].h > vela.h) {
        isPivoBaixa = false;
        break;
      }
    }

    if (isPivoBaixa) {
      const pivoExistente = pivos.find(
        p => p.tipo === 'resistencia' && 
        Math.abs(p.nivel - vela.h) / vela.h <= CONFIG.ZONA_TOLERANCE_PCT
      );

      if (pivoExistente) {
        pivoExistente.forca++;
        pivoExistente.nivel = (pivoExistente.nivel * (pivoExistente.forca - 1) + vela.h) / pivoExistente.forca;
      } else {
        pivos.push({
          nivel: vela.h,
          tipo: 'resistencia',
          direcaoRompimento: null,
          indice: i,
          forca: 1
        });
      }
    }
  }

  // Determinar direção do rompimento para cada pivô
  for (const pivo of pivos) {
    for (let i = pivo.indice + 1; i < currentIndex; i++) {
      const v = velas[i];
      
      if (pivo.tipo === 'suporte') {
        // Rompeu para baixo
        if (isVelaVenda(v) && v.c < pivo.nivel) {
          pivo.direcaoRompimento = 'BAIXO';
          break;
        }
      } else {
        // Rompeu para cima
        if (isVelaCompra(v) && v.c > pivo.nivel) {
          pivo.direcaoRompimento = 'CIMA';
          break;
        }
      }
    }
  }

  return pivos.filter(p => p.forca >= CONFIG.PIVO_MIN_FORCA);
}

// ═══════════════════════════════════════════════════════════════════════════
// DETECTAR ZONAS S/R M1
// ═══════════════════════════════════════════════════════════════════════════
function detectarZonasSR(velas: Candle[], currentIndex: number): {
  suportes: ZonaSR[];
  resistencias: ZonaSR[];
} {
  const inicio = Math.max(0, currentIndex - CONFIG.ZONA_LOOKBACK);
  const suportes: ZonaSR[] = [];
  const resistencias: ZonaSR[] = [];

  for (let i = inicio; i < currentIndex - 5; i++) {
    const v = velas[i];
    const corpo = corpoVela(v);
    const r = range(v);

    if (r === 0 || corpo < 0.00001) continue;

    const pavioInf = minCorpo(v) - v.l;
    const pavioSup = v.h - maxCorpo(v);

    // SUPORTE: pavio inferior forte + rejeição
    if (pavioInf >= corpo * 0.5) {
      const zonaExistente = suportes.find(
        z => Math.abs(z.preco - v.l) / v.l <= CONFIG.ZONA_TOLERANCE_PCT
      );

      if (zonaExistente) {
        if (i - zonaExistente.indiceMaisRecente >= 3) {
          zonaExistente.toques++;
          zonaExistente.preco = (zonaExistente.preco * (zonaExistente.toques - 1) + v.l) / zonaExistente.toques;
          zonaExistente.indiceMaisRecente = i;
          zonaExistente.forca = zonaExistente.toques * 10;
        }
      } else {
        suportes.push({
          preco: v.l,
          tipo: 'suporte',
          toques: 1,
          indiceMaisRecente: i,
          forca: 10
        });
      }
    }

    // RESISTÊNCIA: pavio superior forte + rejeição
    if (pavioSup >= corpo * 0.5) {
      const zonaExistente = resistencias.find(
        z => Math.abs(z.preco - v.h) / v.h <= CONFIG.ZONA_TOLERANCE_PCT
      );

      if (zonaExistente) {
        if (i - zonaExistente.indiceMaisRecente >= 3) {
          zonaExistente.toques++;
          zonaExistente.preco = (zonaExistente.preco * (zonaExistente.toques - 1) + v.h) / zonaExistente.toques;
          zonaExistente.indiceMaisRecente = i;
          zonaExistente.forca = zonaExistente.toques * 10;
        }
      } else {
        resistencias.push({
          preco: v.h,
          tipo: 'resistencia',
          toques: 1,
          indiceMaisRecente: i,
          forca: 10
        });
      }
    }
  }

  return {
    suportes: suportes.filter(z => z.toques >= CONFIG.MIN_TOQUES_ZONA),
    resistencias: resistencias.filter(z => z.toques >= CONFIG.MIN_TOQUES_ZONA)
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ENCONTRAR SEQUÊNCIA CONTRÁRIA
// ═══════════════════════════════════════════════════════════════════════════
function encontrarSequenciaContraria(
  velas: Candle[],
  indicePenultima: number,
  direcaoContraria: 'COMPRA' | 'VENDA',
  minVelas: number,
  mediaCorpo: number
): {
  sequencia: Candle[];
  tamanho: number;
  valida: boolean;
  velasAcimaMedia: number;
  inicioIndex: number;
} {
  const sequencia: Candle[] = [];
  let idx = indicePenultima - 1;

  while (idx >= 0 && idx >= indicePenultima - CONFIG.MAX_VELAS_SEQUENCIA_ANALISAR) {
    const v = velas[idx];
    const dir = direcaoVela(v);

    if (dir === direcaoContraria || dir === 'DOJI') {
      sequencia.unshift(v);
      idx--;
    } else {
      break;
    }
  }

  const velasAcimaMedia = sequencia.filter(v => corpoVela(v) > mediaCorpo).length;

  return {
    sequencia,
    tamanho: sequencia.length,
    valida: sequencia.length >= minVelas && velasAcimaMedia >= CONFIG.MIN_VELAS_ACIMA_MEDIA,
    velasAcimaMedia,
    inicioIndex: idx + 1
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICAR PADRÃO DE ENTRADA (A ou B)
// ═══════════════════════════════════════════════════════════════════════════
function verificarPadraoEntrada(
  penultima: Candle,
  ultima: Candle,
  direcaoOperacao: 'COMPRA' | 'VENDA',
  mediaCorpo: number
): {
  valido: boolean;
  padrao: 'A' | 'B' | null;
  descricao: string;
  motivo?: string;
  pavioProporcionaB?: boolean;
} {
  const dirPenultima = direcaoVela(penultima);
  const dirUltima = direcaoVela(ultima);

  if (isVelaDesproporcional(ultima, mediaCorpo, CONFIG.FATOR_DESPROPORCIONAL)) {
    return {
      valido: false,
      padrao: null,
      descricao: '',
      motivo: 'Última vela desproporcional'
    };
  }

  if (direcaoOperacao === 'VENDA') {
    if (dirPenultima !== 'VENDA') {
      return { valido: false, padrao: null, descricao: '', motivo: 'Penúltima não é VENDA' };
    }

    // PADRÃO A: verde não superou máxima da vermelha
    if (dirUltima === 'COMPRA') {
      if (ultima.h <= penultima.h && ultima.c <= penultima.h) {
        return {
          valido: true,
          padrao: 'A',
          descricao: 'Verde não superou máxima da correção vermelha'
        };
      }
      return { valido: false, padrao: null, descricao: '', motivo: 'Verde superou máxima' };
    }

    // PADRÃO B: vermelha superou mínima
    if (dirUltima === 'VENDA') {
      if (ultima.l < penultima.l) {
        const pavioSup = ultima.h - maxCorpo(ultima);
        const pavioInf = minCorpo(ultima) - ultima.l;
        const pavioProporcionaB = pavioSup > pavioInf;
        
        return {
          valido: true,
          padrao: 'B',
          descricao: 'Vermelha superou mínima' + (pavioProporcionaB ? ' [pavio OK]' : ''),
          pavioProporcionaB
        };
      }
      return { valido: false, padrao: null, descricao: '', motivo: 'Vermelha não superou mínima' };
    }

    return { valido: false, padrao: null, descricao: '', motivo: 'Última é DOJI' };
  }

  // COMPRA
  if (dirPenultima !== 'COMPRA') {
    return { valido: false, padrao: null, descricao: '', motivo: 'Penúltima não é COMPRA' };
  }

  // PADRÃO A: vermelha não superou mínima da verde
  if (dirUltima === 'VENDA') {
    if (ultima.l >= penultima.l && ultima.c >= penultima.l) {
      return {
        valido: true,
        padrao: 'A',
        descricao: 'Vermelha não superou mínima da correção verde'
      };
    }
    return { valido: false, padrao: null, descricao: '', motivo: 'Vermelha superou mínima' };
  }

  // PADRÃO B: verde superou máxima
  if (dirUltima === 'COMPRA') {
    if (ultima.h > penultima.h) {
      const pavioInf = minCorpo(ultima) - ultima.l;
      const pavioSup = ultima.h - maxCorpo(ultima);
      const pavioProporcionaB = pavioInf > pavioSup;
      
      return {
        valido: true,
        padrao: 'B',
        descricao: 'Verde superou máxima' + (pavioProporcionaB ? ' [pavio OK]' : ''),
        pavioProporcionaB
      };
    }
    return { valido: false, padrao: null, descricao: '', motivo: 'Verde não superou máxima' };
  }

  return { valido: false, padrao: null, descricao: '', motivo: 'Última é DOJI' };
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICAR TOQUE EM ZONA M1
// ═══════════════════════════════════════════════════════════════════════════
function verificarToqueZonaM1(
  velas: Candle[],
  zonas: ZonaSR[],
  direcaoOperacao: 'COMPRA' | 'VENDA'
): {
  tocou: boolean;
  zona: ZonaSR | null;
  operacionalC?: boolean;
  operacionalD?: boolean;
  direcaoInversa?: 'CALL' | 'PUT';
} {
  const ultimaVela = velas[velas.length - 1];
  const velaEntrada = velas[velas.length - 2];

  for (const zona of zonas) {
    const nivel = zona.preco;

    // Verificar toque da vela de entrada
    let tocou = false;
    if (direcaoOperacao === 'COMPRA' && velaEntrada.l <= nivel) tocou = true;
    if (direcaoOperacao === 'VENDA' && velaEntrada.h >= nivel) tocou = true;

    if (!tocou) continue;

    // Verificar rejeição (fechamento correto)
    let rejeitou = false;
    if (direcaoOperacao === 'COMPRA' && velaEntrada.c > nivel) rejeitou = true;
    if (direcaoOperacao === 'VENDA' && velaEntrada.c < nivel) rejeitou = true;

    if (!rejeitou) continue;

    // Verificar pavio desproporcional
    const amplitudeTotal = velaEntrada.h - velaEntrada.l;
    const pavioRelevante = direcaoOperacao === 'COMPRA'
      ? velaEntrada.h - maxCorpo(velaEntrada)
      : minCorpo(velaEntrada) - velaEntrada.l;

    if (amplitudeTotal > 0 && pavioRelevante / amplitudeTotal > CONFIG.PAVIO_DESPROPORCIONAL_PCT) {
      continue; // Pavio muito grande, rejeitar
    }

    // OP. C: última vela rompeu pavio da vela de entrada
    let ultimaRompeuPavio = false;
    if (direcaoOperacao === 'COMPRA' && ultimaVela.l < velaEntrada.l) ultimaRompeuPavio = true;
    if (direcaoOperacao === 'VENDA' && ultimaVela.h > velaEntrada.h) ultimaRompeuPavio = true;

    if (ultimaRompeuPavio) {
      return {
        tocou: false,
        zona,
        operacionalC: true,
        direcaoInversa: direcaoOperacao === 'COMPRA' ? 'PUT' : 'CALL'
      };
    }

    return { tocou: true, zona };
  }

  return { tocou: false, zona: null };
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICAR OPERACIONAL D (Zona Oposta)
// ═══════════════════════════════════════════════════════════════════════════
function verificarOperacionalD(
  velas: Candle[],
  zonasSR: { suportes: ZonaSR[]; resistencias: ZonaSR[] },
  direcaoOperacaoEsperada: 'COMPRA' | 'VENDA'
): {
  detectado: boolean;
  sinalEntrada?: 'CALL' | 'PUT';
  zona?: ZonaSR;
} {
  const ultimaVela = velas[velas.length - 1];

  // Zonas OPOSTAS à direção esperada
  const zonasOpostas = direcaoOperacaoEsperada === 'COMPRA'
    ? zonasSR.resistencias
    : zonasSR.suportes;

  for (const zona of zonasOpostas) {
    const nivel = zona.preco;

    if (direcaoOperacaoEsperada === 'COMPRA') {
      // Tocou resistência e fechou abaixo → PUT
      if (ultimaVela.h >= nivel && ultimaVela.c < nivel) {
        return {
          detectado: true,
          sinalEntrada: 'PUT',
          zona
        };
      }
    } else {
      // Tocou suporte e fechou acima → CALL
      if (ultimaVela.l <= nivel && ultimaVela.c > nivel) {
        return {
          detectado: true,
          sinalEntrada: 'CALL',
          zona
        };
      }
    }
  }

  return { detectado: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICAR TOQUE EM LINHA/PIVO
// ═══════════════════════════════════════════════════════════════════════════
function verificarToqueLinha(
  velas: Candle[],
  linha: LinhaPivo,
  direcaoOperacao: 'COMPRA' | 'VENDA'
): boolean {
  const antepenultima = velas[velas.length - 3];
  const penultima = velas[velas.length - 2];

  const nivel = linha.nivel;

  // Toque simples
  if (direcaoOperacao === 'COMPRA') {
    if (antepenultima && antepenultima.l <= nivel) return true;
    if (penultima && penultima.l <= nivel) return true;
  } else {
    if (antepenultima && antepenultima.h >= nivel) return true;
    if (penultima && penultima.h >= nivel) return true;
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICAR SE SEQUÊNCIA ROMPEU LINHA
// ═══════════════════════════════════════════════════════════════════════════
function sequenciaRompeuLinha(sequencia: Candle[], nivel: number): boolean {
  for (const vela of sequencia) {
    if (isVelaCompra(vela) && vela.c > nivel) return true;
    if (isVelaVenda(vela) && vela.c < nivel) return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// ESTRATÉGIA PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════
const PadroesOperacionaisV28: Strategy = {
  id: "padroes_operacionais_v28_interno",
  name: "Padrões Operacionais v2.8 (Cálculo Interno)",
  description: "Sistema completo de padrões A/B com operacionais C/D/E - Tudo calculado no M1",
  category: "auto",

  customStatKeys: [
    { key: "padrao", label: "Padrão" },
    { key: "operacional", label: "Operacional" },
    { key: "cenario", label: "Cenário" },
    { key: "zonaPreco", label: "Zona (Preço)" },
    { key: "zonaTipo", label: "Zona (Tipo)" },
    { key: "zonaToques", label: "Toques Zona" },
    { key: "linhaPreco", label: "Linha (Preço)" },
    { key: "linhaForca", label: "Força Linha" },
    { key: "velasSequencia", label: "Velas Seq." },
    { key: "score", label: "Score" },
  ],

  onTick: (ctx: StrategyContext): StrategyResult | null => {
    const velas = ctx.history;
    const currentIndex = velas.length - 1;

    // Validações básicas
    if (currentIndex < 250) return null; // Precisa de histórico para pivôs
    if (ctx.hasOpenTrade) return null;

    const mediaCorpo = calcularMediaCorpo(velas.slice(-50));
    const ultimaVela = velas[currentIndex];
    const penultimaVela = velas[currentIndex - 1];

    // 1. Detectar pivôs (simulando linhas M10)
    const pivos = detectarPivos(velas, currentIndex);
    
    // 2. Detectar zonas S/R M1
    const zonasSR = detectarZonasSR(velas, currentIndex);
    const todasZonas = [...zonasSR.suportes, ...zonasSR.resistencias];

    if (pivos.length === 0 && todasZonas.length === 0) return null;

    // ═══════════════════════════════════════════════════════════════════════
    // CENÁRIO 1: COM VIÉS (pivô com direção de rompimento definida)
    // ═══════════════════════════════════════════════════════════════════════
    const pivosComDirecao = pivos.filter(p => p.direcaoRompimento !== null);
    
    if (pivosComDirecao.length > 0) {
      // Ordenar por força (mais forte primeiro)
      pivosComDirecao.sort((a, b) => b.forca - a.forca);
      
      for (const pivo of pivosComDirecao) {
        const direcaoOp = pivo.direcaoRompimento === 'CIMA' ? 'COMPRA' : 'VENDA';
        const direcaoContraria = direcaoOp === 'COMPRA' ? 'VENDA' : 'COMPRA';

        // Verificar direção da penúltima
        if (direcaoVela(penultimaVela) !== direcaoOp) continue;

        // Encontrar sequência contrária
        const seqContraria = encontrarSequenciaContraria(
          velas,
          currentIndex - 1,
          direcaoContraria,
          CONFIG.MIN_VELAS_CONTRARIAS_COM_VIES,
          mediaCorpo
        );

        if (!seqContraria.valida) continue;

        // Verificar se sequência rompeu a linha
        if (sequenciaRompeuLinha(seqContraria.sequencia, pivo.nivel)) continue;

        // Verificar padrão de entrada
        const padrao = verificarPadraoEntrada(penultimaVela, ultimaVela, direcaoOp, mediaCorpo);
        if (!padrao.valido) continue;

        // Verificar toque na linha
        if (!verificarToqueLinha(velas, pivo, direcaoOp)) continue;

        // Verificar zonas M1
        const zonasRelevantes = direcaoOp === 'COMPRA' ? zonasSR.suportes : zonasSR.resistencias;
        const toqueM1 = verificarToqueZonaM1(velas, zonasRelevantes, direcaoOp);

        // OP. C: Monitorar
        if (toqueM1.operacionalC) {
          // Sistema de monitoramento não implementado na plataforma atual
          continue;
        }

        // OP. D: Entrada oposta imediata
        if (!toqueM1.tocou) {
          const opD = verificarOperacionalD(velas, zonasSR, direcaoOp);
          if (opD.detectado) {
            const score = CONFIG.SCORE_PADRAO_A_COM_VIES;
            
            return {
              action: opD.sinalEntrada!,
              expiryCandles: 1,
              waitForCandleClose: true,
              customStats: {
                padrao: padrao.padrao!,
                operacional: 'D',
                cenario: 'COM_VIES',
                zonaPreco: opD.zona?.preco.toFixed(5) || 'N/A',
                zonaTipo: opD.zona?.tipo || 'N/A',
                zonaToques: opD.zona?.toques || 0,
                linhaPreco: pivo.nivel.toFixed(5),
                linhaForca: pivo.forca,
                velasSequencia: seqContraria.tamanho,
                score
              }
            };
          }
          continue;
        }

        // Entrada normal (padrão confirmado)
        const score = padrao.padrao === 'A' 
          ? CONFIG.SCORE_PADRAO_A_COM_VIES 
          : CONFIG.SCORE_PADRAO_B_COM_VIES;

        return {
          action: direcaoOp === 'COMPRA' ? 'CALL' : 'PUT',
          expiryCandles: 1,
          waitForCandleClose: true,
          customStats: {
            padrao: padrao.padrao!,
            operacional: padrao.padrao!,
            cenario: 'COM_VIES',
            zonaPreco: toqueM1.zona?.preco.toFixed(5) || 'N/A',
            zonaTipo: toqueM1.zona?.tipo || 'N/A',
            zonaToques: toqueM1.zona?.toques || 0,
            linhaPreco: pivo.nivel.toFixed(5),
            linhaForca: pivo.forca,
            velasSequencia: seqContraria.tamanho,
            score
          }
        };
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CENÁRIO 2: SEM VIÉS (apenas zonas M1)
    // ═══════════════════════════════════════════════════════════════════════
    for (const tentativa of ['COMPRA', 'VENDA'] as const) {
      const direcaoOp = tentativa;
      const direcaoContraria = direcaoOp === 'COMPRA' ? 'VENDA' : 'COMPRA';

      // Verificar direção da penúltima
      if (direcaoVela(penultimaVela) !== direcaoOp) continue;

      // Sequência contrária
      const seqContraria = encontrarSequenciaContraria(
        velas,
        currentIndex - 1,
        direcaoContraria,
        CONFIG.MIN_VELAS_CONTRARIAS_SEM_VIES,
        mediaCorpo
      );

      if (!seqContraria.valida) continue;

      // Padrão de entrada
      const padrao = verificarPadraoEntrada(penultimaVela, ultimaVela, direcaoOp, mediaCorpo);
      if (!padrao.valido) continue;

      // Verificar zonas M1
      const zonasRelevantes = direcaoOp === 'COMPRA' ? zonasSR.suportes : zonasSR.resistencias;
      const toqueM1 = verificarToqueZonaM1(velas, zonasRelevantes, direcaoOp);

      // OP. D
      if (!toqueM1.tocou) {
        const opD = verificarOperacionalD(velas, zonasSR, direcaoOp);
        if (opD.detectado) {
          const score = CONFIG.SCORE_PADRAO_A_SEM_VIES;
          
          return {
            action: opD.sinalEntrada!,
            expiryCandles: 1,
            waitForCandleClose: true,
            customStats: {
              padrao: padrao.padrao!,
              operacional: 'D',
              cenario: 'SEM_VIES',
              zonaPreco: opD.zona?.preco.toFixed(5) || 'N/A',
              zonaTipo: opD.zona?.tipo || 'N/A',
              zonaToques: opD.zona?.toques || 0,
              linhaPreco: 'N/A',
              linhaForca: 0,
              velasSequencia: seqContraria.tamanho,
              score
            }
          };
        }
        continue;
      }

      // Entrada normal
      const score = padrao.padrao === 'A' 
        ? CONFIG.SCORE_PADRAO_A_SEM_VIES 
        : CONFIG.SCORE_PADRAO_B_SEM_VIES;

      return {
        action: direcaoOp === 'COMPRA' ? 'CALL' : 'PUT',
        expiryCandles: 1,
        waitForCandleClose: true,
        customStats: {
          padrao: padrao.padrao!,
          operacional: padrao.padrao!,
          cenario: 'SEM_VIES',
          zonaPreco: toqueM1.zona?.preco.toFixed(5) || 'N/A',
          zonaTipo: toqueM1.zona?.tipo || 'N/A',
          zonaToques: toqueM1.zona?.toques || 0,
          linhaPreco: 'N/A',
          linhaForca: 0,
          velasSequencia: seqContraria.tamanho,
          score
        }
      };
    }

    return null;
  }
};

export default PadroesOperacionaisV28;