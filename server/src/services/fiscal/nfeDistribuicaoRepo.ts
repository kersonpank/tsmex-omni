import type { NfeDistribuicaoDocumentoStatus, NfeDistribuicaoDocumentoTipo, Prisma } from '@prisma/client';
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
            'findUnique' | 'create' | 'updateMany' | 'update' | 'findMany' | 'count'
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
    integrity?: { checksum?: string; size?: number },
): Promise<boolean> {
    const result = await deps.prisma.nfeDistribuicaoDocumento.updateMany({
        where: { id, status: 'MANIFESTED', xmlDownloadedAt: null },
        data: {
            status: 'READY_FOR_TRIAGE', tipo: 'NFE_PROC', xmlDownloadedAt: new Date(), xmlStorageKey,
            xmlChecksum: integrity?.checksum, xmlSize: integrity?.size, lastError: null,
        },
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

export interface ListAllDocumentsFilter {
    status?: NfeDistribuicaoDocumentoStatus;
    fiscalEmitterId?: string;
    hubId?: string;
    cnpjEmitente?: string;
    limit?: number;
}

/**
 * Visão administrativa de TODOS os status (não só READY_FOR_TRIAGE como `listReadyForTriage`) —
 * pro painel ADMIN de monitoramento (`GET /distribuicao-nfe/monitor`), que precisa enxergar o
 * pipeline inteiro (descoberta → manifestação → triagem → conversão/descarte → erro).
 */
export async function listAllDocuments(
    filter: ListAllDocumentsFilter = {},
    deps: NfeDistribuicaoRepoDeps = defaultNfeDistribuicaoRepoDeps,
) {
    return deps.prisma.nfeDistribuicaoDocumento.findMany({
        where: {
            ...(filter.status ? { status: filter.status } : {}),
            ...(filter.fiscalEmitterId ? { fiscalEmitterId: filter.fiscalEmitterId } : {}),
            ...(filter.hubId ? { fiscalEmitter: { hubId: filter.hubId } } : {}),
            ...(filter.cnpjEmitente ? { cnpjEmitente: filter.cnpjEmitente.replace(/\D/g, '') } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: filter.limit ?? 200,
        include: {
            fiscalEmitter: { select: { displayName: true, hub: { select: { code: true, name: true } } } },
            convertedDemand: { select: { id: true, status: true, orderNumber: true } },
        },
    });
}

const ALL_STATUSES: NfeDistribuicaoDocumentoStatus[] = [
    'DISCOVERED', 'MANIFESTED', 'READY_FOR_TRIAGE', 'CONVERTED', 'DISCARDED', 'FAILED', 'PENDING_RECONCILIATION',
];

/** Contagem por status — tira de "saúde do pipeline" no topo do painel ADMIN. */
export async function countDocumentsByStatus(
    filter: { fiscalEmitterId?: string; hubId?: string; cnpjEmitente?: string } = {},
    deps: NfeDistribuicaoRepoDeps = defaultNfeDistribuicaoRepoDeps,
): Promise<Record<NfeDistribuicaoDocumentoStatus, number>> {
    const baseWhere = {
        ...(filter.fiscalEmitterId ? { fiscalEmitterId: filter.fiscalEmitterId } : {}),
        ...(filter.hubId ? { fiscalEmitter: { hubId: filter.hubId } } : {}),
        ...(filter.cnpjEmitente ? { cnpjEmitente: filter.cnpjEmitente.replace(/\D/g, '') } : {}),
    };
    const counts = await Promise.all(
        ALL_STATUSES.map((status) => deps.prisma.nfeDistribuicaoDocumento.count({ where: { ...baseWhere, status } })),
    );
    return Object.fromEntries(ALL_STATUSES.map((status, i) => [status, counts[i]])) as Record<NfeDistribuicaoDocumentoStatus, number>;
}
