/**
 * Auditoria somente leitura do responsável RNTRC por unidade (após a migration
 * 20260926170000_vehicle_unit_rntrc_holder). Lista o que o backfill conservador NÃO atribuiu,
 * para conferência manual. Nada é corrigido aqui.
 *
 *   cd server && npx tsx prisma/report-rntrc-holders.ts
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
    const column = await db.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'VehicleUnit' AND column_name = 'rntrcHolderPersonId') AS "exists"`;
    if (!column[0]?.exists) { console.log('RNTRC audit: migration ainda não aplicada.'); return; }

    // Unidade sem responsável RNTRC.
    const withoutHolder = await db.$queryRaw<Array<{ plate: string; role: string; legacyRntrc: string | null; ownerDocument: string | null }>>`
        SELECT "plate", "role"::text AS role, "rntrc" AS "legacyRntrc", "ownerDocument"
        FROM "VehicleUnit" WHERE "active" AND "rntrcHolderPersonId" IS NULL ORDER BY "plate"`;

    // RNTRC legado da unidade diferente do RNTRC da pessoa responsável (conflito não resolvido).
    const conflicts = await db.$queryRaw<Array<{ plate: string; legacyRntrc: string; holder: string; holderRntrc: string | null }>>`
        SELECT vu."plate", vu."rntrc" AS "legacyRntrc", p."legalName" AS holder, p."rntrc" AS "holderRntrc"
        FROM "VehicleUnit" vu JOIN "Person" p ON p."id" = vu."rntrcHolderPersonId"
        WHERE vu."rntrc" IS NOT NULL AND (p."rntrc" IS NULL OR p."rntrc" <> vu."rntrc") ORDER BY vu."plate"`;

    // Responsável definido mas sem RNTRC cadastrado na pessoa (pendência para CIOT/MDF-e).
    const holderWithoutRntrc = await db.$queryRaw<Array<{ plate: string; holder: string; document: string }>>`
        SELECT vu."plate", p."legalName" AS holder, p."document"
        FROM "VehicleUnit" vu JOIN "Person" p ON p."id" = vu."rntrcHolderPersonId"
        WHERE vu."active" AND p."rntrc" IS NULL ORDER BY vu."plate"`;

    // Links cujos números de RNTRC divergem para a mesma pessoa (não preenchidos no backfill).
    const linkConflicts = await db.$queryRaw<Array<{ personId: string; rntrcs: string[] }>>`
        SELECT "personId", ARRAY_AGG(DISTINCT regexp_replace("rntrc", '\\D', '', 'g')) AS rntrcs
        FROM "Link" WHERE "personId" IS NOT NULL AND "rntrc" IS NOT NULL
        GROUP BY "personId" HAVING COUNT(DISTINCT regexp_replace("rntrc", '\\D', '', 'g')) > 1`;

    console.log(JSON.stringify({
        unitsWithoutRntrcHolder: withoutHolder,
        legacyRntrcDiffersFromHolder: conflicts,
        holderWithoutRntrc,
        personsWithConflictingLinkRntrc: linkConflicts,
        note: 'Viagens já ofertadas/emitidas usam o RNTRC congelado no retrato; este relatório afeta só viagens novas.',
    }, null, 2));
}

main().catch((error) => { console.error('RNTRC audit failed:', error); process.exitCode = 1; })
    .finally(() => db.$disconnect());
