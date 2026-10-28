-- A modalidade é desconhecida nos pedidos existentes: não inferir uma coleta antiga.
ALTER TABLE "Order"
    ADD COLUMN "intakeMode" TEXT,
    ADD COLUMN "intakeHubId" TEXT;

ALTER TABLE "Order"
    ADD CONSTRAINT "Order_intakeMode_check"
    CHECK ("intakeMode" IS NULL OR "intakeMode" IN ('HUB_DIRECT', 'UNKNOWN'));

-- Um POST sem resposta pode ter chegado ao provedor; o marcador evita reenviá-lo.
ALTER TABLE "CteEmissionJob"
    ADD COLUMN "submissionGuardVersion" INTEGER,
    ADD COLUMN "submitStartedAt" TIMESTAMP(3),
    ADD COLUMN "inputSnapshot" JSONB,
    ADD COLUMN "rejectionCode" TEXT,
    ADD COLUMN "rejectionReason" TEXT;
