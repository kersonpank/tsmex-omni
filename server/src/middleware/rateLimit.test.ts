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
