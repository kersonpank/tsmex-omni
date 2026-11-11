/** Segurança das chaves de LLM: nunca em resposta HTTP, cifradas em repouso. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import express from 'express';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { isSealedSecret, openSecret } from '../lib/secretBox.js';

const users: Record<string, string[]> = { 'admin-1': ['ADMIN'], 'client-1': ['CLIENT'], 'hub-1': ['HUB'] };

describe('Settings LLM — segredos', () => {
    const jwtSecret = `it-secret-llm-${Date.now()}`;
    const fiscalKey = 'f'.repeat(64);
    let baseUrl = '';
    let server: ReturnType<express.Express['listen']> | null = null;
    let savedApiKey: string | null = null;
    const original = {
        userFindUnique: prisma.user.findUnique,
        modelFindFirst: prisma.lLMModel.findFirst,
        providerFindUnique: prisma.lLMProvider.findUnique,
        keyUpsert: prisma.lLMApiKey.upsert,
        fiscalKey: process.env.FISCAL_SECRET_KEY,
    };

    async function call(method: string, path: string, user: string, body?: unknown) {
        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers: { authorization: `Bearer ${jwt.sign({ userId: user }, jwtSecret)}`, 'content-type': 'application/json' },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        return { status: response.status, text: await response.text() };
    }

    before(async () => {
        process.env.JWT_SECRET = jwtSecret;
        process.env.FISCAL_SECRET_KEY = fiscalKey;
        prisma.user.findUnique = (async (args: any) => {
            const roles = users[args?.where?.id];
            if (!roles) return null;
            return { id: args.where.id, email: 'x@t.io', roles, active: true, hubId: null, permissions: [], admin: null, client: null, link: null };
        }) as any;
        prisma.lLMModel.findFirst = (async () => ({
            modelId: 'gpt-x',
            provider: { code: 'openai', baseUrl: 'https://api.example.com', apiKey: { active: true, apiKey: 'sk-SEGREDO-123' } },
        })) as any;
        prisma.lLMProvider.findUnique = (async () => ({ id: 'p' })) as any;
        prisma.lLMApiKey.upsert = (async (args: any) => {
            savedApiKey = args.create.apiKey;
            return { id: 'k1', keyPreview: args.create.keyPreview, label: null };
        }) as any;

        const { settingsRouter } = await import('./settings.js');
        const app = express();
        app.use(express.json());
        app.use('/api/settings/llm', settingsRouter);
        app.use(errorHandler);
        server = app.listen(0);
        await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
        const addr = server.address();
        if (!addr || typeof addr === 'string') throw new Error('port');
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    after(async () => {
        if (server) await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())));
        prisma.user.findUnique = original.userFindUnique;
        prisma.lLMModel.findFirst = original.modelFindFirst;
        prisma.lLMProvider.findUnique = original.providerFindUnique;
        prisma.lLMApiKey.upsert = original.keyUpsert;
        if (original.fiscalKey === undefined) delete process.env.FISCAL_SECRET_KEY;
        else process.env.FISCAL_SECRET_KEY = original.fiscalKey;
    });

    it('models/active nega usuários não ADMIN', async () => {
        for (const u of ['client-1', 'hub-1']) {
            const r = await call('GET', '/api/settings/llm/models/active', u);
            assert.equal(r.status, 403);
            assert.ok(!r.text.includes('SEGREDO'));
        }
    });

    it('models/active (ADMIN) não devolve apiKey nem baseUrl', async () => {
        const r = await call('GET', '/api/settings/llm/models/active', 'admin-1');
        assert.equal(r.status, 200);
        assert.ok(!r.text.includes('SEGREDO'));
        const data = JSON.parse(r.text).data;
        assert.deepEqual(data, { modelId: 'gpt-x', providerCode: 'openai', hasApiKey: true });
    });

    it('POST api-keys grava a chave cifrada', async () => {
        const r = await call('POST', '/api/settings/llm/api-keys', 'admin-1', { providerId: '3f2b8c1e-8a47-4c1e-9d0b-1a2b3c4d5e6f', apiKey: 'sk-NOVA-9999' });
        assert.equal(r.status, 200);
        assert.ok(savedApiKey && isSealedSecret(savedApiKey));
        assert.equal(openSecret(savedApiKey!, fiscalKey), 'sk-NOVA-9999');
        assert.ok(!r.text.includes('NOVA-9999'));
    });

    it('POST api-keys falha fechado sem FISCAL_SECRET_KEY', async () => {
        delete process.env.FISCAL_SECRET_KEY;
        try {
            savedApiKey = null;
            const r = await call('POST', '/api/settings/llm/api-keys', 'admin-1', { providerId: '3f2b8c1e-8a47-4c1e-9d0b-1a2b3c4d5e6f', apiKey: 'sk-NOVA-9999' });
            assert.equal(r.status, 500);
            assert.match(r.text, /FISCAL_SECRET_KEY/);
            assert.equal(savedApiKey, null);
        } finally {
            process.env.FISCAL_SECRET_KEY = fiscalKey;
        }
    });
});
