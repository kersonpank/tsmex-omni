import { createRedisConnection } from './redis.js';

const redis = createRedisConnection();
const TTL_SECONDS = 300; // 5-minute TTL; permission changes propagate within this window

export type CachedUser = {
    id: string;
    email: string;
    roles: string[];
    hubId?: string | null;
    permissions?: string[];
    linkId?: string | null;
    accountId?: string | null;
};

export async function getCachedUser(userId: string): Promise<CachedUser | null> {
    try {
        const raw = await redis.get(`user:${userId}`);
        return raw ? (JSON.parse(raw) as CachedUser) : null;
    } catch {
        return null;
    }
}

export async function setCachedUser(userId: string, user: CachedUser): Promise<void> {
    try {
        await redis.set(`user:${userId}`, JSON.stringify(user), 'EX', TTL_SECONDS);
    } catch {
        // non-fatal — cache miss on next request is fine
    }
}

export async function invalidateCachedUser(userId: string): Promise<void> {
    try {
        await redis.del(`user:${userId}`);
    } catch {
        // non-fatal
    }
}
