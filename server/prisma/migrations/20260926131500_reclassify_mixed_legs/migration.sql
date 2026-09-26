-- Historical mixed trips classified every leg as ENTREGA. The stop purpose is the source of truth.
UPDATE "ManifestStop" AS stop
SET "purpose" = CASE WHEN manifest."tripType" = 'TRANSFER' THEN 'TRANSFER'::"ManifestStopPurpose" ELSE 'DELIVERY'::"ManifestStopPurpose" END
FROM "Manifest" AS manifest
WHERE stop."manifestId" = manifest."id" AND manifest."tripType" IN ('TRANSFER', 'DELIVERY')
  AND stop."purpose" IN ('PASSAGE', 'OPERATIONAL')
  AND EXISTS (SELECT 1 FROM "OrderLeg" AS leg WHERE leg."stopId" = stop."id");

UPDATE "OrderLeg" AS leg
SET "legType" = 'TRANSFERENCIA', "destHubId" = stop."destHubId"
FROM "ManifestStop" AS stop
WHERE leg."stopId" = stop."id" AND stop."purpose" = 'TRANSFER'
  AND leg."legType" <> 'TRANSFERENCIA';

UPDATE "OrderLeg" AS leg
SET "legType" = 'ENTREGA', "destHubId" = NULL
FROM "ManifestStop" AS stop
WHERE leg."stopId" = stop."id" AND stop."purpose" = 'DELIVERY'
  AND leg."legType" <> 'ENTREGA';
