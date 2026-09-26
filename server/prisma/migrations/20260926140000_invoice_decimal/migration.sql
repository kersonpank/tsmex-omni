ALTER TABLE "Invoice"
  ALTER COLUMN "subtotal" TYPE DECIMAL(14,2) USING ROUND("subtotal"::numeric, 2),
  ALTER COLUMN "taxes" TYPE DECIMAL(14,2) USING ROUND("taxes"::numeric, 2),
  ALTER COLUMN "discounts" TYPE DECIMAL(14,2) USING ROUND("discounts"::numeric, 2),
  ALTER COLUMN "total" TYPE DECIMAL(14,2) USING ROUND("total"::numeric, 2);
