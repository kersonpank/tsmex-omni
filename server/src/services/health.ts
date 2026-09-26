import IORedis from 'ioredis';
import prisma from '../lib/prisma.js';
import { REDIS_URL } from '../lib/redis.js';

export const WORKER_HEARTBEAT_KEY = 'tsmex:worker:heartbeat';
const redis = new IORedis(REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 1500,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
});
redis.on('error', () => undefined);

async function within<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('health timeout')), ms)),
    ]);
}

export async function getApiHealth() {
    const [database, worker] = await Promise.all([
        within(prisma.$queryRaw`SELECT 1`, 2000).then(() => true, () => false),
        within(redis.get(WORKER_HEARTBEAT_KEY), 2000)
            .then((heartbeat) => heartbeat != null && Date.now() - Number(heartbeat) < 30_000, () => false),
    ]);
    return { status: database && worker ? 'ok' : 'degraded', database, worker, timestamp: new Date().toISOString() };
}
