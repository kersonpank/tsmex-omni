# Volta completa da roda em staging — Plano

> **Para agentes:** execute tarefa por tarefa. Fase 1 é descoberta (nenhum código muda). As correções da
> Fase 2 só recebem plano detalhado (arquivos, testes, código) depois que a Fase 1 registrar o que
> realmente quebra — decisão do dono em 2026-11-10: "primeiro clareza do que já funciona, depois corrigir".

**Objetivo:** uma remessa real dá a volta completa na roda dentro do staging, só pelas rotas que o TSM O.S.
(`/#/hubs`) usa: entra → etiqueta → documento do frete → consolida → viaja → chega → entrega → fatura → paga.

**Arquitetura:** o staging (`staging-tsmex-dev`, commit `d0bcbc5` = `origin/develop`) é o ambiente de prova.
Cada passo é executado contra a API pública do staging com token de operador HUB (ADMIN só onde o papel HUB
é recusado, e isso vira achado). Fiscal em homologação (ACBr e e-Frete). Painel do Link fica fora.

**Fora de escopo:** painel/app do Link, produção, A6/A6.1 (volumetria 3D, custódia por volume), chat/IA,
portal do cliente. Copiloto/autopiloto só depois da roda fechada.

**Fonte de verdade do estado:** banco do staging + respostas da API. Documentos `.md` não são evidência.

---

## Estado de partida (medido em 2026-11-10)

| Item | Valor |
|---|---|
| Pedidos | 32 (31 `AT_HUB` em SP-GRU, 1 `IN_TRANSIT`) |
| Viagens | 22; 1 `IN_PROGRESS` desde 2026-07-28; 3 `ACCEPTED` GRU→SLZ; 0 concluídas |
| CT-e | 26 autorizados (homologação); 9 em `CTE_PENDING_RECONCILIATION` desde julho |
| MDF-e | nunca emitido (`lastMdfeNumber = 0`) |
| CIOT | 1 tentativa, rejeitada pelo e-Frete em 2026-11-02 |
| `HubCoverage` | 0 linhas |
| Operadores de hub | só SP-GRU (3 usuários). IMP-MA e SLZ-MA sem operador |
| Entregas, faturas, títulos | 0 / 0 / 0 |
| Emitente | TransMesquita, ACBR/HOMOLOGACAO, certificado válido até 2027-09-10 |

Destino real da carga em estoque: interior do Maranhão em torno de São Luís (Santa Inês, Pinheiro, Bacabal,
Viana, Rosário, São José de Ribamar…). **Rota piloto da volta: SP-GRU → SLZ-MA → entrega regional.**

---

## Fase 0 — Preparação do ambiente (torre)

- [ ] **0.1** Backup em arquivo da frente local não commitada (`../_backup_frente_local_2026-11-10/`). ✅ feito
- [ ] **0.2** Cadastrar `HubCoverage` de SLZ-MA com as cidades dos pedidos em estoque e de IMP-MA com Imperatriz,
      Açailândia e João Lisboa (`PUT /api/hubs/:id/coverage`, ADMIN).
- [ ] **0.3** Criar um operador HUB para SLZ-MA (sem ele ninguém recebe a carga no destino).
- [ ] **0.4** Conferir a fila de consolidação de SP-GRU depois da cobertura: os grupos devem apontar SLZ-MA.

Critério: `GET /api/hub/cargo/queues` em SP-GRU mostra grupo `TRANSFER → SLZ-MA`; nenhum pedido com destino
coberto fica em `UNROUTED`.

## Fase 1 — A volta (descoberta, sem mudar código)

Registrar para cada passo: chamada, HTTP, o que mudou no banco, veredito (OK / ATRITO / QUEBRADO / NÃO EXISTE)
e a mensagem de erro literal. Resultado em `docs/superpowers/plans/2026-11-10-volta-completa-resultado.md`.

**Volta A — chegada primeiro (viagem que já está na estrada)**
- [ ] **A1** Viagem `4ba0449a` (`IN_PROGRESS` desde julho): operador SLZ-MA lista viagens chegando.
- [ ] **A2** Marca um pedido como divergente e confirma o recebimento (`PATCH /manifests/:id/complete`).
- [ ] **A3** Conferir: pedido `AT_HUB` em SLZ-MA, `enteredAtHubAt`, perna concluída, `FiscalClosureTask`.
- [ ] **A4** Fila de SLZ-MA: o pedido reaparece sozinho? Em qual grupo (LOCAL/TRANSFER/UNROUTED)?

**Volta B — tronco completo (viagem aceita GRU → SLZ)**
- [ ] **B1** Escolher uma viagem `ACCEPTED` GRU→SLZ; ler `readiness` e listar todas as pendências.
- [ ] **B2** Resolver pendências só com as rotas do O.S. (ficha do transportador, placas, Carta Frete).
- [ ] **B3** CIOT em homologação (ou dispensa com motivo, se o transportador permitir).
- [ ] **B4** MDF-e em homologação — primeira emissão da história.
- [ ] **B5** Saída (`PATCH /manifests/:id/start`) pelo hub de origem, em nome do transportador.
- [ ] **B6** Chegada em SLZ-MA (como A2–A4).

**Volta C — entrega e dinheiro**
- [ ] **C1** Em SLZ-MA, montar a viagem de entrega a partir do grupo LOCAL e despachar.
- [ ] **C2** Registrar entrega com comprovante (`POST /manifests/:id/delivery-attempts`) como HUB.
- [ ] **C3** Registrar uma entrega que falha, com `nextAction`; ver o que acontece com pedido e viagem.
- [ ] **C4** Concluir a viagem de entrega; pedido `DELIVERED`.
- [ ] **C5** Encerramento fiscal automático: MDF-e e CIOT fechados, sem `SystemAlert` novo.
- [ ] **C6** Fatura do pedido entregue (`/invoices/eligible-orders` → `POST /invoices`) e recebimento.
- [ ] **C7** Título do transportador (`/payables/settlement-candidates` → `from-manifest`) e pagamento.
- [ ] **C8** Margem da viagem devolvida por `GET /manifests/:id`: conferir à mão contra CT-e e Carta Frete.

**Volta D — entrada nova no build atual**
- [ ] **D1** Uma demanda `AWAITING_ARRIVAL` real → `confirm-arrival` → pedido em estoque.
- [ ] **D2** Volumes (`PUT /orders/:id/packages`).
- [ ] **D3** Documento do frete: sugestão → `prepare` → `emit-cte`; acompanhar até `CTE_AUTHORIZED`.
- [ ] **D4** Pedido aparece na fila de consolidação com selo de documento.

## Fase 2 — Correções (detalhar depois da Fase 1)

Candidatas já apontadas pela leitura do código; a Fase 1 confirma, descarta ou reordena.

| # | Correção | Onde | Esforço |
|---|---|---|---|
| F1 | Estação **Entregar** no O.S. + HUB conclui viagem `DELIVERY` do próprio hub | `components/os`, `server/src/routes/manifests.ts` | M |
| F2 | Entrega que falha: `nextAction` devolve o pedido ao estoque; viagem fecha com pernas não entregues, com motivo | `server/src/services/deliveryAttempts.ts`, `manifestLifecycle.ts` | M |
| F3 | Conferência de chegada com efeito: divergência vai ao backend, "não chegou" não vira estoque, uma rota só | `TripReceivePage.tsx`, `manifestLifecycle.ts` | M |
| F4 | Próximo salto real (rota via hub intermediário) em `resolveNextHop` | `server/src/services/hubCargo/consolidationQueue.ts`, schema | M–G |
| F5 | CIOT e MDF-e autorizando em homologação (causa a descobrir em B3/B4) | `server/src/services/efrete`, `acbr` | ? |
| F6 | Varredor de conciliação de CT-e/MDF-e/CIOT pendentes no worker | `server/src/worker.ts` | M |
| F7 | Ator nos eventos de chegada, entrega e cancelamento | `manifestLifecycle.ts`, `deliveryAttempts.ts` | P |
| F8 | Margem: receita sem dupla contagem por perna e sem ICMS | `server/src/services/pricingService.ts` | M |
| F9 | Cancelar viagem pelo O.S.; correção de viagem em execução devolve custódia | `components/os`, `manifestPlanningChanges.ts` | M |
| F10 | Integrar a frente local (liberação pelo operador + histórico CIOT) sobre `origin/develop` | 27 arquivos em conflito | G |

Regra: cada correção entra com teste, passa `typecheck:server`, `typecheck:web`, `test:server`, `npm test`, sobe
para o staging por `develop` e o passo correspondente da Fase 1 é reexecutado.

## Fase 3 — Prova permanente

- [ ] Script de smoke `server/scripts/smoke-volta-completa.mjs` que roda a volta por API contra o staging
      (padrão de `server/scripts/smoke-pr002-intake.mjs`) e falha no primeiro passo quebrado.
- [ ] Rodar o smoke depois de cada deploy de staging.

## Critério de saída do marco 1

1. Uma remessa completa as voltas B + C sem SQL manual e sem papel ADMIN nos passos de hub.
2. CT-e, MDF-e e CIOT autorizados e encerrados em homologação.
3. Uma entrega com comprovante, uma com falha tratada, uma chegada com divergência registrada.
4. Fatura emitida com o valor do CT-e e título do transportador com o saldo da Carta Frete.
5. Smoke verde em dois deploys seguidos.
6. `TSM_NORTE.md` atualizado: itens da Etapa A marcados conforme o código real.
