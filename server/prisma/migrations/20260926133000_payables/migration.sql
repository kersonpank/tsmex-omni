CREATE TYPE "PayableBeneficiaryType" AS ENUM ('LINK', 'PARTNER', 'HUB', 'OTHER');
CREATE TYPE "PayableStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED');

CREATE TABLE "Payable" (
  "id" TEXT NOT NULL,
  "beneficiaryType" "PayableBeneficiaryType" NOT NULL,
  "beneficiaryName" TEXT NOT NULL,
  "beneficiaryDocument" TEXT,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT,
  "manifestId" TEXT,
  "description" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "status" "PayableStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Payable_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Payable_sourceType_sourceId_key" ON "Payable"("sourceType", "sourceId");
CREATE INDEX "Payable_status_dueDate_idx" ON "Payable"("status", "dueDate");
CREATE INDEX "Payable_manifestId_idx" ON "Payable"("manifestId");
ALTER TABLE "Payable" ADD CONSTRAINT "Payable_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "Manifest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PayablePayment" (
  "id" TEXT NOT NULL,
  "payableId" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL,
  "reference" TEXT,
  "evidenceStorageKey" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "reversedAt" TIMESTAMP(3),
  "reversedByUserId" TEXT,
  "reversalReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayablePayment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PayablePayment_idempotencyKey_key" ON "PayablePayment"("idempotencyKey");
CREATE INDEX "PayablePayment_payableId_paidAt_idx" ON "PayablePayment"("payableId", "paidAt");
ALTER TABLE "PayablePayment" ADD CONSTRAINT "PayablePayment_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "Payable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
