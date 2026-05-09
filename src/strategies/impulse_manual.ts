import { Candle } from "@/lib/market";
import { Strategy, StrategyContext, StrategyResult } from "./index";
import { sma } from "@/lib/market";

/**
 * STRATEGY: IMPULSE (MANUAL/SEMI-AUTO)
 * Relies on Support/Resistance lines or zones drawn by the user.
 */

function getBodySizes(history: Candle[]) {
  return history.map(c => Math.abs(c.o - c.c));
}

const strategy: Strategy = {
  id: "impulse-manual",
  name: "Impulso (Linhas de S/R)",
  description: "Estratégia de Impulso que valida toques em zonas de Suporte e Resistência traçadas manualmente no gráfico.",
  category: "semi-auto",
  onTick: (context: StrategyContext): StrategyResult | null => {
    const { history, srLines, srZones } = context;
    if (history.length < 20) return null;

    const lastIdx = history.length - 1;
    const bodySizes = getBodySizes(history);
    const avgBody = (sma(bodySizes, 20)[lastIdx] as number) || 0;
    
    // Manual S/R Check
    const current = history[lastIdx];
    const threshold = current.c * 0.0005;

    const checkSREntry = (val: number, type: "support" | "resistance") => {
      const lineTouched = srLines.some(l => l.type === type && Math.abs(val - l.price) < threshold);
      const zoneTouched = srZones.some(z => z.type === type && val >= Math.min(z.p1, z.p2) && val <= Math.max(z.p1, z.p2));
      return lineTouched || zoneTouched;
    };

    const trigger = history[lastIdx];
    const posCandle = history[lastIdx - 1];
    const seqEndIdx = lastIdx - 2;
    if (seqEndIdx < 4) return null;

    const getSequence = (endIdx: number) => {
      const color = history[endIdx].c > history[endIdx].o ? "G" : "R";
      let count = 0;
      for (let i = endIdx; i >= 0; i--) {
        const cColor = history[i].c > history[i].o ? "G" : "R";
        if (cColor === color) count++;
        else break;
      }
      return { color, count };
    };

    const seq = getSequence(seqEndIdx);

    const isImpulseSeq = (seqInfo: { color: string, count: number }, startIdx: number) => {
      // Minimum of 3 candles as requested
      if (seqInfo.count < 3 || seqInfo.count > 6) return false;
      
      // Focus on movement direction rather than extreme candle size
      for (let i = 0; i < seqInfo.count; i++) {
        if (bodySizes[startIdx - i] < avgBody * 0.4) return false;
      }
      return true;
    };

    // SELL SIGNAL
    if (seq.color === "G" && isImpulseSeq(seq, seqEndIdx)) {
       if (posCandle.c < posCandle.o) {
          const touchedRes = checkSREntry(history[seqEndIdx].h, "resistance") || checkSREntry(posCandle.h, "resistance");
          
          if (touchedRes) {
             // Breakout continuation
             if (trigger.c > trigger.o && trigger.c > posCandle.h) {
                return { action: "CALL", duration: 60 };
             }
             // Mean reversion
             if (trigger.h <= posCandle.h) {
                return { action: "PUT", duration: 60 };
             }
          }
       }
    }

    // BUY SIGNAL
    if (seq.color === "R" && isImpulseSeq(seq, seqEndIdx)) {
       if (posCandle.c > posCandle.o) {
          const touchedSup = checkSREntry(history[seqEndIdx].l, "support") || checkSREntry(posCandle.l, "support");
          
          if (touchedSup) {
             // Breakout continuation
             if (trigger.c < trigger.o && trigger.c < posCandle.l) {
                return { action: "PUT", duration: 60 };
             }
             // Mean reversion
             if (trigger.l >= posCandle.l) {
                return { action: "CALL", duration: 60 };
             }
          }
       }
    }

    return null;
  }
};

export default strategy;
