import { Strategy, StrategyContext, StrategyResult } from "./index";

const lastProcessedTimes: Record<string, number> = {};

const strategy: Strategy = {
  id: "sr-semi-auto",
  name: "Suporte e Resistência (Semi-Auto)",
  description: "Detecta toques e rompimentos em linhas de S/R traçadas manualmente no gráfico. Aguarde o fechamento da vela para confirmação.",
  category: "semi-auto",
  onTick: (context: StrategyContext): StrategyResult | null => {
    const history = context.history;
    if (history.length < 2) return null;

    const currentAsset = context.asset;
    const lastProcessedTime = lastProcessedTimes[currentAsset] || 0;

    // Em backtest, a vela atual (history[history.length - 1]) já está "fechada" no contexto de cada iteração.
    // Em tempo real (robotEngine), a vela atual acabou de abrir, então a vela que fechou é a anterior.
    const lastCandle = context.isBacktest ? history[history.length - 1] : history[history.length - 2];

    if (!lastCandle || lastProcessedTime === lastCandle.t) return null;

    const lines = context.srLines || [];
    const zones = context.srZones || [];
    const hasOpenTrade = context.hasOpenTrade;

    let result: StrategyResult | null = null;
    let actedOnCandle = false;

    // Estratégia de Linhas (Suporte e Resistência) conforme documentação matemática
    for (const line of lines) {
      if (hasOpenTrade) break;

      const linePrice = line.price;
      const openedAbove = lastCandle.o > linePrice;
      const openedBelow = lastCandle.o < linePrice;

      // COMPRA (Suporte)
      if (openedAbove) {
        const touched = lastCandle.l <= linePrice;
        const closedAbove = lastCandle.c > linePrice;
        const closedBelow = lastCandle.c < linePrice;

        if (touched && closedAbove) {
          context.toast?.success(`Suporte respeitado em ${linePrice.toFixed(2)}. Toque e fechamento confirmados.`);
          result = { action: "CALL" };
          actedOnCandle = true;
          // Se estava marcada como resistência, atualiza para suporte
          if (line.type === "resistance") context.updateSR?.(line.id, { kind: "support" });
          break;
        } else if (closedBelow) {
          // Rompimento: se fechou abaixo, vira resistência para a próxima
          context.updateSR?.(line.id, { kind: "resistance" });
          context.toast?.info(`Suporte em ${linePrice.toFixed(2)} rompido. Virou Resistência.`);
          actedOnCandle = true;
        }
      }
      // VENDA (Resistência)
      else if (openedBelow) {
        const touched = lastCandle.h >= linePrice;
        const closedBelow = lastCandle.c < linePrice;
        const closedAbove = lastCandle.c > linePrice;

        if (touched && closedBelow) {
          context.toast?.success(`Resistência respeitada em ${linePrice.toFixed(2)}. Toque e fechamento confirmados.`);
          result = { action: "PUT" };
          actedOnCandle = true;
          // Se estava marcada como suporte, atualiza para resistência
          if (line.type === "support") context.updateSR?.(line.id, { kind: "resistance" });
          break;
        } else if (closedAbove) {
          // Rompimento: se fechou acima, vira suporte para a próxima
          context.updateSR?.(line.id, { kind: "support" });
          context.toast?.info(`Resistência em ${linePrice.toFixed(2)} rompida. Virou Suporte.`);
          actedOnCandle = true;
        }
      }
    }

    // Strategy 2: Zones (Strict entry detection)
    if (!actedOnCandle && !hasOpenTrade) {
      for (const zone of zones) {
        if (zone.type === "support" || zone.type === "buy_zone") { // Using "support" or "buy_zone" based on backwards compat
          const bottomPrice = zone.p2 || zone.bottomPrice || 0;
          const topPrice = zone.p1 || zone.topPrice || 0;
          const touchedTop = lastCandle.l <= topPrice;
          const closedAboveBottom = lastCandle.c >= bottomPrice;

          if (touchedTop && closedAboveBottom) {
            context.toast?.success(`Zona de COMPRA respeitada.`);
            result = { action: "CALL" };
            actedOnCandle = true;
            break;
          }
        } else if (zone.type === "resistance" || zone.type === "sell_zone") {
          const bottomPrice = zone.p2 || zone.bottomPrice || 0;
          const topPrice = zone.p1 || zone.topPrice || 0;
          const touchedBottom = lastCandle.h >= bottomPrice;
          const closedBelowTop = lastCandle.c <= topPrice;

          if (touchedBottom && closedBelowTop) {
            context.toast?.success(`Zona de VENDA respeitada.`);
            result = { action: "PUT" };
            actedOnCandle = true;
            break;
          }
        }
      }
    }

    if (actedOnCandle) {
      lastProcessedTimes[currentAsset] = lastCandle.t;
    }

    return result;
  }
};

export default strategy;
