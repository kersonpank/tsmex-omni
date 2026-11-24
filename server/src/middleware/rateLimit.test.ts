import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { applyRateLimits } from './rateLimit.js';

async function start(env: Record<string, string | undefined>) {
    const app = express();
    app.set('trust proxy', 1);
    applyRateLimits(app, env);
    app.get('/health', (_req, res) => res.json({ ok: true }));
    app.post('/api/auth/login', (_req, res) => res.json({ ok: true }));
    app.get('/api/orders', (_req, res) => res.json({ ok: true }));
    const server = app.listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    return { base, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test('login recebe 429 após o limite; health e demais rotas não são afetados', async () => {
    const s = await start({ NODE_ENV: 'production', RATE_LIMIT_AUTH_PER_MIN: '3', RATE_LIMIT_GENERAL_PER_MIN: '5' });
    try {
        const codes: number[] = [];
        for (let i = 0; i < 5; i++) codes.push((await fetch(`${s.base}/api/auth/login`, { method: 'POST' })).status);
        assert.deepEqual(codes.slice(0, 3), [200, 200, 200]);
        assert.equal(codes[3], 429);
        // geral (5/min) já consumido pelas chamadas acima: health continua livre
        for (let i = 0; i < 10; i++) assert.equal((await fetch(`${s.base}/health`)).status, 200);
        assert.equal((await fetch(`${s.base}/api/orders`)).status, 429);
    } finally {
        await s.close();
    }
});

test('desligado em NODE_ENV=test e com RATE_LIMIT_DISABLED=true', async () => {
    for (const env of [{ NODE_ENV: 'test', RATE_LIMIT_AUTH_PER_MIN: '1' }, { NODE_ENV: 'production', RATE_LIMIT_DISABLED: 'true', RATE_LIMIT_AUTH_PER_MIN: '1' }]) {
        const s = await start(env);
        try {
            for (let i = 0; i < 5; i++) assert.equal((await fetch(`${s.base}/api/auth/login`, { method: 'POST' })).status, 200);
        } finally {
            await s.close();
        }
    }
});

test('com Redis, duas réplicas compartilham o mesmo limite', { skip: !process.env.REDIS_URL }, async () => {
    const { default: IORedis } = await import('ioredis');
    const redis = new IORedis(process.env.REDIS_URL!);
    const env = { NODE_ENV: 'production', RATE_LIMIT_AUTH_PER_MIN: '3' };
    const mk = async () => {
        const app = express();
        app.set('trust proxy', 1);
        applyRateLimits(app, env, { redis });
        app.post('/api/auth/login', (_req, res) => res.json({ ok: true }));
        const server = app.listen(0);
        await new Promise<void>((r) => server.once('listening', () => r()));
        return { base: `http://127.0.0.1:${(server.address() as { port: number }).port}`, server };
    };
    const a = await mk();
    const b = await mk();
    try {
        const keys = await redis.keys('rl:auth:*');
        if (keys.length) await redis.del(...keys);
        const codes: number[] = [];
        for (const base of [a.base, b.base, a.base, b.base]) codes.push((await fetch(`${base}/api/auth/login`, { method: 'POST' })).status);
        assert.deepEqual(codes, [200, 200, 200, 429]);
    } finally {
        a.server.close();
        b.server.close();
        const keys = await redis.keys('rl:*');
        if (keys.length) await redis.del(...keys);
        redis.disconnect();
    }
});

test('Redis fora do ar não bloqueia a requisição (passa e loga)', async () => {
    const broken = {
        eval: async () => { throw new Error('ECONNREFUSED'); },
        del: async () => 0,
    };
    const app = express();
    applyRateLimits(app, { NODE_ENV: 'production', RATE_LIMIT_AUTH_PER_MIN: '1' }, { redis: broken });
    app.post('/api/auth/login', (_req, res) => res.json({ ok: true }));
    const server = app.listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
        for (let i = 0; i < 3; i++) assert.equal((await fetch(`${base}/api/auth/login`, { method: 'POST' })).status, 200);
    } finally {
        server.close();
    }
});
