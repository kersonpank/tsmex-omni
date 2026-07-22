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
import { getCteEmissionQueue, type CteEmissionJobData } from './cteEmissionQueue.js';
import { createSystemAlert, createOrMergeSystemAlert } from '../systemAlertService.js';
import { pendingReconciliationRecoveryHint } from './cteReconciliationMessages.js';

const POLL_DELAY_MS = 1500;
const RATE_LIMIT_BACKOFF_CAP_MS = 5 * 60 * 1000;

/**
 * Rastro mínimo de observabilidade: sem isso, os logs do container não distinguem "job nunca
 * foi retirado da fila" (ex.: fila pausada silenciosamente) de "job foi pego e travou em algum
 * ponto do processamento" — a única forma de saber era consultar Postgres/Redis diretamente.
 */
function logProcessorEvent(event: string, details: Record<string, unknown>): void {
    console.log(JSON.stringify({ level: 'info', source: 'cteEmissionProcessor', event, ...details }));
}

type CteEmissionJobRecord = Awaited<ReturnType<typeof prisma.cteEmissionJob.findUniqueOrThrow>>;

/**
 * Dependências injetáveis do processor. Por padrão (`defaultCteEmissionProcessorDeps`)
 * apontam para as implementações reais (ACBr HTTP real, prisma real, fila BullMQ real).
 *
 * Existem para permitir testar `processCteEmissionJob` (o state machine de submit/poll/
 * 429/402/timeout/reconciliação — a peça de maior risco de todo o pipeline) sem falar com
 * Postgres/Redis/ACBr de verdade. Bindings de função exportados por módulos ES não podem
 * ser reatribuídos de fora do módulo que os exporta, então a injeção por parâmetro é o jeito
 * limpo de trocar por duplos de teste em vez de mockar objetos internos do runtime ESM.
 */
export interface CteEmissionProcessorDeps {
    prisma: {
        cteEmissionJob: Pick<typeof prisma.cteEmissionJob, 'findUniqueOrThrow' | 'update'>;
        orderFreightCalculation: Pick<typeof prisma.orderFreightCalculation, 'update'>;
        $transaction: (ops: Array<Promise<unknown>>) => Promise<unknown[]>;
    };
    submitCteToAcbr: typeof submitCteToAcbr;
    pollCteStatusOnce: typeof pollCteStatusOnce;
    downloadCteXml: typeof downloadCteXml;
    downloadCtePdf: typeof downloadCtePdf;
    buildCteEmissionInputForJob: typeof buildCteEmissionInputForJob;
    uploadBase64Object: typeof uploadBase64Object;
    cteEmissionQueue: Pick<ReturnType<typeof getCteEmissionQueue>, 'pause'>;
    createSystemAlert: typeof createSystemAlert;
    createOrMergeSystemAlert: typeof createOrMergeSystemAlert;
}

export const defaultCteEmissionProcessorDeps: CteEmissionProcessorDeps = {
    prisma: {
        cteEmissionJob: prisma.cteEmissionJob,
        orderFreightCalculation: prisma.orderFreightCalculation,
        $transaction: prisma.$transaction.bind(prisma) as CteEmissionProcessorDeps['prisma']['$transaction'],
    },
    submitCteToAcbr,
    pollCteStatusOnce,
    downloadCteXml,
    downloadCtePdf,
    buildCteEmissionInputForJob,
    uploadBase64Object,
    // getter: só constrói a Queue/conexão Redis reais quando algo de fato acessa
    // `deps.cteEmissionQueue` (ex.: pausa por cota) — nunca na importação deste módulo.
    get cteEmissionQueue() {
        return getCteEmissionQueue();
    },
    createSystemAlert,
    createOrMergeSystemAlert,
};

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

async function markPendingReconciliation(
    deps: CteEmissionProcessorDeps,
    calcId: string,
    emissionJobId: string,
    reason: string,
    providerDocId: string | null = null,
): Promise<void> {
    const fullReason = `${reason}${pendingReconciliationRecoveryHint(providerDocId)}`;
    await deps.prisma.$transaction([
        deps.prisma.orderFreightCalculation.update({
            where: { id: calcId },
            data: { status: 'CTE_PENDING_RECONCILIATION', cteStatusReason: fullReason },
        }),
        deps.prisma.cteEmissionJob.update({
            where: { id: emissionJobId },
            // lastError fica cru, sem o hint de recuperação — é log técnico, não texto pra UI.
            data: { phase: 'PENDING_RECONCILIATION', lastError: reason },
        }),
    ]);
}

async function handlePaymentRequired(
    deps: CteEmissionProcessorDeps,
    calcId: string,
    emissionJobId: string,
    err: AcbrHttpError,
    providerDocId: string | null,
): Promise<void> {
    await deps.cteEmissionQueue.pause();
    await deps.prisma.cteEmissionJob.update({
        where: { id: emissionJobId },
        data: { pausedForQuota: true, lastHttpStatus: 402, lastError: err.message },
    });
    await markPendingReconciliation(
        deps,
        calcId,
        emissionJobId,
        'Fila de emissão pausada: créditos ACBr insuficientes ou cota excedida. Aguardando ação de um administrador.',
        providerDocId,
    );
    await deps.createSystemAlert({
        category: 'FISCAL_PROVIDER_QUOTA',
        severity: 'CRITICAL',
        title: 'Emissão de CT-e pausada — créditos ACBr esgotados',
        message: `Código: ${err.quotaErrorCode ?? 'desconhecido'}. ${err.message}`,
        context: { calcId, emissionJobId, httpStatus: 402, quotaErrorCode: err.quotaErrorCode },
    });
}

async function downloadAndPersistFiles(
    deps: CteEmissionProcessorDeps,
    calcId: string,
    emissionJobId: string,
    providerDocId: string,
    ambiente: CteEmissionInput['ambiente'],
): Promise<void> {
    const job = await deps.prisma.cteEmissionJob.findUniqueOrThrow({ where: { id: emissionJobId } });

    if (!job.xmlDownloadedAt) {
        const xml = await deps.downloadCteXml(providerDocId, ambiente);
        const uploaded = await deps.uploadBase64Object({
            base64: Buffer.from(xml, 'utf-8').toString('base64'),
            fileName: `${calcId}.xml`,
            mimeType: 'application/xml',
            keyPrefix: `cte/${calcId}/xml`,
        });
        await deps.prisma.$transaction([
            deps.prisma.orderFreightCalculation.update({
                where: { id: calcId },
                data: { cteXml: xml, cteXmlStorageKey: uploaded.storageKey },
            }),
            deps.prisma.cteEmissionJob.update({ where: { id: emissionJobId }, data: { xmlDownloadedAt: new Date() } }),
        ]);
    }

    if (!job.pdfDownloadedAt) {
        const pdf = await deps.downloadCtePdf(providerDocId, ambiente);
        const uploaded = await deps.uploadBase64Object({
            base64: pdf.toString('base64'),
            fileName: `${calcId}.pdf`,
            mimeType: 'application/pdf',
            keyPrefix: `cte/${calcId}/pdf`,
        });
        await deps.prisma.$transaction([
            deps.prisma.orderFreightCalculation.update({ where: { id: calcId }, data: { ctePdfStorageKey: uploaded.storageKey } }),
            deps.prisma.cteEmissionJob.update({ where: { id: emissionJobId }, data: { pdfDownloadedAt: new Date() } }),
        ]);
    }
}

export async function processCteEmissionJob(
    job: Job<CteEmissionJobData>,
    deps: CteEmissionProcessorDeps = defaultCteEmissionProcessorDeps,
): Promise<void> {
    const { calcId, cteEmissionJobId, phaseHint } = job.data;
    // `emissionJob` e as chamadas que o carregam ficam DENTRO do try: se
    // `findUniqueOrThrow`/`buildCteEmissionInputForJob` lançarem (preflight fiscal falhou no
    // momento do processamento, blip transitório de DB, etc.), o erro precisa passar pela
    // mesma classificação (429/402/genérico) que qualquer outra falha do job — senão a fila
    // (sem `attempts` configurado) mata o job na primeira exceção sem nunca atualizar
    // `CteEmissionJob.lastError`/`phase` nem `OrderFreightCalculation.status`, e a emissão
    // trava silenciosamente sem nenhum sinal pro operador.
    let emissionJob: CteEmissionJobRecord | null = null;

    logProcessorEvent('job-picked-up', { calcId, cteEmissionJobId, phaseHint: phaseHint ?? null });

    try {
        emissionJob = await deps.prisma.cteEmissionJob.findUniqueOrThrow({ where: { id: cteEmissionJobId } });
        const { input, fiscalEmitterContext } = await deps.buildCteEmissionInputForJob(calcId);

        // Fase 1: submit — só acontece se ainda não temos providerDocId. Nunca reenvia depois disso
        // (POST /cte custa 1 crédito ACBr por chamada; reenviar duplicaria o documento fiscal).
        if (!emissionJob.providerDocId && phaseHint !== 'poll-only') {
            // `job.data` sobrevive no Redis independente do estado do Postgres. Se uma
            // tentativa anterior JÁ recebeu sucesso da ACBr mas não conseguiu persistir
            // `providerDocId` no Postgres (ex.: connection reset bem entre as duas etapas),
            // `providerDocIdPending` guarda esse valor — e esta tentativa NUNCA rechama
            // `submitCteToAcbr` quando ele está presente, só completa a persistência que
            // faltou. Sem isso, `attempts`/retry automático da fila poderia causar uma
            // segunda cobrança de crédito + rejeição por duplicidade na SEFAZ.
            let providerDocId = job.data.providerDocIdPending;

            if (!providerDocId) {
                const submitted = await deps.submitCteToAcbr(input, calcId, fiscalEmitterContext);
                if ('rejected' in submitted) {
                    await deps.prisma.$transaction([
                        deps.prisma.orderFreightCalculation.update({
                            where: { id: calcId },
                            data: { status: 'CTE_REJECTED', cteStatusReason: submitted.rejected.rejectionReason ?? 'Rejeitado pela ACBr.' },
                        }),
                        deps.prisma.cteEmissionJob.update({ where: { id: cteEmissionJobId }, data: { phase: 'FAILED', lastError: submitted.rejected.rejectionReason } }),
                    ]);
                    return;
                }
                providerDocId = submitted.providerDocId;
                // Grava no Redis ANTES de qualquer escrita no Postgres — fecha a janela de
                // duplicidade descrita acima.
                await job.updateData({ ...job.data, providerDocIdPending: providerDocId });
            }

            await deps.prisma.$transaction([
                deps.prisma.cteEmissionJob.update({
                    where: { id: cteEmissionJobId },
                    data: { phase: 'SUBMITTED', providerDocId },
                }),
                deps.prisma.orderFreightCalculation.update({ where: { id: calcId }, data: { status: 'CTE_PROCESSING' } }),
            ]);
            emissionJob.providerDocId = providerDocId;
            logProcessorEvent('submit-accepted', { calcId, cteEmissionJobId, providerDocId });
        }

        if (!emissionJob.providerDocId) {
            throw new Error(`CteEmissionJob ${cteEmissionJobId} está em poll-only sem providerDocId — estado inconsistente.`);
        }

        // Fase 2: poll — uma tentativa por execução do job; reagenda via delay do BullMQ, nunca bloqueia
        // o worker com um sleep local (isso liberaria o processo pra outros jobs da fila).
        const outcome = await deps.pollCteStatusOnce(emissionJob.providerDocId, input.ambiente, emissionJob.attemptCount);
        logProcessorEvent('poll-outcome', { calcId, cteEmissionJobId, kind: outcome.kind, attemptCount: emissionJob.attemptCount });

        if (outcome.kind === 'AUTHORIZED') {
            await deps.prisma.cteEmissionJob.update({ where: { id: cteEmissionJobId }, data: { phase: 'DOWNLOADING_FILES' } });
            await downloadAndPersistFiles(deps, calcId, cteEmissionJobId, emissionJob.providerDocId, input.ambiente);
            await deps.prisma.$transaction([
                deps.prisma.orderFreightCalculation.update({
                    where: { id: calcId },
                    data: {
                        status: 'CTE_AUTHORIZED',
                        cteAccessKey: outcome.result.accessKey ?? null,
                        cteProtocol: outcome.result.protocol ?? null,
                        cteAuthorizedAt: new Date(),
                        cteStatusReason: null,
                    },
                }),
                deps.prisma.cteEmissionJob.update({ where: { id: cteEmissionJobId }, data: { phase: 'DONE' } }),
            ]);
            logProcessorEvent('done', { calcId, cteEmissionJobId });
            return;
        }

        if (outcome.kind === 'REJECTED') {
            await deps.prisma.$transaction([
                deps.prisma.orderFreightCalculation.update({
                    where: { id: calcId },
                    data: { status: 'CTE_REJECTED', cteStatusReason: outcome.result.rejectionReason ?? 'Rejeitado pela SEFAZ.', cteRejectedAt: new Date() },
                }),
                deps.prisma.cteEmissionJob.update({ where: { id: cteEmissionJobId }, data: { phase: 'FAILED', lastError: outcome.result.rejectionReason } }),
            ]);
            return;
        }

        // outcome.kind === 'PENDING' — reagenda mais uma tentativa. Timeout aqui NUNCA vira
        // CTE_REJECTED: o documento pode estar autorizado do lado da SEFAZ mesmo que nosso
        // polling tenha desistido; só reconciliação manual pode confirmar isso.
        const nextAttempt = emissionJob.attemptCount + 1;
        if (nextAttempt >= emissionJob.maxAttempts) {
            await markPendingReconciliation(deps, calcId, cteEmissionJobId, 'Timeout aguardando retorno da SEFAZ via ACBr após o número máximo de tentativas.', emissionJob.providerDocId);
            return;
        }
        await deps.prisma.cteEmissionJob.update({
            where: { id: cteEmissionJobId },
            data: { phase: 'POLLING', attemptCount: nextAttempt, lastPolledAt: new Date() },
        });
        await rescheduleJob(job, POLL_DELAY_MS);
    } catch (err) {
        if (err instanceof DelayedError) throw err;
        console.error(
            JSON.stringify({
                level: 'error',
                source: 'processCteEmissionJob',
                calcId,
                cteEmissionJobId,
                attempt: (emissionJob?.attemptCount ?? 0) + 1,
                error: err instanceof Error ? err.message : String(err),
            }),
        );

        if (err instanceof AcbrHttpError && err.httpStatus === 429) {
            if (emissionJob) {
                await deps.prisma.cteEmissionJob.update({ where: { id: cteEmissionJobId }, data: { lastHttpStatus: 429, lastError: err.message } });
            }
            await rescheduleJob(job, retryDelayFromHeaders(err));
            return;
        }
        if (err instanceof AcbrHttpError && err.httpStatus === 402) {
            await handlePaymentRequired(deps, calcId, cteEmissionJobId, err, emissionJob?.providerDocId ?? null);
            return;
        }

        // `emissionJob` pode ser `null` aqui se o próprio `findUniqueOrThrow` inicial falhou
        // (blip transitório de DB, job apagado, etc.) — sem um registro carregado não temos
        // `attemptCount`/`maxAttempts` pra decidir reagendar, então tratamos como
        // reconciliação imediata em vez de arriscar acessar propriedades de `null`.
        if (!emissionJob) {
            await markPendingReconciliation(
                deps,
                calcId,
                cteEmissionJobId,
                `Falha ao carregar dados do job antes do processamento: ${err instanceof Error ? err.message : String(err)}`,
            );
            return;
        }

        // Timeout de rede ou qualquer outra instabilidade (incluindo falha do preflight
        // fiscal em `buildCteEmissionInputForJob`): NÃO é rejeição definitiva.
        const nextAttempt = emissionJob.attemptCount + 1;
        if (nextAttempt >= emissionJob.maxAttempts) {
            await markPendingReconciliation(deps, calcId, cteEmissionJobId, `Falha de comunicação persistente com a ACBr: ${err instanceof Error ? err.message : String(err)}`, emissionJob.providerDocId);
            return;
        }
        await deps.prisma.cteEmissionJob.update({
            where: { id: cteEmissionJobId },
            data: { attemptCount: nextAttempt, lastError: err instanceof Error ? err.message : String(err) },
        });
        await rescheduleJob(job, POLL_DELAY_MS);
        return;
    }
}

/**
<<<<<<< Updated upstream
 * Chamada pelo worker (`worker.ts`) só na tentativa FINAL do BullMQ (todos os `attempts`
 * esgotados) — nunca marcar reconciliação/alerta numa tentativa intermediária que ainda vai
 * ser retentada automaticamente.
=======
 * Chamado pelo `worker.ts` no `.on('failed', ...)` do worker `cte-emission`, e SÓ quando o
 * BullMQ esgotou de vez todas as `attempts` configuradas (não vai retentar mais este job) —
 * nunca em falhas intermediárias que ainda serão retentadas automaticamente (ver o cálculo de
 * "última tentativa" em `worker.ts`, verificado contra o código-fonte do BullMQ).
 *
 * Fecha o buraco final do pipeline: sem isso, um job que morre de vez por uma exceção não
 * classificada (ex.: o próprio catch-all falhando ao escrever no Postgres) deixaria o calc
 * preso em `CTE_SENT`/`CTE_PROCESSING` pra sempre — sem sequer poder ser reconciliado
 * manualmente, já que `/emit-cte/reconcile` exige `CTE_PENDING_RECONCILIATION`.
>>>>>>> Stashed changes
 */
export async function handleCteJobExhausted(
    jobData: CteEmissionJobData,
    err: Error,
    deps: CteEmissionProcessorDeps = defaultCteEmissionProcessorDeps,
): Promise<void> {
    const { calcId, cteEmissionJobId } = jobData;

    const emissionJob = await deps.prisma.cteEmissionJob
        .findUniqueOrThrow({ where: { id: cteEmissionJobId } })
        .catch(() => null);

    // Se o job já chegou num estado terminal por outro caminho (ex.: uma tentativa anterior
    // na verdade concluiu com sucesso antes deste evento 'failed' de uma tentativa mais velha
    // ser processado fora de ordem), não sobrescrever — evita regressão de estado.
    if (emissionJob && ['DONE', 'FAILED', 'PENDING_RECONCILIATION'].includes(emissionJob.phase)) {
        return;
    }
    await markPendingReconciliation(
        deps,
        calcId,
        cteEmissionJobId,
        `Job esgotou todas as tentativas automáticas da fila: ${err.message}`,
        emissionJob?.providerDocId ?? null,
    );

    await deps.createOrMergeSystemAlert({
        category: 'FISCAL_PROVIDER_ERROR',
        severity: 'WARNING',
        title: 'Emissão de CT-e travada — tentativas automáticas esgotadas',
        message: `Cálculo ${calcId} não concluiu a emissão assíncrona após todas as tentativas automáticas. Reconciliação manual necessária.`,
        context: { calcId, cteEmissionJobId, providerDocId: emissionJob?.providerDocId ?? null, lastError: err.message },
    });
}
