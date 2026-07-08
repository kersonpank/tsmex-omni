import type { NfeDistribuicaoDocumentoTipo, Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';

/**
 * Dependências injetáveis do repositório — mesmo padrão de `CteEmissionProcessorDeps`
 * (`server/src/services/queues/cteEmissionProcessor.ts`): permite testar as transições de
 * estado sem falar com Postgres de verdade.
 */
export interface NfeDistribuicaoRepoDeps {
    prisma: {
        nfeDistribuicaoDocumento: Pick<
            typeof prisma.nfeDistribuicaoDocumento,
            'findUnique' | 'create' | 'updateMany' | 'update' | 'findMany'
        >;
    };
}

export const defaultNfeDistribuicaoRepoDeps: NfeDistribuicaoRepoDeps = {
    prisma: {
        nfeDistribuicaoDocumento: prisma.nfeDistribuicaoDocumento,
    },
};

export interface DiscoveredDocumentInput {
    nsu: string;
    accessKey: string;
    tipo: NfeDistribuicaoDocumentoTipo;
    cnpjEmitente: string;
    ambiente: string;
    fiscalEmitterId: string;
    resumoRaw: Record<string, unknown>;
}

/**
 * Idempotente por `accessKey`: se o documento já existe (de uma execução anterior do worker,
 * ou de uma nova descoberta do mesmo NSU), retorna o registro existente sem regredir o status
 * — nunca duplica, nunca reabre um documento que já passou de DISCOVERED.
 */
export async function upsertDiscovered(
    input: DiscoveredDocumentInput,
    deps: NfeDistribuicaoRepoDeps = defaultNfeDistribuicaoRepoDeps,
) {
    const existing = await deps.prisma.nfeDistribuicaoDocumento.findUnique({ where: { accessKey: input.accessKey } });
    if (existing) return existing;
    return deps.prisma.nfeDistribuicaoDocumento.create({
        data: {
            nsu: input.nsu,
            accessKey: input.accessKey,
            tipo: input.tipo,
            cnpjEmitente: input.cnpjEmitente,
            ambiente: input.ambiente,
            fiscalEmitterId: input.fiscalEmitterId,
            resumoRaw: input.resumoRaw as Prisma.InputJsonValue,
        },
    });
}

/** Compare-and-swap: só transiciona DISCOVERED→MANIFESTED. Retorna false se já não estava em DISCOVERED. */
export async function markManifested(
    id: string,
    deps: NfeDistribuicaoRepoDeps = defaultNfeDistribuicaoRepoDeps,
): Promise<boolean> {
    const result = await deps.prisma.nfeDistribuicaoDocumento.updateMany({
        where: { id, status: 'DISCOVERED' },
        data: { status: 'MANIFESTED', manifestedAt: new Date() },
    });
    return result.count > 0;
}

/**
 * Compare-and-swap: só transiciona MANIFESTED→READY_FOR_TRIAGE quando o XML ainda não foi
 * baixado (`xmlDownloadedAt: null`). Idempotente: rodar o processor 2x não duplica o upload.
 */
export async function markXmlDownloaded(
    id: string,
    xmlStorageKey: string,
    deps: NfeDistribuicaoRepoDeps = defaultNfeDistribuicaoRepoDeps,
): Promise<boolean> {
    const result = await deps.prisma.nfeDistribuicaoDocumento.updateMany({
        where: { id, status: 'MANIFESTED', xmlDownloadedAt: null },
        data: { status: 'READY_FOR_TRIAGE', xmlDownloadedAt: new Date(), xmlStorageKey },
    });
    return result.count > 0;
}

export async function markPausedForQuota(
    id: string,
    params: { lastHttpStatus?: number; lastError?: string },
    deps: NfeDistribuicaoRepoDeps = defaultNfeDistribuicaoRepoDeps,
): Promise<void> {
    await deps.prisma.nfeDistribuicaoDocumento.update({
        where: { id },
        data: {
            pausedForQuota: true,
            status: 'PENDING_RECONCILIATION',
            lastHttpStatus: params.lastHttpStatus,
            lastError: params.lastError,
        },
    });
}

export async function markFailed(
    id: string,
    lastError: string,
    deps: NfeDistribuicaoRepoDeps = defaultNfeDistribuicaoRepoDeps,
): Promise<void> {
    await deps.prisma.nfeDistribuicaoDocumento.update({
        where: { id },
        data: { status: 'FAILED', lastError },
    });
}

export async function listReadyForTriage(
    filter: { fiscalEmitterId?: string; hubId?: string } = {},
    deps: NfeDistribuicaoRepoDeps = defaultNfeDistribuicaoRepoDeps,
) {
    return deps.prisma.nfeDistribuicaoDocumento.findMany({
        where: {
            status: 'READY_FOR_TRIAGE',
            ...(filter.fiscalEmitterId ? { fiscalEmitterId: filter.fiscalEmitterId } : {}),
            ...(filter.hubId ? { fiscalEmitter: { hubId: filter.hubId } } : {}),
        },
        orderBy: { createdAt: 'asc' },
    });
}

/** Compare-and-swap: só converte quem ainda está READY_FOR_TRIAGE (evita converter 2x). */
export async function markConverted(
    id: string,
    demandId: string,
    deps: NfeDistribuicaoRepoDeps = defaultNfeDistribuicaoRepoDeps,
): Promise<boolean> {
    const result = await deps.prisma.nfeDistribuicaoDocumento.updateMany({
        where: { id, status: 'READY_FOR_TRIAGE' },
        data: { status: 'CONVERTED', convertedDemandId: demandId, convertedAt: new Date() },
    });
    return result.count > 0;
}

/** Compare-and-swap: só descarta quem ainda está READY_FOR_TRIAGE. */
export async function markDiscarded(
    id: string,
    userId: string,
    deps: NfeDistribuicaoRepoDeps = defaultNfeDistribuicaoRepoDeps,
): Promise<boolean> {
    const result = await deps.prisma.nfeDistribuicaoDocumento.updateMany({
        where: { id, status: 'READY_FOR_TRIAGE' },
        data: { status: 'DISCARDED', discardedAt: new Date(), discardedByUserId: userId },
    });
    return result.count > 0;
}
