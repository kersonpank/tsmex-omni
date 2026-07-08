import type { Job } from 'bullmq';
import { DelayedError } from 'bullmq';
import prisma from '../../lib/prisma.js';
import { AcbrHttpError } from '../acbr/acbrHttp.js';
import {
    baixarXmlDocumentoDistribuicao,
    getUltimoNsuStored,
    setUltimoNsuStored,
    solicitarDistribuicaoNfe,
    type DistribuicaoNfeRequestBody,
} from '../acbr/acbrDistribuicaoNfe.js';
import { parseDistribuicaoDocumento } from '../acbr/distribuicaoNfeDocumentParser.js';
import { manifestarCienciaOperacao } from '../acbr/acbrManifestacao.js';
import { uploadBase64Object } from '../../lib/objectStorage.js';
import {
    markFailed,
    markManifested,
    markPausedForQuota,
    markXmlDownloaded,
    upsertDiscovered,
} from '../fiscal/nfeDistribuicaoRepo.js';
import { createSystemAlert } from '../systemAlertService.js';
import { getDistribuicaoNfeQueue, type DistribuicaoNfeJobData } from './distribuicaoNfeQueue.js';

type SyncEmitterJobData = Extract<DistribuicaoNfeJobData, { kind: 'sync-emitter' }>;

/** ~3,3 req/s — folga confortável abaixo do rate limit documentado (240/min POST, 360/min GET). */
const THROTTLE_MS = 300;
const RATE_LIMIT_BACKOFF_CAP_MS = 5 * 60 * 1000;
/** Cap de documentos processados (manifestação+download) por execução do job — evita um job
 * gigante travar um slot do worker; o restante fica pra próxima execução (coordenador/sync-now). */
const MAX_DOCS_PER_RUN = 50;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Dependências injetáveis — mesmo padrão de `CteEmissionProcessorDeps`
 * (`server/src/services/queues/cteEmissionProcessor.ts`).
 */
export interface SyncProcessorDeps {
    prisma: {
        fiscalEmitter: Pick<typeof prisma.fiscalEmitter, 'findUnique'>;
        nfeDistribuicaoDocumento: Pick<typeof prisma.nfeDistribuicaoDocumento, 'findMany'>;
    };
    getUltimoNsuStored: typeof getUltimoNsuStored;
    setUltimoNsuStored: typeof setUltimoNsuStored;
    solicitarDistribuicaoNfe: typeof solicitarDistribuicaoNfe;
    manifestarCienciaOperacao: typeof manifestarCienciaOperacao;
    baixarXmlDocumentoDistribuicao: typeof baixarXmlDocumentoDistribuicao;
    uploadBase64Object: typeof uploadBase64Object;
    upsertDiscovered: typeof upsertDiscovered;
    markManifested: typeof markManifested;
    markXmlDownloaded: typeof markXmlDownloaded;
    markPausedForQuota: typeof markPausedForQuota;
    markFailed: typeof markFailed;
    createSystemAlert: typeof createSystemAlert;
    distribuicaoNfeQueue: Pick<ReturnType<typeof getDistribuicaoNfeQueue>, 'pause'>;
    sleep: (ms: number) => Promise<void>;
}

export const defaultSyncProcessorDeps: SyncProcessorDeps = {
    prisma: {
        fiscalEmitter: prisma.fiscalEmitter,
        nfeDistribuicaoDocumento: prisma.nfeDistribuicaoDocumento,
    },
    getUltimoNsuStored,
    setUltimoNsuStored,
    solicitarDistribuicaoNfe,
    manifestarCienciaOperacao,
    baixarXmlDocumentoDistribuicao,
    uploadBase64Object,
    upsertDiscovered,
    markManifested,
    markXmlDownloaded,
    markPausedForQuota,
    markFailed,
    createSystemAlert,
    get distribuicaoNfeQueue() {
        return getDistribuicaoNfeQueue();
    },
    sleep,
};

function retryDelayFromHeaders(err: AcbrHttpError): number {
    const seconds = err.retryInSeconds ?? err.retryAfterSeconds ?? 2;
    return Math.min(Math.max(seconds, 1) * 1000, RATE_LIMIT_BACKOFF_CAP_MS);
}

/** Mesmo contrato exigido pelo BullMQ documentado em `cteEmissionProcessor.ts:rescheduleJob`. */
async function rescheduleJob(job: Job<SyncEmitterJobData>, delayMs: number): Promise<never> {
    await job.moveToDelayed(Date.now() + delayMs, job.token);
    throw new DelayedError();
}

async function handlePaymentRequired(deps: SyncProcessorDeps, doc: { id: string }, err: AcbrHttpError): Promise<void> {
    await deps.distribuicaoNfeQueue.pause();
    await deps.markPausedForQuota(doc.id, { lastHttpStatus: 402, lastError: err.message });
    await deps.createSystemAlert({
        category: 'FISCAL_DISTRIBUICAO_NFE_QUOTA',
        severity: 'CRITICAL',
        title: 'Varredura de Distribuição NF-e pausada — créditos ACBr esgotados',
        message: `Código: ${err.quotaErrorCode ?? 'desconhecido'}. ${err.message}`,
        context: { documentoId: doc.id, httpStatus: 402, quotaErrorCode: err.quotaErrorCode },
    });
}

/**
 * TODO (mesmo bloqueio de schema não confirmado — ver Task 3/`acbrManifestacao.ts`): o nome do
 * campo com o array de documentos retornados por `POST /distribuicao/nfe` não está confirmado.
 * `ultimo_nsu` já é usado com confiança (código pré-existente em `fiscalDistribuicao.ts`).
 */
function extractDocumentos(data: Record<string, unknown>): Record<string, unknown>[] {
    const candidate = data.documentos ?? data.docs;
    return Array.isArray(candidate) ? (candidate as Record<string, unknown>[]) : [];
}

function extractUltimoNsu(data: Record<string, unknown>): number | null {
    const raw = data.ultimo_nsu;
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number(raw);
    return null;
}

function extractDocumentoId(raw: unknown): string | null {
    if (!raw || typeof raw !== 'object') return null;
    const id = (raw as Record<string, unknown>).id;
    return typeof id === 'string' ? id : null;
}

async function runDiscoveryPhase(
    deps: SyncProcessorDeps,
    fiscalEmitterId: string,
    cpfCnpj: string,
    ambiente: 'homologacao' | 'producao',
): Promise<void> {
    const ultimoNsuStr = await deps.getUltimoNsuStored(cpfCnpj, ambiente);

    // Segunda camada de defesa contra o "Big Bang" de custo do NSU=0 — a primeira é o
    // coordenador (`distribuicaoNfeCoordinatorProcessor.ts`). Redundante de propósito: este
    // processor não deve confiar apenas no coordenador pra nunca deixar passar ultNSU=0.
    if (!ultimoNsuStr || ultimoNsuStr === '0') {
        await deps.createSystemAlert({
            category: 'FISCAL_DISTRIBUICAO_NFE_NOT_SEEDED',
            severity: 'WARNING',
            title: 'NSU inicial não configurado — sync abortada',
            message: `Guarda de segurança: o emitente ${fiscalEmitterId} (CNPJ ${cpfCnpj}, ${ambiente}) tentou sincronizar sem NSU semeado. Use o endpoint bootstrap-nsu antes de tentar de novo.`,
            context: { fiscalEmitterId, cpfCnpj, ambiente },
        });
        return;
    }

    const body: DistribuicaoNfeRequestBody = {
        cpf_cnpj: cpfCnpj,
        ambiente,
        tipo_consulta: 'dist-nsu',
        dist_nsu: Number(ultimoNsuStr),
    };
    const response = await deps.solicitarDistribuicaoNfe(body);

    const docs = extractDocumentos(response);
    const novoUltimoNsu = extractUltimoNsu(response);

    for (const raw of docs) {
        const nsuDoDocumento = typeof raw.nsu === 'string' || typeof raw.nsu === 'number' ? String(raw.nsu) : String(novoUltimoNsu ?? ultimoNsuStr);
        const parsed = parseDistribuicaoDocumento(raw, nsuDoDocumento);
        if ((parsed.tipo === 'RESUMO' || parsed.tipo === 'NFE_PROC') && parsed.accessKey && parsed.cnpjEmitente) {
            await deps.upsertDiscovered({
                nsu: parsed.nsu,
                accessKey: parsed.accessKey,
                tipo: parsed.tipo,
                cnpjEmitente: parsed.cnpjEmitente,
                ambiente,
                fiscalEmitterId,
                resumoRaw: parsed.raw,
            });
        }
    }

    if (novoUltimoNsu != null && String(novoUltimoNsu) !== ultimoNsuStr) {
        await deps.setUltimoNsuStored(cpfCnpj, ambiente, String(novoUltimoNsu));
    }
}

/**
 * Fases 2 (manifestação) e 3 (download de XML) para os documentos pendentes deste emitente.
 * Processados SEMPRE em série, nunca em paralelo, com throttle entre cada chamada ACBr — um
 * job processando um lote grande (ex.: pico de faturamento antes da varredura das 13h) em
 * loop apertado ou `Promise.all` estouraria os limites documentados (240 req/min POST,
 * 360 req/min GET) em segundos. O limiter do BullMQ Worker controla jobs/minuto na fila, não
 * chamadas HTTP dentro de UM job — por isso o throttle explícito aqui é indispensável.
 */
async function runManifestacaoEDownloadPhases(
    deps: SyncProcessorDeps,
    job: Job<SyncEmitterJobData>,
    fiscalEmitterId: string,
    cpfCnpj: string,
    ambiente: 'homologacao' | 'producao',
): Promise<void> {
    const pendentes = await deps.prisma.nfeDistribuicaoDocumento.findMany({
        where: { fiscalEmitterId, status: { in: ['DISCOVERED', 'MANIFESTED'] } },
        orderBy: { createdAt: 'asc' },
        take: MAX_DOCS_PER_RUN,
    });

    let calledAcbrOnce = false;
    for (const doc of pendentes) {
        if (calledAcbrOnce) await deps.sleep(THROTTLE_MS);

        let status = doc.status;
        if (status === 'DISCOVERED') {
            calledAcbrOnce = true;
            await deps.manifestarCienciaOperacao({ chaveAcesso: doc.accessKey, cpfCnpj, ambiente });
            await deps.markManifested(doc.id);
            status = 'MANIFESTED';
            await deps.sleep(THROTTLE_MS);
        }

        if (status === 'MANIFESTED' && !doc.xmlDownloadedAt) {
            calledAcbrOnce = true;
            const documentoId = extractDocumentoId(doc.resumoRaw) ?? doc.accessKey;
            const xml = await deps.baixarXmlDocumentoDistribuicao(documentoId, ambiente);
            const uploaded = await deps.uploadBase64Object({
                base64: Buffer.from(xml, 'utf-8').toString('base64'),
                fileName: `${doc.accessKey}.xml`,
                mimeType: 'application/xml',
                keyPrefix: `nfe-distribuicao/${doc.accessKey}/xml`,
            });
            await deps.markXmlDownloaded(doc.id, uploaded.storageKey);
        }
    }

    void job; // reservado para eventual reagendamento por volume — ver Task 9 no plano.
}

export async function processDistribuicaoNfeSyncJob(
    job: Job<SyncEmitterJobData>,
    deps: SyncProcessorDeps = defaultSyncProcessorDeps,
): Promise<void> {
    const { fiscalEmitterId } = job.data;

    let currentDocId: string | null = null;

    try {
        const emitter = await deps.prisma.fiscalEmitter.findUnique({
            where: { id: fiscalEmitterId },
            select: { id: true, active: true, distribuicaoNfeEnabled: true, environment: true, person: { select: { document: true } } },
        });

        // Emitente desligado/desativado entre o enqueue e o processamento — sai cedo sem
        // chamar a ACBr (nunca confiar que o estado no momento do enqueue ainda vale agora).
        if (!emitter || !emitter.active || !emitter.distribuicaoNfeEnabled) return;

        const ambiente: 'homologacao' | 'producao' = emitter.environment === 'PRODUCAO' ? 'producao' : 'homologacao';
        const cpfCnpj = emitter.person.document;

        await runDiscoveryPhase(deps, fiscalEmitterId, cpfCnpj, ambiente);

        // Rastreia qual documento estava em processamento quando um erro estourar, pra poder
        // marcá-lo corretamente no catch (402) sem precisar recarregar o estado.
        const pendentesSnapshot = await deps.prisma.nfeDistribuicaoDocumento.findMany({
            where: { fiscalEmitterId, status: { in: ['DISCOVERED', 'MANIFESTED'] } },
            orderBy: { createdAt: 'asc' },
            take: MAX_DOCS_PER_RUN,
        });
        for (const doc of pendentesSnapshot) currentDocId = doc.id;

        await runManifestacaoEDownloadPhases(deps, job, fiscalEmitterId, cpfCnpj, ambiente);
    } catch (err) {
        if (err instanceof DelayedError) throw err;

        if (err instanceof AcbrHttpError && err.httpStatus === 429) {
            await rescheduleJob(job, retryDelayFromHeaders(err));
            return;
        }
        if (err instanceof AcbrHttpError && err.httpStatus === 402) {
            if (currentDocId) {
                await handlePaymentRequired(deps, { id: currentDocId }, err);
            } else {
                await deps.distribuicaoNfeQueue.pause();
                await deps.createSystemAlert({
                    category: 'FISCAL_DISTRIBUICAO_NFE_QUOTA',
                    severity: 'CRITICAL',
                    title: 'Varredura de Distribuição NF-e pausada — créditos ACBr esgotados',
                    message: `Código: ${err.quotaErrorCode ?? 'desconhecido'}. ${err.message}`,
                    context: { fiscalEmitterId, httpStatus: 402, quotaErrorCode: err.quotaErrorCode },
                });
            }
            return;
        }

        throw err;
    }
}
