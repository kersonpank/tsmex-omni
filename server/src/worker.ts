import dotenv from 'dotenv';
import { Worker } from 'bullmq';
import { redisConnection } from './lib/redis.js';
import { CTE_EMISSION_QUEUE_NAME } from './services/queues/cteEmissionQueue.js';
import { processCteEmissionJob } from './services/queues/cteEmissionProcessor.js';

dotenv.config();

const worker = new Worker(CTE_EMISSION_QUEUE_NAME, (job) => processCteEmissionJob(job), {
    connection: redisConnection,
    concurrency: 3,
    // Cinto de segurança abaixo do rate-limit documentado da ACBr (240-360 req/min em endpoints protegidos).
    limiter: { max: 200, duration: 60_000 },
});

worker.on('failed', (job, err) => {
    console.error(JSON.stringify({ level: 'error', source: 'cteEmissionWorker', jobId: job?.id, error: err.message }));
});

worker.on('ready', () => {
    console.log(JSON.stringify({ level: 'info', source: 'cteEmissionWorker', message: 'Worker pronto, consumindo fila cte-emission.' }));
});

process.on('SIGTERM', async () => {
    await worker.close();
    process.exit(0);
});
