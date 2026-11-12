import { randomUUID } from 'node:crypto';
import prisma from '../../lib/prisma.js';
import { lookupCteInProvider, type CteLookupOutcome, type CteLookupQuery } from '../acbr/acbrCteLookup.js';
import { enqueueCteEmissionJob } from './cteEmissionQueue.js';
import { buildCteEmissionInputForJob } from './cteEmissionJobInput.js';

/**
 * Conciliação de CT-e SEM `providerDocId` (o `POST /cte` estourou o tempo e não sabemos se o
 * provedor recebeu). Procura o documento no provedor e decide com PROVA:
 *
 * - FOUND        -> grava o `providerDocId` e segue o fluxo normal (consulta poll-only: autorizado/rejeitado, XML/PDF).
 * - NOT_FOUND    -> a busca respondeu e não há documento. Se o envio tem mais de 10 minutos, é a prova de
 *                   inexistência: o MESMO job volta a 'submit' com a MESMA numeração (o número já está no
 *                   inputSnapshot do job) e a referência é a mesma. Com menos de 10 min não decide (o provedor
 *                   ainda pode estar processando a requisição que estourou o tempo).
 * - LOOKUP_FAILED-> rede/5xx/timeout: continua pendente. NUNCA reenvia.
 * - AMBIGUOUS    -> mais de um candidato: não decide sozinho.
 *
 * Contadores sem mudar o schema: `CteEmissionJob.attemptCount` guarda quantas conferências seguidas
 * falharam por culpa do provedor (zera ao obter qualquer resposta), `lastPolledAt` a última conferência.
 */

export const RESEND_MIN_AGE_MS = 10 * 60_000;
/** Conferências sem resposta do provedor a partir das quais a tela diz que o emissor está fora do ar. */
export const PROVIDER_DOWN_AFTER_FAILURES = 3;

export type CteReconcileResult =
    | { kind: 'HAS_PROVIDER_ID' }
    | { kind: 'NOT_PENDING' }
    | { kind: 'FOUND_POLLING'; providerDocId: string }
    | { kind: 'RESUBMITTED' }
    | { kind: 'TOO_RECENT'; retryAfterMs: number }
    | { kind: 'PROVIDER_UNAVAILABLE'; failedChecks: number; error: string }
    | { kind: 'AMBIGUOUS'; ids: string[] }
    | { kind: 'INPUT_ERROR'; error: string };

export interface CteReconcileDeps {
    db: typeof prisma;
    now: () => Date;
    lookup: (q: CteLookupQuery) => Promise<CteLookupOutcome>;
    enqueue: typeof enqueueCteEmissionJob;
    loadInput: typeof buildCteEmissionInputForJob;
}

const defaultDeps = (): CteReconcileDeps => ({
    db: prisma,
    now: () => new Date(),
    lookup: (q) => lookupCteInProvider(q),
    enqueue: enqueueCteEmissionJob,
    loadInput: buildCteEmissionInputForJob,
});

const digits = (v: unknown): string => String(v ?? '').replace(/\D/g, '');

async function history(db: typeof prisma, orderId: string, description: string): Promise<void> {
    try {
        await db.orderHistory.create({ data: { orderId, eventType: 'NOTE', description } });
    } catch (err) {
        console.error(JSON.stringify({ source: 'cteReconcileWithoutId', event: 'history-failed', error: String(err) }));
    }
}

export async function reconcileCteWithoutProviderId(
    calcId: string,
    overrides: Partial<CteReconcileDeps> = {},
): Promise<CteReconcileResult> {
    const deps = { ...defaultDeps(), ...overrides };
    const { db } = deps;
    const now = deps.now();

    const calc = await db.orderFreightCalculation.findUnique({
        where: { id: calcId },
        select: {
            id: true, orderId: true, status: true, cteNumber: true, cteSeries: true, cteAccessKey: true,
            cteEmissionJobs: {
                orderBy: { createdAt: 'desc' }, take: 1,
                select: { id: true, providerDocId: true, phase: true, submitStartedAt: true, createdAt: true, attemptCount: true },
            },
        },
    });
    const job = calc?.cteEmissionJobs[0];
    if (!calc || !job || calc.status !== 'CTE_PENDING_RECONCILIATION') return { kind: 'NOT_PENDING' };
    if (job.providerDocId) return { kind: 'HAS_PROVIDER_ID' };
    if (job.phase !== 'PENDING_RECONCILIATION') return { kind: 'NOT_PENDING' };

    let query: CteLookupQuery;
    try {
        const { input } = await deps.loadInput(calcId, job.id);
        const numero = input.numero ?? (calc.cteNumber ? Number(calc.cteNumber) : null);
        query = {
            cpfCnpj: digits(input.person.document),
            ambiente: input.ambiente,
            referencias: [job.id],
            legacyReferencias: [calcId],
            chave: calc.cteAccessKey,
            serie: input.serie ?? calc.cteSeries ?? null,
            numero: Number.isFinite(numero) ? numero : null,
        };
        if (!query.cpfCnpj) throw new Error('Emitente sem CNPJ para consultar o provedor.');
    } catch (err) {
        return { kind: 'INPUT_ERROR', error: err instanceof Error ? err.message : String(err) };
    }

    const outcome = await deps.lookup(query);

    if (outcome.kind === 'LOOKUP_FAILED') {
        const failedChecks = job.attemptCount + 1;
        await db.cteEmissionJob.updateMany({
            where: { id: job.id, providerDocId: null, phase: 'PENDING_RECONCILIATION' },
            data: { attemptCount: failedChecks, lastPolledAt: now, lastError: `Conferência no emissor sem resposta: ${outcome.error}`.slice(0, 1000) },
        });
        return { kind: 'PROVIDER_UNAVAILABLE', failedChecks, error: outcome.error };
    }

    // O provedor respondeu: a contagem de falhas seguidas zera.
    await db.cteEmissionJob.updateMany({
        where: { id: job.id, providerDocId: null, phase: 'PENDING_RECONCILIATION' },
        data: { attemptCount: 0, lastPolledAt: now },
    });

    if (outcome.kind === 'AMBIGUOUS') return { kind: 'AMBIGUOUS', ids: outcome.ids };

    if (outcome.kind === 'FOUND') {
        let claim: { count: number };
        try {
            claim = await db.cteEmissionJob.updateMany({
                where: { id: job.id, providerDocId: null, phase: 'PENDING_RECONCILIATION' },
                data: {
                    providerDocId: outcome.providerDocId, phase: 'POLLING', attemptCount: 0, pausedForQuota: false,
                    lastPolledAt: now, lastError: null, queueJobId: null,
                },
            });
        } catch (err) {
            // providerDocId é único: outro registro já usa este documento.
            return { kind: 'AMBIGUOUS', ids: [outcome.providerDocId] };
        }
        if (claim.count === 0) return { kind: 'NOT_PENDING' };
        await db.orderFreightCalculation.updateMany({
            where: { id: calc.id, status: 'CTE_PENDING_RECONCILIATION' },
            data: { status: 'CTE_PROCESSING', cteStatusReason: null },
        });
        const queueJobId = await deps.enqueue({ calcId: calc.id, cteEmissionJobId: job.id, phaseHint: 'poll-only' });
        await db.cteEmissionJob.update({ where: { id: job.id }, data: { queueJobId } });
        await history(db, calc.orderId, `CT-e${calc.cteNumber ? ` nº ${calc.cteNumber}` : ''} localizado no emissor fiscal após conferência (${outcome.matchedBy}); acompanhando a autorização.`);
        return { kind: 'FOUND_POLLING', providerDocId: outcome.providerDocId };
    }

    // NOT_FOUND: prova de inexistência só vale depois de a requisição que estourou o tempo ter tido chance de terminar.
    const sentAt = job.submitStartedAt ?? job.createdAt;
    const age = now.getTime() - sentAt.getTime();
    if (age < RESEND_MIN_AGE_MS) return { kind: 'TOO_RECENT', retryAfterMs: RESEND_MIN_AGE_MS - age };

    const reset = await db.cteEmissionJob.updateMany({
        where: { id: job.id, providerDocId: null, phase: 'PENDING_RECONCILIATION' },
        data: {
            phase: 'QUEUED', submissionGuardVersion: 1, submitStartedAt: null, attemptCount: 0, pausedForQuota: false,
            lastError: null, lastHttpStatus: null, lastPolledAt: now, nextPollAt: null, queueJobId: null,
        },
    });
    if (reset.count === 0) return { kind: 'NOT_PENDING' };
    await db.orderFreightCalculation.updateMany({
        where: { id: calc.id, status: 'CTE_PENDING_RECONCILIATION' },
        data: { status: 'CTE_SENT', cteStatusReason: null },
    });
    try {
        const queueJobId = await deps.enqueue({ calcId: calc.id, cteEmissionJobId: job.id, phaseHint: 'submit', resubmitRunId: randomUUID() });
        await db.cteEmissionJob.update({ where: { id: job.id }, data: { queueJobId } });
    } catch (err) {
        // Nada foi enviado ainda: volta ao estado pendente para a próxima rodada tentar de novo.
        await db.cteEmissionJob.updateMany({ where: { id: job.id, phase: 'QUEUED', providerDocId: null }, data: { phase: 'PENDING_RECONCILIATION', lastError: `Falha ao enfileirar o reenvio: ${err instanceof Error ? err.message : String(err)}` } });
        await db.orderFreightCalculation.updateMany({ where: { id: calc.id, status: 'CTE_SENT' }, data: { status: 'CTE_PENDING_RECONCILIATION' } });
        throw err;
    }
    await history(db, calc.orderId, `CT-e${calc.cteNumber ? ` nº ${calc.cteNumber}` : ''} reenviado após conferência: o emissor fiscal confirmou que não recebeu o documento. Mesma numeração mantida.`);
    return { kind: 'RESUBMITTED' };
}

/** Mensagem curta para o operador a partir do resultado (usada pela rota "Conferir agora"). */
export function describeReconcileResult(r: CteReconcileResult): { state: string; message: string } {
    switch (r.kind) {
        case 'FOUND_POLLING': return { state: 'FOUND', message: 'CT-e encontrado no emissor; acompanhando a autorização.' };
        case 'RESUBMITTED': return { state: 'RESUBMITTED', message: 'O emissor confirmou que não recebeu o CT-e. Reenviado com a mesma numeração.' };
        case 'TOO_RECENT': return { state: 'WAIT', message: 'O emissor não tem o CT-e, mas o envio é recente. Conferimos de novo em alguns minutos antes de reenviar.' };
        case 'PROVIDER_UNAVAILABLE': return { state: 'PROVIDER_UNAVAILABLE', message: 'O emissor fiscal não respondeu à conferência. Tentaremos de novo sozinhos; nada foi reenviado.' };
        case 'AMBIGUOUS': return { state: 'AMBIGUOUS', message: 'Mais de um documento parecido no emissor. Nada foi reenviado; a torre confere.' };
        case 'INPUT_ERROR': return { state: 'ERROR', message: `Não foi possível preparar a conferência: ${r.error}` };
        case 'HAS_PROVIDER_ID': return { state: 'POLLING', message: 'Consulta do status reenfileirada.' };
        default: return { state: 'NOT_PENDING', message: 'O CT-e já saiu da conciliação.' };
    }
}
