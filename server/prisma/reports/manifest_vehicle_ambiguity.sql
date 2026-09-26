-- Execute read-only before migration and again after. Existing manifests do not
-- inherit the transporter's current vehicles: those units may have changed.
SELECT m."id" AS manifest_id, m."status", m."createdAt", m."offeredAt",
       m."linkId", l."name" AS transporter,
       l."vehiclePlate" AS current_transporter_plate,
       COUNT(a."id") AS confirmed_trip_units,
       CASE WHEN COUNT(a."id") = 0 THEN 'REVIEW_REQUIRED' ELSE 'CONFIRMED' END AS composition_state
FROM "Manifest" m
LEFT JOIN "Link" l ON l."id" = m."linkId"
LEFT JOIN "ManifestVehicleAssignment" a ON a."manifestId" = m."id"
GROUP BY m."id", l."id"
ORDER BY m."createdAt" DESC;

-- Legacy driver-to-transporter links that the additive migration preserves.
SELECT d."id" AS driver_id, d."document" AS cpf, d."linkId" AS legacy_transporter_id,
       l."name" AS transporter
FROM "Driver" d LEFT JOIN "Link" l ON l."id" = d."linkId"
ORDER BY d."document";
