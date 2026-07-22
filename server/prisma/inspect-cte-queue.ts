import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const prisma = new PrismaClient();

// Autocontido de propósito: a imagem `migrate` (onde este script roda) só copia `server/prisma`
// no build (ver Dockerfile.migrate) — nunca `server/src`. Importar de `../src/...` quebra em
// runtime com MODULE_NOT_FOUND. Mesmo padrão já seguido por `repair-stuck-cte-jobs.ts` (só usa
// `@prisma/client`); aqui duplicamos a config mínima de fila/Redis em vez de importar de `src/`.
const CTE_EMISSION_QUEUE_NAME = 'cte-emission';
const REDIS_URL = process.env.REDIS_URL?.trim() || 'redis://redis:6379';
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
const queue = new Queue(CTE_EMISSION_QUEUE_NAME, { connection });

/**
 * Diagnóstico read-only (não altera nada): responde a única pergunta que os logs atuais não
 * conseguem responder — a fila cte-emission está pausada? Um POST /emit-cte bem-sucedido (202)
 * só prova que o job foi ENFILEIRADO; se a fila estiver pausada, o BullMQ nunca o retira da
 * fila, e não existe hoje nenhum log que revele isso (ver Onda 4, plano de investigação).
 *
 * Uso: passe o(s) calcId(s) a inspecionar como argumentos de linha de comando.
 * npx tsx prisma/inspect-cte-queue.ts <calcId1> [calcId2...]
 */
async function main() {
    const calcIds = process.argv.slice(2);

    const [isPaused, waiting, active, delayed, failed, completed] = await Promise.all([
        queue.isPaused(),
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getDelayedCount(),
        queue.getFailedCount(),
        queue.getCompletedCount(),
    ]);

    console.log('=== Estado da fila cte-emission ===');
    console.log(`paused: ${isPaused}`);
    console.log(`waiting: ${waiting} | active: ${active} | delayed: ${delayed} | failed: ${failed} | completed: ${completed}`);
    if (isPaused) {
        console.log('!!! FILA PAUSADA — nenhum job é processado enquanto isso não for revertido (queue.resume()).');
    }

    if (calcIds.length > 0) {
        console.log('\n=== CteEmissionJob por calc ===');
        for (const calcId of calcIds) {
            const jobs = await prisma.cteEmissionJob.findMany({
                where: { calcId },
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    phase: true,
                    providerDocId: true,
                    queueJobId: true,
                    attemptCount: true,
                    maxAttempts: true,
                    lastError: true,
                    pausedForQuota: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });
            if (jobs.length === 0) {
                console.log(`  calc ${calcId}: nenhum CteEmissionJob encontrado.`);
                continue;
            }
            for (const job of jobs) {
                console.log(`  calc ${calcId} → job ${job.id}`);
                console.log(`    phase=${job.phase} providerDocId=${job.providerDocId ?? 'nenhum'} queueJobId=${job.queueJobId ?? 'nenhum'}`);
                console.log(`    attemptCount=${job.attemptCount}/${job.maxAttempts} pausedForQuota=${job.pausedForQuota}`);
                console.log(`    lastError=${job.lastError ?? 'nenhum'}`);
                console.log(`    createdAt=${job.createdAt.toISOString()} updatedAt=${job.updatedAt.toISOString()}`);

                if (job.queueJobId) {
                    const bullJob = await queue.getJob(job.queueJobId);
                    if (!bullJob) {
                        console.log(`    [BullMQ] job ${job.queueJobId} NÃO existe mais no Redis (removido/expirado).`);
                    } else {
                        const state = await bullJob.getState();
                        console.log(`    [BullMQ] estado atual: ${state} | attemptsMade=${bullJob.attemptsMade} | data=${JSON.stringify(bullJob.data)}`);
                    }
                }
            }
        }
    }

    console.log('\n=== Credenciais ACBr (presença, não valor) ===');
    console.log(`ACBR_CLIENT_ID definido: ${Boolean(process.env.ACBR_CLIENT_ID?.trim())}`);
    console.log(`ACBR_CLIENT_SECRET definido: ${Boolean(process.env.ACBR_CLIENT_SECRET?.trim())}`);
}

main()
    .catch((err) => {
        console.error('Diagnóstico falhou:', err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
        await queue.close();
        connection.disconnect();
    });
