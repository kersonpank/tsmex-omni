import { Queue } from 'bullmq';
import { redisConnection } from '../../lib/redis.js';

export const CTE_EMISSION_QUEUE_NAME = 'cte-emission';

export interface CteEmissionJobData {
    calcId: string;
    cteEmissionJobId: string;
    /** 'poll-only' é usado pela reconciliação manual: nunca refaz POST /cte, só consulta status. */
    phaseHint?: 'submit' | 'poll-only';
    /**
     * Marcador durável no Redis (job.data sobrevive a um blip do Postgres): grava o
     * providerDocId assim que a ACBr confirma sucesso, ANTES de tentar persistir no Postgres.
     * Fecha a janela de duplicidade — um retry (automático ou reconciliação manual) que ache
     * esse valor pula direto pra persistência, nunca rechama submitCteToAcbr.
     */
    providerDocIdPending?: string;
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
                // Seguro só por causa do marcador providerDocIdPending acima: um retry nunca
                // rechama a ACBr se o submit anterior já tinha sido confirmado.
                attempts: 5,
                backoff: { type: 'exponential', delay: 5000 },
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

/**
 * `jobId` é sempre `data.cteEmissionJobId` (UUID já único, gerado pelo Postgres em
 * `cteEmissionJob.create`) — nunca deixar o BullMQ gerar um automaticamente. Sem `jobId`
 * explícito, o BullMQ usa um contador incremental próprio guardado no Redis
 * (`bull:cte-emission:id`, `INCR`); se esse contador for perdido (Redis reiniciado sem volume
 * persistido, ou reagendado pro Swarm em outro node com volume `local` vazio), ele volta a
 * `1, 2, 3...` — valores que já existem como `CteEmissionJob.queueJobId` (`@unique`) de jobs
 * antigos no Postgres, e o `.update()` em `freightCalculations.ts` quebra com
 * `P2002 Unique constraint failed on the fields: (queueJobId)`. Usar um UUID nosso elimina essa
 * classe de colisão inteira, e como bônus torna o enqueue idempotente: o BullMQ não duplica
 * nem lança erro ao chamar `add()` de novo com o mesmo `jobId` — essencial pro fluxo de
 * "recover from enqueue failure" já documentado em `freightCalculations.ts` (o retry depois de
 * uma falha de persistência não arrisca enfileirar o mesmo cálculo duas vezes).
 *
 * `queue` é injetável (mesmo padrão de DI de `cteEmissionProcessor.ts`/
 * `distribuicaoNfeSyncProcessor.ts`) pra permitir testar sem tocar Redis de verdade.
 */
export async function enqueueCteEmissionJob(
    data: CteEmissionJobData,
    queue: Pick<Queue<CteEmissionJobData>, 'add'> = getCteEmissionQueue(),
): Promise<string> {
    const job = await queue.add('emit', data, { jobId: data.cteEmissionJobId });
    if (!job.id) throw new Error('BullMQ não retornou id para o job enfileirado.');
    return job.id;
}
