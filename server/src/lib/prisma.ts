import { PrismaClient } from '@prisma/client';

declare global {
    var prisma: PrismaClient | undefined;
}

function buildDatabaseUrl(): string | undefined {
    const base = process.env.DATABASE_URL;
    if (!base) return undefined;
    try {
        const url = new URL(base);
        if (!url.searchParams.has('connection_limit')) {
            url.searchParams.set('connection_limit', process.env.DATABASE_CONNECTION_LIMIT ?? '10');
        }
        if (!url.searchParams.has('pool_timeout')) {
            url.searchParams.set('pool_timeout', process.env.DATABASE_POOL_TIMEOUT ?? '20');
        }
        return url.toString();
    } catch {
        return base;
    }
}

export const prisma = global.prisma || new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    datasources: { db: { url: buildDatabaseUrl() } },
});

if (process.env.NODE_ENV !== 'production') {
    global.prisma = prisma;
}

export default prisma;
