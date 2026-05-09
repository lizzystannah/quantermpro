# Estratégia Suporte e Resistência (Semiautomático)

Esta documentação serve como a "verdade única" para o comportamento do script de Suporte e Resistência.

## Regras de Execução Matemática

A estratégia opera baseada em linhas de preço específicas definidas pelo usuário no gráfico.

### 1. Contexto de Definição
- Uma linha é considerada **Suporte** se o preço de abertura da vela atual está **acima** do preço da linha.
- Uma linha é considerada **Resistência** se o preço de abertura da vela atual está **abaixo** do preço da linha.

### 2. Critérios para Entrada de COMPRA (CALL)
Para que uma ordem de compra seja disparada, os seguintes critérios matemáticos devem ser atendidos na **mesma vela**:
1. **Nascimento:** `Vela.Open > Preço_da_Linha`
2. **Toque:** `Vela.Low <= Preço_da_Linha` (Igual ou inferior)
3. **Fechamento:** `Vela.Close > Preço_da_Linha` (Deve fechar acima da linha)
4. **Acionamento:** A entrada ocorre imediatamente após o fechamento desta vela que validou os 3 pontos acima.

### 3. Critérios para Entrada de VENDA (PUT)
Para que uma ordem de venda seja disparada, os seguintes critérios matemáticos devem ser atendidos na **mesma vela**:
1. **Nascimento:** `Vela.Open < Preço_da_Linha`
2. **Toque:** `Vela.High >= Preço_da_Linha` (Igual ou superior)
3. **Fechamento:** `Vela.Close < Preço_da_Linha` (Deve fechar abaixo da linha)
4. **Acionamento:** A entrada ocorre imediatamente após o fechamento desta vela que validou os 3 pontos acima.

## Invariantes
- **Sem Tolerância:** Não existe margem de erro (pips/pontos). A comparação é estritamente `>=` ou `<=`.
- **Vela Única:** O toque e o fechamento validado precisam ocorrer na mesma unidade de tempo (candle).
- **Reset de Backtest:** Ao mudar a estratégia ativa no modo Backtest, os trades anteriores devem ser removidos para evitar poluição de dados de estratégias diferentes.
