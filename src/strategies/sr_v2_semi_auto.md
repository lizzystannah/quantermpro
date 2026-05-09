# Estratégia Suporte e Resistência V2 (Semiautomático)

Esta versão aprimora a estratégia SR V1 com foco em zonas de alta probabilidade baseadas em reincidência.

## Regras de Execução Matemática

### 1. Critério de Validação (O "Respeito")
Uma vela é considerada "Respeito" quando:
- **Suporte:** `Open > Preço` && `Low <= Preço` && `Close > Preço`.
- **Resistência:** `Open < Preço` && `High >= Preço` && `Close < Preço`.

### 2. A Regra do Range (10 Velas)
A estratégia monitora os últimos 10 candles.
- Se dentro de um range de **10 velas**, o preço tocou a linha **duas vezes** e respeitou (fechou do lado correto), o sinal de entrada é validado.
- Mesmo que a primeira vez tenha "falhado" (não tenha resultado em win anterior), a segunda validação no intervalo libera a sequência.

### 3. Sequência de 3 Entradas
Uma vez que o critério de "Duplo Toque Respeitado" é atingido:
- O script está autorizado a realizar até **3 entradas consecutivas** (uma por vela) a favor da direção (COMPRA para Suporte, VENDA para Resistência).
- Estas entradas ocorrem mesmo que as velas 2 e 3 da sequência estejam distantes da linha, pois baseiam-se na força do suporte/resistência confirmado.

## Invariantes
- **Range:** O cálculo de 10 velas é fixo.
- **Sequência:** Se uma sequência de 3 velas for iniciada, ela deve ser concluída antes de buscar um novo padrão de duplo toque na mesma linha.
- **Matemática Pura:** Sem tolerância, apenas comparação direta de preços.
