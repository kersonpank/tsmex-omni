import { Queue } from 'bullmq';
import { createRedisConnection } from '../../lib/redis.js';

export const DISTRIBUICAO_NFE_QUEUE_NAME = 'distribuicao-nfe';

export type DistribuicaoNfeJobData =
    | { kind: 'coordinator' }
    | { kind: 'sync-emitter'; fiscalEmitterId: string };

let queueInstance: Queue<DistribuicaoNfeJobData> | null = null;

/** Construção sob demanda — mesma razão documentada em `cteEmissionQueue.ts:getCteEmissionQueue`. */
export function getDistribuicaoNfeQueue(): Queue<DistribuicaoNfeJobData> {
    if (!queueInstance) {
        queueInstance = new Queue<DistribuicaoNfeJobData>(DISTRIBUICAO_NFE_QUEUE_NAME, {
            connection: createRedisConnection(),
            defaultJobOptions: {
                removeOnComplete: { age: 60 * 60 * 24 * 7 },
                removeOnFail: { age: 60 * 60 * 24 * 30 },
            },
        });
        queueInstance.on('error', (err) => {
            console.error('[distribuicaoNfeQueue] error:', err instanceof Error ? err.message : err);
        });
    }
    return queueInstance;
}

/**
 * Garante o repeatable job 2x/dia (13h e 23h, America/Sao_Paulo). Idempotente: BullMQ
 * deduplica repeatables com o mesmo `jobId`+opções de `repeat`, então chamar isto toda vez
 * que o worker sobe não cria agendamentos duplicados.
 */
export async function ensureDistribuicaoNfeSchedule(): Promise<void> {
    await getDistribuicaoNfeQueue().add(
        'coordinator',
        { kind: 'coordinator' },
        {
            repeat: { pattern: '0 13,23 * * *', tz: 'America/Sao_Paulo' },
            jobId: 'distribuicao-nfe-coordinator',
        },
    );
}

/**
 * Enfileira a sincronização de um emitente. `jobId` determinístico evita duas sincronizações
 * concorrentes do mesmo CNPJ pisando no mesmo `FiscalDistribuicaoCheckpoint`.
 *
 * BullMQ não reexecuta um job cujo `jobId` já existe em qualquer estado — inclusive
 * `completed`/`failed`. Sem remover o job anterior nesses dois estados, o botão manual
 * ("Buscar agora") fica inoperante por `removeOnComplete`/`removeOnFail` (dias) depois da
 * primeira execução, sem nenhum aviso. Só pulamos a remoção quando o job anterior ainda está
 * em andamento (`active`/`waiting`/`delayed`), preservando a proteção de concorrência original.
 */
export async function enqueueSyncEmitterJob(fiscalEmitterId: string): Promise<string> {
    const queue = getDistribuicaoNfeQueue();
    const jobId = `sync-emitter-${fiscalEmitterId}`;

    const existing = await queue.getJob(jobId);
    if (existing) {
        const state = await existing.getState();
        if (state === 'completed' || state === 'failed' || state === 'unknown') {
            await existing.remove();
        }
    }

    const job = await queue.add(
        'sync-emitter',
        { kind: 'sync-emitter', fiscalEmitterId },
        { jobId },
    );
    if (!job.id) throw new Error('BullMQ não retornou id para o job enfileirado.');
    return job.id;
}
