import prisma from '../../lib/prisma.js';
import { getCteEmissionQueue } from './cteEmissionQueue.js';
import { createOrMergeSystemAlert } from '../systemAlertService.js';
import { pendingReconciliationRecoveryHint } from './cteReconciliationMessages.js';

/** Fases que ainda podem estar "vivas" no BullMQ — mesma lista de repair-stuck-cte-jobs.ts. */
const NON_TERMINAL_PHASES = ['QUEUED', 'EMPRESA_ENSURING', 'SUBMITTED', 'POLLING', 'DOWNLOADING_FILES'] as const;

const STALE_THRESHOLD_MINUTES = 15;

const RECONCILE_REASON_STALE = 'Job assíncrono não teve retorno em tempo hábil — verificar manualmente ou usar POST .../emit-cte/reconcile.';
const RECONCILE_REASON_ORPHAN = 'Job não existe mais na fila Redis (provavelmente perdido em reinício/recriação de infraestrutura) — nenhuma tentativa automática vai processá-lo.';

/**
 * Detecta e repara CteEmissionJobs presos em fases não-terminais: orphans (job sumiu do Redis)
 * ou stale (sem progresso por mais de 15min). Move para PENDING_RECONCILIATION.
 * Chamado no startup do worker e periodicamente a cada 30min — substitui a necessidade de rodar
 * repair-stuck-cte-jobs.ts manualmente após crashes ou perda de volume Redis.
 */
export async function runStuckCteJobRepair(): Promise<void> {
    const queue = getCteEmissionQueue();
    const staleBefore = new Date(Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000);

    let candidates: Array<{
        id: string;
        calcId: string;
        phase: string;
        providerDocId: string | null;
        lastError: string | null;
        updatedAt: Date;
        queueJobId: string | null;
    }>;

    try {
        candidates = await prisma.cteEmissionJob.findMany({
            where: { phase: { in: [...NON_TERMINAL_PHASES] } },
            select: { id: true, calcId: true, phase: true, providerDocId: true, lastError: true, updatedAt: true, queueJobId: true },
        });
    } catch (err) {
        console.error(JSON.stringify({
            level: 'error',
            source: 'cteRepairService',
            message: 'Falha ao buscar candidatos travados no DB.',
            error: err instanceof Error ? err.message : String(err),
        }));
        return;
    }

    const toRepair: Array<{ job: (typeof candidates)[number]; reason: string }> = [];

    for (const job of candidates) {
        try {
            if (job.queueJobId) {
                const bullJob = await queue.getJob(job.queueJobId);
                if (!bullJob) {
                    toRepair.push({ job, reason: RECONCILE_REASON_ORPHAN });
                    continue;
                }
            }
            if (job.updatedAt < staleBefore) {
                toRepair.push({ job, reason: RECONCILE_REASON_STALE });
            }
        } catch (err) {
            console.warn(JSON.stringify({
                level: 'warn',
                source: 'cteRepairService',
                message: 'Falha ao checar job no Redis — pulando este candidate.',
                cteEmissionJobId: job.id,
                error: err instanceof Error ? err.message : String(err),
            }));
        }
    }

    if (toRepair.length === 0) return;

    console.log(JSON.stringify({
        level: 'info',
        source: 'cteRepairService',
        message: `Reparando ${toRepair.length} job(s) travado(s).`,
        count: toRepair.length,
        calcIds: toRepair.map((r) => r.job.calcId),
    }));

    const repairedCalcIds: string[] = [];

    for (const { job, reason } of toRepair) {
        try {
            const cteStatusReason = reason + pendingReconciliationRecoveryHint(job.providerDocId);
            await prisma.$transaction([
                prisma.cteEmissionJob.update({
                    where: { id: job.id },
                    data: { phase: 'PENDING_RECONCILIATION', lastError: job.lastError ?? reason },
                }),
                prisma.orderFreightCalculation.update({
                    where: { id: job.calcId },
                    data: { status: 'CTE_PENDING_RECONCILIATION', cteStatusReason },
                }),
            ]);
            repairedCalcIds.push(job.calcId);
        } catch (err) {
            console.error(JSON.stringify({
                level: 'error',
                source: 'cteRepairService',
                message: 'Falha ao mover job para PENDING_RECONCILIATION.',
                cteEmissionJobId: job.id,
                calcId: job.calcId,
                error: err instanceof Error ? err.message : String(err),
            }));
        }
    }

    if (repairedCalcIds.length === 0) return;

    // Dedup: múltiplas execuções periódicas não criam alertas repetidos para o mesmo incidente.
    await createOrMergeSystemAlert({
        category: 'FISCAL_PROVIDER_ERROR',
        severity: 'WARNING',
        title: 'Reparo automático: CT-e(s) destravado(s) pelo worker',
        message: `${repairedCalcIds.length} cálculo(s) de CT-e estavam presos em processamento assíncrono há mais de ${STALE_THRESHOLD_MINUTES} minutos e foram movidos para reconciliação manual pelo worker.`,
        context: { affectedCalcIds: repairedCalcIds, staleThresholdMinutes: STALE_THRESHOLD_MINUTES },
        dedupWindowMs: 60 * 60 * 1000, // 1h — agrupa ocorrências do mesmo incidente
    });
}
