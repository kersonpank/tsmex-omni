import dotenv from 'dotenv';
import { Worker } from 'bullmq';
import { redisConnection } from './lib/redis.js';
import { CTE_EMISSION_QUEUE_NAME, getCteEmissionQueue } from './services/queues/cteEmissionQueue.js';
import { processCteEmissionJob, handleCteJobExhausted } from './services/queues/cteEmissionProcessor.js';
import { DISTRIBUICAO_NFE_QUEUE_NAME, ensureDistribuicaoNfeSchedule, type DistribuicaoNfeJobData } from './services/queues/distribuicaoNfeQueue.js';
import { processCoordinatorJob } from './services/queues/distribuicaoNfeCoordinatorProcessor.js';
import { processDistribuicaoNfeSyncJob } from './services/queues/distribuicaoNfeSyncProcessor.js';
import { CIOT_EMISSION_QUEUE_NAME } from './services/queues/ciotEmissionQueue.js';
import { processCiotEmissionJob, handleCiotJobExhausted } from './services/queues/ciotEmissionProcessor.js';

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

// Sem estes 3 listeners, os logs não distinguem "job nunca foi retirado da fila" (ex.: fila
// pausada silenciosamente — ver Onda 4) de "job foi pego e travou em algum ponto do
// processamento". `active`/`completed` dão rastro positivo mínimo; `stalled` denuncia um job
// que o BullMQ considerou perdido (worker morreu no meio do processamento).
worker.on('active', (job) => {
    console.log(JSON.stringify({ level: 'info', source: 'cteEmissionWorker', event: 'active', jobId: job.id, calcId: job.data.calcId }));
});

worker.on('completed', (job) => {
    console.log(JSON.stringify({ level: 'info', source: 'cteEmissionWorker', event: 'completed', jobId: job.id, calcId: job.data.calcId }));
});

worker.on('stalled', (jobId) => {
    console.error(JSON.stringify({ level: 'error', source: 'cteEmissionWorker', event: 'stalled', jobId }));
});

worker.on('ready', () => {
    console.log(JSON.stringify({ level: 'info', source: 'cteEmissionWorker', message: 'Worker pronto, consumindo fila cte-emission.' }));

    // Todo boot deixa rastro se a fila subiu pausada — sem isso, um pause() antigo (ex.: 402 da
    // ACBr cujo alerta associado foi resolvido sem o resume() ter sido de fato chamado)
    // sobrevive silenciosamente a qualquer reinício de container, indefinidamente.
    void getCteEmissionQueue().isPaused().then((paused) => {
        console.log(JSON.stringify({ level: paused ? 'error' : 'info', source: 'cteEmissionWorker', message: `Estado da fila no boot: paused=${paused}` }));
    }).catch((err) => {
        console.error(JSON.stringify({ level: 'error', source: 'cteEmissionWorker', message: 'Falha ao checar isPaused() no boot.', error: err instanceof Error ? err.message : String(err) }));
    });
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

const ciotWorker = new Worker(CIOT_EMISSION_QUEUE_NAME, (job) => processCiotEmissionJob(job), {
    connection: redisConnection,
    concurrency: 3,
});

ciotWorker.on('failed', (job, err) => {
    console.error(JSON.stringify({ level: 'error', source: 'ciotEmissionWorker', jobId: job?.id, error: err.message }));

    if (!job) return;
    const maxAttempts = job.opts.attempts ?? 1;
    const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;
    if (isFinalAttempt) {
        void handleCiotJobExhausted(job.data, err).catch((handlerErr) => {
            console.error(JSON.stringify({
                level: 'error',
                source: 'ciotEmissionWorker',
                message: 'handleCiotJobExhausted falhou ao marcar reconciliação após esgotar tentativas.',
                jobId: job.id,
                error: handlerErr instanceof Error ? handlerErr.message : String(handlerErr),
            }));
        });
    }
});

ciotWorker.on('error', (err) => {
    console.error(JSON.stringify({ level: 'error', source: 'ciotEmissionWorker', message: 'Worker error', error: err instanceof Error ? err.message : String(err) }));
});

ciotWorker.on('ready', () => {
    console.log(JSON.stringify({ level: 'info', source: 'ciotEmissionWorker', message: 'Worker pronto, consumindo fila ciot-emission.' }));
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
    await Promise.all([worker.close(), distribuicaoNfeWorker.close(), ciotWorker.close()]);
    process.exit(0);
});
