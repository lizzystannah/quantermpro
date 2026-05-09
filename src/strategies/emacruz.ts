import { Strategy, StrategyContext, StrategyResult } from "./index";

// ═══════════════════════════════════════════════════════════════════════════
// ESTRATÉGIA: DETECTOR DE CRUZAMENTO v4.0 (CORRIGIDA)
// ═══════════════════════════════════════════════════════════════════════════

const CFG = {
  toleranciaProximidade: 0.05,  // % entre médias para antecipação
  velaGrandeMinimo:      0.12,  // corpo mínimo como % do range
  janelaCruzamento:      5,     // velas atrás para procurar cruzamento
  toleranciaToque:       0.001, // 0.1% — toque na EMA
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function mediasProximas(m1: number, m2: number, preco: number): boolean {
  return Math.abs(m1 - m2) / preco * 100 < CFG.toleranciaProximidade;
}

// Procura cruzamento entre dois arrays nas últimas N posições
// Retorna índice no array (relativo ao próprio array) onde cruzou
function encontrarCruzamento(
  rapida: number[],
  lenta: number[],
  janela: number
): { cruzou: boolean; indice: number; direcao: 'PARA_CIMA' | 'PARA_BAIXO' | null } {

  const minLen = Math.min(rapida.length, lenta.length);
  if (minLen < 2) return { cruzou: false, indice: -1, direcao: null };

  // Começa da penúltima (não usa a última = vela atual ainda aberta)
  const inicio = Math.max(1, minLen - janela);

  for (let i = minLen - 1; i >= inicio; i--) {
    const acimaAgora = rapida[i]     > lenta[i];
    const acimaAntes = rapida[i - 1] > lenta[i - 1];

    if (acimaAgora && !acimaAntes) {
      return { cruzou: true, indice: i, direcao: 'PARA_CIMA' };
    }
    if (!acimaAgora && acimaAntes) {
      return { cruzou: true, indice: i, direcao: 'PARA_BAIXO' };
    }
  }

  return { cruzou: false, indice: -1, direcao: null };
}

// Verifica se houve toque na EMA após o cruzamento
// Usa os arrays de indicadores diretamente (mesma base de índices)
function verificarToqueAposCruzamento(
  velas: { o: number; h: number; l: number; c: number }[],
  emaArr: number[],
  indiceCruzamento: number,   // índice no array da EMA
  direcao: 'PARA_CIMA' | 'PARA_BAIXO',
  tolerancia: number
): { tocou: boolean; velasToque: number } {

  // Os arrays de indicadores têm o mesmo tamanho que ctx.history
  // então índice no array = índice na vela
  const inicio = indiceCruzamento + 1;
  const fim    = velas.length - 1; // não inclui última (vela de entrada)

  for (let i = inicio; i < fim; i++) {
    const vela = velas[i];
    const ema  = emaArr[i];

    if (!vela || ema === undefined || isNaN(ema)) continue;

    if (direcao === 'PARA_CIMA') {
      // Após cruzamento para cima: toque = mínima tocou a EMA
      const distancia = Math.abs(vela.l - ema) / ema;
      if (distancia <= tolerancia || vela.l <= ema) {
        return { tocou: true, velasToque: i - indiceCruzamento };
      }
    } else {
      // Após cruzamento para baixo: toque = máxima tocou a EMA
      const distancia = Math.abs(vela.h - ema) / ema;
      if (distancia <= tolerancia || vela.h >= ema) {
        return { tocou: true, velasToque: i - indiceCruzamento };
      }
    }
  }

  return { tocou: false, velasToque: 0 };
}

// Valida a vela de entrada (última vela)
function verificarVelaEntrada(
  vela: { o: number; h: number; l: number; c: number },
  direcao: 'PARA_CIMA' | 'PARA_BAIXO',
  ema5: number,
  ema10: number,
  mediaCorpo: number
): { valida: boolean; motivo: string } {

  const corpo = Math.abs(vela.c - vela.o);

  // Rejeita velas desproporcionais
  if (mediaCorpo > 0 && corpo > mediaCorpo * 3) {
    return { valida: false, motivo: 'Vela desproporcional' };
  }

  if (direcao === 'PARA_CIMA') {
    // CALL: fechamento deve estar acima da menor EMA
    if (vela.c <= Math.min(ema5, ema10)) {
      return { valida: false, motivo: 'Fechamento abaixo das EMAs (CALL)' };
    }
  } else {
    // PUT: fechamento deve estar abaixo da maior EMA
    if (vela.c >= Math.max(ema5, ema10)) {
      return { valida: false, motivo: 'Fechamento acima das EMAs (PUT)' };
    }
  }

  return { valida: true, motivo: 'OK' };
}

// ═══════════════════════════════════════════════════════════════════════════
// ESTRATÉGIA
// ═══════════════════════════════════════════════════════════════════════════
const DetectorCruzamentoV4: Strategy = {
  id: "detector_cruzamento_v4",
  name: "Detector Cruzamento v4.0",
  description: "Cruzamento EMA5/EMA10 vs SMA21 + Toque de retorno + Filtro SMA82",
  category: "auto",

  customStatKeys: [
    { key: "tipoSinal",       label: "Tipo de Sinal"    },
    { key: "mediaQueCruzou",  label: "Média que Cruzou" },
    { key: "direcao",         label: "Direção"           },
    { key: "tendenciaGeral",  label: "Tendência MA82"    },
    { key: "aFavorTendencia", label: "A Favor MA82"      },
    { key: "velasToque",      label: "Velas até Toque"   },
    { key: "confianca",       label: "Confiança %"       },
  ],

  customFilterKeys: [
    {
      key: "min_confianca",
      label: "Confiança Mínima (%)",
      type: "range",
      defaultMin: 70,
      defaultMax: 100,
      step: 5,
    },
    {
      key: "apenas_favor_tendencia",
      label: "Apenas a Favor da MA82",
      type: "multiselect",
      options: ["SIM", "NÃO"],
    },
    {
      key: "tipo_sinal",
      label: "Tipo de Sinal",
      type: "multiselect",
      options: ["CRUZAMENTO_COM_TOQUE", "ANTECIPACAO_CRUZAMENTO"],
    },
    {
      key: "janela_cruzamento",
      label: "Janela de Cruzamento (velas)",
      type: "range",
      defaultMin: 1,
      defaultMax: 10,
      step: 1,
    },
  ],

  onTick: (ctx: StrategyContext): StrategyResult | null => {
    const velas = ctx.history;
    const n     = velas.length;

    if (n < 100) return null;
    if (ctx.hasOpenTrade) return null;

    const filters = ctx.activeFilters || {};

    // Janela configurável
    const janelaCruz = (filters.janela_cruzamento?.enabled && filters.janela_cruzamento.min != null)
      ? filters.janela_cruzamento.min
      : CFG.janelaCruzamento;

    // ─── Indicadores ──────────────────────────────────────────────────
    const ema5Arr  = ctx.indicators.ema(5);
    const ema10Arr = ctx.indicators.ema(10);
    const sma21Arr = ctx.indicators.sma(21);
    const sma82Arr = ctx.indicators.sma(82);

    // Garantir arrays válidos com tamanho suficiente
    if (
      ema5Arr.length  < janelaCruz + 2 ||
      ema10Arr.length < janelaCruz + 2 ||
      sma21Arr.length < janelaCruz + 2 ||
      sma82Arr.length < 2
    ) return null;

    // Valores atuais (último índice = vela atual)
    const valEMA5  = ema5Arr[ema5Arr.length   - 1];
    const valEMA10 = ema10Arr[ema10Arr.length - 1];
    const valSMA21 = sma21Arr[sma21Arr.length - 1];
    const valSMA82 = sma82Arr[sma82Arr.length - 1];

    if (
      valEMA5  == null || isNaN(valEMA5)  ||
      valEMA10 == null || isNaN(valEMA10) ||
      valSMA21 == null || isNaN(valSMA21) ||
      valSMA82 == null || isNaN(valSMA82)
    ) return null;

    const preco = ctx.lastPrice;

    // Média de corpo das últimas 20 velas
    const slice20   = velas.slice(-20);
    const mediaCorpo = slice20.reduce((s, v) => s + Math.abs(v.c - v.o), 0) / slice20.length;

    // ─── Tendência geral (SMA82) ───────────────────────────────────────
    const tendenciaGeral: 'ALTA' | 'BAIXA' = preco > valSMA82 ? 'ALTA' : 'BAIXA';

    // ─── Função interna: aplicar filtros e retornar ────────────────────
    function aplicarFiltrosERetornar(
      sinalFinal: 'CALL' | 'PUT',
      tipoSinal: string,
      mediaQueCruzou: string,
      direcao: string,
      aFavorTendencia: boolean,
      velasToque: number,
      confianca: number
    ): StrategyResult | null {

      confianca = Math.max(0, Math.min(100, confianca));

      if (filters.min_confianca?.enabled) {
        const minConf = filters.min_confianca.min ?? 70;
        if (confianca < minConf) return null;
      }

      if (filters.apenas_favor_tendencia?.enabled) {
        const vals = filters.apenas_favor_tendencia.values ?? [];
        if (vals.includes('SIM') && !aFavorTendencia) return null;
      }

      if (filters.tipo_sinal?.enabled) {
        const tipos = filters.tipo_sinal.values ?? [];
        if (tipos.length > 0 && !tipos.includes(tipoSinal)) return null;
      }

      return {
        action: sinalFinal,
        expiryCandles: 1,
        waitForCandleClose: true,
        customStats: {
          tipoSinal,
          mediaQueCruzou,
          direcao,
          tendenciaGeral,
          aFavorTendencia: aFavorTendencia ? 'SIM' : 'NÃO',
          velasToque,
          confianca,
        },
      };
    }

    // ═══════════════════════════════════════════════════════════════════
    // CASO 1: CRUZAMENTO EMA5 vs SMA21
    // ═══════════════════════════════════════════════════════════════════
    const cruzEMA5 = encontrarCruzamento(ema5Arr, sma21Arr, janelaCruz);

    if (cruzEMA5.cruzou && cruzEMA5.direcao) {

      const toque = verificarToqueAposCruzamento(
        velas,
        ema5Arr,
        cruzEMA5.indice,
        cruzEMA5.direcao,
        CFG.toleranciaToque
      );

      if (toque.tocou) {
        const velaEntrada = verificarVelaEntrada(
          velas[n - 1],
          cruzEMA5.direcao,
          valEMA5,
          valEMA10,
          mediaCorpo
        );

        if (velaEntrada.valida) {
          const sinal: 'CALL' | 'PUT'  = cruzEMA5.direcao === 'PARA_CIMA' ? 'CALL' : 'PUT';
          const aFavor = (tendenciaGeral === 'ALTA' && sinal === 'CALL') ||
                         (tendenciaGeral === 'BAIXA' && sinal === 'PUT');
          const confianca = aFavor ? 85 : 70;

          return aplicarFiltrosERetornar(
            sinal, 'CRUZAMENTO_COM_TOQUE', 'EMA5',
            cruzEMA5.direcao, aFavor, toque.velasToque, confianca
          );
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // CASO 2: CRUZAMENTO EMA10 vs SMA21
    // ═══════════════════════════════════════════════════════════════════
    const cruzEMA10 = encontrarCruzamento(ema10Arr, sma21Arr, janelaCruz);

    if (cruzEMA10.cruzou && cruzEMA10.direcao) {

      const toque = verificarToqueAposCruzamento(
        velas,
        ema10Arr,
        cruzEMA10.indice,
        cruzEMA10.direcao,
        CFG.toleranciaToque
      );

      if (toque.tocou) {
        const velaEntrada = verificarVelaEntrada(
          velas[n - 1],
          cruzEMA10.direcao,
          valEMA5,
          valEMA10,
          mediaCorpo
        );

        if (velaEntrada.valida) {
          const sinal: 'CALL' | 'PUT'  = cruzEMA10.direcao === 'PARA_CIMA' ? 'CALL' : 'PUT';
          const aFavor = (tendenciaGeral === 'ALTA' && sinal === 'CALL') ||
                         (tendenciaGeral === 'BAIXA' && sinal === 'PUT');
          const confianca = aFavor ? 80 : 65;

          return aplicarFiltrosERetornar(
            sinal, 'CRUZAMENTO_COM_TOQUE', 'EMA10',
            cruzEMA10.direcao, aFavor, toque.velasToque, confianca
          );
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // CASO 3: ANTECIPAÇÃO — linhas próximas + vela grande cruzando
    // ═══════════════════════════════════════════════════════════════════
    const ema5Proxima  = mediasProximas(valEMA5,  valSMA21, preco);
    const ema10Proxima = mediasProximas(valEMA10, valSMA21, preco);

    if (ema5Proxima || ema10Proxima) {
      const penultima  = velas[n - 2];
      const rangeVela  = penultima.h - penultima.l;
      const corpoVela  = Math.abs(penultima.c - penultima.o);
      const ehGrande   = rangeVela > 0 && (corpoVela / rangeVela) > CFG.velaGrandeMinimo;

      if (ehGrande) {
        let direcao: 'PARA_CIMA' | 'PARA_BAIXO' | null = null;

        if (penultima.o > valSMA21 && penultima.c < valSMA21) direcao = 'PARA_BAIXO';
        if (penultima.o < valSMA21 && penultima.c > valSMA21) direcao = 'PARA_CIMA';

        if (direcao) {
          const velaEntrada = verificarVelaEntrada(
            velas[n - 1],
            direcao,
            valEMA5,
            valEMA10,
            mediaCorpo
          );

          if (velaEntrada.valida) {
            const sinal: 'CALL' | 'PUT'  = direcao === 'PARA_CIMA' ? 'CALL' : 'PUT';
            const aFavor = (tendenciaGeral === 'ALTA' && sinal === 'CALL') ||
                           (tendenciaGeral === 'BAIXA' && sinal === 'PUT');
            const confianca = aFavor ? 75 : 60;
            const mediaProx = ema5Proxima ? 'EMA5' : 'EMA10';

            return aplicarFiltrosERetornar(
              sinal, 'ANTECIPACAO_CRUZAMENTO', mediaProx,
              direcao, aFavor, 0, confianca
            );
          }
        }
      }
    }

    return null;
  },
};

export default DetectorCruzamentoV4;