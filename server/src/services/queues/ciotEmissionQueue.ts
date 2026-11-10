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
 *
 * O reenvio de um CIOT recusado reutiliza o mesmo registro (e o mesmo `jobId`). O BullMQ guarda
 * jobs concluídos e ignora em silêncio um `add()` com id já existente: sem remover a tentativa
 * encerrada, o registro ficava `QUEUED` para sempre. Jobs ainda ativos ou na fila não são tocados.
 */
type CiotQueuePort = Pick<Queue<CiotEmissionJobData>, 'add'> & Partial<Pick<Queue<CiotEmissionJobData>, 'getJob'>>;

export async function enqueueCiotEmissionJob(
    data: CiotEmissionJobData,
    queue: CiotQueuePort = getCiotEmissionQueue(),
): Promise<string> {
    const previous = await queue.getJob?.(data.ciotEmissionJobId);
    if (previous && ['completed', 'failed'].includes(await previous.getState())) await previous.remove();
    const job = await queue.add('emit', data, { jobId: data.ciotEmissionJobId });
    if (!job.id) throw new Error('BullMQ não retornou id para o job enfileirado.');
    return job.id;
}
