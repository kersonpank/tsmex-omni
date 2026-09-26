-- Stop the rollout if historical active duplicates exist; they require fiscal reconciliation.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "ManifestFiscalDocument"
    WHERE "documentType" = 'MDFE' AND "status" IN ('SENT', 'READY', 'AUTHORIZED')
    GROUP BY "manifestId" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Multiple active MDF-e documents exist for one manifest; reconcile before deploying';
  END IF;
END $$;

CREATE UNIQUE INDEX "ManifestFiscalDocument_one_active_mdfe"
ON "ManifestFiscalDocument"("manifestId")
WHERE "documentType" = 'MDFE' AND "status" IN ('SENT', 'READY', 'AUTHORIZED');
