-- Hubs cadastrados antes da exigência do IBGE: completa o código pela cidade+UF do catálogo
-- (só correspondência exata e única). Somente dados; idempotente.
UPDATE "Hub" AS h
SET "cityIbgeCode" = m."ibgeCode", "city" = m."name"
FROM (
    SELECT h2."id" AS "hubId", MIN(c."ibgeCode") AS "ibgeCode", MIN(c."name") AS "name"
    FROM "Hub" h2
    JOIN "State" s ON s."code" = UPPER(TRIM(h2."state"))
    JOIN "City" c ON c."stateId" = s."id" AND LOWER(c."name") = LOWER(TRIM(h2."city"))
    WHERE h2."cityIbgeCode" IS NULL
    GROUP BY h2."id"
    HAVING COUNT(*) = 1
) AS m
WHERE h."id" = m."hubId";
