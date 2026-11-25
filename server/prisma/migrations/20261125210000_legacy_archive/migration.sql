-- CreateTable
CREATE TABLE "LegacyRecord" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "legacyKey" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "searchText" TEXT NOT NULL,
    "rowHash" TEXT NOT NULL,
    "sourceFile" TEXT,
    "revisions" INTEGER NOT NULL DEFAULT 0,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegacyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LegacyRecord_entity_idx" ON "LegacyRecord"("entity");

-- CreateIndex
CREATE UNIQUE INDEX "LegacyRecord_entity_legacyKey_key" ON "LegacyRecord"("entity", "legacyKey");

