CREATE TABLE "CiotEmissionAttempt" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "requestData" JSONB NOT NULL,
    "rawPayload" JSONB,
    "rawResponse" JSONB,
    "phase" TEXT NOT NULL,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CiotEmissionAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CiotEmissionAttempt_jobId_createdAt_idx" ON "CiotEmissionAttempt"("jobId", "createdAt");
ALTER TABLE "CiotEmissionAttempt" ADD CONSTRAINT "CiotEmissionAttempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "CiotEmissionJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
