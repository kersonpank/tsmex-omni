-- Fix idempotency guarantee and worker polling query shape for CteEmissionJob.
DROP INDEX IF EXISTS "CteEmissionJob_providerDocId_idx";
DROP INDEX IF EXISTS "CteEmissionJob_phase_idx";
CREATE UNIQUE INDEX "CteEmissionJob_providerDocId_key" ON "CteEmissionJob"("providerDocId");
CREATE INDEX "CteEmissionJob_phase_nextPollAt_idx" ON "CteEmissionJob"("phase", "nextPollAt");
