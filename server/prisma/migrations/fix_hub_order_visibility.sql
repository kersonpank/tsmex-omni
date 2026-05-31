-- Corrige visibilidade de pedidos criados via POST /entrada por operadores HUB.
--
-- Problema: orders criados via /api/orders/entrada antes de 2026-05-31
-- geravam demands com expectedHubId = NULL. Quando o order sai de AT_HUB,
-- currentHubId é zerado e o HUB perde acesso ao order (403).
--
-- Esta query copia o currentHubId do Order -> demand.expectedHubId
-- para todos os orders FORM cujo demand ainda não tem expectedHubId setado.

UPDATE "Demand" d
SET "expectedHubId" = o."currentHubId"
FROM "Order" o
WHERE o."demandId" = d.id
  AND d."sourceType" = 'FORM'
  AND d."expectedHubId" IS NULL
  AND o."currentHubId" IS NOT NULL;

-- Verificar quantos foram afetados:
-- SELECT COUNT(*) FROM "Demand" d
-- JOIN "Order" o ON o."demandId" = d.id
-- WHERE d."sourceType" = 'FORM' AND d."expectedHubId" IS NULL AND o."currentHubId" IS NOT NULL;

-- Pedidos já em IN_TRANSIT (currentHubId = NULL) precisam ser identificados
-- manualmente. Rode a query abaixo para listar:
-- SELECT o.id AS order_id, d.id AS demand_id, o.status, o."currentHubId"
-- FROM "Order" o
-- JOIN "Demand" d ON d.id = o."demandId"
-- WHERE d."sourceType" = 'FORM'
--   AND d."expectedHubId" IS NULL
-- ORDER BY o."createdAt" DESC;
