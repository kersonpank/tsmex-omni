-- Cobertura rica do hub (tabela de roteamento da teia). Aditiva e idempotente:
-- nenhuma tabela/coluna existente é alterada.
CREATE TABLE IF NOT EXISTS "HubCoverage" (
    "id" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "cityIbgeCode" TEXT NOT NULL,
    "cityName" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "leadTimeDays" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HubCoverage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "HubCoverage_hubId_cityIbgeCode_key" ON "HubCoverage"("hubId", "cityIbgeCode");

CREATE INDEX IF NOT EXISTS "HubCoverage_cityIbgeCode_active_idx" ON "HubCoverage"("cityIbgeCode", "active");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'HubCoverage_hubId_fkey'
    ) THEN
        ALTER TABLE "HubCoverage"
            ADD CONSTRAINT "HubCoverage_hubId_fkey"
            FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
