import assert from 'node:assert/strict';
import { describe, it, beforeEach, mock } from 'node:test';

import { getAcbrAccessToken, clearAcbrTokenCache } from './acbrAuth.js';

describe('getAcbrAccessToken — cache reuse', () => {
    beforeEach(() => {
        clearAcbrTokenCache();
        process.env.ACBR_CLIENT_ID = 'test-client';
        process.env.ACBR_CLIENT_SECRET = 'test-secret';
    });

    it('faz apenas 1 chamada HTTP ao endpoint de token mesmo com múltiplas chamadas seguidas (simula N jobs do worker)', async () => {
        const originalFetch = globalThis.fetch;
        const fetchMock = mock.fn(async () => new Response(JSON.stringify({ access_token: 'tok-123', expires_in: 3600 }), { status: 200 }));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        try {
            const scopes = ['empresa', 'cte'];
            const tokens = await Promise.all([
                getAcbrAccessToken(scopes),
                getAcbrAccessToken(scopes),
                getAcbrAccessToken(scopes),
                getAcbrAccessToken(scopes),
                getAcbrAccessToken(scopes),
            ]);

            assert.ok(tokens.every((t) => t === 'tok-123'), 'todas as chamadas devem retornar o mesmo token cacheado');
            assert.equal(fetchMock.mock.callCount(), 1, 'o endpoint de token só pode ser chamado 1 vez para N jobs dentro da janela de validade');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
