-- Encerramento fiscal (CIOT/MDF-e) com repeticao automatica e espera crescente.
ALTER TABLE "FiscalClosureTask"
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3);
