import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Jobs nessas fases ainda podem estar "vivos" no BullMQ — só mexe se estiverem velhos demais. */
const NON_TERMINAL_PHASES = ['QUEUED', 'EMPRESA_ENSURING', 'SUBMITTED', 'POLLING', 'DOWNLOADING_FILES'] as const;

/** Configurável via env pra permitir rodar com threshold menor em teste manual. */
const STALE_THRESHOLD_MINUTES = Number(process.env.REPAIR_STALE_THRESHOLD_MINUTES ?? '15');

const RECONCILE_REASON = 'Job assíncrono não teve retorno em tempo hábil — verificar manualmente ou usar POST .../emit-cte/reconcile.';

async function main() {
    console.log(`Iniciando reparo de CteEmissionJob travados (parados há mais de ${STALE_THRESHOLD_MINUTES} min em fase não-terminal)...`);

    const staleBefore = new Date(Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000);

    const stuck = await prisma.cteEmissionJob.findMany({
        where: {
            phase: { in: [...NON_TERMINAL_PHASES] },
            updatedAt: { lt: staleBefore },
        },
        select: { id: true, calcId: true, phase: true, providerDocId: true, lastError: true, updatedAt: true },
    });

    console.log(`Encontrados ${stuck.length} job(s) travado(s).`);
    if (stuck.length === 0) {
        return;
    }

    for (const job of stuck) {
        await prisma.$transaction([
            prisma.cteEmissionJob.update({
                where: { id: job.id },
                data: { phase: 'PENDING_RECONCILIATION', lastError: job.lastError ?? RECONCILE_REASON },
            }),
            prisma.orderFreightCalculation.update({
                where: { id: job.calcId },
                data: { status: 'CTE_PENDING_RECONCILIATION', cteStatusReason: RECONCILE_REASON },
            }),
        ]);
        console.log(`  [ok] calc ${job.calcId} (job ${job.id}, fase anterior ${job.phase}, providerDocId=${job.providerDocId ?? 'nenhum'}, parado desde ${job.updatedAt.toISOString()}) → CTE_PENDING_RECONCILIATION`);
    }

    // Um único alerta resume o reparo inteiro — não um por calc, pra não poluir o painel.
    await prisma.systemAlert.create({
        data: {
            category: 'FISCAL_PROVIDER_ERROR',
            severity: 'WARNING',
            title: 'Reparo manual: CT-e(s) destravado(s) por script de manutenção',
            message: `${stuck.length} cálculo(s) de CT-e estavam presos em processamento assíncrono há mais de ${STALE_THRESHOLD_MINUTES} minutos e foram movidos para reconciliação manual pelo script repair-stuck-cte-jobs.ts.`,
            context: { affectedCalcIds: stuck.map((j) => j.calcId), staleThresholdMinutes: STALE_THRESHOLD_MINUTES },
        },
    });

    console.log(`Reparo concluído: ${stuck.length} calc(s) movido(s) para CTE_PENDING_RECONCILIATION. Use POST .../emit-cte/reconcile em cada um pra retomar (poll-only, nunca reenvia à ACBr).`);
}

main()
    .catch((err) => {
        console.error('Reparo falhou:', err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
