-- CreateTable
CREATE TABLE "OrderSequenceConfig" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "OrderSequenceConfig_pkey" PRIMARY KEY ("id")
);

-- AlterTable (nullable first, backfill below, NOT NULL depois)
ALTER TABLE "Demand" ADD COLUMN     "orderNumber" INTEGER;

-- Backfill: atribui numero sequencial as Demands existentes por ordem de criacao
UPDATE "Demand" d
SET "orderNumber" = sub.rn
FROM (
    SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt") AS rn
    FROM "Demand"
) sub
WHERE d."id" = sub."id";

-- Seed do contador global, iniciando do maior numero ja atribuido no backfill
INSERT INTO "OrderSequenceConfig" ("id", "lastNumber", "updatedAt")
VALUES ('global', COALESCE((SELECT MAX("orderNumber") FROM "Demand"), 0), CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET "lastNumber" = EXCLUDED."lastNumber", "updatedAt" = EXCLUDED."updatedAt";

-- AlterTable (agora obrigatorio)
ALTER TABLE "Demand" ALTER COLUMN "orderNumber" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Demand_orderNumber_key" ON "Demand"("orderNumber");
