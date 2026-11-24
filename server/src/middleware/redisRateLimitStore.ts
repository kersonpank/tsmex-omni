import type { ClientRateLimitInfo, Options, Store } from 'express-rate-limit';

/**
 * Cliente mínimo que o store usa (subconjunto do ioredis) — permite teste sem Redis real.
 */
export interface RateLimitRedisClient {
    eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
    del(...keys: string[]): Promise<number>;
}

// INCR + expira só na primeira batida da janela; devolve [hits, ttlMs].
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {hits, ttl}
`;

const DECREMENT_SCRIPT = `
local v = redis.call('GET', KEYS[1])
if v and tonumber(v) > 0 then return redis.call('DECR', KEYS[1]) end
return 0
`;

/**
 * Store do express-rate-limit no Redis: a contagem é compartilhada entre as réplicas da API
 * (com 2 réplicas e store em memória o limite efetivo dobrava e variava por réplica).
 * Falha do Redis propaga erro — o limiter é criado com `passOnStoreError: true`
 * (operação não para por causa do Redis; o erro vai para o log).
 */
export class RedisRateLimitStore implements Store {
    windowMs = 60_000;
    readonly localKeys = false;
    readonly prefix: string;

    constructor(private readonly client: RateLimitRedisClient, prefix: string) {
        this.prefix = `rl:${prefix}:`;
    }

    init(options: Options): void {
        this.windowMs = options.windowMs;
    }

    private key(key: string): string {
        return `${this.prefix}${key}`;
    }

    async increment(key: string): Promise<ClientRateLimitInfo> {
        const result = (await this.client.eval(INCREMENT_SCRIPT, 1, this.key(key), this.windowMs)) as [number, number];
        const totalHits = Number(result[0]);
        const ttl = Number(result[1]);
        return { totalHits, resetTime: new Date(Date.now() + (ttl > 0 ? ttl : this.windowMs)) };
    }

    async decrement(key: string): Promise<void> {
        await this.client.eval(DECREMENT_SCRIPT, 1, this.key(key));
    }

    async resetKey(key: string): Promise<void> {
        await this.client.del(this.key(key));
    }
}
