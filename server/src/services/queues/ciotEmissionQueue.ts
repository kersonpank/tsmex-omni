import { Queue } from 'bullmq';
import { createRedisConnection } from '../../lib/redis.js';

export const CIOT_EMISSION_QUEUE_NAME = 'ciot-emission';

export interface CiotEmissionJobData {
    ciotEmissionJobId: string;
}

let queueInstance: Queue<CiotEmissionJobData> | null = null;

/** Construção sob demanda — mesmo motivo de `cteEmissionQueue.ts`: adiar a conexão Redis real até o primeiro uso. */
export function getCiotEmissionQueue(): Queue<CiotEmissionJobData> {
    if (!queueInstance) {
        queueInstance = new Queue<CiotEmissionJobData>(CIOT_EMISSION_QUEUE_NAME, {
            connection: createRedisConnection(),
            defaultJobOptions: {
                removeOnComplete: { age: 60 * 60 * 24 * 7 },
                removeOnFail: { age: 60 * 60 * 24 * 30 },
            },
        });
        queueInstance.on('error', (err) => {
            console.error('[ciotEmissionQueue] error:', err instanceof Error ? err.message : err);
        });
    }
    return queueInstance;
}

/**
 * `jobId` é sempre `data.ciotEmissionJobId` (UUID gerado no `create` do Postgres) — mesmo
 * racional de `enqueueCteEmissionJob`: torna o enqueue idempotente e evita colisão com o
 * contador incremental interno do BullMQ.
 */
export async function enqueueCiotEmissionJob(
    data: CiotEmissionJobData,
    queue: Pick<Queue<CiotEmissionJobData>, 'add'> = getCiotEmissionQueue(),
): Promise<string> {
    const job = await queue.add('emit', data, { jobId: data.ciotEmissionJobId });
    if (!job.id) throw new Error('BullMQ não retornou id para o job enfileirado.');
    return job.id;
}
