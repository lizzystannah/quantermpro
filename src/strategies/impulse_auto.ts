import { Candle } from "@/lib/market";
import { Strategy, StrategyContext, StrategyResult } from "./index";
import { sma } from "@/lib/market";

/**
 * STRATEGY: IMPULSE (AUTO)
 * Detects impulses hitting automatic Support/Resistance zones.
 */

// Helper to calculate body sizes
function getBodySizes(history: Candle[]) {
  return history.map(c => Math.abs(c.o - c.c));
}

// Helper to find automatic S/R zones
function findSRZones(history: Candle[]) {
  const peaks: number[] = [];
  const troughs: number[] = [];
  
  // Look for pivot points
  for (let i = 2; i < history.length - 2; i++) {
    const c = history[i];
    const prev1 = history[i - 1];
    const prev2 = history[i - 2];
    const next1 = history[i + 1];
    const next2 = history[i + 2];
    
    if (c.h > prev1.h && c.h > prev2.h && c.h > next1.h && c.h > next2.h) {
      peaks.push(c.h);
    }
    if (c.l < prev1.l && c.l < prev2.l && c.l < next1.l && c.l < next2.l) {
      troughs.push(c.l);
    }
  }
  
  // Return recent extremes as potential zones
  return { peaks, troughs };
}

const strategy: Strategy = {
  id: "impulse-auto",
  name: "Impulso (100% Automático)",
  description: "Detecta impulsos agressivos em zonas de S/R calculadas automaticamente. Analisa sequência de velas grandes e rejeições em níveis críticos.",
  category: "auto",
  onTick: (context: StrategyContext): StrategyResult | null => {
    const { history } = context;
    if (history.length < 20) return null;

    const lastIdx = history.length - 1;
    const current = history[lastIdx];
    const prev = history[lastIdx - 1]; // This is the "Impulse Position Candle" or "Trigger Candle" depending on state
    
    // We need at least the last few candles to identify the pattern
    // The user description suggests a sequence, then an impulse candle, then a trigger candle.
    // So we evaluate at the close of the trigger candle.
    
    const bodySizes = getBodySizes(history);
    const avgBody = (sma(bodySizes, 20)[lastIdx] as number) || 0;
    
    // Detect Support/Resistance
    const { peaks, troughs } = findSRZones(history.slice(-100)); // Use last 100 for zones
    const threshold = current.c * 0.0005; // 0.05% tolerance for "touch"
    
    const checkTouchRes = (val: number) => peaks.some(p => Math.abs(val - p) < threshold);
    const checkTouchSup = (val: number) => troughs.some(t => Math.abs(val - t) < threshold);

    // Analyze sequence BEFORE the impulse candle
    // Let's check for a Bullish Impulse (Sequence of Red hitting support -> Green counter -> Trigger)
    // Wait, the user's example was: Green sequence -> Red counter -> Trigger -> Entry.
    
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

    // Pattern for SELL:
    // 1. Sequence of Green (2-4 candles)
    // 2. Large candles (Impulse)
    // 3. Counter-movement (Red candle) - "Impulse Position"
    // 4. Trigger candle (didn't break high)
    
    // We are at index 'lastIdx' (Trigger candle just closed).
    // prev (lastIdx - 1) is Impulse Position candle.
    // prev2 (lastIdx - 2) is the end of the sequence.

    const trigger = history[lastIdx];
    const posCandle = history[lastIdx - 1];
    const seqEndIdx = lastIdx - 2;
    if (seqEndIdx < 4) return null;
    
    const seq = getSequence(seqEndIdx);
    
    // Criteria for sequence "Impulse"
    const isImpulseSeq = (seqInfo: { color: string, count: number }, startIdx: number) => {
      // Minimum of 3 candles as requested
      if (seqInfo.count < 3 || seqInfo.count > 6) return false;
      
      // We still want "healthy" movement, but not necessarily "extra large"
      // Just ensure they aren't tiny dojis
      for (let i = 0; i < seqInfo.count; i++) {
        if (bodySizes[startIdx - i] < avgBody * 0.4) return false;
      }
      return true;
    };

    // SELL SIGNAL (Retracement from Green Peak)
    if (seq.color === "G" && isImpulseSeq(seq, seqEndIdx)) {
       const posColor = posCandle.c > posCandle.o ? "G" : "R";
       if (posColor === "R") {
          // Sync check: Seq end or Pos candle touched resistance
          const touchedRes = checkTouchRes(history[seqEndIdx].h) || checkTouchRes(posCandle.h);
          
          if (touchedRes) {
             // Exception 3: If trigger breaks resistance with body -> BUY instead
             if (trigger.c > trigger.o && trigger.c > posCandle.h) {
                return { action: "CALL", duration: 60 };
             }

             // Standard Sell Entry: Trigger candle didn't break position high
             if (trigger.h <= posCandle.h) {
                return { action: "PUT", duration: 60 };
             }
          }
       }
    }

    // BUY SIGNAL (Retracement from Red Dip)
    if (seq.color === "R" && isImpulseSeq(seq, seqEndIdx)) {
       const posColor = posCandle.c > posCandle.o ? "G" : "R";
       if (posColor === "G") {
          const touchedSup = checkTouchSup(history[seqEndIdx].l) || checkTouchSup(posCandle.l);
          
          if (touchedSup) {
             // Exception 3: If trigger breaks support with body -> SELL instead
             if (trigger.c < trigger.o && trigger.c < posCandle.l) {
                return { action: "PUT", duration: 60 };
             }

             // Standard Buy Entry
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
