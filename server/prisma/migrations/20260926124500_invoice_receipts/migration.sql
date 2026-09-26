CREATE TABLE "InvoiceReceipt" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "reference" TEXT,
  "evidenceStorageKey" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "reversedAt" TIMESTAMP(3),
  "reversedByUserId" TEXT,
  "reversalReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvoiceReceipt_idempotencyKey_key" ON "InvoiceReceipt"("idempotencyKey");
CREATE INDEX "InvoiceReceipt_invoiceId_receivedAt_idx" ON "InvoiceReceipt"("invoiceId", "receivedAt");
ALTER TABLE "InvoiceReceipt" ADD CONSTRAINT "InvoiceReceipt_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
