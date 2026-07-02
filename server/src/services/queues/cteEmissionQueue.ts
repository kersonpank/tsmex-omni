import { Queue } from 'bullmq';
import { redisConnection } from '../../lib/redis.js';

export const CTE_EMISSION_QUEUE_NAME = 'cte-emission';

export interface CteEmissionJobData {
    calcId: string;
    cteEmissionJobId: string;
    /** 'poll-only' é usado pela reconciliação manual: nunca refaz POST /cte, só consulta status. */
    phaseHint?: 'submit' | 'poll-only';
}

export const cteEmissionQueue = new Queue<CteEmissionJobData>(CTE_EMISSION_QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
        removeOnComplete: { age: 60 * 60 * 24 * 7 }, // 7 dias de histórico pra auditoria
        removeOnFail: { age: 60 * 60 * 24 * 30 }, // 30 dias — falhas ficam mais tempo pra investigação
    },
});

export async function enqueueCteEmissionJob(data: CteEmissionJobData): Promise<string> {
    const job = await cteEmissionQueue.add('emit', data);
    if (!job.id) throw new Error('BullMQ não retornou id para o job enfileirado.');
    return job.id;
}
