-- Cancelamento (evento 110111) e carta de correcao (110110) de CT-e. Estado intermediario evita reenvio as cegas.
ALTER TYPE "FreightCalcStatus" ADD VALUE IF NOT EXISTS 'CTE_CANCEL_PENDING';

ALTER TABLE "OrderFreightCalculation"
  ADD COLUMN IF NOT EXISTS "cteCancelReason" TEXT,
  ADD COLUMN IF NOT EXISTS "cteCancelProtocol" TEXT,
  ADD COLUMN IF NOT EXISTS "cteCancelRequestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cteCancelRequestedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "cteCancelXmlStorageKey" TEXT,
  ADD COLUMN IF NOT EXISTS "cteCorrections" JSONB;
