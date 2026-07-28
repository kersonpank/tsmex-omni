-- Fecha todas as ocorrências OPEN duplicadas de cada categoria, mantendo apenas a mais recente.
-- Resolve o acúmulo histórico causado pelo uso de createSystemAlert (bare create) nos processors.
UPDATE "SystemAlert"
SET status = 'RESOLVED', "resolvedAt" = NOW()
WHERE status = 'OPEN'
  AND id NOT IN (
    SELECT DISTINCT ON (category) id
    FROM "SystemAlert"
    WHERE status = 'OPEN'
    ORDER BY category, "createdAt" DESC
  );
