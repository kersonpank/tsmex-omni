ALTER TABLE "PricingTable" ADD COLUMN IF NOT EXISTS "coverageOnly" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "HubCoverage" ADD COLUMN IF NOT EXISTS "pricingTableId" TEXT;

ALTER TABLE "HubCoverage"
    ADD CONSTRAINT "HubCoverage_pricingTableId_fkey"
    FOREIGN KEY ("pricingTableId") REFERENCES "PricingTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "HubCoverage_pricingTableId_idx" ON "HubCoverage"("pricingTableId");
