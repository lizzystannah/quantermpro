# Documentação do Sistema de Estratégias

## 📁 Estrutura de Diretórios
O sistema foi projetado para ser totalmente dinâmico. Todas as estratégias devem ser colocadas na pasta `/src/strategies/`.
Nenhuma alteração é necessária no core do aplicativo ao adicionar uma nova estratégia, pois o FrontEnd carrega automaticamente as estratégias registradas ou implementa uma ponte baseada nesta estrutura.

## 🖼️ Interface Obrigatória
Cada estratégia deve implementar a interface `Strategy`:
```typescript
import { Strategy, StrategyContext, StrategyResult } from "./index";

const MinhaEstrategia: Strategy = {
  id: "id_unico_da_estrategia",
  name: "Nome da Estratégia",
  description: "Descrição breve da lógica",
  onTick: (context: StrategyContext): StrategyResult | null => {
    // Lógica aqui
    return null;
  }
};

export default MinhaEstrategia;
```

## 🧠 Contexto (StrategyContext)
Ao executar `onTick(context)`, a estratégia recebe:

- `asset`: (string) O ativo atual (ex: "R_100");
- `lastPrice`: (number) O preço mais recente do ativo.
- `history`: Array com histórico de candles contendo `{t, o, h, l, c}`.
- `balance`: (number) Saldo atual do usuário.
- `indicators`: Funções para acessar os indicadores técnicos mais comuns:
  - `indicators.rsi(period: number)`
  - `indicators.sma(period: number)`
  - `indicators.ema(period: number)`
  - `indicators.bollinger(period, multiplier)`
  - `indicators.adx(period)`

Esses indicadores calculam imediatamente os resultados usando os preços de fechamento (e máximas/mínimas para ADX) do histórico atual.

## 🔄 Emitindo Sinais de Trading
Sua estratégia deve retornar um objeto `StrategyResult` se desejar abrir uma operação, ou `null` para aguardar.

Ao preencher `StrategyResult`:
- `action`: Pode ser `"CALL"`, `"PUT"` (opções binárias) ou `"BUY"`, `"SELL"` (forex).
- `duration`: opcional. Duração em segundos (usado em contas Demo/Reais).
- `expiryCandles`: opcional. Obrigatório recomendar usar para backtesting preciso. Define em quantas velas a operação vai espirar. Se não definido, no backtest ele faz uma heurística dividindo a duração definida no painel pelo timeframe atual.
- `stake`: opcional. Caso não fornecido, usará a stake configurada no painel.

Exemplo de Operação ("CALL" expirando em 1 vela):
```typescript
return {
  action: "CALL",
  expiryCandles: 1
};
```

## ⏱️ Tempo de Expiração e Backtesting
No Modo Backtest, o sistema SIMULA o tempo baseado *estritamente em velas*. Não existem temporizadores de segundos (`setTimeout`).
A entrada no backtest é gravada no fechamento da vela atual (`idx`). Se `expiryCandles: 1`, a resolução ocorre comparando a entrada com o preço da próxima vela (`idx + 1`).

## 🔒 Boas Práticas
- Só execute chamadas (returns) quando um rompimento/condição ocorrer no frame de mudança.
- O sistema possui gestão de risco (Anti-Martingale, Stop-Loss), então você não precisa criar gestões de risco rígidas dentro da estratégia, o núcleo do software bloqueará caso haja estouro.
