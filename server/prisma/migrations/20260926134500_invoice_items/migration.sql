CREATE TABLE "InvoiceItem" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InvoiceItem_invoiceId_orderId_key" ON "InvoiceItem"("invoiceId", "orderId");
CREATE INDEX "InvoiceItem_orderId_idx" ON "InvoiceItem"("orderId");
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing single-order invoices become reviewable invoice items without changing their totals.
INSERT INTO "InvoiceItem" ("id", "invoiceId", "orderId", "description", "amount")
SELECT gen_random_uuid()::text, inv."id", inv."orderId", 'Frete do pedido', ROUND(inv."subtotal"::numeric, 2)
FROM "Invoice" AS inv
WHERE inv."orderId" IS NOT NULL;
