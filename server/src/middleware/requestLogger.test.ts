import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { requestLogger } from './requestLogger.js';

test('loga JSON sem query string e devolve X-Request-Id', async () => {
    const lines: string[] = [];
    const app = express();
    app.use(requestLogger((l) => lines.push(l)));
    app.get('/api/hubs/:id/cadastro-info', (req, res) => {
        (req as any).user = { id: 'u-1' };
        res.status(403).json({ ok: false });
    });
    const server = app.listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
        const res = await fetch(`${base}/api/hubs/h1/cadastro-info?token=SEGREDO`, { headers: { 'X-Request-Id': 'req-abc-12345' } });
        assert.equal(res.headers.get('x-request-id'), 'req-abc-12345');
        await new Promise((r) => setTimeout(r, 20));
        assert.equal(lines.length, 1);
        const entry = JSON.parse(lines[0]);
        assert.equal(entry.path, '/api/hubs/h1/cadastro-info');
        assert.equal(entry.status, 403);
        assert.equal(entry.level, 'warn');
        assert.equal(entry.userId, 'u-1');
        assert.ok(!lines[0].includes('SEGREDO'));

        const res2 = await fetch(`${base}/api/hubs/h1/cadastro-info`, { headers: { 'X-Request-Id': 'bad id with spaces' } });
        assert.match(res2.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/);
    } finally {
        server.close();
    }
});
