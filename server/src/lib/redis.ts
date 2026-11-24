import IORedis, { type RedisOptions } from 'ioredis';

export const REDIS_URL = process.env.REDIS_URL?.trim() || 'redis://redis:6379';

/**
 * Configurações de conexão Redis compartilhadas para BullMQ (Queues e Workers).
 * - `keepAlive: 10000`: envia TCP keepalive a cada 10s pra impedir que o roteador overlay (IPVS)
 *   do Docker Swarm derrube silenciosamente o socket bloqueante de escuta (`BLMOVE`/`BRPOPLPUSH`)
 *   após 15 min de ociosidade.
 * - `maxRetriesPerRequest: null`: exigência estrita do BullMQ para retentativas de comandos.
 * - `enableReadyCheck: false`: evita checagens de estado desnecessárias em reconexões rápidas.
 * - `enableOfflineQueue: true`: garante enfileiramento temporário durante pequenas oscilações de rede.
 * - `retryStrategy`: reconexão automática com backoff exponencial limitado a 2s.
 */
export const redisOptions: RedisOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    enableOfflineQueue: true,
    keepAlive: 10000,
    retryStrategy(times) {
        const delay = Math.min(times * 100, 2000);
        return delay;
    },
};

/**
 * Cria uma nova instância de `IORedis` dedicada com as opções otimizadas para BullMQ/Swarm.
 */
export function createRedisConnection(customUrl: string = REDIS_URL): IORedis {
    const client = new IORedis(customUrl, redisOptions);
    client.on('error', (err) => {
        console.error('[redis] connection error:', err instanceof Error ? err.message : err);
    });
    return client;
}

export function isRedisConfigured(): boolean {
    return Boolean(process.env.REDIS_URL?.trim()) || true;
}

/**
 * Conexão curta para o rate limit: sem fila offline e com 1 tentativa, para que uma queda do
 * Redis libere a requisição na hora (`passOnStoreError`) em vez de segurar o login.
 * Retorna `undefined` sem `REDIS_URL` (dev local sem Redis conta em memória).
 */
export function createRateLimitRedis(url: string | undefined = process.env.REDIS_URL?.trim()): IORedis | undefined {
    if (!url) return undefined;
    const client = new IORedis(url, {
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        keepAlive: 10000,
        lazyConnect: false,
        retryStrategy: (times) => Math.min(times * 200, 2000),
    });
    client.on('error', (err) => {
        console.error('[redis:rate-limit] connection error:', err instanceof Error ? err.message : err);
    });
    return client;
}
