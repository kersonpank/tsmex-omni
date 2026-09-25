-- Backfill idempotente: transforma os dados de veículo hoje espalhados em Link (placa, reboques em
-- texto, chassi, RENAVAM, eixos, RNTRC, dono) em VehicleUnit reutilizável, e liga o Link a elas.
-- Seguro para reexecutar: usa ON CONFLICT (plate) DO NOTHING e só preenche FKs ainda nulas.
-- Não apaga nem altera as colunas legadas do Link (espelho até a limpeza).

-- 1) Cavalos: 1 unidade por placa válida (7 alfanuméricos). Se várias Links compartilham a placa,
--    vence a que tem mais dados (chassi presente) e a mais recente.
INSERT INTO "VehicleUnit" (
    "id", "plate", "role", "chassi", "renavam", "axles", "rntrc", "bodyType", "wheelType", "year",
    "ownerPersonId", "ownerDocument", "ownerName", "active", "createdAt", "updatedAt"
)
SELECT DISTINCT ON (src.plate)
    gen_random_uuid()::text, src.plate, 'TRACTION'::"VehicleUnitRole",
    NULLIF(TRIM(src."vehicleChassi"), ''), NULLIF(TRIM(src."vehicleRenavam"), ''), src."vehicleAxles",
    NULLIF(TRIM(src."rntrc"), ''), src."vehicleBodyType", src."vehicleWheelType", src."vehicleYear",
    COALESCE(
        (SELECT p."id" FROM "Person" p
          WHERE p."document" = regexp_replace(COALESCE(src."vehicleOwnerDocument", ''), '\D', '', 'g')
          LIMIT 1),
        CASE WHEN src."vehicleOwnerDocument" IS NULL THEN src."personId" END
    ),
    NULLIF(TRIM(src."vehicleOwnerDocument"), ''), NULLIF(TRIM(src."vehicleOwnerName"), ''),
    true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
    SELECT l.*, upper(regexp_replace(l."vehiclePlate", '[^A-Za-z0-9]', '', 'g')) AS plate
      FROM "Link" l
) src
WHERE length(src.plate) = 7
ORDER BY src.plate, (src."vehicleChassi" IS NOT NULL) DESC, src."updatedAt" DESC
ON CONFLICT ("plate") DO NOTHING;

-- 2) Reboques: só a placa é conhecida (chassi/RENAVAM/eixos/RNTRC ficam pendentes e aparecem
--    como pendência da unidade, não da viagem). Placa que já é cavalo não vira reboque.
INSERT INTO "VehicleUnit" ("id", "plate", "role", "active", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, t.plate, 'TRAILER'::"VehicleUnitRole", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT upper(regexp_replace(p, '[^A-Za-z0-9]', '', 'g')) AS plate
      FROM "Link" l,
           LATERAL (VALUES (l."trailerPlate"), (l."trailer2Plate"), (l."trailer3Plate")) AS v(p)
     WHERE v.p IS NOT NULL
) t
WHERE length(t.plate) = 7
ON CONFLICT ("plate") DO NOTHING;

-- 3) Liga cada Link às suas unidades (apenas quando o papel confere e a FK ainda está nula).
UPDATE "Link" l SET "tractionUnitId" = u."id"
  FROM "VehicleUnit" u
 WHERE l."tractionUnitId" IS NULL AND u."role" = 'TRACTION'
   AND u."plate" = upper(regexp_replace(l."vehiclePlate", '[^A-Za-z0-9]', '', 'g'));

UPDATE "Link" l SET "trailer1UnitId" = u."id"
  FROM "VehicleUnit" u
 WHERE l."trailer1UnitId" IS NULL AND l."trailerPlate" IS NOT NULL AND u."role" = 'TRAILER'
   AND u."plate" = upper(regexp_replace(l."trailerPlate", '[^A-Za-z0-9]', '', 'g'));

UPDATE "Link" l SET "trailer2UnitId" = u."id"
  FROM "VehicleUnit" u
 WHERE l."trailer2UnitId" IS NULL AND l."trailer2Plate" IS NOT NULL AND u."role" = 'TRAILER'
   AND u."plate" = upper(regexp_replace(l."trailer2Plate", '[^A-Za-z0-9]', '', 'g'));

UPDATE "Link" l SET "trailer3UnitId" = u."id"
  FROM "VehicleUnit" u
 WHERE l."trailer3UnitId" IS NULL AND l."trailer3Plate" IS NOT NULL AND u."role" = 'TRAILER'
   AND u."plate" = upper(regexp_replace(l."trailer3Plate", '[^A-Za-z0-9]', '', 'g'));
