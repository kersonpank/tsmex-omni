-- Estacao "Excecoes" do TSM O.S.: alerta ganha dono (hub), prazo e desfecho.
ALTER TYPE "SystemAlertCategory" ADD VALUE IF NOT EXISTS 'OPERATIONAL_STOCK_AGING';
ALTER TYPE "SystemAlertCategory" ADD VALUE IF NOT EXISTS 'OPERATIONAL_TRIP_LATE';
ALTER TYPE "SystemAlertCategory" ADD VALUE IF NOT EXISTS 'OPERATIONAL_UNROUTED';

ALTER TABLE "SystemAlert"
  ADD COLUMN "hubId" TEXT,
  ADD COLUMN "dueAt" TIMESTAMP(3),
  ADD COLUMN "resolvedByUserId" TEXT,
  ADD COLUMN "resolutionNote" TEXT;

CREATE INDEX "SystemAlert_hubId_status_idx" ON "SystemAlert"("hubId", "status");
