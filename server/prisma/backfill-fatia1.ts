import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🤖 Running Fatia 1 backfill migration...');

    // 1. Backfill Hub roles with default value [RECEBIMENTO, DISTRIBUICAO]
    const hubsToUpdate = await prisma.hub.findMany({
        where: {
            roles: {
                isEmpty: true
            }
        }
    });

    if (hubsToUpdate.length > 0) {
        console.log(`   Updating roles for ${hubsToUpdate.length} hubs...`);
        for (const hub of hubsToUpdate) {
            await prisma.hub.update({
                where: { id: hub.id },
                data: {
                    roles: ['RECEBIMENTO', 'DISTRIBUICAO']
                }
            });
        }
    }

    // 2. Backfill Demand status (convert physical statuses to CONVERTED using raw SQL)
    const count = await prisma.$executeRawUnsafe(
        `UPDATE "Demand" SET status = 'CONVERTED' WHERE status::text IN ('ASSIGNED', 'COLLECTED', 'IN_TRANSIT', 'AT_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED')`
    );
    console.log(`   Updated ${count} demands to status CONVERTED`);

    // 3. Backfill legacy Order.manifestId references to OrderLeg
    const ordersWithManifest = await prisma.order.findMany({
        where: {
            manifestId: { not: null }
        },
        include: {
            manifest: true
        }
    });

    console.log(`   Processing ${ordersWithManifest.length} orders with legacy manifest assignments...`);
    let legsCreated = 0;
    
    for (const order of ordersWithManifest) {
        if (!order.manifest) continue;

        // Check if an OrderLeg already exists for this order-manifest combination (idempotency)
        const existingLeg = await prisma.orderLeg.findUnique({
            where: {
                orderId_manifestId: {
                    orderId: order.id,
                    manifestId: order.manifestId!
                }
            }
        });

        if (!existingLeg) {
            const legType = order.manifest.tripType === 'DELIVERY' ? 'ENTREGA' : 'TRANSFERENCIA';
            await prisma.orderLeg.create({
                data: {
                    orderId: order.id,
                    manifestId: order.manifestId!,
                    sequence: 1,
                    legType,
                    executedBy: 'LINK',
                    originHubId: order.manifest.hubId,
                    destHubId: order.manifest.destHubId,
                    startedAt: order.manifest.startedAt,
                    completedAt: order.manifest.completedAt
                }
            });
            legsCreated++;
        }
    }

    console.log(`   Created ${legsCreated} new OrderLeg records`);
    console.log('✅ Backfill complete!');
}

main()
    .catch((e) => {
        console.error('❌ Backfill failed:', e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
