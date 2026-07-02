import type { Job } from 'bullmq';
import { DelayedError } from 'bullmq';
import prisma from '../../lib/prisma.js';
import { AcbrHttpError } from '../acbr/acbrHttp.js';
import {
    submitCteToAcbr,
    pollCteStatusOnce,
    downloadCteXml,
    downloadCtePdf,
} from '../acbr/acbrCteEmit.js';
import type { CteEmissionInput } from '../cteService.js';
import { buildCteEmissionInputForJob } from './cteEmissionJobInput.js';
import { uploadBase64Object } from '../../lib/objectStorage.js';
import { cteEmissionQueue, type CteEmissionJobData } from './cteEmissionQueue.js';
import { createSystemAlert } from '../systemAlertService.js';

const POLL_DELAY_MS = 1500;
const RATE_LIMIT_BACKOFF_CAP_MS = 5 * 60 * 1000;

function retryDelayFromHeaders(err: AcbrHttpError): number {
    const seconds = err.retryInSeconds ?? err.retryAfterSeconds ?? 2;
    return Math.min(Math.max(seconds, 1) * 1000, RATE_LIMIT_BACKOFF_CAP_MS);
}

/**
 * Reagenda o job para rodar de novo após `delayMs` e sinaliza ao worker da BullMQ que o
 * job já foi movido para o estado "delayed" — lançar `DelayedError` depois de
 * `job.moveToDelayed` é o contrato exigido pela BullMQ (ver `worker.js#handleFailed`):
 * sem isso, o worker tentaria `moveToCompleted` num job que já saiu do set "active",
 * corrompendo o lock/estado do job. Nunca troque isto por um `return` simples.
 */
async function rescheduleJob(job: Job<CteEmissionJobData>, delayMs: number): Promise<never> {
    await job.moveToDelayed(Date.now() + delayMs, job.token);
    throw new DelayedError();
}

async function markPendingReconciliation(calcId: string, emissionJobId: string, reason: string): Promise<void> {
    await prisma.$transaction([
        prisma.orderFreightCalculation.update({
            where: { id: calcId },
            data: { status: 'CTE_PENDING_RECONCILIATION', cteStatusReason: reason },
        }),
        prisma.cteEmissionJob.update({
            where: { id: emissionJobId },
            data: { phase: 'PENDING_RECONCILIATION', lastError: reason },
        }),
    ]);
}

async function handlePaymentRequired(calcId: string, emissionJobId: string, err: AcbrHttpError): Promise<void> {
    await cteEmissionQueue.pause();
    await prisma.cteEmissionJob.update({
        where: { id: emissionJobId },
        data: { pausedForQuota: true, lastHttpStatus: 402, lastError: err.message },
    });
    await markPendingReconciliation(
        calcId,
        emissionJobId,
        'Fila de emissão pausada: créditos ACBr insuficientes ou cota excedida. Aguardando ação de um administrador.',
    );
    await createSystemAlert({
        category: 'FISCAL_PROVIDER_QUOTA',
        severity: 'CRITICAL',
        title: 'Emissão de CT-e pausada — créditos ACBr esgotados',
        message: `Código: ${err.quotaErrorCode ?? 'desconhecido'}. ${err.message}`,
        context: { calcId, emissionJobId, httpStatus: 402, quotaErrorCode: err.quotaErrorCode },
    });
}

async function downloadAndPersistFiles(
    calcId: string,
    emissionJobId: string,
    providerDocId: string,
    ambiente: CteEmissionInput['ambiente'],
): Promise<void> {
    const job = await prisma.cteEmissionJob.findUniqueOrThrow({ where: { id: emissionJobId } });

    if (!job.xmlDownloadedAt) {
        const xml = await downloadCteXml(providerDocId, ambiente);
        const uploaded = await uploadBase64Object({
            base64: Buffer.from(xml, 'utf-8').toString('base64'),
            fileName: `${calcId}.xml`,
            mimeType: 'application/xml',
            keyPrefix: `cte/${calcId}/xml`,
        });
        await prisma.$transaction([
            prisma.orderFreightCalculation.update({
                where: { id: calcId },
                data: { cteXml: xml, cteXmlStorageKey: uploaded.storageKey },
            }),
            prisma.cteEmissionJob.update({ where: { id: emissionJobId }, data: { xmlDownloadedAt: new Date() } }),
        ]);
    }

    if (!job.pdfDownloadedAt) {
        const pdf = await downloadCtePdf(providerDocId, ambiente);
        const uploaded = await uploadBase64Object({
            base64: pdf.toString('base64'),
            fileName: `${calcId}.pdf`,
            mimeType: 'application/pdf',
            keyPrefix: `cte/${calcId}/pdf`,
        });
        await prisma.$transaction([
            prisma.orderFreightCalculation.update({ where: { id: calcId }, data: { ctePdfStorageKey: uploaded.storageKey } }),
            prisma.cteEmissionJob.update({ where: { id: emissionJobId }, data: { pdfDownloadedAt: new Date() } }),
        ]);
    }
}

export async function processCteEmissionJob(job: Job<CteEmissionJobData>): Promise<void> {
    const { calcId, cteEmissionJobId, phaseHint } = job.data;
    const emissionJob = await prisma.cteEmissionJob.findUniqueOrThrow({ where: { id: cteEmissionJobId } });
    const { input, fiscalEmitterContext } = await buildCteEmissionInputForJob(calcId);

    try {
        // Fase 1: submit — só acontece se ainda não temos providerDocId. Nunca reenvia depois disso
        // (POST /cte custa 1 crédito ACBr por chamada; reenviar duplicaria o documento fiscal).
        if (!emissionJob.providerDocId && phaseHint !== 'poll-only') {
            const submitted = await submitCteToAcbr(input, calcId, fiscalEmitterContext);
            if ('rejected' in submitted) {
                await prisma.$transaction([
                    prisma.orderFreightCalculation.update({
                        where: { id: calcId },
                        data: { status: 'CTE_REJECTED', cteStatusReason: submitted.rejected.rejectionReason ?? 'Rejeitado pela ACBr.' },
                    }),
                    prisma.cteEmissionJob.update({ where: { id: cteEmissionJobId }, data: { phase: 'FAILED', lastError: submitted.rejected.rejectionReason } }),
                ]);
                return;
            }
            await prisma.$transaction([
                prisma.cteEmissionJob.update({
                    where: { id: cteEmissionJobId },
                    data: { phase: 'SUBMITTED', providerDocId: submitted.providerDocId },
                }),
                prisma.orderFreightCalculation.update({ where: { id: calcId }, data: { status: 'CTE_PROCESSING' } }),
            ]);
            emissionJob.providerDocId = submitted.providerDocId;
        }

        if (!emissionJob.providerDocId) {
            throw new Error(`CteEmissionJob ${cteEmissionJobId} está em poll-only sem providerDocId — estado inconsistente.`);
        }

        // Fase 2: poll — uma tentativa por execução do job; reagenda via delay do BullMQ, nunca bloqueia
        // o worker com um sleep local (isso liberaria o processo pra outros jobs da fila).
        const outcome = await pollCteStatusOnce(emissionJob.providerDocId, input.ambiente, emissionJob.attemptCount);

        if (outcome.kind === 'AUTHORIZED') {
            await prisma.cteEmissionJob.update({ where: { id: cteEmissionJobId }, data: { phase: 'DOWNLOADING_FILES' } });
            await downloadAndPersistFiles(calcId, cteEmissionJobId, emissionJob.providerDocId, input.ambiente);
            await prisma.$transaction([
                prisma.orderFreightCalculation.update({
                    where: { id: calcId },
                    data: {
                        status: 'CTE_AUTHORIZED',
                        cteAccessKey: outcome.result.accessKey ?? null,
                        cteProtocol: outcome.result.protocol ?? null,
                        cteAuthorizedAt: new Date(),
                        cteStatusReason: null,
                    },
                }),
                prisma.cteEmissionJob.update({ where: { id: cteEmissionJobId }, data: { phase: 'DONE' } }),
            ]);
            return;
        }

        if (outcome.kind === 'REJECTED') {
            await prisma.$transaction([
                prisma.orderFreightCalculation.update({
                    where: { id: calcId },
                    data: { status: 'CTE_REJECTED', cteStatusReason: outcome.result.rejectionReason ?? 'Rejeitado pela SEFAZ.', cteRejectedAt: new Date() },
                }),
                prisma.cteEmissionJob.update({ where: { id: cteEmissionJobId }, data: { phase: 'FAILED', lastError: outcome.result.rejectionReason } }),
            ]);
            return;
        }

        // outcome.kind === 'PENDING' — reagenda mais uma tentativa. Timeout aqui NUNCA vira
        // CTE_REJECTED: o documento pode estar autorizado do lado da SEFAZ mesmo que nosso
        // polling tenha desistido; só reconciliação manual pode confirmar isso.
        const nextAttempt = emissionJob.attemptCount + 1;
        if (nextAttempt >= emissionJob.maxAttempts) {
            await markPendingReconciliation(calcId, cteEmissionJobId, 'Timeout aguardando retorno da SEFAZ via ACBr após o número máximo de tentativas.');
            return;
        }
        await prisma.cteEmissionJob.update({
            where: { id: cteEmissionJobId },
            data: { phase: 'POLLING', attemptCount: nextAttempt, lastPolledAt: new Date() },
        });
        await rescheduleJob(job, POLL_DELAY_MS);
    } catch (err) {
        if (err instanceof DelayedError) throw err;

        if (err instanceof AcbrHttpError && err.httpStatus === 429) {
            await prisma.cteEmissionJob.update({ where: { id: cteEmissionJobId }, data: { lastHttpStatus: 429, lastError: err.message } });
            await rescheduleJob(job, retryDelayFromHeaders(err));
            return;
        }
        if (err instanceof AcbrHttpError && err.httpStatus === 402) {
            await handlePaymentRequired(calcId, cteEmissionJobId, err);
            return;
        }
        // Timeout de rede ou qualquer outra instabilidade: NÃO é rejeição definitiva.
        const nextAttempt = emissionJob.attemptCount + 1;
        if (nextAttempt >= emissionJob.maxAttempts) {
            await markPendingReconciliation(calcId, cteEmissionJobId, `Falha de comunicação persistente com a ACBr: ${err instanceof Error ? err.message : String(err)}`);
            return;
        }
        await prisma.cteEmissionJob.update({
            where: { id: cteEmissionJobId },
            data: { attemptCount: nextAttempt, lastError: err instanceof Error ? err.message : String(err) },
        });
        await rescheduleJob(job, POLL_DELAY_MS);
        return;
    }
}
