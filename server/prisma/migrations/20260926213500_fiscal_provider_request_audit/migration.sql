CREATE TABLE "FiscalProviderRequestAudit" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hubId" TEXT,
    "accessKey" TEXT,
    "status" TEXT NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FiscalProviderRequestAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FiscalProviderRequestAudit_provider_action_createdAt_idx" ON "FiscalProviderRequestAudit"("provider", "action", "createdAt");
CREATE INDEX "FiscalProviderRequestAudit_userId_createdAt_idx" ON "FiscalProviderRequestAudit"("userId", "createdAt");
CREATE INDEX "FiscalProviderRequestAudit_accessKey_idx" ON "FiscalProviderRequestAudit"("accessKey");
