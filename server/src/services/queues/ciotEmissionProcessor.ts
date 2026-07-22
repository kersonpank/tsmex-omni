import type { Job } from 'bullmq';
import { DelayedError } from 'bullmq';
import prisma from '../../lib/prisma.js';
import { EfreteApiError } from '../efrete/efreteHttp.js';
import { ensureMotoristaRegistrado, ensureProprietarioRegistrado, ensureVeiculoRegistrado } from '../efrete/efreteCadastro.js';
import { submitCiotToEfrete, consultarStatusCiot } from '../efrete/efreteCiotEmit.js';
import { buildCiotPayload } from '../efrete/efreteCiotMapper.js';
import { buildCiotEmissionInputForJob } from './ciotEmissionJobInput.js';
import type { CiotEmissionJobData } from './ciotEmissionQueue.js';

const RETRY_DELAY_MS = 5_000;

type CiotEmissionJobRecord = Awaited<ReturnType<typeof prisma.ciotEmissionJob.findUniqueOrThrow>>;

/**
 * Dependências injetáveis — mesmo racional de `cteEmissionProcessor.ts`: permite testar o
 * state machine (cadastros/idempotência/submit/erro) sem falar com Postgres/Redis/eFrete de
 * verdade.
 */
export interface CiotEmissionProcessorDeps {
    prisma: {
        ciotEmissionJob: Pick<typeof prisma.ciotEmissionJob, 'findUniqueOrThrow' | 'update'>;
        manifest: Pick<typeof prisma.manifest, 'findUniqueOrThrow'>;
        manifestFiscalDocument: Pick<typeof prisma.manifestFiscalDocument, 'create'>;
    };
    ensureMotoristaRegistrado: typeof ensureMotoristaRegistrado;
    ensureProprietarioRegistrado: typeof ensureProprietarioRegistrado;
    ensureVeiculoRegistrado: typeof ensureVeiculoRegistrado;
    consultarStatusCiot: typeof consultarStatusCiot;
    submitCiotToEfrete: typeof submitCiotToEfrete;
    buildCiotEmissionInputForJob: typeof buildCiotEmissionInputForJob;
}

export const defaultCiotEmissionProcessorDeps: CiotEmissionProcessorDeps = {
    prisma: {
        ciotEmissionJob: prisma.ciotEmissionJob,
        manifest: prisma.manifest,
        manifestFiscalDocument: prisma.manifestFiscalDocument,
    },
    ensureMotoristaRegistrado,
    ensureProprietarioRegistrado,
    ensureVeiculoRegistrado,
    consultarStatusCiot,
    submitCiotToEfrete,
    buildCiotEmissionInputForJob,
};

async function rescheduleJob(job: Job<CiotEmissionJobData>, delayMs: number): Promise<never> {
    await job.moveToDelayed(Date.now() + delayMs, job.token);
    throw new DelayedError();
}

async function markFailed(
    deps: CiotEmissionProcessorDeps,
    ciotEmissionJobId: string,
    manifestId: string,
    fiscalEmitterId: string | null,
    reason: string,
    rawPayload?: unknown,
    rawResponse?: unknown,
): Promise<void> {
    await deps.prisma.ciotEmissionJob.update({ where: { id: ciotEmissionJobId }, data: { phase: 'FAILED', lastError: reason } });
    await deps.prisma.manifestFiscalDocument.create({
        data: {
            manifestId,
            fiscalEmitterId,
            documentType: 'CIOT',
            status: 'REJECTED',
            statusReason: reason,
            rawPayload: rawPayload as object | undefined,
            rawResponse: rawResponse as object | undefined,
            rejectedAt: new Date(),
        },
    });
}

async function markPendingReconciliation(deps: CiotEmissionProcessorDeps, ciotEmissionJobId: string, reason: string): Promise<void> {
    await deps.prisma.ciotEmissionJob.update({
        where: { id: ciotEmissionJobId },
        data: { phase: 'PENDING_RECONCILIATION', lastError: reason },
    });
}

export async function processCiotEmissionJob(
    job: Job<CiotEmissionJobData>,
    deps: CiotEmissionProcessorDeps = defaultCiotEmissionProcessorDeps,
): Promise<void> {
    const { ciotEmissionJobId } = job.data;
    let ciotJob: CiotEmissionJobRecord | null = null;

    try {
        ciotJob = await deps.prisma.ciotEmissionJob.findUniqueOrThrow({ where: { id: ciotEmissionJobId } });
        if (ciotJob.phase === 'DONE') return;

        const manifest = await deps.prisma.manifest.findUniqueOrThrow({
            where: { id: ciotJob.manifestId },
            include: { link: { include: { person: true } }, driver: { include: { person: true } } },
        });
        if (!manifest.link) throw new Error(`Manifesto ${ciotJob.manifestId} sem Link atribuído — estado inconsistente.`);
        if (!manifest.driver) throw new Error(`Manifesto ${ciotJob.manifestId} sem Driver atribuído — estado inconsistente.`);

        // Fase 1: cadastros (idempotentes na própria eFrete — sempre antes de emitir operação).
        if (ciotJob.phase === 'QUEUED') {
            await deps.ensureMotoristaRegistrado(manifest.driver);
            await deps.ensureProprietarioRegistrado(manifest.link);
            await deps.ensureVeiculoRegistrado(manifest.link);
            await deps.prisma.ciotEmissionJob.update({ where: { id: ciotEmissionJobId }, data: { phase: 'CADASTROS_ENSURING' } });
        }

        // Fase 2: idempotência — NUNCA reenviar sem checar primeiro se já existe CIOT pra este
        // idOperacaoCliente (timeout anterior pode ter sido aceito do lado da eFrete mesmo sem
        // resposta chegar aqui; reenviar direto duplicaria o CIOT e gera multa ANTT).
        const existing = await deps.consultarStatusCiot(ciotJob.idOperacaoCliente);
        let codigoIdentificacaoOperacao = existing.codigoIdentificacaoOperacao;
        let protocoloServico = existing.protocoloServico;
        let rawResponse: unknown = existing.exists ? existing : undefined;
        let rawPayload: unknown;

        if (!existing.exists) {
            const { mapperInput } = await deps.buildCiotEmissionInputForJob(ciotEmissionJobId);
            const payload = buildCiotPayload(mapperInput);
            rawPayload = payload;
            const submitted = await deps.submitCiotToEfrete(payload);
            codigoIdentificacaoOperacao = submitted.codigoIdentificacaoOperacao;
            protocoloServico = submitted.protocoloServico;
            rawResponse = submitted.raw;
        }

        if (!codigoIdentificacaoOperacao) {
            throw new Error('eFrete não retornou CodigoIdentificacaoOperacao nem na consulta de idempotência nem na emissão.');
        }

        await deps.prisma.ciotEmissionJob.update({
            where: { id: ciotEmissionJobId },
            data: { phase: 'DONE', codigoIdentificacaoOperacao, attemptCount: 0 },
        });
        await deps.prisma.manifestFiscalDocument.create({
            data: {
                manifestId: ciotJob.manifestId,
                documentType: 'CIOT',
                status: 'AUTHORIZED',
                number: codigoIdentificacaoOperacao,
                protocol: protocoloServico,
                rawPayload: rawPayload as object | undefined,
                rawResponse: rawResponse as object | undefined,
                authorizedAt: new Date(),
            },
        });
    } catch (err) {
        if (err instanceof DelayedError) throw err;

        if (!ciotJob) {
            // findUniqueOrThrow inicial falhou — sem attemptCount/maxAttempts pra decidir reagendar.
            throw err;
        }

        // Rejeição de negócio da própria eFrete (`Sucesso: false` com Excecao preenchida — ex.:
        // piso mínimo do Lotação) é definitiva, não transitória: reenviar não muda o resultado.
        if (err instanceof EfreteApiError && err.excecaoMensagem) {
            await markFailed(
                deps,
                ciotEmissionJobId,
                ciotJob.manifestId,
                null,
                err.excecaoMensagem,
                undefined,
                { excecaoCodigo: err.excecaoCodigo, excecaoMensagem: err.excecaoMensagem },
            );
            return;
        }

        // Timeout de rede ou instabilidade transitória: reagenda até maxAttempts, depois
        // reconciliação manual — nunca marca REJECTED por timeout (pode ter sido aceito do
        // outro lado; só reconciliação humana confirma).
        const nextAttempt = ciotJob.attemptCount + 1;
        if (nextAttempt >= ciotJob.maxAttempts) {
            await markPendingReconciliation(deps, ciotEmissionJobId, `Falha de comunicação persistente com a eFrete: ${err instanceof Error ? err.message : String(err)}`);
            return;
        }
        await deps.prisma.ciotEmissionJob.update({
            where: { id: ciotEmissionJobId },
            data: { attemptCount: nextAttempt, lastError: err instanceof Error ? err.message : String(err) },
        });
        await rescheduleJob(job, RETRY_DELAY_MS);
    }
}

/**
 * Chamado pelo `worker.ts` no `.on('failed', ...)` do worker `ciot-emission`, só quando o
 * BullMQ esgotou todas as `attempts` (não vai retentar mais) — fecha o buraco final do
 * pipeline: sem isso, um job morto por exceção não classificada travaria o manifesto sem
 * nenhum caminho de reconciliação manual (mesmo racional de `handleCteJobExhausted`).
 */
export async function handleCiotJobExhausted(
    jobData: CiotEmissionJobData,
    err: Error,
    deps: CiotEmissionProcessorDeps = defaultCiotEmissionProcessorDeps,
): Promise<void> {
    const { ciotEmissionJobId } = jobData;
    const job = await deps.prisma.ciotEmissionJob.findUniqueOrThrow({ where: { id: ciotEmissionJobId } }).catch(() => null);
    if (job && ['DONE', 'FAILED', 'PENDING_RECONCILIATION'].includes(job.phase)) return;
    await markPendingReconciliation(deps, ciotEmissionJobId, `Job esgotou todas as tentativas automáticas da fila: ${err.message}`);
}
