# Fatia 1 — Jornada da Demanda (multi-perna) + Fonte única de verdade

**Data:** 2026-06-02
**Status:** Design aprovado (aguardando revisão do spec)
**Escopo:** Espinha operacional do ciclo. NÃO inclui custo/margem/faturamento (Fatia 2).

---

## 1. Contexto e problema

O ciclo atual roda ponta a ponta para **uma única perna** (uma transferência OU uma entrega). A operação real é **multi-perna, multi-hub**: coleta/drop → hub origem → transferência(s) → hub destino → entrega. Hoje o código:

- **Proíbe multi-perna por design** — `assertDemandNotInOtherActiveManifest` ([manifestLifecycle.ts:73](../../../server/src/services/manifestLifecycle.ts)) impede uma carga em 2 manifestos ativos. Multi-perna só por reatribuição sequencial de `manifestId`, que **sobrescreve e perde a perna anterior**.
- **Mantém dupla fonte de verdade** — `demand.status` e `order.status` atualizados em lockstep ([orders.ts:968](../../../server/src/routes/orders.ts), manifestLifecycle). Duas máquinas de estado para uma carga física → divergem.
- **Não captura dado de IA** — `ConsolidationFeedback` existe no schema mas **nunca é gravado**.

Sem perna estruturada, o custo por trecho (Fatia 2) é incalculável — logo margem é impossível. Esta fatia é pré-requisito de tudo.

## 2. Princípios (inegociáveis)

1. **A fronteira é a POSSE.** Demanda = oportunidade (cotação, NF emitida com nosso CNPJ, solicitado coleta — ainda não é nossa). Pedido = já em nossa posse (coletado / deu entrada no CD).
2. **Pedido é a ÚNICA fonte do estado físico/custódia.** Demanda para de rastrear movimento após virar pedido.
3. **Pernas emergem na operação.** Sem planejador de rota automático. Humano monta manifesto e encaixa pedido perna a perna, como já faz. O sistema só para de perder o rastro.
4. **Corpo físico não habita dois lugares.** Custódia derivada da perna ativa, nunca campo solto.
5. **Capturar dado de IA desde o dia 1**, mesmo 100% manual.
6. **Zero IA automática nesta fatia.** Só fundação de captura.

## 3. Modelo de dados

### 3.1 Nova entidade: `OrderLeg` (perna)

Cada linha = "este pedido viajou neste manifesto" = uma perna da jornada.

```prisma
model OrderLeg {
  id          String     @id @default(uuid())
  orderId     String
  order       Order      @relation(fields: [orderId], references: [id], onDelete: Cascade)
  manifestId  String
  manifest    Manifest   @relation(fields: [manifestId], references: [id], onDelete: Cascade)
  sequence    Int        // ordem na jornada (1, 2, 3...)
  legType     LegType    // COLETA | TRANSFERENCIA | ENTREGA
  executedBy  ExecutedBy // HUB | LINK  (entrega pode ser do próprio hub de distribuição)
  originHubId String?    // hub de origem da perna (null na coleta na ponta)
  destHubId   String?    // hub de destino da perna (null na entrega final)
  // allocatedCost: ADICIONADO NA FATIA 2 (rateio do custo do manifesto por m³/kg) — não nesta fatia
  startedAt   DateTime?
  completedAt DateTime?
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  @@unique([orderId, manifestId])
  @@index([orderId])
  @@index([manifestId])
}

enum LegType { COLETA TRANSFERENCIA ENTREGA }
enum ExecutedBy { HUB LINK }
```

> **Jornada do pedido** = suas `OrderLeg` ordenadas por `sequence`.

### 3.2 Mudanças em `Order`

- **Remover** `manifestId` único (vira histórico de pernas via `OrderLeg`). Manter coluna deprecada temporariamente para compat de leitura durante migração, depois drop.
- **Manter** `currentHubId` (custódia atual — onde a carga está parada).
- `Order.legs OrderLeg[]`.

### 3.3 Mudanças em `Demand`

- **Remover** `manifestId` (redundante; o vínculo de transporte é do pedido).
- `DemandStatus` restrito ao **pré-posse**: `AWAITING_ARRIVAL`, `PENDING`, `QUOTED`, `APPROVED`, `CONVERTED` (virou pedido), `LOST`, `CANCELLED`. Estados de movimento (`ASSIGNED`, `COLLECTED`, `IN_TRANSIT`, `AT_HUB`, `OUT_FOR_DELIVERY`, `DELIVERED`) **saem da demanda** — passam a viver só no pedido.

### 3.4 Mudanças em `Hub`

- `roles HubRole[]` — um hub pode ter vários papéis ou todos.

```prisma
enum HubRole { RECEBIMENTO COLETA DISTRIBUICAO TRIAGEM }
```

### 3.5 `Manifest`

- `Manifest.legs OrderLeg[]` (a relação real passa a ser pedido↔manifesto via perna).
- Manter `demands`/`orders` legados durante migração; alvo é o consumo migrar para `legs`.

### 3.6 `ConsolidationFeedback` (fundação de IA — passa a ser gravado)

- Re-chavear de `demandIds` para `orderIds` (a consolidação opera sobre pedidos físicos).
- `utilizationBefore/After` mantidos. `marginBefore/After` ADICIONADOS na Fatia 2.
- **Gravar uma linha a cada consolidação** (add/remove de perna), mesmo 100% manual: `action=ACCEPTED`, `suggestedManifests=null` (sem sugestão de IA ainda), `finalManifests` = estado resultante.

## 4. Máquinas de estado (separadas pela posse)

```text
DEMANDA (pré-posse, oportunidade):
  AWAITING_ARRIVAL / PENDING → QUOTED → APPROVED → CONVERTED
                                              ↘ LOST / CANCELLED

  --- FRONTEIRA DA POSSE (coleta efetuada OU entrada no CD) ---

PEDIDO (em posse, fonte única do físico):
  PENDING(criado: coletado/entrada)
     → IN_TRANSIT (perna ativa)  ⇄  AT_HUB (currentHubId = hub Y)
     → OUT_FOR_DELIVERY
     → DELIVERED
     (CANCELLED a qualquer momento)
```

- **Custódia** = derivada: se há `OrderLeg` com manifesto `IN_PROGRESS` → `IN_TRANSIT` naquela perna; senão `AT_HUB` em `currentHubId`; antes da 1ª perna → aguardando.
- **Handoff demanda→pedido:** ao coletar (intent COLLECT) ou dar entrada (DROP_AT_HUB), cria-se o `Order` e a demanda vai a `CONVERTED`. A partir daí, demanda não muda mais por movimento.

## 5. Invariante que substitui o bloqueio atual

Trocar `assertDemandNotInOtherActiveManifest` por regra ciente de perna:

> Um pedido pode ter **N pernas** (histórico + futuras), mas **no máximo uma perna com manifesto `IN_PROGRESS`** ao mesmo tempo (não pode estar fisicamente em dois caminhões). Pernas em manifesto `DRAFT`/`PENDING_ACCEPT`/`ACCEPTED` são planejamento e podem coexistir.

Isso preserva "corpo não em dois lugares" e libera multi-perna + pré-encaixe.

## 6. Fluxos afetados

- **Consolidação** (`addDemandToManifest` → renomear/refatorar para `addOrderToManifest`): cria `OrderLeg` (sequence = última+1, legType pela `tripType`/contexto, executedBy), atualiza ocupação do manifesto, **grava ConsolidationFeedback**.
- **Remover de manifesto**: remove a `OrderLeg` correspondente (não mexe em pernas concluídas).
- **start/complete manifesto** ([manifestLifecycle.ts](../../../server/src/services/manifestLifecycle.ts)): operam sobre as `OrderLeg` do manifesto; atualizam `Order.status`/`currentHubId` e marcam `leg.startedAt`/`completedAt`. **Param de escrever `demand.status`.**
- **orders/:id/status**: continua como atualização manual de pedido, mas **para de escrever `demand.status`**. Reconciliar com a perna ativa (ou bloquear transição manual que conflite com manifesto IN_PROGRESS — decidir na implementação).
- **DELIVERY hub-próprio**: perna `ENTREGA` com `executedBy=HUB` não exige Link.

## 7. Migração de dados

1. Para cada `Order` com `manifestId` não-nulo: criar `OrderLeg(sequence=1, legType = manifest.tripType→COLETA/TRANSFERENCIA/ENTREGA, executedBy=LINK, manifestId, completedAt = manifest.completedAt)`.
2. Backfill `Hub.roles` com valor padrão sensato (ex.: todos `[RECEBIMENTO, DISTRIBUICAO]`) — ajustável depois.
3. `Demand.status` de movimento → mapear para `CONVERTED` (já viraram pedido).
4. Drop `Demand.manifestId`. Deprecar `Order.manifestId` (manter coluna até consumo migrar, depois drop em migração seguinte).

## 8. Fora de escopo (Fatia 2+)

- `OrderLeg.allocatedCost`, custo do Link/Hub, comissão, **margem**.
- `marginBefore/After` no feedback.
- Frete (`OrderFreightCalculation.freightTotal`) → duplicata automática.
- Gateway de pagamento, contas a pagar/receber, settlement.
- Sugestão de IA (só capturamos dado aqui).

### 8.1 Decisões de contexto (registradas, fora desta fatia)

- **Segurança = gate de pré-produção, não agora.** O sistema novo ainda não tem usuários reais (está sendo construído; a operação real roda no TMS atual). Itens verificados a corrigir ANTES do go-live com operação real: chave LLM (`LLMApiKey.apiKey`) em plaintext → cifrar com o mesmo AES-256-GCM já usado em [fiscalEmitterService.ts](../../../server/src/services/fiscalEmitterService.ts); guard `NODE_ENV` no seed. Certificado A1 já está cifrado corretamente (AES-256-GCM) — OK.
- **Frontend = refatorar depois, não bloqueia.** UIs cresceram soltas. Refatoração futura com foco em experiência + máxima automação operacional. **/hub é a superfície principal hoje** — o payoff backend desta fatia (receber, custódia, consolidar) aparece no /hub. O plano amarra Fatia 1 aos toques do /hub, sem refatorar o resto do front.

## 9. Riscos

- **Migração com operação real rodando** (GRU/MA). Backfill precisa ser idempotente e testado em cópia antes de prod. Dinheiro/carga real → rigor máximo.
- **Consumidores de `Order.manifestId`/`Demand.manifestId`** espalhados (frontend, dashboards). Mapear todos antes do drop — fase deprecada cobre isso.
- **orders/:id/status manual vs manifesto**: risco de transição conflitante. Definir reconciliação na implementação.

## 10. Critérios de aceite

- [x] Um pedido percorre ≥2 pernas (coleta→transferência→entrega) preservando todas as `OrderLeg`.
- [x] Custódia sempre resolvível: em qual hub OU em qual perna/Link, nunca ambíguo.
- [x] `demand.status` não muda mais após `CONVERTED`.
- [x] Cada add/remove de perna grava `ConsolidationFeedback`.
- [x] Invariante "uma perna IN_PROGRESS por pedido" garantida (teste).
- [x] Testes de lifecycle existentes ([manifests.lifecycle.test.ts](../../../server/src/routes/manifests.lifecycle.test.ts)) adaptados e verdes.
- [ ] Migração backfill idempotente de dados legados: não foi necessária nesta rodada (nenhum manifesto em produção real dependia da mudança); `Order.manifestId` seguiu mantido como coluna de compat, sem uso na lógica nova.

> **2026-07-25 — Fatia 1.5** (fora do escopo original deste spec, registrada aqui por continuidade): o fluxo de consolidação pela UI (Hub e Admin) estava quebrado apesar do backend acima estar correto — corrigido. Além disso, o modelo evoluiu para suportar **múltiplas paradas/descargas por viagem** (`ManifestStop`), **capa da viagem + Carta Frete estruturada** (`ManifestFreightAgreement`, fonte real de custo do Link), correção de um bug fiscal no MDF-e (município de descarga errado, sem suporte a múltiplas descargas) e **encerramento automático best-effort de CIOT/MDF-e** ao concluir a viagem. Detalhes em `TSM_NORTE.md` §6 "Fatia 1.5". Endpoint de encerramento do MDF-e via ACBr (`/mdfe/{id}/encerrar`) ainda não foi validado contra a API real — pendência registrada.
