/** Read-only audit printed by the migrate container before applying new migrations. */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
    const tables = await db.$queryRaw<Array<{ exists: string | null }>>`
        SELECT to_regclass('public."Manifest"')::text AS "exists"`;
    if (!tables[0]?.exists) { console.log('Manifest audit: fresh database; no legacy trips.'); return; }
    const vehicleTable = await db.$queryRaw<Array<{ exists: string | null }>>`
        SELECT to_regclass('public."ManifestVehicleAssignment"')::text AS "exists"`;
    if (vehicleTable[0]?.exists) { console.log('Manifest audit: per-trip vehicle table already present.'); return; }

    const summary = await db.$queryRaw<Array<{ status: string; count: bigint }>>`
        SELECT "status"::text AS status, COUNT(*) AS count FROM "Manifest" GROUP BY "status" ORDER BY "status"`;
    const examples = await db.$queryRaw<Array<{ id: string; status: string; linkId: string | null; vehiclePlate: string | null }>>`
        SELECT m."id", m."status"::text AS status, m."linkId", l."vehiclePlate"
        FROM "Manifest" m LEFT JOIN "Link" l ON l."id" = m."linkId"
        WHERE m."status"::text IN ('DRAFT','PENDING_ACCEPT','ACCEPTED','IN_PROGRESS')
        ORDER BY m."createdAt" DESC LIMIT 100`;
    const links = await db.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count FROM "Driver" WHERE "linkId" IS NOT NULL`;
    console.log('Manifest audit before vehicle migration:', JSON.stringify({
        byStatus: summary.map((row) => ({ status: row.status, count: Number(row.count) })),
        legacyDriverCarrierLinks: Number(links[0]?.count ?? 0),
        activeTripsNeedingCompositionReview: examples,
        activeTripListTruncated: examples.length === 100,
        note: 'Current Link plate is reference only; it is never copied as a historical trip assignment.',
    }));
}

main().catch((error) => { console.error('Manifest pre-migration audit failed:', error); process.exitCode = 1; })
    .finally(() => db.$disconnect());
