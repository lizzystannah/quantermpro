import { Strategy, StrategyContext, StrategyResult } from "./index";

// Estado para rastrear sequências de entradas e toques por ativo/linha
interface StrategyState {
  lastTouchTimes: Record<string, number[]>; // asset_lineId -> timestamps das últimas 10 velas que respeitaram
  inSequence: Record<string, { count: number; action: "CALL" | "PUT"; startTime: number }>; // asset_lineId -> contagem de velas
  lastProcessedTime: Record<string, number>; // asset -> timestamp da última vela fechada processada
}

const state: StrategyState = {
  lastTouchTimes: {},
  inSequence: {},
  lastProcessedTime: {}
};

const strategy: Strategy = {
  id: "sr-v2-semi-auto",
  name: "Suporte e Resistência V2",
  description: "Detecta duplo toque respeitado em 10 velas. Ativa sequência de 3 entradas a favor do respeito.",
  category: "semi-auto",
  onTick: (context: StrategyContext): StrategyResult | null => {
    const history = context.history;
    if (history.length < 15) return null;

    const currentAsset = context.asset;
    const lines = context.srLines;
    const lastCompletedCandle = context.isBacktest ? history[history.length - 1] : history[history.length - 2];
    const currentCandle = context.isBacktest ? history[history.length - 1] : history[history.length - 1];
    const hasOpenTrade = context.hasOpenTrade;

    // 1. Processar sequências em andamento (Entradas 2 e 3)
    // Estas devem ocorrer no início da nova vela
    for (const key in state.inSequence) {
      // Usar uma verificação mais rigorosa para não misturar ativos (ex: R_10 vs R_100)
      if (key === `${currentAsset}_` || key.startsWith(`${currentAsset}_`)) {
        const seq = state.inSequence[key];
        // Se a vela atual é nova em relação à que iniciou ou à última entrada
        if (currentCandle.t > seq.startTime && seq.count < 3) {
          if (hasOpenTrade) {
            context.toast?.info(`Aguardando fechamento da ordem anterior para continuar a sequência SR V2.`);
            return null;
          }

          seq.count++;
          seq.startTime = currentCandle.t;
          const label = key.split('_')[1] || "Linha";

          if (seq.count >= 3) {
            delete state.inSequence[key];
            context.toast?.success(`Sequência SR V2 finalizada em ${currentAsset}.`);
          } else {
            context.toast?.info(`Executando entrada ${seq.count}/3 da sequência SR V2.`);
          }

          return { action: seq.action };
        }
      }
    }

    // 2. Validação de "Respeito" e Inversão de Linhas
    // Apenas uma vez por vela fechada
    if (state.lastProcessedTime[currentAsset] === lastCompletedCandle.t) return null;
    state.lastProcessedTime[currentAsset] = lastCompletedCandle.t;

    for (const line of lines) {
      const lineKey = `${currentAsset}_${line.id}`;
      const linePrice = line.price;
      const openedAbove = lastCompletedCandle.o > linePrice;
      const openedBelow = lastCompletedCandle.o < linePrice;

      let respected = false;
      let action: "CALL" | "PUT" | null = null;

      // Lógica de Suporte
      if (openedAbove) {
        const touched = lastCompletedCandle.l <= linePrice;
        const closedAbove = lastCompletedCandle.c > linePrice;

        if (touched && closedAbove) {
          respected = true;
          action = "CALL";
        } else if (lastCompletedCandle.c < linePrice) {
          // Só inverte se for suporte. Evita loops.
          if (line.type === "support") {
            context.updateSR?.(line.id, { kind: "resistance" });
            context.toast?.info(`Suporte em ${linePrice.toFixed(2)} rompido e invertido para Resistência.`);
          }
        }
      }
      // Lógica de Resistência
      else if (openedBelow) {
        const touched = lastCompletedCandle.h >= linePrice;
        const closedBelow = lastCompletedCandle.c < linePrice;

        if (touched && closedBelow) {
          respected = true;
          action = "PUT";
        } else if (lastCompletedCandle.c > linePrice) {
          // Só inverte se for resistência. Evita loops.
          if (line.type === "resistance") {
            context.updateSR?.(line.id, { kind: "support" });
            context.toast?.info(`Resistência em ${linePrice.toFixed(2)} rompida e invertida para Suporte.`);
          }
        }
      }

      if (respected && action) {
        if (!state.lastTouchTimes[lineKey]) state.lastTouchTimes[lineKey] = [];
        state.lastTouchTimes[lineKey].push(lastCompletedCandle.t);

        // Janela de 10 velas (baseada no timestamp da última vela fechada)
        const tenCandlesAgo = history[history.length - 11]?.t || 0;
        state.lastTouchTimes[lineKey] = state.lastTouchTimes[lineKey].filter(t => t >= tenCandlesAgo);

        // Se confirmou 2 toques respeitados, inicia sequência
        if (state.lastTouchTimes[lineKey].length >= 2 && !state.inSequence[lineKey]) {
          context.toast?.success(`SR V2: Canal confirmado em ${linePrice.toFixed(2)}. Iniciando sequência de 3 entradas.`);

          state.inSequence[lineKey] = {
            count: 1,
            action: action,
            startTime: currentCandle.t
          };

          state.lastTouchTimes[lineKey] = []; // Reinicia toques para esta linha

          if (!hasOpenTrade) {
            return { action: action };
          } else {
            context.toast?.info("SR V2: Sinal detectado, mas há uma ordem aberta. Sequência agendada para próxima vela.");
          }
        } else if (respected) {
          const count = state.lastTouchTimes[lineKey].length;
          context.toast?.info(`SR V2: Toque ${count}/2 respeitado em ${linePrice.toFixed(2)} (${line.type === "support" ? "Suporte" : "Resistência"}).`);
        }
      }
    }

    return null;
  }
};

export default strategy;
