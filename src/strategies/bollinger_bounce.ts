import { Strategy, StrategyContext, StrategyResult } from "./index";

const BollingerBounceStrategy: Strategy = {
  id: "bollinger_bounce",
  name: "Bollinger Bounce",
  description: "Aposta na reversão quando o preço toca ou ultrapassa nas bandas de Bollinger.",
  category: "auto",
  onTick: (context: StrategyContext): StrategyResult | null => {
    if (context.history.length < 21) return null;

    const { upper, lower } = context.indicators.bollinger(20, 2);
    
    if (!upper || !lower || upper.length === 0 || lower.length === 0) return null;

    const lastUpper = upper[upper.length - 1];
    const lastLower = lower[lower.length - 1];
    const lastPrice = context.lastPrice;

    if (lastPrice <= lastLower) {
      // Preço na banda inferior ou abaixo dela -> Reversão para cima
      return { action: "CALL", duration: 60, expiryCandles: 1 };
    }
    
    if (lastPrice >= lastUpper) {
      // Preço na banda superior ou acima dela -> Reversão para baixo
      return { action: "PUT", duration: 60, expiryCandles: 1 };
    }

    return null;
  }
};

export default BollingerBounceStrategy;
