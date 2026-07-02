import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL?.trim() || 'redis://redis:6379';

/**
 * Client único, compartilhado por toda a fila BullMQ. `maxRetriesPerRequest: null`
 * é exigido pelo BullMQ (ele mesmo controla os retries de conexão) — sem isso o
 * Worker trava silenciosamente em reconexões.
 */
export const redisConnection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    // Sem isso, `new IORedis(...)` já dispara a conexão TCP no momento do import do módulo —
    // basta um arquivo importar `cteEmissionQueue.ts` (mesmo sem nunca enfileirar nada) pra
    // tentar falar com o host 'redis' e falhar fora do Docker. Com lazyConnect, o BullMQ conecta
    // sozinho só quando alguém de fato manda um comando (add/worker), que é o único caso que
    // precisa de Redis de verdade.
    lazyConnect: true,
});

// Sem este listener, qualquer falha de conexão (ex.: host 'redis' inalcançável fora do
// Docker, blip de rede em produção) vira uma rejeição/erro não tratado e pode derrubar o
// processo. O client de ioredis já reconecta sozinho via retryStrategy — aqui só evitamos o
// crash e deixamos rastro no log.
redisConnection.on('error', (err) => {
    console.error('[redis] connection error:', err instanceof Error ? err.message : err);
});

export function isRedisConfigured(): boolean {
    return Boolean(process.env.REDIS_URL?.trim()) || true; // sempre há um default local
}
