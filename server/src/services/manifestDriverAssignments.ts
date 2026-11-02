import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';

// associateLinkId: o motorista é independente do transportador; ao escolhê-lo para a viagem, o vínculo
// (DriverCarrier) é criado/reativado na mesma transação em vez de recusar o motorista.
export async function replaceManifestDrivers(manifestId: string, driverIds: string[], expectedUpdatedAt: Date, linkId?: string | null, associateLinkId?: string | null) {
    return prisma.$transaction(async (tx) => {
        const updated = await tx.manifest.updateMany({
            where: { id: manifestId, status: 'DRAFT', updatedAt: expectedUpdatedAt },
            data: { driverId: driverIds[0] ?? null, ...(linkId !== undefined ? { linkId } : {}), updatedAt: new Date() },
        });
        if (updated.count !== 1) throw new AppError('A viagem mudou durante a edição. Recarregue e tente novamente.', 409);
        await tx.manifestDriverAssignment.deleteMany({ where: { manifestId } });
        if (associateLinkId) {
            for (const driverId of driverIds) {
                await tx.driverCarrier.upsert({
                    where: { driverId_linkId: { driverId, linkId: associateLinkId } },
                    create: { driverId, linkId: associateLinkId },
                    update: { active: true },
                });
            }
        }
        if (driverIds.length) {
            await tx.manifestDriverAssignment.createMany({ data: driverIds.map((driverId, index) => ({
                manifestId, driverId, sequence: index + 1, isPrimary: index === 0,
            })) });
        }
        return tx.manifest.findUniqueOrThrow({ where: { id: manifestId }, include: { link: true, driver: true, vehicleType: true, driverAssignments: { orderBy: { sequence: 'asc' }, include: { driver: true } } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

