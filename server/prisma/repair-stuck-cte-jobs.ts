import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const prisma = new PrismaClient();

// Autocontido de propósito: a imagem `migrate` (onde este script roda) só copia `server/prisma`
// no build (ver Dockerfile.migrate) — nunca `server/src`. Importar de `../src/...` quebra em
// runtime com MODULE_NOT_FOUND (bug real descoberto na Onda 4: este arquivo importava
// `pendingReconciliationRecoveryHint` de `../src/services/queues/cteReconciliationMessages.js`
// e só não tinha sido pego porque a última execução bem-sucedida foi ANTES dessa dependência
// ser introduzida). Mesmo padrão de `inspect-cte-queue.ts`: duplica a config mínima em vez de
// importar de `src/`.
const CTE_EMISSION_QUEUE_NAME = 'cte-emission';
const REDIS_URL = process.env.REDIS_URL?.trim() || 'redis://redis:6379';
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
const queue = new Queue(CTE_EMISSION_QUEUE_NAME, { connection });

/** Cópia local de `cteReconciliationMessages.ts` — ver comentário acima sobre por que não importar. */
function pendingReconciliationRecoveryHint(providerDocId: string | null | undefined): string {
    return providerDocId
        ? ' Documento já submetido à ACBr — só reconciliação (consulta de status) é permitida; reemissão automática está bloqueada para evitar duplicidade.'
        : ' Nenhum documento foi submetido à ACBr ainda — reemissão automática está disponível (repita a emissão normalmente, é seguro).';
}

/** Jobs nessas fases ainda podem estar "vivos" no BullMQ — só mexe se estiverem velhos demais ou órfãos. */
const NON_TERMINAL_PHASES = ['QUEUED', 'EMPRESA_ENSURING', 'SUBMITTED', 'POLLING', 'DOWNLOADING_FILES'] as const;

/** Configurável via env pra permitir rodar com threshold menor em teste manual. */
const STALE_THRESHOLD_MINUTES = Number(process.env.REPAIR_STALE_THRESHOLD_MINUTES ?? '15');

const RECONCILE_REASON_STALE = 'Job assíncrono não teve retorno em tempo hábil — verificar manualmente ou usar POST .../emit-cte/reconcile.';
// Achado real na Onda 4: um job pode sumir do Redis (ex.: recriação completa do stack/volume
// entre o enqueue e o processamento) enquanto o Postgres ainda o descreve como "ativo". Sem essa
// checagem cruzada, esse caso só seria pego pelo threshold de tempo — mas na verdade é
// definitivo, não "demorado": nenhuma tentativa automática vai processá-lo nunca, porque ele
// simplesmente não existe mais em lugar nenhum pro BullMQ.
const RECONCILE_REASON_ORPHAN = 'Job não existe mais na fila Redis (provavelmente perdido em reinício/recriação de infraestrutura) — nenhuma tentativa automática vai processá-lo.';

async function main() {
    console.log(`Iniciando reparo de CteEmissionJob travados (fase não-terminal, órfãos no Redis ou parados há mais de ${STALE_THRESHOLD_MINUTES} min)...`);

    const staleBefore = new Date(Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000);

    const candidates = await prisma.cteEmissionJob.findMany({
        where: { phase: { in: [...NON_TERMINAL_PHASES] } },
        select: { id: true, calcId: true, phase: true, providerDocId: true, lastError: true, updatedAt: true, queueJobId: true },
    });

    const toRepair: Array<{ job: (typeof candidates)[number]; reason: string; orphan: boolean }> = [];
    for (const job of candidates) {
        let isOrphan = false;
        if (job.queueJobId) {
            const bullJob = await queue.getJob(job.queueJobId);
            isOrphan = !bullJob;
        }
        if (isOrphan) {
            toRepair.push({ job, reason: RECONCILE_REASON_ORPHAN, orphan: true });
        } else if (job.updatedAt < staleBefore) {
            toRepair.push({ job, reason: RECONCILE_REASON_STALE, orphan: false });
        }
    }

    console.log(`Encontrados ${toRepair.length} job(s) travado(s) (${toRepair.filter((r) => r.orphan).length} órfão(s) no Redis, ${toRepair.filter((r) => !r.orphan).length} por timeout).`);
    if (toRepair.length === 0) {
        return;
    }

    for (const { job, reason } of toRepair) {
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
        console.log(`  [ok] calc ${job.calcId} (job ${job.id}, fase anterior ${job.phase}, providerDocId=${job.providerDocId ?? 'nenhum'}, parado desde ${job.updatedAt.toISOString()}) → CTE_PENDING_RECONCILIATION [${reason === RECONCILE_REASON_ORPHAN ? 'órfão no Redis' : 'timeout'}]`);
    }

    // Um único alerta resume o reparo inteiro — não um por calc, pra não poluir o painel.
    await prisma.systemAlert.create({
        data: {
            category: 'FISCAL_PROVIDER_ERROR',
            severity: 'WARNING',
            title: 'Reparo manual: CT-e(s) destravado(s) por script de manutenção',
            message: `${toRepair.length} cálculo(s) de CT-e estavam presos em processamento assíncrono (parados há muito tempo ou órfãos no Redis) e foram movidos para reconciliação manual pelo script repair-stuck-cte-jobs.ts.`,
            context: { affectedCalcIds: toRepair.map((r) => r.job.calcId), staleThresholdMinutes: STALE_THRESHOLD_MINUTES },
        },
    });

    console.log(`Reparo concluído: ${toRepair.length} calc(s) movido(s) para CTE_PENDING_RECONCILIATION. Use POST .../emit-cte/reconcile (se já tinha providerDocId) ou POST .../emit-cte (reemissão segura, se nunca chegou a submeter) em cada um.`);
}

main()
    .catch((err) => {
        console.error('Reparo falhou:', err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
        await queue.close();
        connection.disconnect();
    });
