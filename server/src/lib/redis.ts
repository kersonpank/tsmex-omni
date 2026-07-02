import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL?.trim() || 'redis://redis:6379';

/**
 * Client único, compartilhado por toda a fila BullMQ. `maxRetriesPerRequest: null`
 * é exigido pelo BullMQ (ele mesmo controla os retries de conexão) — sem isso o
 * Worker trava silenciosamente em reconexões.
 */
export const redisConnection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
});

export function isRedisConfigured(): boolean {
    return Boolean(process.env.REDIS_URL?.trim()) || true; // sempre há um default local
}
