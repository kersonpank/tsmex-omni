# Volta completa em staging — resultado da Fase 1 (2026-11-10)

Ambiente: `staging-tsmex-dev`, commit `d0bcbc5`. Chamadas feitas na API pública do staging, com token de
operador HUB (SP-GRU e SLZ-MA) e ADMIN só onde indicado. Fiscal em homologação.

## Passo a passo

| # | Passo | Papel | Resultado |
|---|---|---|---|
| 0.2 | Cobertura SLZ-MA (15 cidades) e IMP-MA (2) | ADMIN | Gravou. O `PUT` de 15 linhas passou de 120 s sem responder; o de 2 linhas foi imediato |
| 0.3 | Operador de SLZ-MA | ADMIN | Criado (`hub.slz@tsmex.com`) |
| 0.4 | Fila de SP-GRU após cobertura | HUB | OK: grupo `TRANSFER → SLZ-MA` |
| A1 | SLZ lista viagem chegando | HUB destino | OK |
| A2 | Divergência + confirmar recebimento | HUB destino | OK: primeira viagem concluída da história. Divergência é só nota de texto |
| A3 | Pedido em estoque de SLZ | HUB destino | OK (`AT_HUB`, hub SLZ) |
| A4 | Pedido cai na fila de SLZ | HUB destino | **QUEBRADO**: ficou preso a um rascunho de viagem de SP-GRU; SLZ recebe 403 ao soltar. Só SP-GRU destravou. Depois: `UNROUTED` (pedido sem IBGE de destino) |
| B1 | Prontidão da viagem aceita `0b4481c5` | HUB origem | OK: faltavam só MDF-e e CIOT |
| B3 | CIOT em homologação | HUB origem | **QUEBRADO** (2 causas, abaixo) |
| B3b | Dispensa de CIOT com motivo | HUB origem | OK |
| B4 | MDF-e em homologação | HUB origem | **QUEBRADO**: ACBr recusa o payload |
| B5–B6 | Saída e chegada do tronco | — | Não testado: depende do MDF-e |
| C1–C5 | Viagem de entrega, comprovante, falha, encerramento fiscal | — | Não testado: depende do MDF-e |
| C6 | Fatura do pedido | ADMIN | **QUEBRADO**: `POST /invoices` devolve 500. HUB recebe 403 |
| C7 | Título e pagamento do transportador | ADMIN | OK: R$ 7.000 gerado e pago. HUB não acessa |
| C8 | Margem da viagem | — | Calculada no JSON (−183%); nenhuma tela mostra |
| D1 | Entrada de NF-e real (demanda aguardando) | HUB | OK |
| D2 | Volumes | HUB | OK |
| D3 | CT-e em homologação | HUB | OK: autorizado em cerca de 10 s, preço pela tabela |
| D4 | Pedido na fila com selo de documento | HUB | OK |

## Defeitos confirmados

1. **MDF-e nunca autoriza.** ACBr responde `InvalidJson: Invalid string JSON value at $.infMDFe.ide.procEmi`.
   `server/src/services/acbr/acbrMdfeEmit.ts:378` envia `procEmi: 0` (número); o provedor espera texto.
   Pode haver outros campos com o mesmo problema atrás deste. Sem MDF-e nenhuma viagem sai.
2. **Reenvio de CIOT trava para sempre.** `enqueueCiotEmissionJob` reutiliza o `jobId`; o BullMQ guarda o job
   concluído e ignora o novo. O registro fica `QUEUED`, e nova tentativa ou dispensa devolvem 409.
   A correção existe só na frente local não commitada (`ciotEmissionQueue.ts`).
3. **Fatura nunca funcionou.** `generateInvoiceNumber` (`server/src/routes/invoices.ts:17`) chama
   `pg_advisory_xact_lock(bigint, integer)`, assinatura que o Postgres não tem.
4. **Pedido recebido fica preso a rascunho de outro hub.** A chegada não solta vínculos com viagens em rascunho
   da origem, e o hub de destino não tem permissão para soltar.
5. **`PUT /hubs/:id/coverage` lento** com 15 linhas (mais de 120 s). Causa a investigar.

## Dependência externa

- CIOT em homologação: a placa `AFY2E46` da massa de teste da ANTT está "contratada para outro contratante".
  É preciso cadastrar outro conjunto da massa (transportador + veículo) para provar o CIOT.

## Confirmado no ambiente (já apontado na leitura do código)

- Hub de destino recebe 403 em `readiness`; faturas e títulos são só ADMIN.
- Só 5 dos 26 pedidos com CT-e autorizado são faturáveis: nos demais o pagador não tem conta de cliente.
- Valores de frete com 7 casas decimais (ex.: 4234.6293528) circulam como dinheiro.

## O que foi alterado no staging por este teste

- `HubCoverage`: 15 cidades em SLZ-MA e 2 em IMP-MA (escolha de teste; a cobertura real é decisão da torre).
- Usuário `hub.slz@tsmex.com` (operador SLZ-MA).
- Viagem `4ba0449a` concluída; pedido nº 1 em estoque de SLZ-MA e retirado do rascunho `8c729eca`.
- Viagem `0b4481c5`: saída prevista, Carta Frete (26.000 / adiantamento 0 / pedágio 1.800), dispensa de CIOT,
  1 MDF-e e 1 CIOT rejeitados. Job de CIOT reenfileirado à mão no Redis.
- Pedido novo nº 108 (Pinheiro-MA) com CT-e de homologação autorizado.
- Título de R$ 7.000 para o transportador da viagem `4ba0449a`, pago.
