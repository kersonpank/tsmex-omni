-- MDF-e: id do provedor em coluna própria (antes improvisado em pdfUrl = 'mdfe:<id>') e UF de descarregamento.
ALTER TABLE "ManifestFiscalDocument" ADD COLUMN "providerDocId" TEXT;
ALTER TABLE "ManifestFiscalDocument" ADD COLUMN "unloadUf" TEXT;

-- Backfill: o id sai do formato antigo; pdfUrl passa a apontar só para o PDF arquivado (s3:<chave>).
UPDATE "ManifestFiscalDocument"
SET "providerDocId" = substr("pdfUrl", 6)
WHERE "pdfUrl" LIKE 'mdfe:%' AND length("pdfUrl") > 5;

UPDATE "ManifestFiscalDocument"
SET "pdfUrl" = NULL
WHERE "pdfUrl" LIKE 'mdfe:%';

-- Um MDF-e ativo por viagem E UF de descarregamento. Registros antigos (sem UF) usam '' e continuam
-- valendo como "um ativo por viagem" entre si.
DROP INDEX IF EXISTS "ManifestFiscalDocument_one_active_mdfe";

CREATE UNIQUE INDEX "ManifestFiscalDocument_one_active_mdfe_per_uf"
ON "ManifestFiscalDocument"("manifestId", COALESCE("unloadUf", ''))
WHERE "documentType" = 'MDFE' AND "status" IN ('SENT', 'READY', 'AUTHORIZED');
