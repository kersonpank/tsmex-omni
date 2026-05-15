# PR003.1 — Exceções de Intake na Torre de Controle

**Depende de:** [PR003](2026-05-15-pr003-hub-awaiting-arrival-queue.md) (fluxo operacional de recebimento no Hub validado ponta a ponta).

**Motivação:** O PR003 entrega o fluxo principal (fila no Hub, busca, lookup, confirm-arrival, Order, `AT_HUB`, histórico, isolamento). **Não** expandir escopo com triagem de exceções na Torre antes de validar recebimento real no Hub.

---

## Escopo futuro

1. **Card ou lista** para Admin listar demandas em intake **`AWAITING_ARRIVAL`** com **`expectedHubId` nulo** (exceções / sem hub esperado).
2. **Atribuir** `expectedHubId` (hub esperado) a partir da UI, com validação clara.
3. **Registrar evento** na `Demand` (auditoria / rastreio da correção).
4. Após atribuição, a demanda passa a aparecer na **fila do Hub** correspondente (comportamento natural do filtro por `expectedHubId`).
5. **Não** criar `Order` neste fluxo.
6. **Não** confirmar chegada (sem `confirm-arrival`).
7. **Não** alterar integração **ACBr**.
8. **Não** alterar **etiquetas** / impressão.

---

## Notas de implementação (quando for priorizado)

- Reutilizar query/API existente: `GET /api/intake/demands?onlyUnassignedHub=true` (ou equivalente) **desde que** retorne só intake elegíveis e respeite RBAC `ADMIN`.
- Novo endpoint PATCH dedicado (ex.: `PATCH /api/intake/demands/:id/expected-hub`) pode ser mais seguro que reutilizar PATCH genérico de demanda — definir na implementação.
- Alinhar copy de produto: “Exceções de intake” vs “Sem CD de recebimento”.

---

## Fora de escopo

- Qualquer mudança no fluxo **confirm-arrival** do PR003.
- CT-e, MDF-e, distribuição DF-e.
