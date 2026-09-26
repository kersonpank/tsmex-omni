-- RNTRC passa a ser registro da pessoa (transportador) e cada unidade aponta seu responsável RNTRC,
-- independente do proprietário do CRLV. Migração aditiva: VehicleUnit.rntrc fica como legado
-- somente leitura; snapshots de viagens e documentos já emitidos não são tocados.

-- AlterTable
ALTER TABLE "Person" ADD COLUMN "rntrc" TEXT;

-- AlterTable
ALTER TABLE "VehicleUnit" ADD COLUMN "rntrcHolderPersonId" TEXT;

-- CreateIndex
CREATE INDEX "VehicleUnit_rntrcHolderPersonId_idx" ON "VehicleUnit"("rntrcHolderPersonId");

-- AddForeignKey
ALTER TABLE "VehicleUnit" ADD CONSTRAINT "VehicleUnit_rntrcHolderPersonId_fkey" FOREIGN KEY ("rntrcHolderPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Backfill conservador ───────────────────────────────────────────────────
-- Só atribui com evidência inequívoca; o restante fica pendente e sai no relatório
-- (server/prisma/report-rntrc-holders.ts) para conferência manual.

-- 1) Proprietário informado só por documento: vincula à Person de mesmo documento.
UPDATE "VehicleUnit" vu SET "ownerPersonId" = p."id"
FROM "Person" p
WHERE vu."ownerPersonId" IS NULL AND vu."ownerDocument" IS NOT NULL AND p."document" = vu."ownerDocument";

-- 2) RNTRC do transportador (Link) vai para a pessoa do Link, quando a pessoa ainda não tem
--    e todos os Links dela concordam no mesmo número.
UPDATE "Person" p SET "rntrc" = src."rntrc"
FROM (
    SELECT "personId", MIN(regexp_replace("rntrc", '\D', '', 'g')) AS "rntrc"
    FROM "Link"
    WHERE "personId" IS NOT NULL AND "rntrc" IS NOT NULL AND regexp_replace("rntrc", '\D', '', 'g') ~ '^\d{8,9}$'
    GROUP BY "personId"
    HAVING COUNT(DISTINCT regexp_replace("rntrc", '\D', '', 'g')) = 1
) src
WHERE p."id" = src."personId" AND p."rntrc" IS NULL;

-- 3) RNTRC legado da unidade vai para o proprietário, quando ele ainda não tem
--    e todas as unidades dele concordam no mesmo número.
UPDATE "Person" p SET "rntrc" = src."rntrc"
FROM (
    SELECT "ownerPersonId", MIN("rntrc") AS "rntrc"
    FROM "VehicleUnit"
    WHERE "ownerPersonId" IS NOT NULL AND "rntrc" ~ '^\d{8,9}$'
    GROUP BY "ownerPersonId"
    HAVING COUNT(DISTINCT "rntrc") = 1
) src
WHERE p."id" = src."ownerPersonId" AND p."rntrc" IS NULL;

-- 4) Responsável = proprietário quando o RNTRC legado da unidade é o do proprietário.
UPDATE "VehicleUnit" vu SET "rntrcHolderPersonId" = vu."ownerPersonId"
FROM "Person" p
WHERE vu."rntrcHolderPersonId" IS NULL AND vu."ownerPersonId" = p."id" AND vu."rntrc" IS NOT NULL AND p."rntrc" = vu."rntrc";

-- 5) Sem proprietário compatível: responsável = a única pessoa com aquele RNTRC.
UPDATE "VehicleUnit" vu SET "rntrcHolderPersonId" = src."id"
FROM (
    SELECT MIN("id") AS "id", "rntrc" FROM "Person" WHERE "rntrc" IS NOT NULL GROUP BY "rntrc" HAVING COUNT(*) = 1
) src
WHERE vu."rntrcHolderPersonId" IS NULL AND vu."rntrc" IS NOT NULL AND src."rntrc" = vu."rntrc";

-- 6) Sem RNTRC legado algum: o padrão de negócio é responsável = proprietário (pendência se ele não tiver RNTRC).
UPDATE "VehicleUnit" SET "rntrcHolderPersonId" = "ownerPersonId"
WHERE "rntrcHolderPersonId" IS NULL AND "rntrc" IS NULL AND "ownerPersonId" IS NOT NULL;
