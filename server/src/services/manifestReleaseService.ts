import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { getManifestReadiness } from './manifestReadinessService.js';
import { linkVehicleInclude, manifestVehicleAssignmentsInclude } from './vehicleUnitService.js';
import { resolveManifestComposition } from './vehicleUnitRules.js';

export async function releaseManifest(manifestId: string, actor: { userId: string; source: 'OPERATOR' | 'LINK'; hubId?: string; admin?: boolean }) {
    return prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "Manifest" WHERE "id" = ${manifestId} FOR UPDATE`;
        const manifest = await tx.manifest.findUnique({ where: { id: manifestId }, include: { vehicleAssignments: manifestVehicleAssignmentsInclude, link: { include: linkVehicleInclude } } });
        if (!manifest) throw new AppError('Viagem não encontrada.', 404);
        if (actor.source === 'OPERATOR') {
            if (!actor.admin && (!actor.hubId || manifest.hubId !== actor.hubId)) throw new AppError('Esta viagem não pertence à sua unidade de origem.', 403);
        } else {
            const link = await tx.link.findFirst({ where: { userId: actor.userId }, select: { id: true } });
            if (!link || manifest.linkId !== link.id) throw new AppError('Viagem não atribuída a este transportador.', 403);
        }
        const allowed = actor.source === 'LINK' ? ['PENDING_ACCEPT'] : ['DRAFT', 'PENDING_ACCEPT'];
        if (!allowed.includes(manifest.status)) throw new AppError('A viagem mudou de estado. Atualize a página.', 409);
        const readiness = await getManifestReadiness(manifestId, tx);
        if (!readiness.canRelease) throw new AppError(`Resolva as pendências antes de liberar: ${readiness.actionIssues.release.map(item => item.message).join(' ')}`, 422);
        const composition = resolveManifestComposition(manifest);
        if (!composition.traction) throw new AppError('Escolha o cavalo da viagem antes de liberar.', 422);
        const otherReservations = await tx.manifest.findMany({
            where: { id: { not: manifestId }, status: { in: ['PENDING_ACCEPT', 'ACCEPTED', 'IN_PROGRESS'] }, vehicleAssignments: { some: { vehicleUnit: { plate: { in: composition.units.map(unit => unit.plate) } } } } },
            select: { id: true, status: true, plannedDepartureAt: true, plannedArrivalAt: true },
        });
        const conflict = otherReservations.find(other => other.status === 'IN_PROGRESS' || !manifest.plannedDepartureAt || !manifest.plannedArrivalAt || !other.plannedDepartureAt || !other.plannedArrivalAt || (manifest.plannedDepartureAt < other.plannedArrivalAt && other.plannedDepartureAt < manifest.plannedArrivalAt));
        if (conflict) throw new AppError(`Veículo reservado na viagem ${conflict.id.slice(0, 8)}. Confira a programação.`, 409);
        const now = new Date();
        const updated = await tx.manifest.updateMany({
            where: { id: manifestId, status: manifest.status, updatedAt: manifest.updatedAt },
            data: {
                status: 'ACCEPTED', acceptedAt: now, releasedAt: now,
                releaseSource: actor.source, releasedByUserId: actor.userId,
                rejectedAt: null, rejectionReason: null,
                compositionSnapshot: manifest.status === 'PENDING_ACCEPT' && manifest.compositionSnapshot
                    ? manifest.compositionSnapshot as Prisma.InputJsonValue
                    : JSON.parse(JSON.stringify(composition)) as Prisma.InputJsonValue,
            },
        });
        if (updated.count !== 1) throw new AppError('A viagem foi alterada durante a liberação. Revise novamente.', 409);
        return tx.manifest.findUniqueOrThrow({ where: { id: manifestId }, include: { link: true, driver: true, vehicleType: true } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(error => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') throw new AppError('Outra ação alterou a viagem. Atualize a página e revise novamente.', 409);
        throw error;
    });
}
