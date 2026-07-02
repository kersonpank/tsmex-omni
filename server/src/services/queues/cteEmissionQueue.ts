import { Queue } from 'bullmq';
import { redisConnection } from '../../lib/redis.js';

export const CTE_EMISSION_QUEUE_NAME = 'cte-emission';

export interface CteEmissionJobData {
    calcId: string;
    cteEmissionJobId: string;
    /** 'poll-only' é usado pela reconciliação manual: nunca refaz POST /cte, só consulta status. */
    phaseHint?: 'submit' | 'poll-only';
}

let queueInstance: Queue<CteEmissionJobData> | null = null;

/**
 * Construção sob demanda. `new Queue(...)` sozinho já dispara conexão real ao Redis — o
 * construtor do BullMQ chama `waitUntilReady()` internamente, então bastaria QUALQUER módulo
 * importar este arquivo (ex.: uma rota HTTP como freightCalculations.ts ou systemAlerts.ts,
 * mesmo em um teste que nunca enfileira nada) para tentar abrir socket com o Redis de verdade.
 * Adiar a construção para o primeiro uso real (enqueue/pause/resume) evita esse efeito
 * colateral e mantém os testes HTTP dessas rotas livres de qualquer dependência de Redis.
 */
export function getCteEmissionQueue(): Queue<CteEmissionJobData> {
    if (!queueInstance) {
        queueInstance = new Queue<CteEmissionJobData>(CTE_EMISSION_QUEUE_NAME, {
            connection: redisConnection,
            defaultJobOptions: {
                removeOnComplete: { age: 60 * 60 * 24 * 7 }, // 7 dias de histórico pra auditoria
                removeOnFail: { age: 60 * 60 * 24 * 30 }, // 30 dias — falhas ficam mais tempo pra investigação
            },
        });
        // BullMQ re-emite qualquer falha de conexão como 'error' na Queue (via
        // RedisConnection.init()). Sem um listener aqui, esse emit acontece sem ouvinte, o
        // que derruba o processo. Recomendação oficial do BullMQ para toda Queue/Worker.
        queueInstance.on('error', (err) => {
            console.error('[cteEmissionQueue] error:', err instanceof Error ? err.message : err);
        });
    }
    return queueInstance;
}

export async function enqueueCteEmissionJob(data: CteEmissionJobData): Promise<string> {
    const job = await getCteEmissionQueue().add('emit', data);
    if (!job.id) throw new Error('BullMQ não retornou id para o job enfileirado.');
    return job.id;
}
