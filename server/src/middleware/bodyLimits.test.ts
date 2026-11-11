import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createJsonBodyParser, isLargeBodyRoute } from './bodyLimits.js';
import { errorHandler } from './errorHandler.js';

test('isLargeBodyRoute reconhece só as rotas de arquivo', () => {
    assert.equal(isLargeBodyRoute('POST', '/api/upload'), true);
    assert.equal(isLargeBodyRoute('POST', '/api/orders/3f2b8c1e-8a47-4c1e-9d0b-1a2b3c4d5e6f/attachments'), true);
    assert.equal(isLargeBodyRoute('POST', '/api/fiscal-emitters/abc/certificate'), true);
    assert.equal(isLargeBodyRoute('POST', '/api/intake/demands/abc/nfe-xml'), true);
    assert.equal(isLargeBodyRoute('GET', '/api/upload'), false);
    assert.equal(isLargeBodyRoute('POST', '/api/auth/login'), false);
    assert.equal(isLargeBodyRoute('POST', '/api/manifests'), false);
});

test('corpo >1MB é recusado (413) fora das rotas de arquivo e aceito nas de arquivo', async () => {
    const app = express();
    app.use(createJsonBodyParser({ defaultLimit: '1kb', largeLimit: '10kb' }));
    app.post('/api/upload', (req, res) => res.json({ ok: true }));
    app.post('/api/other', (req, res) => res.json({ ok: true }));
    app.use(errorHandler);
    const server = app.listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    const port = (server.address() as { port: number }).port;
    const body = JSON.stringify({ x: 'a'.repeat(5000) });
    const post = (path: string) => fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    try {
        assert.equal((await post('/api/other')).status, 413);
        assert.equal((await post('/api/upload')).status, 200);
    } finally {
        await new Promise<void>((r) => server.close(() => r()));
    }
});
