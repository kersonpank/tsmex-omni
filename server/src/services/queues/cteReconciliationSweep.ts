import prisma from '../../lib/prisma.js';
import { enqueueCteEmissionJob } from './cteEmissionQueue.js';
import { reconcileCteWithoutProviderId, PROVIDER_DOWN_AFTER_FAILURES } from './cteReconcileWithoutId.js';
import { SYSTEM_RESOLUTION_NOTE } from '../exceptions/exceptionRules.js';
import { dueIn } from '../exceptions/alertOwner.js';

/**
 * Varredor de CT-e preso em CTE_PENDING_RECONCILIATION (worker, a cada 2 minutos).
 *
 * - Com `providerDocId` no último job: só CONSULTA o provedor — mesmo caminho da rota manual
 *   `POST .../emit-cte/reconcile` (job -> POLLING, enfileira `poll-only`, cálculo -> CTE_PROCESSING).
 *   Nunca reenvia o documento. Espaçado por `minAgeMs` (10 min).
 * - Sem `providerDocId` (o POST estourou o tempo): procura o documento no provedor por referência/série+número
 *   (`reconcileCteWithoutProviderId`): achou -> segue a consulta; não existe (e o envio tem > 10 min) -> reenvia o
 *   MESMO job com a MESMA numeração; busca falhou -> continua pendente. Espaçado de 2 em 2 minutos (10 min depois
 *   de 3 falhas seguidas do provedor).
 * - Teto: 48 h sem solução (contadas da primeira vez que o varredor viu o caso, guardada em
 *   `CteEmissionJob.nextPollAt`, que nenhum outro fluxo usa) -> para de reconsultar e deixa UMA exceção
 *   FISCAL_PROVIDER_ERROR com dono = hub do pedido.
 *
 * Serialização: a "última tentativa" fica em `CteEmissionJob.lastPolledAt`, reivindicada de forma
 * atômica antes de agir.
 */

export const RECONCILE_MIN_AGE_MS = 10 * 60_000;
export const WITHOUT_ID_CHECK_EVERY_MS = 2 * 60_000;
export const GIVE_UP_AFTER_MS = 48 * 3_600_000;
const MAX_ENQUEUE_PER_RUN = 20;
const MAX_LOOKUPS_PER_RUN = 20;
const CANDIDATE_SCAN = 200;
const ALERT_KIND = 'CTE_SEM_CONFIRMACAO';

export interface CteReconciliationSweepResult {
    requeued: number;
    /** Sem id: conferências feitas no provedor nesta rodada. */
    lookups: number;
    /** Sem id: documentos reenviados após prova de inexistência. */
    resubmitted: number;
    alerted: number;
    resolved: number;
}

export async function sweepPendingCteReconciliation(
    options: {
        db?: typeof prisma;
        now?: Date;
        enqueue?: typeof enqueueCteEmissionJob;
        minAgeMs?: number;
        reconcile?: typeof reconcileCteWithoutProviderId;
    } = {},
): Promise<CteReconciliationSweepResult> {
    const db = options.db ?? prisma;
    const now = options.now ?? new Date();
    const enqueue = options.enqueue ?? enqueueCteEmissionJob;
    const reconcile = options.reconcile ?? reconcileCteWithoutProviderId;
    const cutoff = new Date(now.getTime() - (options.minAgeMs ?? RECONCILE_MIN_AGE_MS));
    const result: CteReconciliationSweepResult = { requeued: 0, lookups: 0, resubmitted: 0, alerted: 0, resolved: 0 };

    const calcs = await db.orderFreightCalculation.findMany({
        where: { status: 'CTE_PENDING_RECONCILIATION' },
        orderBy: { updatedAt: 'asc' },
        take: CANDIDATE_SCAN,
        select: {
            id: true,
            orderId: true,
            emissorId: true,
            updatedAt: true,
            cteEmissionJobs: {
                orderBy: { createdAt: 'desc' }, take: 1,
                select: { id: true, providerDocId: true, lastPolledAt: true, nextPollAt: true, attemptCount: true },
            },
            order: { select: { currentHubId: true, demand: { select: { orderNumber: true } } } },
        },
    });

    const openAlerts = await db.systemAlert.findMany({
        where: { category: 'FISCAL_PROVIDER_ERROR', status: { not: 'RESOLVED' } },
        select: { id: true, context: true },
    });
    const alertedCalcs = new Map<string, string>();
    for (const a of openAlerts) {
        const ctx = (a.context as { kind?: string; calcId?: string } | null) ?? {};
        if (ctx.kind === ALERT_KIND && ctx.calcId) alertedCalcs.set(ctx.calcId, a.id);
    }

    const openAlert = async (calc: (typeof calcs)[number], title: string, message: string) => {
        await db.systemAlert.create({
            data: {
                category: 'FISCAL_PROVIDER_ERROR',
                severity: 'CRITICAL',
                title,
                message,
                context: { kind: ALERT_KIND, calcId: calc.id, orderId: calc.orderId },
                hubId: calc.order?.currentHubId ?? calc.emissorId,
                dueAt: dueIn(24, now),
            },
        });
        alertedCalcs.set(calc.id, 'new');
        result.alerted += 1;
    };
    const labelOf = (calc: (typeof calcs)[number]) =>
        calc.order?.demand?.orderNumber != null ? `#${calc.order.demand.orderNumber}` : calc.orderId.slice(0, 8);

    for (const calc of calcs) {
        const job = calc.cteEmissionJobs[0];
        const label = labelOf(calc);

        if (!job) {
            // Sem nenhuma tentativa registrada não há o que consultar: só a pessoa resolve.
            if (!alertedCalcs.has(calc.id)) {
                await openAlert(calc, `CT-e do pedido ${label} sem confirmação do provedor`,
                    `CT-e do pedido ${label} sem confirmação do provedor: confira no painel do emissor antes de reemitir.`);
            }
            continue;
        }

        // Teto de 48 h: o relógio começa na primeira vez que o varredor vê o caso.
        if (!job.nextPollAt) {
            await db.cteEmissionJob.updateMany({ where: { id: job.id, nextPollAt: null }, data: { nextPollAt: new Date(now.getTime() + GIVE_UP_AFTER_MS) } });
        } else if (now.getTime() >= job.nextPollAt.getTime()) {
            if (!alertedCalcs.has(calc.id)) {
                await openAlert(calc, `CT-e do pedido ${label} sem solução há 48 h`,
                    `CT-e do pedido ${label} segue sem confirmação do emissor fiscal depois de 48 h de conferências automáticas. Paramos de consultar: confira no painel do emissor antes de reemitir.`);
            }
            continue;
        }

        if (job.providerDocId) {
            if (calc.updatedAt >= cutoff) continue;
            if (result.requeued >= MAX_ENQUEUE_PER_RUN) continue;
            // Reivindica a tentativa de forma atômica: duas rodadas (ou duas instâncias) não enfileiram o mesmo cálculo.
            const claim = await db.cteEmissionJob.updateMany({
                where: { id: job.id, OR: [{ lastPolledAt: null }, { lastPolledAt: { lt: cutoff } }] },
                data: { phase: 'POLLING', attemptCount: 0, pausedForQuota: false, lastPolledAt: now },
            });
            if (claim.count === 0) continue;
            const queueJobId = await enqueue({ calcId: calc.id, cteEmissionJobId: job.id, phaseHint: 'poll-only' });
            await db.cteEmissionJob.update({ where: { id: job.id }, data: { queueJobId } });
            await db.orderFreightCalculation.updateMany({
                where: { id: calc.id, status: 'CTE_PENDING_RECONCILIATION' },
                data: { status: 'CTE_PROCESSING', cteStatusReason: null },
            });
            result.requeued += 1;
            continue;
        }

        // Sem id: procura no provedor (a cada 2 min; a cada 10 min depois de várias falhas seguidas do provedor).
        if (result.lookups >= MAX_LOOKUPS_PER_RUN) continue;
        const every = job.attemptCount >= PROVIDER_DOWN_AFTER_FAILURES ? RECONCILE_MIN_AGE_MS : WITHOUT_ID_CHECK_EVERY_MS;
        const due = new Date(now.getTime() - every);
        const claim = await db.cteEmissionJob.updateMany({
            where: { id: job.id, providerDocId: null, OR: [{ lastPolledAt: null }, { lastPolledAt: { lt: due } }] },
            data: { lastPolledAt: now },
        });
        if (claim.count === 0) continue;
        result.lookups += 1;
        try {
            const outcome = await reconcile(calc.id);
            if (outcome.kind === 'RESUBMITTED') result.resubmitted += 1;
            if (outcome.kind === 'FOUND_POLLING') result.requeued += 1;
        } catch (error) {
            console.error(JSON.stringify({ source: 'cteReconciliationSweep', event: 'reconcile-failed', calcId: calc.id, error: error instanceof Error ? error.message : String(error) }));
        }
    }

    // Alerta cujo cálculo saiu da conciliação (autorizado, rejeitado, reemitido...) se resolve sozinho.
    if (alertedCalcs.size > 0) {
        const stillPending = await db.orderFreightCalculation.findMany({
            where: { id: { in: [...alertedCalcs.keys()] }, status: 'CTE_PENDING_RECONCILIATION' },
            select: { id: true },
        });
        const pendingIds = new Set(stillPending.map((c) => c.id));
        const staleAlertIds = [...alertedCalcs]
            .filter(([calcId, alertId]) => alertId !== 'new' && !pendingIds.has(calcId))
            .map(([, alertId]) => alertId);
        if (staleAlertIds.length > 0) {
            await db.systemAlert.updateMany({
                where: { id: { in: staleAlertIds }, status: { not: 'RESOLVED' } },
                data: { status: 'RESOLVED', resolvedAt: now, resolvedByUserId: null, resolutionNote: SYSTEM_RESOLUTION_NOTE },
            });
            result.resolved = staleAlertIds.length;
        }
    }
    return result;
}
