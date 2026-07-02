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

describe('getAcbrAccessToken — dedup em voo é por escopo (não um slot único)', () => {
    beforeEach(() => {
        clearAcbrTokenCache();
        process.env.ACBR_CLIENT_ID = 'test-client';
        process.env.ACBR_CLIENT_SECRET = 'test-secret';
    });

    it('duas chamadas concorrentes para escopos DIFERENTES disparam exatamente 1 fetch cada (2 no total), sem se sobreporem', async () => {
        const originalFetch = globalThis.fetch;
        // Resolve o fetch de forma assíncrona (via setImmediate) pra garantir que as chamadas
        // concorrentes realmente se sobreponham no tempo antes de qualquer uma resolver.
        const fetchMock = mock.fn(async (_url: string, init?: RequestInit) => {
            const body = String(init?.body ?? '');
            const scope = new URLSearchParams(body).get('scope') ?? '';
            await new Promise((resolve) => setImmediate(resolve));
            return new Response(JSON.stringify({ access_token: `tok-${scope.replace(/\s+/g, '-')}`, expires_in: 3600 }), { status: 200 });
        });
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        try {
            const scopeA = ['empresa', 'cte'];
            const scopeB = ['empresa', 'mdfe'];

            // Reproduz exatamente o cenário do bug do slot único: A começa (ocupa o slot),
            // B começa enquanto A ainda está em voo (sobrescreveria o slot único), e então
            // um SEGUNDO request para A chega enquanto A e B ainda estão os dois em voo — no
            // slot único isso falharia o match de escopo (slot agora é B) e dispararia um
            // fetch duplicado para A. Com o Map por escopo, deve deduplicar corretamente.
            const p1 = getAcbrAccessToken(scopeA);
            const p2 = getAcbrAccessToken(scopeB);
            const p3 = getAcbrAccessToken(scopeA);

            const [tokenA1, tokenB, tokenA2] = await Promise.all([p1, p2, p3]);

            assert.equal(fetchMock.mock.callCount(), 2, 'exatamente 1 fetch por escopo distinto, não 1 total nem mais que 2 (o bug do slot único dispararia 3)');
            assert.equal(tokenA1, tokenA2, 'as duas chamadas do escopo A (intercaladas com B) devem compartilhar o mesmo token');
            assert.notEqual(tokenA1, tokenB, 'escopos diferentes devem produzir tokens diferentes (não devem colidir no cache/dedup)');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
