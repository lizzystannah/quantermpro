import { Strategy, StrategyContext, StrategyResult } from "./index";

const RSIStepStrategy: Strategy = {
  id: "rsi_step",
  name: "RSI Reversão",
  description: "Opera reversão quando RSI < 30 (CALL) ou RSI > 70 (PUT)",
  onTick: (context: StrategyContext): StrategyResult | null => {
    // Exige no minimo 14 velas para RSI
    if (context.history.length < 15) return null;

    const rsiArr = context.indicators.rsi(14);
    if (!rsiArr || rsiArr.length === 0) return null;

    const lastRsi = rsiArr[rsiArr.length - 1];

    if (lastRsi < 30) {
      return { action: "CALL", duration: 60, expiryCandles: 1 };
    }
    
    if (lastRsi > 70) {
      return { action: "PUT", duration: 60, expiryCandles: 1 };
    }

    return null;
  }
};

export default RSIStepStrategy;
