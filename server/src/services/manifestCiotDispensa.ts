import { Prisma, type UserRole } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';

interface FiscalActor {
    id: string;
    roles: readonly UserRole[];
    hubId?: string | null;
}

const unresolvedCiotPhases = [
    'QUEUED', 'CADASTROS_ENSURING', 'SUBMITTED', 'POLLING', 'DOWNLOADING_FILES', 'PENDING_RECONCILIATION',
] satisfies Prisma.EnumCiotEmissionJobPhaseFilter['in'];

async function changeCiotDispensa(manifestId: string, actor: FiscalActor, motivo: string | null) {
    if (!actor.roles.includes('ADMIN') && !actor.roles.includes('HUB')) {
        throw new AppError('Sem permissão para alterar a dispensa de CIOT.', 403);
    }
    const reason = motivo?.trim() ?? null;
    if (reason !== null && reason.length < 10) {
        throw new AppError('Informe o motivo da dispensa de CIOT com pelo menos 10 caracteres.', 400);
    }

    return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Manifest" WHERE "id" = ${manifestId} FOR UPDATE`;
        const manifest = await tx.manifest.findUnique({ where: { id: manifestId } });
        if (!manifest) throw new AppError('Viagem não encontrada.', 404);
        if (!actor.roles.includes('ADMIN') && (!actor.hubId || manifest.hubId !== actor.hubId)) {
            throw new AppError('Sem acesso a esta viagem.', 403);
        }
        if (!['PENDING_ACCEPT', 'ACCEPTED'].includes(manifest.status)) {
            throw new AppError('A dispensa de CIOT só pode ser alterada em uma viagem ofertada ou aceita.', 409);
        }

        if (reason === null) {
            const mdfe = await tx.manifestFiscalDocument.findFirst({
                where: { manifestId, documentType: 'MDFE', status: 'AUTHORIZED' },
                select: { id: true },
            });
            if (mdfe) throw new AppError('Não é possível desfazer a dispensa de CIOT após a autorização do MDF-e.', 409);
        } else {
            const ciot = await tx.manifestFiscalDocument.findFirst({
                where: { manifestId, documentType: 'CIOT', status: 'AUTHORIZED' },
                select: { id: true },
            });
            if (ciot) throw new AppError('Já existe um CIOT autorizado para esta viagem. Não é possível dispensá-lo.', 409);
            const job = await tx.ciotEmissionJob.findFirst({
                where: { manifestId, phase: { in: unresolvedCiotPhases } },
                select: { id: true },
            });
            if (job) throw new AppError('Há uma emissão de CIOT em processamento ou aguardando conciliação. Consulte o resultado antes de dispensá-lo.', 409);
        }

        const dispensado = reason !== null;
        if (manifest.ciotDispensado === dispensado && manifest.ciotDispensadoMotivo === reason) return manifest;
        const previous = { ciotDispensado: manifest.ciotDispensado, ciotDispensadoMotivo: manifest.ciotDispensadoMotivo };
        const updated = await tx.manifest.update({
            where: { id: manifestId },
            data: { ciotDispensado: dispensado, ciotDispensadoMotivo: reason },
        });
        await tx.manifestCorrection.create({
            data: {
                manifestId,
                actorUserId: actor.id,
                reason: reason === null
                    ? `[CIOT dispensa desfeita] ${previous.ciotDispensadoMotivo ?? 'Dispensa removida pelo operador.'}`
                    : `[CIOT dispensado] ${reason}`,
                kind: reason === null ? 'CIOT_DISPENSA_DESFEITA' : 'CIOT_DISPENSA',
                before: previous,
                after: { ciotDispensado: dispensado, ciotDispensadoMotivo: reason },
                status: 'APPLIED',
                resolvedAt: new Date(),
            },
        });
        return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export function dispenseManifestCiot(manifestId: string, actor: FiscalActor, motivo: string) {
    return changeCiotDispensa(manifestId, actor, motivo);
}

export function undoManifestCiotDispensa(manifestId: string, actor: FiscalActor) {
    return changeCiotDispensa(manifestId, actor, null);
}
