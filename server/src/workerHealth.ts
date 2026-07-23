import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { redisOptions, REDIS_URL } from './lib/redis.js';

const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
});

async function checkHealth(): Promise<void> {
    const redis = new IORedis(REDIS_URL, {
        ...redisOptions,
        connectTimeout: 3000,
        maxRetriesPerRequest: 1,
        lazyConnect: false,
    });

    try {
        const ping = await redis.ping();
        if (ping !== 'PONG') {
            throw new Error(`Redis ping inesperado: ${ping}`);
        }
        await prisma.$queryRaw`SELECT 1`;
        process.exit(0);
    } catch (error) {
        console.error('Worker health check FAILED:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    } finally {
        await redis.disconnect();
        await prisma.$disconnect();
    }
}

void checkHealth();
