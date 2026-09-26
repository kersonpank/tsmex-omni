import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { linkCompositionSchema, upsertVehicleUnit, manifestVehicleAssignmentsInclude } from './vehicleUnitService.js';
import { normalizePlate, resolveManifestComposition } from './vehicleUnitRules.js';

export const manifestVehiclesSchema = linkCompositionSchema;
export type ManifestVehiclesInput = z.infer<typeof manifestVehiclesSchema>;

function overlaps(aStart: Date | null, aEnd: Date | null, bStart: Date | null, bEnd: Date | null): boolean {
    if (!aStart || !aEnd || !bStart || !bEnd) return true;
    return aStart < bEnd && bStart < aEnd;
}

export async function setManifestVehicles(manifestId: string, input: ManifestVehiclesInput) {
    const manifest = await prisma.manifest.findUnique({ where: { id: manifestId }, select: { status: true, plannedDepartureAt: true, plannedArrivalAt: true, link: { select: { personId: true } } } });
    if (!manifest) throw new AppError('Viagem não encontrada.', 404);
    if (manifest.status !== 'DRAFT') throw new AppError('Reabra o planejamento antes de trocar veículos.', 409);
    const all = [input.traction, ...input.trailers];
    const plates = all.map((unit) => normalizePlate(unit.plate));
    if (new Set(plates).size !== plates.length) throw new AppError('Cada placa só pode aparecer uma vez na composição.', 400);

    return prisma.$transaction(async (tx) => {
        const units = [];
        for (const [index, item] of all.entries()) {
            units.push(await upsertVehicleUnit(tx, index === 0 ? 'TRACTION' : 'TRAILER', item, { defaultHolderPersonId: manifest.link?.personId }));
        }
        const conflicts = await tx.manifest.findMany({
            where: { id: { not: manifestId }, status: { in: ['PENDING_ACCEPT', 'ACCEPTED', 'IN_PROGRESS'] }, vehicleAssignments: { some: { vehicleUnitId: { in: units.map((unit) => unit.id) } } } },
            select: { id: true, status: true, plannedDepartureAt: true, plannedArrivalAt: true, vehicleAssignments: { select: { vehicleUnitId: true } } },
        });
        const conflict = conflicts.find((other) => other.status === 'IN_PROGRESS' || overlaps(manifest.plannedDepartureAt, manifest.plannedArrivalAt, other.plannedDepartureAt, other.plannedArrivalAt));
        if (conflict) throw new AppError(`Um veículo selecionado já está reservado na viagem ${conflict.id.slice(0, 8)}.`, 409);

        await tx.manifestVehicleAssignment.deleteMany({ where: { manifestId } });
        await tx.manifestVehicleAssignment.createMany({ data: units.map((unit, slot) => ({ manifestId, vehicleUnitId: unit.id, slot })) });
        const updated = await tx.manifest.updateMany({ where: { id: manifestId, status: 'DRAFT' }, data: { compositionSnapshot: Prisma.DbNull, updatedAt: new Date() } });
        if (updated.count !== 1) throw new AppError('A viagem mudou de estado enquanto a composição era salva. Recarregue a página.', 409);
        return tx.manifestVehicleAssignment.findMany({ where: { manifestId }, ...manifestVehicleAssignmentsInclude });
    });
}

/** Conserva as placas e todos os dados fiscais da composição aceitos nesta oferta. */
export async function publishManifestOffer(manifestId: string) {
    return prisma.$transaction(async (tx) => {
        const manifest = await tx.manifest.findUnique({
            where: { id: manifestId },
            include: { vehicleAssignments: manifestVehicleAssignmentsInclude },
        });
        if (!manifest || manifest.status !== 'DRAFT') throw new AppError('A viagem não está em rascunho.', 409);
        const composition = resolveManifestComposition(manifest);
        if (!composition.traction) throw new AppError('Escolha o cavalo desta viagem antes de ofertar.', 422);
        const offeredAt = new Date();
        const updated = await tx.manifest.updateMany({
            where: { id: manifestId, status: 'DRAFT', updatedAt: manifest.updatedAt },
            data: {
                status: 'PENDING_ACCEPT', offeredAt, firstOfferedAt: manifest.firstOfferedAt ?? offeredAt,
                rejectedAt: null, rejectionReason: null,
                compositionSnapshot: JSON.parse(JSON.stringify(composition)) as Prisma.InputJsonValue,
            },
        });
        if (updated.count !== 1) throw new AppError('A viagem foi alterada durante a oferta. Revise e tente novamente.', 409);
        return tx.manifest.findUniqueOrThrow({ where: { id: manifestId }, include: { link: true, driver: true, vehicleType: true } });
    });
}
