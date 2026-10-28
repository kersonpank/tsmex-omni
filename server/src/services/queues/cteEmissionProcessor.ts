import type { Job } from 'bullmq';
import { DelayedError } from 'bullmq';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { FreightCalcStatus, Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { AcbrHttpError } from '../acbr/acbrHttp.js';
import { submitCteToAcbr, pollCteStatusOnce, downloadCteXml, downloadCtePdf } from '../acbr/acbrCteEmit.js';
import type { CteEmissionInput, CteProviderResult } from '../cteService.js';
import { buildCteEmissionInputForJob } from './cteEmissionJobInput.js';
import { uploadBase64Object } from '../../lib/objectStorage.js';
import { getCteEmissionQueue, type CteEmissionJobData } from './cteEmissionQueue.js';
import { createSystemAlert, createOrMergeSystemAlert } from '../systemAlertService.js';
import { pendingReconciliationRecoveryHint } from './cteReconciliationMessages.js';

const POLL_DELAY_MS = 1500;
const RATE_LIMIT_BACKOFF_CAP_MS = 5 * 60 * 1000;
const ACTIVE_CALC_STATUSES = ['CTE_SENT', 'CTE_PROCESSING', 'CTE_PENDING_RECONCILIATION'] as const;
const SUBMITTED_CALC_STATUSES = ['CTE_PROCESSING', 'CTE_PENDING_RECONCILIATION'] as const;

type CteEmissionJobRecord = Awaited<ReturnType<typeof prisma.cteEmissionJob.findUniqueOrThrow>>;
type CteTransaction = {
    cteEmissionJob: Pick<typeof prisma.cteEmissionJob, 'updateMany'>;
    orderFreightCalculation: Pick<typeof prisma.orderFreightCalculation, 'updateMany'>;
};

export interface CteEmissionProcessorDeps {
    prisma: CteTransaction & {
        cteEmissionJob: CteTransaction['cteEmissionJob'] & Pick<typeof prisma.cteEmissionJob, 'findUniqueOrThrow'>;
        orderFreightCalculation: CteTransaction['orderFreightCalculation'] & Pick<typeof prisma.orderFreightCalculation, 'findUniqueOrThrow'>;
        $transaction: <T>(fn: (tx: CteTransaction) => Promise<T>) => Promise<T>;
    };
    submitCteToAcbr: typeof submitCteToAcbr;
    pollCteStatusOnce: typeof pollCteStatusOnce;
    downloadCteXml: typeof downloadCteXml;
    downloadCtePdf: typeof downloadCtePdf;
    buildCteEmissionInputForJob: (calcId: string, cteEmissionJobId: string) => ReturnType<typeof buildCteEmissionInputForJob>;
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
    get cteEmissionQueue() { return getCteEmissionQueue(); },
    createSystemAlert,
    createOrMergeSystemAlert,
};

async function readJob(deps: CteEmissionProcessorDeps, id: string): Promise<CteEmissionJobRecord> {
    return deps.prisma.cteEmissionJob.findUniqueOrThrow({ where: { id } });
}

class StaleTransition extends Error {}

/** Compara a versão lida, inclusive o marcador, antes de alterar job e cálculo numa transação. */
async function transition(
    deps: CteEmissionProcessorDeps,
    record: CteEmissionJobRecord,
    jobData: Prisma.CteEmissionJobUpdateManyMutationInput,
    calcData?: Prisma.OrderFreightCalculationUpdateManyMutationInput,
    options: { calcStatuses?: readonly FreightCalcStatus[]; queueJobId?: string; requireCalc?: boolean } = {},
): Promise<boolean> {
    try {
        return await deps.prisma.$transaction(async (tx) => {
            const where = {
                id: record.id,
                calcId: record.calcId,
                phase: record.phase,
                providerDocId: record.providerDocId,
                submissionGuardVersion: record.submissionGuardVersion,
                submitStartedAt: record.submitStartedAt,
                ...((options.queueJobId ?? record.queueJobId) ? { queueJobId: options.queueJobId ?? record.queueJobId } : {}),
            } satisfies Prisma.CteEmissionJobWhereInput;
            const changed = await tx.cteEmissionJob.updateMany({ where, data: jobData });
            if (changed.count !== 1) return false;
            if (calcData) {
                const calc = await tx.orderFreightCalculation.updateMany({
                    where: { id: record.calcId, status: { in: [...(options.calcStatuses ?? ACTIVE_CALC_STATUSES)] } },
                    data: calcData,
                });
                if (calc.count !== 1 && options.requireCalc !== false) throw new StaleTransition();
            }
            return true;
        });
    } catch (err) {
        if (err instanceof StaleTransition) return false;
        throw err;
    }
}

async function markPendingReconciliation(
    deps: CteEmissionProcessorDeps,
    record: CteEmissionJobRecord,
    reason: string,
    extra: Prisma.CteEmissionJobUpdateManyMutationInput = {},
    queueJobId?: string,
): Promise<boolean> {
    if (['DONE', 'FAILED', 'PENDING_RECONCILIATION'].includes(record.phase)) return false;
    return transition(deps, record,
        { ...extra, phase: 'PENDING_RECONCILIATION', lastError: reason },
        { status: 'CTE_PENDING_RECONCILIATION', cteStatusReason: `${reason}${pendingReconciliationRecoveryHint(record.providerDocId)}` },
        { queueJobId, calcStatuses: record.submitStartedAt || record.providerDocId ? SUBMITTED_CALC_STATUSES : ACTIVE_CALC_STATUSES },
    );
}

async function rescheduleJob(job: Job<CteEmissionJobData>, delayMs: number): Promise<never> {
    await job.moveToDelayed(Date.now() + delayMs, job.token);
    throw new DelayedError();
}

function rejectionText(result: CteProviderResult): string {
    const reason = result.rejectionReason ?? 'Rejeitado pela SEFAZ.';
    return result.rejectionCode ? `Código ${result.rejectionCode}: ${reason}` : reason;
}

/** Só a resposta de rejeição efetiva ou o pré-cadastro que falhou antes do POST é definitiva. */
async function markRejected(deps: CteEmissionProcessorDeps, record: CteEmissionJobRecord, result: CteProviderResult): Promise<void> {
    const reason = rejectionText(result);
    await transition(deps, record,
        { phase: 'FAILED', lastError: reason, rejectionCode: result.rejectionCode ?? null, rejectionReason: result.rejectionReason ?? null },
        { status: 'CTE_REJECTED', cteStatusReason: reason, cteRejectedAt: new Date() },
        { calcStatuses: record.submitStartedAt || record.providerDocId ? SUBMITTED_CALC_STATUSES : ACTIVE_CALC_STATUSES },
    );
}

function fiscalDate(value: unknown): Date | null {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Confirma o protocolo do mesmo CT-e e obtém a data do XML ou do retorno de autorização. */
function cteAuthorizationDate(xml: string, key: string, protocol: string, responseDate: Date | null = null): Date | null {
    try {
        if (XMLValidator.validate(xml) !== true) return null;
        const parsed = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false }).parse(xml) as Record<string, unknown>;
        const root = (parsed.cteProc ?? parsed.procCTe) as Record<string, unknown> | undefined;
        const cte = root?.CTe as Record<string, unknown> | undefined;
        const infCte = cte?.infCte as Record<string, unknown> | undefined;
        const prot = root?.protCTe as Record<string, unknown> | undefined;
        const inf = prot?.infProt as Record<string, unknown> | undefined;
        const matches = String(infCte?.['@_Id'] ?? '') === `CTe${key}`
            && String(inf?.cStat ?? '') === '100'
            && String(inf?.chCTe ?? '') === key
            && String(inf?.nProt ?? '') === protocol;
        const xmlDate = inf?.dhRecbto;
        const receivedAt = xmlDate == null || xmlDate === '' ? responseDate : fiscalDate(xmlDate);
        return matches ? receivedAt : null;
    } catch {
        return null;
    }
}

export function xmlConfirmsCteAuthorization(xml: string, key: string, protocol: string): boolean {
    return cteAuthorizationDate(xml, key, protocol) !== null;
}

async function downloadAndPersistFiles(
    deps: CteEmissionProcessorDeps,
    record: CteEmissionJobRecord,
    ambiente: CteEmissionInput['ambiente'],
    key: string,
    protocol: string,
    responseDate: Date | null,
): Promise<Date | null> {
    const id = record.providerDocId!;
    let xml: string;
    if (!record.xmlDownloadedAt) {
        xml = await deps.downloadCteXml(id, ambiente);
        if (!cteAuthorizationDate(xml, key, protocol, responseDate)) return null;
        const uploaded = await deps.uploadBase64Object({
            base64: Buffer.from(xml, 'utf8').toString('base64'), fileName: `${record.calcId}.xml`,
            mimeType: 'application/xml', keyPrefix: `cte/${record.calcId}/xml`,
        });
        if (!(await transition(deps, record, { xmlDownloadedAt: new Date() }, { cteXml: xml, cteXmlStorageKey: uploaded.storageKey }, { calcStatuses: SUBMITTED_CALC_STATUSES }))) return null;
    } else {
        const calc = await deps.prisma.orderFreightCalculation.findUniqueOrThrow({ where: { id: record.calcId } });
        xml = calc.cteXml ?? '';
        if (!cteAuthorizationDate(xml, key, protocol, responseDate)) return null;
    }

    if (!record.pdfDownloadedAt) {
        const pdf = await deps.downloadCtePdf(id, ambiente);
        const uploaded = await deps.uploadBase64Object({
            base64: pdf.toString('base64'), fileName: `${record.calcId}.pdf`,
            mimeType: 'application/pdf', keyPrefix: `cte/${record.calcId}/pdf`,
        });
        if (!(await transition(deps, record, { pdfDownloadedAt: new Date() }, { ctePdfStorageKey: uploaded.storageKey }, { calcStatuses: SUBMITTED_CALC_STATUSES }))) return null;
    }
    return cteAuthorizationDate(xml, key, protocol, responseDate);
}

/** Persiste o ID mesmo se o Redis falhou; não sobrescreve cálculo já terminal ou substituído. */
async function persistProviderId(deps: CteEmissionProcessorDeps, id: string, providerDocId: string): Promise<CteEmissionJobRecord | null> {
    const stillCurrent = async (record: CteEmissionJobRecord): Promise<CteEmissionJobRecord | null> => {
        const calc = await deps.prisma.orderFreightCalculation.findUniqueOrThrow({ where: { id: record.calcId } });
        return SUBMITTED_CALC_STATUSES.some((status) => status === calc.status) ? record : null;
    };
    for (let attempt = 0; attempt < 2; attempt++) {
        const current = await readJob(deps, id);
        if (current.providerDocId) return current.providerDocId === providerDocId ? stillCurrent(current) : null;
        if (['DONE', 'FAILED'].includes(current.phase)) return null;
        if (await transition(deps, current, { phase: 'SUBMITTED', providerDocId }, { status: 'CTE_PROCESSING' }, {
            calcStatuses: SUBMITTED_CALC_STATUSES, requireCalc: false,
        })) return stillCurrent(await readJob(deps, id));
    }
    return null;
}

export async function processCteEmissionJob(
    job: Job<CteEmissionJobData>,
    deps: CteEmissionProcessorDeps = defaultCteEmissionProcessorDeps,
): Promise<void> {
    const { calcId, cteEmissionJobId, phaseHint } = job.data;
    let record: CteEmissionJobRecord | null = null;
    let claimed = false;
    try {
        record = await readJob(deps, cteEmissionJobId);
        if (record.calcId !== calcId) throw new Error('Cálculo do job não corresponde ao registro fiscal.');
        if (['DONE', 'FAILED'].includes(record.phase)) return;
        // A rota atual publica queueJobId depois de enfileirar. Uma consulta que começou muito
        // cedo aguarda essa publicação; uma execução substituída jamais altera o job atual.
        if (job.id && record.queueJobId && record.queueJobId !== job.id) {
            if (phaseHint === 'poll-only' && (job.data.queueIdWaitCount ?? 0) < 3) {
                await job.updateData({ ...job.data, queueIdWaitCount: (job.data.queueIdWaitCount ?? 0) + 1 });
                await rescheduleJob(job, POLL_DELAY_MS);
            }
            return;
        }

        if (!record.providerDocId && job.data.providerDocIdPending) {
            record = await persistProviderId(deps, cteEmissionJobId, job.data.providerDocIdPending);
            if (!record) return;
        }
        if (!record.providerDocId) {
            if (record.phase === 'PENDING_RECONCILIATION') return;
            if (phaseHint === 'poll-only' || record.submissionGuardVersion !== 1 || record.submitStartedAt || record.phase !== 'QUEUED') {
                await markPendingReconciliation(deps, record, 'Não é possível comprovar que o CT-e deixou de ser enviado; investigação necessária.');
                return;
            }
        }
        if (record.phase === 'PENDING_RECONCILIATION' && phaseHint !== 'poll-only') return;

        const { input, fiscalEmitterContext } = await deps.buildCteEmissionInputForJob(calcId, cteEmissionJobId);
        if (!record.providerDocId) {
            const submitted = await deps.submitCteToAcbr(input, calcId, fiscalEmitterContext, async () => {
                // O CAS e o estado do cálculo são gravados juntos. A rota não deve conseguir
                // declarar falha de enqueue após esta transição e liberar uma nova emissão.
                const startedAt = new Date();
                const won = await transition(deps, record!, { submitStartedAt: startedAt, phase: 'EMPRESA_ENSURING' },
                    { status: 'CTE_PROCESSING' }, { calcStatuses: ['CTE_SENT'] });
                if (won) {
                    claimed = true;
                    record = { ...record!, submitStartedAt: startedAt, phase: 'EMPRESA_ENSURING' };
                }
                return won;
            });
            if ('skipped' in submitted) return;
            if ('rejected' in submitted) {
                // O adapter só retorna esta variante se o cadastro da empresa falhou antes do POST.
                if (!claimed) await markRejected(deps, record, submitted.rejected);
                else await markPendingReconciliation(deps, record, 'Resultado do envio não confirmado pelo provedor.');
                return;
            }
            const providerDocId = submitted.providerDocId?.trim();
            if (!providerDocId || !claimed) {
                await markPendingReconciliation(deps, await readJob(deps, cteEmissionJobId), 'Resposta do envio sem identificador fiscal utilizável.');
                return;
            }
            try {
                await job.updateData({ ...job.data, providerDocIdPending: providerDocId });
            } catch (err) {
                console.error(JSON.stringify({ source: 'cteEmissionProcessor', event: 'redis-id-write-failed', cteEmissionJobId, error: String(err) }));
            }
            record = await persistProviderId(deps, cteEmissionJobId, providerDocId);
            if (!record) return;
        }

        const providerDocId = record.providerDocId;
        if (!providerDocId) return;
        const outcome = await deps.pollCteStatusOnce(providerDocId, input.ambiente, record.attemptCount);
        if (outcome.kind === 'REJECTED') {
            await markRejected(deps, record, outcome.result);
            return;
        }
        if (outcome.kind === 'RECONCILIATION_REQUIRED') {
            await markPendingReconciliation(deps, record, outcome.reason, {
                ...(outcome.rejectionCode ? { rejectionCode: outcome.rejectionCode } : {}),
                ...(outcome.rejectionReason ? { rejectionReason: outcome.rejectionReason } : {}),
            });
            return;
        }
        if (outcome.kind === 'AUTHORIZED') {
            const key = outcome.result.accessKey ?? '';
            const protocol = outcome.result.protocol ?? '';
            if (!/^\d{44}$/.test(key) || !protocol.trim()) {
                await markPendingReconciliation(deps, record, 'Autorização sem chave ou protocolo válidos; confirme o documento na ACBr e SEFAZ.');
                return;
            }
            if (!(await transition(deps, record, { phase: 'DOWNLOADING_FILES' }))) return;
            record = { ...record, phase: 'DOWNLOADING_FILES' };
            const authorization = outcome.result.rawResponse.autorizacao;
            const authorizationFields = authorization && typeof authorization === 'object' ? authorization as Record<string, unknown> : {};
            const responseDate = fiscalDate(authorizationFields.dhRecbto ?? authorizationFields.data_autorizacao);
            const authorizedAt = await downloadAndPersistFiles(deps, record, input.ambiente, key, protocol, responseDate);
            if (!authorizedAt) {
                await markPendingReconciliation(deps, await readJob(deps, cteEmissionJobId), 'XML não confirma a mesma chave, protocolo e autorização; reconciliação necessária.');
                return;
            }
            await transition(deps, record, { phase: 'DONE' }, {
                status: 'CTE_AUTHORIZED', cteAccessKey: key, cteProtocol: protocol, cteAuthorizedAt: authorizedAt, cteStatusReason: null,
            }, { calcStatuses: SUBMITTED_CALC_STATUSES });
            return;
        }

        const nextAttempt = record.attemptCount + 1;
        if (nextAttempt >= record.maxAttempts) {
            await markPendingReconciliation(deps, record, 'Timeout aguardando retorno da SEFAZ via ACBr após o número máximo de tentativas.');
            return;
        }
        if (await transition(deps, record, { phase: 'POLLING', attemptCount: nextAttempt, lastPolledAt: new Date() })) {
            await rescheduleJob(job, POLL_DELAY_MS);
        }
    } catch (err) {
        if (err instanceof DelayedError) throw err;
        if (!record && err instanceof Error && ((err as { code?: string }).code === 'P2025' || err.name === 'NotFoundError')) return;
        console.error(JSON.stringify({ source: 'cteEmissionProcessor', calcId, cteEmissionJobId, error: err instanceof Error ? err.message : String(err) }));
        // Se não for possível reler, propaga para o retry do BullMQ: ele terá que passar pelo CAS.
        const current = await readJob(deps, cteEmissionJobId);
        if (current.calcId !== calcId || ['DONE', 'FAILED', 'PENDING_RECONCILIATION'].includes(current.phase)) return;
        if (job.id && current.queueJobId && current.queueJobId !== job.id) return;
        if (!current.providerDocId && job.data.providerDocIdPending) {
            const recovered = await persistProviderId(deps, cteEmissionJobId, job.data.providerDocIdPending);
            if (recovered?.providerDocId) await rescheduleJob(job, POLL_DELAY_MS);
        }
        const error = err instanceof Error ? err.message : String(err);
        if (err instanceof AcbrHttpError && err.httpStatus === 402) {
            await deps.cteEmissionQueue.pause();
            const changed = await markPendingReconciliation(deps, current, `Fila pausada por cota ACBr: ${error}`, { pausedForQuota: true, lastHttpStatus: 402 });
            if (changed) await deps.createSystemAlert({
                category: 'FISCAL_PROVIDER_QUOTA', severity: 'CRITICAL', title: 'Emissão de CT-e pausada — créditos ACBr esgotados',
                message: error, context: { calcId, cteEmissionJobId, httpStatus: 402, quotaErrorCode: err.quotaErrorCode },
            });
            return;
        }
        // Toda falha após o marcador e antes de obter um ID é incerta, inclusive 4xx/429/5xx.
        if (!current.providerDocId && (current.submitStartedAt || current.submissionGuardVersion !== 1 || claimed)) {
            await markPendingReconciliation(deps, current, `Resultado do envio incerto: ${error}`,
                err instanceof AcbrHttpError ? { lastHttpStatus: err.httpStatus } : {});
            return;
        }
        const nextAttempt = current.attemptCount + 1;
        if (nextAttempt >= current.maxAttempts) {
            await markPendingReconciliation(deps, current, `Falha persistente no processamento do CT-e: ${error}`);
            return;
        }
        const delay = err instanceof AcbrHttpError && err.httpStatus === 429
            ? Math.min(Math.max(err.retryInSeconds ?? err.retryAfterSeconds ?? 2, 1) * 1000, RATE_LIMIT_BACKOFF_CAP_MS)
            : POLL_DELAY_MS;
        if (await transition(deps, current, { attemptCount: nextAttempt, lastError: error, ...(err instanceof AcbrHttpError ? { lastHttpStatus: err.httpStatus } : {}) })) {
            await rescheduleJob(job, delay);
        }
    }
}

export async function handleCteJobExhausted(
    jobData: CteEmissionJobData,
    err: Error,
    deps: CteEmissionProcessorDeps = defaultCteEmissionProcessorDeps,
    queueJobId?: string,
): Promise<void> {
    const record = await readJob(deps, jobData.cteEmissionJobId);
    if (record.calcId !== jobData.calcId || ['DONE', 'FAILED', 'PENDING_RECONCILIATION'].includes(record.phase)) return;
    if (queueJobId && record.queueJobId && record.queueJobId !== queueJobId) return;
    const changed = await markPendingReconciliation(deps, record, `Job esgotou as tentativas automáticas: ${err.message}`, {}, record.queueJobId ? queueJobId : undefined);
    if (!changed) return;
    await deps.createOrMergeSystemAlert({
        category: 'FISCAL_PROVIDER_ERROR', severity: 'WARNING', title: 'Emissão de CT-e travada — tentativas automáticas esgotadas',
        message: `Cálculo ${record.calcId} não concluiu a emissão assíncrona. Reconciliação necessária.`,
        context: { calcId: record.calcId, cteEmissionJobId: record.id, providerDocId: record.providerDocId, lastError: err.message },
    });
}
