import dotenv from 'dotenv';
import { Worker } from 'bullmq';
import { redisConnection } from './lib/redis.js';
import { CTE_EMISSION_QUEUE_NAME } from './services/queues/cteEmissionQueue.js';
import { processCteEmissionJob, handleCteJobExhausted } from './services/queues/cteEmissionProcessor.js';
import { DISTRIBUICAO_NFE_QUEUE_NAME, ensureDistribuicaoNfeSchedule, type DistribuicaoNfeJobData } from './services/queues/distribuicaoNfeQueue.js';
import { processCoordinatorJob } from './services/queues/distribuicaoNfeCoordinatorProcessor.js';
import { processDistribuicaoNfeSyncJob } from './services/queues/distribuicaoNfeSyncProcessor.js';

dotenv.config();

const worker = new Worker(CTE_EMISSION_QUEUE_NAME, (job) => processCteEmissionJob(job), {
    connection: redisConnection,
    concurrency: 3,
    // Cinto de segurança abaixo do rate-limit documentado da ACBr (240-360 req/min em endpoints protegidos).
    limiter: { max: 200, duration: 60_000 },
});

worker.on('failed', (job, err) => {
    console.error(JSON.stringify({ level: 'error', source: 'cteEmissionWorker', jobId: job?.id, error: err.message }));

    if (!job) return;
    // BullMQ emite 'failed' em TODA tentativa fracassada, não só na última — verificado contra
    // `node_modules/bullmq/dist/cjs/classes/job.js` (`shouldRetryJob`: retenta quando
    // `attemptsMade + 1 < opts.attempts`). Espelha exatamente essa fórmula negada pra só agir
    // quando o BullMQ de fato desistiu — nunca marcar reconciliação/alerta numa tentativa
    // intermediária que ainda vai ser retentada automaticamente.
    const maxAttempts = job.opts.attempts ?? 1;
    const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;
    if (isFinalAttempt) {
        void handleCteJobExhausted(job.data, err).catch((handlerErr) => {
            console.error(JSON.stringify({
                level: 'error',
                source: 'cteEmissionWorker',
                message: 'handleCteJobExhausted falhou ao marcar reconciliação após esgotar tentativas.',
                jobId: job.id,
                error: handlerErr instanceof Error ? handlerErr.message : String(handlerErr),
            }));
        });
    }
});

worker.on('error', (err) => {
    console.error(JSON.stringify({ level: 'error', source: 'cteEmissionWorker', message: 'Worker error', error: err instanceof Error ? err.message : String(err) }));
});

worker.on('ready', () => {
    console.log(JSON.stringify({ level: 'info', source: 'cteEmissionWorker', message: 'Worker pronto, consumindo fila cte-emission.' }));
});

const distribuicaoNfeWorker = new Worker<DistribuicaoNfeJobData>(
    DISTRIBUICAO_NFE_QUEUE_NAME,
    (job) =>
        job.data.kind === 'coordinator'
            ? processCoordinatorJob()
            : processDistribuicaoNfeSyncJob(job as unknown as Parameters<typeof processDistribuicaoNfeSyncJob>[0]),
    {
        connection: redisConnection,
        concurrency: 2,
        limiter: { max: 200, duration: 60_000 },
    },
);

distribuicaoNfeWorker.on('failed', (job, err) => {
    console.error(JSON.stringify({ level: 'error', source: 'distribuicaoNfeWorker', jobId: job?.id, error: err.message }));
});

distribuicaoNfeWorker.on('error', (err) => {
    console.error(JSON.stringify({ level: 'error', source: 'distribuicaoNfeWorker', message: 'Worker error', error: err instanceof Error ? err.message : String(err) }));
});

distribuicaoNfeWorker.on('ready', () => {
    console.log(JSON.stringify({ level: 'info', source: 'distribuicaoNfeWorker', message: 'Worker pronto, consumindo fila distribuicao-nfe.' }));
});

// Garante o repeatable job 2x/dia assim que o worker sobe (idempotente — BullMQ deduplica
// repeatables com o mesmo jobId/opções). CJS não permite top-level await (sem "type":"module"
// no package.json deste projeto), daí a IIFE em vez de `await` direto no topo do módulo.
void (async () => {
    try {
        await ensureDistribuicaoNfeSchedule();
    } catch (err) {
        console.error(JSON.stringify({ level: 'error', source: 'distribuicaoNfeWorker', message: 'Falha ao registrar o agendamento 2x/dia.', error: err instanceof Error ? err.message : String(err) }));
    }
})();

process.on('SIGTERM', async () => {
    await Promise.all([worker.close(), distribuicaoNfeWorker.close()]);
    process.exit(0);
});
