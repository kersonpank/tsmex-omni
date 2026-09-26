CREATE TYPE "FiscalClosureTaskStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'RECONCILIATION_REQUIRED');

CREATE TABLE "FiscalClosureTask" (
  "id" TEXT NOT NULL,
  "manifestId" TEXT NOT NULL,
  "status" "FiscalClosureTaskStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FiscalClosureTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FiscalClosureTask_manifestId_key" ON "FiscalClosureTask"("manifestId");
CREATE INDEX "FiscalClosureTask_status_updatedAt_idx" ON "FiscalClosureTask"("status", "updatedAt");
ALTER TABLE "FiscalClosureTask" ADD CONSTRAINT "FiscalClosureTask_manifestId_fkey"
  FOREIGN KEY ("manifestId") REFERENCES "Manifest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
