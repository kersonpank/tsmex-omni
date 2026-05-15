/**
 * Dados para teste manual/E2E do fluxo TRANSFER SP-GRU → IMP-MA.
 * Uso: npx tsx prisma/seed-manifest-e2e.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const hubSp = await prisma.hub.findUnique({ where: { code: 'SP-GRU' } });
    const hubImp = await prisma.hub.findUnique({ where: { code: 'IMP-MA' } });
    const truck = await prisma.vehicleType.findUnique({ where: { code: 'TRUCK' } });
    const client = await prisma.client.findFirst();

    if (!hubSp || !hubImp || !truck || !client) {
        console.error('Execute o seed principal antes: npm run db:seed');
        process.exit(1);
    }

    const demands = await Promise.all([
        prisma.demand.create({
            data: {
                clientId: client.id,
                nfNumber: 'E2E-001',
                nfValue: 1000,
                origin: 'Guarulhos, SP',
                destination: 'Imperatriz, MA',
                commodity: 'E2E Transfer A',
                weight: 120,
                volume: 1.2,
                riskClass: 'C',
                intentType: 'COLLECT',
                sourceType: 'API',
                status: 'APPROVED',
            },
        }),
        prisma.demand.create({
            data: {
                clientId: client.id,
                nfNumber: 'E2E-002',
                nfValue: 800,
                origin: 'Guarulhos, SP',
                destination: 'Imperatriz, MA',
                commodity: 'E2E Transfer B',
                weight: 90,
                volume: 1,
                riskClass: 'C',
                intentType: 'COLLECT',
                sourceType: 'API',
                status: 'APPROVED',
            },
        }),
    ]);

    for (const d of demands) {
        await prisma.order.create({
            data: {
                demandId: d.id,
                nfNumber: d.nfNumber,
                status: 'PENDING',
            },
        });
    }

    console.log('E2E seed OK:');
    console.log('  Hubs:', hubSp.code, '→', hubImp.code);
    console.log('  Demands:', demands.map((d) => d.id).join(', '));
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
