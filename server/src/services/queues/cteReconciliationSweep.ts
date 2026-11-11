import prisma from '../../lib/prisma.js';
import { enqueueCteEmissionJob } from './cteEmissionQueue.js';
import { SYSTEM_RESOLUTION_NOTE } from '../exceptions/exceptionRules.js';
import { dueIn } from '../exceptions/alertOwner.js';

/**
 * Varredor de CT-e preso em CTE_PENDING_RECONCILIATION (worker, a cada 10 min).
 *
 * - Com `providerDocId` no último job: só CONSULTA o provedor — mesmo caminho da rota manual
 *   `POST .../emit-cte/reconcile` (job -> POLLING, enfileira `poll-only`, cálculo -> CTE_PROCESSING).
 *   Nunca reenvia o documento.
 * - Sem `providerDocId` (resultado realmente desconhecido): não mexe em nada; abre uma exceção
 *   para o hub do pedido conferir no painel do emissor antes de qualquer reemissão.
 *
 * Serialização: a "última tentativa" fica em `CteEmissionJob.lastPolledAt`, reivindicada de forma
 * atômica antes de enfileirar; o cálculo também precisa estar parado há mais de `minAgeMs`.
 */

export const RECONCILE_MIN_AGE_MS = 10 * 60_000;
const MAX_ENQUEUE_PER_RUN = 20;
const CANDIDATE_SCAN = 200;
const ALERT_KIND = 'CTE_SEM_CONFIRMACAO';

export interface CteReconciliationSweepResult {
    requeued: number;
    alerted: number;
    resolved: number;
}

export async function sweepPendingCteReconciliation(
    options: { db?: typeof prisma; now?: Date; enqueue?: typeof enqueueCteEmissionJob; minAgeMs?: number } = {},
): Promise<CteReconciliationSweepResult> {
    const db = options.db ?? prisma;
    const now = options.now ?? new Date();
    const enqueue = options.enqueue ?? enqueueCteEmissionJob;
    const cutoff = new Date(now.getTime() - (options.minAgeMs ?? RECONCILE_MIN_AGE_MS));
    const result: CteReconciliationSweepResult = { requeued: 0, alerted: 0, resolved: 0 };

    const calcs = await db.orderFreightCalculation.findMany({
        where: { status: 'CTE_PENDING_RECONCILIATION', updatedAt: { lt: cutoff } },
        orderBy: { updatedAt: 'asc' },
        take: CANDIDATE_SCAN,
        select: {
            id: true,
            orderId: true,
            emissorId: true,
            cteEmissionJobs: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, providerDocId: true, lastPolledAt: true } },
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

    for (const calc of calcs) {
        const job = calc.cteEmissionJobs[0];
        if (job?.providerDocId) {
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

        if (alertedCalcs.has(calc.id)) continue;
        const label = calc.order?.demand?.orderNumber != null ? `#${calc.order.demand.orderNumber}` : calc.orderId.slice(0, 8);
        await db.systemAlert.create({
            data: {
                category: 'FISCAL_PROVIDER_ERROR',
                severity: 'CRITICAL',
                title: `CT-e do pedido ${label} sem confirmação do provedor`,
                message: `CT-e do pedido ${label} sem confirmação do provedor: confira no painel do emissor antes de reemitir.`,
                context: { kind: ALERT_KIND, calcId: calc.id, orderId: calc.orderId },
                hubId: calc.order?.currentHubId ?? calc.emissorId,
                dueAt: dueIn(24, now),
            },
        });
        result.alerted += 1;
    }

    // Alerta cujo cálculo saiu da conciliação (autorizado, rejeitado, reemitido...) se resolve sozinho.
    if (alertedCalcs.size > 0) {
        const stillPending = await db.orderFreightCalculation.findMany({
            where: { id: { in: [...alertedCalcs.keys()] }, status: 'CTE_PENDING_RECONCILIATION' },
            select: { id: true },
        });
        const pendingIds = new Set(stillPending.map((c) => c.id));
        const staleAlertIds = [...alertedCalcs].filter(([calcId]) => !pendingIds.has(calcId)).map(([, alertId]) => alertId);
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
