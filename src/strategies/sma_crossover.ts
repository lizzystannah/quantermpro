import { Strategy, StrategyContext, StrategyResult } from "./index";

const SMACrossoverStrategy: Strategy = {
  id: "sma_crossover",
  name: "Cruzamento SMA (9/21)",
  description: "Entra a favor da tendência quando a SMA 9 cruza a SMA 21.",
  category: "auto",
  onTick: (context: StrategyContext): StrategyResult | null => {
    if (context.history.length < 22) return null;

    const sma9 = context.indicators.sma(9);
    const sma21 = context.indicators.sma(21);
    
    if (!sma9 || !sma21 || sma9.length < 2 || sma21.length < 2) return null;

    const prevSMA9 = sma9[sma9.length - 2];
    const prevSMA21 = sma21[sma21.length - 2];
    
    const currSMA9 = sma9[sma9.length - 1];
    const currSMA21 = sma21[sma21.length - 1];

    // Crossover de alta
    if (prevSMA9 <= prevSMA21 && currSMA9 > currSMA21) {
      return { action: "CALL", duration: 60, expiryCandles: 2 };
    }
    
    // Crossover de baixa
    if (prevSMA9 >= prevSMA21 && currSMA9 < currSMA21) {
      return { action: "PUT", duration: 60, expiryCandles: 2 };
    }

    return null;
  }
};

export default SMACrossoverStrategy;
