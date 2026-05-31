-- Corrige visibilidade de pedidos criados via POST /entrada por operadores HUB.
--
-- Pedidos criados via /api/orders/entrada geravam demands com expectedHubId=NULL.
-- Quando o order saía de AT_HUB, currentHubId era zerado e o HUB perdia acesso (403).
-- Esta migration copia currentHubId -> demand.expectedHubId para os orders afetados.

UPDATE "Demand" d
SET "expectedHubId" = o."currentHubId"
FROM "Order" o
WHERE o."demandId" = d.id
  AND d."sourceType" = 'FORM'
  AND d."expectedHubId" IS NULL
  AND o."currentHubId" IS NOT NULL;
