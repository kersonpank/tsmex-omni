import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';

export type ManifestDb = Prisma.TransactionClient | typeof prisma;
export async function hasActiveTripFiscalOperation(id: string, db: ManifestDb = prisma) {
    const [document, job] = await Promise.all([
        db.manifestFiscalDocument.findFirst({ where: { manifestId: id, status: { in: ['SENT', 'READY', 'AUTHORIZED'] } }, select: { id: true } }),
        db.ciotEmissionJob.findFirst({ where: { manifestId: id, phase: { notIn: ['FAILED', 'DONE'] } }, select: { id: true } }),
    ]);
    return Boolean(document || job);
}

export async function hasAuthorizedTripCte(id: string, db: ManifestDb = prisma) {
    return Boolean(await db.orderLeg.findFirst({ where: { manifestId: id, order: { freightCalculations: { some: { documentType: 'CTE', status: 'CTE_AUTHORIZED' } } } }, select: { id: true } }));
}

export async function hasProtectedCteFields(id: string, db: ManifestDb = prisma) {
    const manifest = await db.manifest.findUnique({ where: { id }, select: { status: true, corrections: { where: { kind: 'REOPEN' }, take: 1, select: { id: true } } } });
    return Boolean(manifest && (manifest.status !== 'DRAFT' || manifest.corrections?.length) && await hasAuthorizedTripCte(id, db));
}

/** CT-e protege carga, rota fiscal e emitente; não congela o cadastro do motorista. */
export async function assertCteFieldsMutable(id: string, db: ManifestDb = prisma) {
    if (await hasProtectedCteFields(id, db)) throw new AppError('CT-e autorizado: preserve pedidos, rota fiscal e emitente. Regularize o CT-e antes de alterar esses dados; os responsáveis podem ser corrigidos separadamente.', 409);
}

export async function assertTripPlanningMutable(id: string, db: ManifestDb = prisma) {
    const manifest = await db.manifest.findUnique({ where: { id } });
    if (!manifest) throw new AppError('Viagem não encontrada.', 404);
    if (manifest.status !== 'DRAFT') throw new AppError('Retire a oferta ou reabra o planejamento com justificativa antes de editar. Após a correção, libere a viagem novamente.', 409);
    if (await hasActiveTripFiscalOperation(id, db)) throw new AppError('Há emissão fiscal iniciada ou autorizada. Consulte o processamento ou regularize os documentos antes de corrigir.', 409);
    return manifest;
}

export async function recordPlanningEdit(db: ManifestDb, id: string, actorUserId: string, kind: string, before: unknown, after: unknown, reason?: string) {
    await db.manifestCorrection.create({ data: {
        manifestId: id, actorUserId, kind, reason: typeof reason === 'string' && reason.trim() ? reason.trim() : 'Atualização dos dados no planejamento da viagem.',
        before: JSON.parse(JSON.stringify(before ?? {})), after: JSON.parse(JSON.stringify(after ?? {})),
        status: 'APPLIED', resolvedAt: new Date(),
    } });
}

export async function mutatePlanning<T>(id: string, actorUserId: string, kind: string, change: (db: ManifestDb) => Promise<T>, protectCte = false, reason?: string) {
    return prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "Manifest" WHERE "id" = ${id} FOR UPDATE`;
        await assertTripPlanningMutable(id, tx);
        if (protectCte) await assertCteFieldsMutable(id, tx);
        const snapshot = () => tx.manifest.findUniqueOrThrow({ where: { id }, include: { tripStops: true, driverAssignments: true, vehicleAssignments: true } });
        const before = await snapshot();
        const result = await change(tx);
        await tx.manifest.update({ where: { id }, data: { updatedAt: new Date() } });
        await recordPlanningEdit(tx, id, actorUserId, kind, before, await snapshot(), reason);
        return result;
    }, { isolationLevel: 'Serializable' });
}

/** Guarda também os cadastros compartilhados usados pelas viagens: alterações não contornam a consulta fiscal. */
export async function lockFiscalCadastros(db: ManifestDb, subject: { driverId?: string; linkId?: string; personId?: string }) {
    const related = await db.manifest.findMany({ where: {
        status: { in: ['DRAFT', 'PENDING_ACCEPT', 'ACCEPTED', 'IN_PROGRESS'] },
        OR: [
            ...(subject.driverId ? [{ driverId: subject.driverId }, { driverAssignments: { some: { driverId: subject.driverId } } }] : []),
            ...(subject.linkId ? [{ linkId: subject.linkId }] : []),
            ...(subject.personId ? [{ link: { personId: subject.personId } }, { driver: { personId: subject.personId } }, { driverAssignments: { some: { driver: { personId: subject.personId } } } }, { fiscalEmitter: { personId: subject.personId } }, { vehicleAssignments: { some: { vehicleUnit: { OR: [{ ownerPersonId: subject.personId }, { rntrcHolderPersonId: subject.personId }] } } } }] : []),
        ],
    }, orderBy: { id: 'asc' }, select: { id: true, status: true, fiscalEmitter: { select: { personId: true } } } });
    for (const manifest of related) {
        await db.$queryRaw`SELECT "id" FROM "Manifest" WHERE "id" = ${manifest.id} FOR UPDATE`;
        if (await hasActiveTripFiscalOperation(manifest.id, db)) throw new AppError(`Cadastro usado pela viagem ${manifest.id.slice(0, 8)} com processamento fiscal ativo ou documento autorizado. Consulte ou regularize a operação antes de corrigir.`, 409);
        if (subject.personId && manifest.fiscalEmitter?.personId === subject.personId) await assertCteFieldsMutable(manifest.id, db);
    }
    return related;
}

export function assertCadastroCorrectionReason(related: Array<{ status: string }>, reason: unknown) {
    if (related.some(manifest => manifest.status !== 'DRAFT') && (typeof reason !== 'string' || reason.trim().length < 8)) throw new AppError('Informe o motivo da correção (ao menos 8 caracteres): este cadastro é usado por uma viagem já liberada ou ofertada.', 422);
}
