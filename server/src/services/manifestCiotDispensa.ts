import { Prisma, type UserRole } from '@prisma/client';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';

interface FiscalActor {
    id: string;
    roles: readonly UserRole[];
    hubId?: string | null;
}

export const CIOT_DISPENSA_REASONS = {
    FROTA_PROPRIA_CARGA_PROPRIA: 'Embarcador com frota própria transportando carga própria (sem contratação de transporte)',
    OUTRO_VALIDADO_TORRE: 'Outro — validado pela torre',
} as const;

// Manual e-Frete v8.2, cenários das págs. 5–6: a ETC contratada com frota própria continua
// responsável pelo CIOT. Motorista empregado, por si só, não caracteriza dispensa.
export const ciotDispensaSchema = z.object({
    motivo: z.enum(['FROTA_PROPRIA_CARGA_PROPRIA', 'OUTRO_VALIDADO_TORRE'], {
        errorMap: () => ({ message: 'Selecione um motivo válido para a dispensa de CIOT.' }),
    }),
    observacao: z.string().trim().optional(),
}).superRefine((data, ctx) => {
    if (data.motivo === 'OUTRO_VALIDADO_TORRE' && (data.observacao?.length ?? 0) < 20) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['observacao'], message: 'Para outro motivo, informe a validação da torre com pelo menos 20 caracteres.' });
    }
});

export type CiotDispensaInput = z.infer<typeof ciotDispensaSchema>;

/** Mantém a coluna textual para leitura e desfazimento de dispensas legadas, sem reclassificá-las. */
export function formatCiotDispensaReason(input: CiotDispensaInput): string {
    const data = ciotDispensaSchema.parse(input);
    const reason = CIOT_DISPENSA_REASONS[data.motivo];
    return data.observacao ? `${reason}: ${data.observacao}` : reason;
}

const unresolvedCiotPhases = [
    'QUEUED', 'CADASTROS_ENSURING', 'SUBMITTED', 'POLLING', 'DOWNLOADING_FILES', 'PENDING_RECONCILIATION',
] satisfies Prisma.EnumCiotEmissionJobPhaseFilter['in'];

async function changeCiotDispensa(manifestId: string, actor: FiscalActor, motivo: string | null) {
    if (!actor.roles.includes('ADMIN') && !actor.roles.includes('HUB')) {
        throw new AppError('Sem permissão para alterar a dispensa de CIOT.', 403);
    }
    const reason = motivo?.trim() ?? null;

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

export function dispenseManifestCiot(manifestId: string, actor: FiscalActor, input: CiotDispensaInput) {
    return changeCiotDispensa(manifestId, actor, formatCiotDispensaReason(input));
}

export function undoManifestCiotDispensa(manifestId: string, actor: FiscalActor) {
    return changeCiotDispensa(manifestId, actor, null);
}
