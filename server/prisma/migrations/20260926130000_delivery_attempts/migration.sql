CREATE TYPE "DeliveryAttemptResult" AS ENUM ('DELIVERED', 'PARTIAL', 'FAILED');
CREATE TYPE "DeliveryNextAction" AS ENUM ('REATTEMPT', 'RETURN_TO_HUB', 'TRANSFER');

CREATE TABLE "DeliveryAttempt" (
  "id" TEXT NOT NULL,
  "manifestId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "legId" TEXT NOT NULL,
  "stopId" TEXT,
  "result" "DeliveryAttemptResult" NOT NULL,
  "expectedQuantity" INTEGER,
  "deliveredQuantity" INTEGER,
  "receiverName" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "recordedByUserId" TEXT NOT NULL,
  "performedByUserId" TEXT,
  "evidenceStorageKey" TEXT,
  "exceptionReason" TEXT,
  "nextAction" "DeliveryNextAction",
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeliveryAttempt_idempotencyKey_key" ON "DeliveryAttempt"("idempotencyKey");
CREATE INDEX "DeliveryAttempt_legId_occurredAt_idx" ON "DeliveryAttempt"("legId", "occurredAt");
CREATE INDEX "DeliveryAttempt_orderId_occurredAt_idx" ON "DeliveryAttempt"("orderId", "occurredAt");
CREATE INDEX "DeliveryAttempt_manifestId_stopId_idx" ON "DeliveryAttempt"("manifestId", "stopId");
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "Manifest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_legId_fkey" FOREIGN KEY ("legId") REFERENCES "OrderLeg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "ManifestStop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
