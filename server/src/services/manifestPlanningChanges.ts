import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';

const blockingFiscalStatuses = ['SENT', 'READY', 'AUTHORIZED'] as const;

type Db = Prisma.TransactionClient | typeof prisma;

async function hasFiscalActivity(manifestId: string, db: Db = prisma): Promise<boolean> {
    const [document, ciotJob, cte] = await Promise.all([
        db.manifestFiscalDocument.findFirst({ where: { manifestId, status: { in: [...blockingFiscalStatuses] } }, select: { documentType: true, status: true } }),
        db.ciotEmissionJob.findFirst({ where: { manifestId }, select: { id: true } }),
        db.orderLeg.findFirst({ where: { manifestId, order: { freightCalculations: { some: { documentType: 'CTE', status: 'CTE_AUTHORIZED' } } } }, select: { id: true } }),
    ]);
    return Boolean(document || ciotJob || cte);
}

async function assertNoFiscalActivity(manifestId: string, db: Db = prisma) {
    if (await hasFiscalActivity(manifestId, db)) {
        throw new AppError('Há emissão fiscal iniciada ou autorizada. Registre uma correção e reconcilie os documentos antes de alterar a viagem.', 409);
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Ações de planejamento permitidas (para a tela mostrar só o que pode e dizer por quê).
// Espelham as guardas transacionais abaixo, que continuam sendo a autoridade.
// ────────────────────────────────────────────────────────────────────────────

export type PlanningActionKey = 'editPlanning' | 'withdrawOffer' | 'reopen' | 'cancel' | 'delete' | 'requestCorrection';
export interface PlanningActionState { allowed: boolean; reason?: string }
export type PlanningActions = Record<PlanningActionKey, PlanningActionState>;

export interface PlanningFacts {
    status: string;
    started: boolean;
    legsStarted: boolean;
    fiscalActivity: boolean;
    billing: boolean;
    everOffered: boolean;
    creationAuditComplete: boolean;
    hasHistory: boolean;
}

const allow = (): PlanningActionState => ({ allowed: true });
const deny = (reason: string): PlanningActionState => ({ allowed: false, reason });
const FINISHED = 'Viagem concluída ou cancelada: permanece no histórico.';
const FISCAL = 'Há emissão fiscal iniciada ou autorizada: registre uma correção e reconcilie os documentos.';

export function planningActionsFor(f: PlanningFacts): PlanningActions {
    const finished = f.status === 'COMPLETED' || f.status === 'CANCELLED';
    const editPlanning = f.status === 'DRAFT' ? allow()
        : f.status === 'PENDING_ACCEPT' ? deny('Retire a oferta para editar a viagem.')
            : f.status === 'ACCEPTED' ? deny('Reabra o planejamento (com justificativa) para editar; será preciso novo aceite.')
                : f.status === 'IN_PROGRESS' ? deny('Viagem em execução: registre uma correção.')
                    : deny(FINISHED);
    const withdrawOffer = f.status === 'PENDING_ACCEPT' ? allow() : deny('Não há oferta pendente.');
    const reopen = f.status !== 'ACCEPTED' || f.started ? deny('Só uma viagem aceita e ainda não iniciada volta ao planejamento.')
        : f.fiscalActivity ? deny(FISCAL) : allow();
    const cancel = finished ? deny(FINISHED)
        : f.status === 'IN_PROGRESS' || f.started || f.legsStarted ? deny('Resolva a carga e a custódia antes de cancelar uma viagem iniciada.')
            : f.billing ? deny('Concilie faturas e pagamentos antes de cancelar a viagem.')
                : f.fiscalActivity ? deny(FISCAL) : allow();
    const del = f.status !== 'DRAFT' || !f.creationAuditComplete || f.everOffered || f.hasHistory
        ? deny('Só um rascunho vazio e nunca ofertado pode ser excluído; use Cancelar viagem para preservar o histórico.')
        : allow();
    const requestCorrection = f.status === 'IN_PROGRESS' ? allow() : deny('Correções são para viagens em execução.');
    return { editPlanning, withdrawOffer, reopen, cancel, delete: del, requestCorrection };
}

export async function getPlanningActions(manifestId: string, db: Db = prisma): Promise<PlanningActions> {
    const manifest = await db.manifest.findUnique({
        where: { id: manifestId },
        include: {
            legs: { select: { startedAt: true, completedAt: true } },
            freightAgreement: { select: { id: true } },
            _count: { select: { legs: true, fiscalDocuments: true, ciotEmissionJobs: true, invoices: true, payables: true, deliveryAttempts: true, corrections: true, cancelledLegs: true } },
        },
    });
    if (!manifest) throw new AppError('Viagem não encontrada.', 404);
    return planningActionsFor({
        status: manifest.status,
        started: Boolean(manifest.startedAt),
        legsStarted: manifest.legs.some((leg) => leg.startedAt || leg.completedAt),
        fiscalActivity: await hasFiscalActivity(manifestId, db),
        billing: manifest._count.invoices > 0 || manifest._count.payables > 0,
        everOffered: Boolean(manifest.firstOfferedAt || manifest.offeredAt),
        creationAuditComplete: manifest.creationAuditComplete,
        hasHistory: Boolean(manifest.freightAgreement) || Object.values(manifest._count).some((count) => count > 0),
    });
}

export async function reopenAcceptedManifest(manifestId: string, actorUserId: string, reason: string) {
    const manifest = await prisma.manifest.findUnique({ where: { id: manifestId } });
    if (!manifest || manifest.status !== 'ACCEPTED' || manifest.startedAt) {
        throw new AppError('Somente uma viagem aceita e ainda não iniciada pode voltar ao planejamento.', 409);
    }
    return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Manifest" WHERE "id" = ${manifestId} FOR UPDATE`;
        await assertNoFiscalActivity(manifestId, tx);
        const updated = await tx.manifest.updateMany({
            where: { id: manifestId, status: 'ACCEPTED', startedAt: null },
            data: { status: 'DRAFT', acceptedAt: null, offeredAt: null, compositionSnapshot: Prisma.DbNull },
        });
        if (updated.count !== 1) throw new AppError('A viagem mudou de estado. Atualize a página e tente novamente.', 409);
        await tx.manifestCorrection.create({
            data: {
                manifestId, actorUserId, reason, kind: 'REOPEN',
                before: { status: 'ACCEPTED' }, after: { status: 'DRAFT' },
                status: 'APPLIED', resolvedAt: new Date(),
            },
        });
        return tx.manifest.findUniqueOrThrow({ where: { id: manifestId } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function deleteEmptyManifest(manifestId: string) {
    await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Manifest" WHERE "id" = ${manifestId} FOR UPDATE`;
        const manifest = await tx.manifest.findUnique({
            where: { id: manifestId },
            include: {
                _count: { select: { legs: true, fiscalDocuments: true, ciotEmissionJobs: true, invoices: true, payables: true, deliveryAttempts: true, corrections: true, cancelledLegs: true } },
                freightAgreement: { select: { id: true } },
            },
        });
        if (!manifest) throw new AppError('Viagem não encontrada.', 404);
        if (manifest.status !== 'DRAFT' || !manifest.creationAuditComplete || manifest.firstOfferedAt || manifest.offeredAt || manifest.freightAgreement
            || Object.values(manifest._count).some((count) => count > 0)) {
            throw new AppError('Esta viagem possui histórico ou vínculos. Use Cancelar viagem para preservá-los.', 409);
        }
        await tx.manifest.delete({ where: { id: manifestId } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function cancelManifest(manifestId: string, actorUserId: string, reason: string) {
    return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Manifest" WHERE "id" = ${manifestId} FOR UPDATE`;
        const manifest = await tx.manifest.findUnique({
            where: { id: manifestId },
            include: { legs: { select: { id: true, orderId: true, startedAt: true, completedAt: true } }, _count: { select: { invoices: true, payables: true } } },
        });
        if (!manifest) throw new AppError('Viagem não encontrada.', 404);
        if (!['DRAFT', 'PENDING_ACCEPT', 'ACCEPTED'].includes(manifest.status) || manifest.startedAt
            || manifest.legs.some((leg) => leg.startedAt || leg.completedAt)) {
            throw new AppError('Resolva a carga e a custódia antes de cancelar uma viagem iniciada; viagens concluídas permanecem no histórico.', 409);
        }
        if (manifest._count.invoices || manifest._count.payables) throw new AppError('Concilie faturas e pagamentos antes de cancelar a viagem.', 409);
        await assertNoFiscalActivity(manifestId, tx);
        const updated = await tx.manifest.updateMany({
            where: { id: manifestId, status: manifest.status, startedAt: null },
            data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: reason, archivedAt: new Date() },
        });
        if (updated.count !== 1) throw new AppError('A viagem mudou de estado. Atualize a página.', 409);
        for (const leg of manifest.legs) {
            await tx.manifestCancelledLeg.create({
                data: {
                    manifestId, orderId: leg.orderId,
                    legData: {
                        originalLegId: leg.id, startedAt: leg.startedAt?.toISOString() ?? null,
                        completedAt: leg.completedAt?.toISOString() ?? null,
                    },
                },
            });
            await tx.orderLeg.delete({ where: { id: leg.id } });
            const nextLeg = await tx.orderLeg.findFirst({ where: { orderId: leg.orderId }, orderBy: { createdAt: 'desc' }, select: { manifestId: true } });
            await tx.order.updateMany({ where: { id: leg.orderId, manifestId }, data: { manifestId: nextLeg?.manifestId ?? null } });
            await tx.orderHistory.create({ data: { orderId: leg.orderId, eventType: 'NOTE', description: `Viagem ${manifestId} cancelada: ${reason}` } });
        }
        await tx.manifestCorrection.create({
            data: { manifestId, actorUserId, reason, kind: 'CANCEL', before: { status: manifest.status }, after: { status: 'CANCELLED' }, status: 'APPLIED', resolvedAt: new Date() },
        });
        return tx.manifest.findUniqueOrThrow({ where: { id: manifestId } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function requestManifestCorrection(input: {
    manifestId: string; actorUserId: string; reason: string; kind: string;
    after: Prisma.InputJsonObject;
}) {
    const manifest = await prisma.manifest.findUnique({ where: { id: input.manifestId } });
    if (!manifest || manifest.status !== 'IN_PROGRESS') throw new AppError('Correções em execução exigem uma viagem iniciada.', 409);
    return prisma.manifestCorrection.create({
        data: {
            manifestId: input.manifestId, actorUserId: input.actorUserId, reason: input.reason,
            kind: input.kind, before: {
                origin: manifest.origin, destination: manifest.destination,
                originCityIbgeCode: manifest.originCityIbgeCode,
                destinationCityIbgeCode: manifest.destinationCityIbgeCode,
                driverId: manifest.driverId,
            },
            after: input.after,
            fiscalImpact: 'Verificar CT-e, MDF-e e CIOT com os provedores. Nenhum documento ou rota fiscal foi alterado automaticamente.',
        },
    });
}

/**
 * Conclui uma correção de viagem em execução depois da resposta dos provedores:
 * - APPLIED: documentos reconciliados (cancelados/encerrados/reemitidos no provedor); registra a decisão.
 * - REJECTED: correção descartada.
 * - SUCCESSOR: a correção não cabe nesta viagem; abre uma viagem sucessora em rascunho, vinculada,
 *   com a rota corrigida. Pedidos não são movidos automaticamente (custódia é decisão operacional).
 * Nada de documento autorizado é sobrescrito.
 */
export async function resolveManifestCorrection(input: {
    manifestId: string; correctionId: string; actorUserId: string;
    outcome: 'APPLIED' | 'REJECTED' | 'SUCCESSOR'; note: string;
}) {
    return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "ManifestCorrection" WHERE "id" = ${input.correctionId} FOR UPDATE`;
        const correction = await tx.manifestCorrection.findUnique({ where: { id: input.correctionId } });
        if (!correction || correction.manifestId !== input.manifestId) throw new AppError('Correção não encontrada nesta viagem.', 404);
        if (correction.status !== 'PENDING_FISCAL') throw new AppError('Esta correção já foi concluída.', 409);

        let successorManifestId: string | null = null;
        if (input.outcome === 'SUCCESSOR') {
            const original = await tx.manifest.findUniqueOrThrow({ where: { id: input.manifestId } });
            const after = (correction.after ?? {}) as Record<string, unknown>;
            const text = (key: string) => (typeof after[key] === 'string' && after[key] ? String(after[key]) : null);
            const city = text('city'); const state = text('state'); const ibge = text('cityIbgeCode');
            const corrected = city && state && ibge
                ? { destination: `${city}, ${state}`, destinationCity: city, destinationState: state, destinationCityIbgeCode: ibge, destHubId: null }
                : {};
            const successor = await tx.manifest.create({
                data: {
                    tripType: original.tripType, hubId: original.hubId, destHubId: original.destHubId,
                    vehicleTypeId: original.vehicleTypeId, fiscalEmitterId: original.fiscalEmitterId,
                    origin: original.origin, originCity: original.originCity, originState: original.originState, originCityIbgeCode: original.originCityIbgeCode,
                    destination: original.destination, destinationCity: original.destinationCity, destinationState: original.destinationState,
                    destinationCityIbgeCode: original.destinationCityIbgeCode,
                    ...corrected,
                    notes: `Viagem sucessora de ${original.id}: ${correction.reason}`,
                    creationAuditComplete: true,
                },
            });
            successorManifestId = successor.id;
        }

        const conclusion = `Conclusão (${input.outcome}) por ${input.actorUserId}: ${input.note}`;
        return tx.manifestCorrection.update({
            where: { id: correction.id },
            data: {
                status: input.outcome === 'REJECTED' ? 'REJECTED' : 'APPLIED',
                resolvedAt: new Date(),
                successorManifestId,
                fiscalImpact: correction.fiscalImpact ? `${correction.fiscalImpact}\n${conclusion}` : conclusion,
            },
        });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
