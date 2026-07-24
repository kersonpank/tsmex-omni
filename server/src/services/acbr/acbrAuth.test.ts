import assert from 'node:assert/strict';
import { describe, it, beforeEach, after, mock } from 'node:test';

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

describe('getAcbrAccessToken — cache persistente é por escopo (não um slot único)', () => {
    beforeEach(() => {
        clearAcbrTokenCache();
        process.env.ACBR_CLIENT_ID = 'test-client';
        process.env.ACBR_CLIENT_SECRET = 'test-secret';
    });

    it('busca sequencial de A, depois B, depois A de novo: A2 reaproveita o cache (2 fetches no total, não 3)', async () => {
        const originalFetch = globalThis.fetch;
        const fetchMock = mock.fn(async (_url: string, init?: RequestInit) => {
            const body = String(init?.body ?? '');
            const scope = new URLSearchParams(body).get('scope') ?? '';
            return new Response(JSON.stringify({ access_token: `tok-${scope.replace(/\s+/g, '-')}`, expires_in: 3600 }), { status: 200 });
        });
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        try {
            const scopeA = ['empresa', 'cte'];
            const scopeB = ['empresa', 'mdfe'];

            // Regressão do bug do slot único: A é buscado e cacheado (fetch #1). B é buscado
            // e cacheado (fetch #2) — com o slot único isso sobrescreveria a entrada de A.
            // Uma terceira chamada, de novo para A, ainda dentro da validade, deve vir do
            // cache (0 fetches adicionais) — com o slot único ela erraria o cache (o slot
            // agora contém B) e dispararia um 3º fetch desnecessário.
            const tokenA1 = await getAcbrAccessToken(scopeA);
            const tokenB = await getAcbrAccessToken(scopeB);
            const tokenA2 = await getAcbrAccessToken(scopeA);

            assert.equal(fetchMock.mock.callCount(), 2, 'A segunda busca por A deveria vir do cache, não disparar um 3º fetch');
            assert.equal(tokenA1, tokenA2, 'a segunda busca por A deve retornar o mesmo token cacheado da primeira');
            assert.notEqual(tokenA1, tokenB, 'escopos diferentes devem produzir tokens diferentes');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});

describe('getAcbrAccessToken — credencial por ambiente (Sandbox vs Produção são pares diferentes)', () => {
    const originalSandboxId = process.env.ACBR_CLIENT_ID;
    const originalSandboxSecret = process.env.ACBR_CLIENT_SECRET;
    const originalProdId = process.env.ACBR_CLIENT_ID_PRODUCAO;
    const originalProdSecret = process.env.ACBR_CLIENT_SECRET_PRODUCAO;

    beforeEach(() => {
        clearAcbrTokenCache();
        process.env.ACBR_CLIENT_ID = 'sandbox-client';
        process.env.ACBR_CLIENT_SECRET = 'sandbox-secret';
        process.env.ACBR_CLIENT_ID_PRODUCAO = 'prod-client';
        process.env.ACBR_CLIENT_SECRET_PRODUCAO = 'prod-secret';
    });

    after(() => {
        if (originalSandboxId === undefined) delete process.env.ACBR_CLIENT_ID; else process.env.ACBR_CLIENT_ID = originalSandboxId;
        if (originalSandboxSecret === undefined) delete process.env.ACBR_CLIENT_SECRET; else process.env.ACBR_CLIENT_SECRET = originalSandboxSecret;
        if (originalProdId === undefined) delete process.env.ACBR_CLIENT_ID_PRODUCAO; else process.env.ACBR_CLIENT_ID_PRODUCAO = originalProdId;
        if (originalProdSecret === undefined) delete process.env.ACBR_CLIENT_SECRET_PRODUCAO; else process.env.ACBR_CLIENT_SECRET_PRODUCAO = originalProdSecret;
    });

    it('HOMOLOGACAO (padrão) usa ACBR_CLIENT_ID/SECRET; PRODUCAO usa as variantes _PRODUCAO — nunca mistura', async () => {
        const originalFetch = globalThis.fetch;
        const fetchMock = mock.fn(async (_url: string, init?: RequestInit) => {
            const body = String(init?.body ?? '');
            const clientId = new URLSearchParams(body).get('client_id') ?? '';
            return new Response(JSON.stringify({ access_token: `tok-for-${clientId}`, expires_in: 3600 }), { status: 200 });
        });
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        try {
            const scopes = ['empresa', 'nfe', 'distribuicao-nfe'];
            const tokenHom = await getAcbrAccessToken(scopes);
            const tokenProd = await getAcbrAccessToken(scopes, 'PRODUCAO');

            assert.equal(tokenHom, 'tok-for-sandbox-client');
            assert.equal(tokenProd, 'tok-for-prod-client');
            assert.equal(fetchMock.mock.callCount(), 2, 'ambientes diferentes não compartilham cache, mesmo com o mesmo escopo');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('PRODUCAO sem ACBR_CLIENT_ID_PRODUCAO/SECRET_PRODUCAO configurados lança erro claro, não tenta usar credencial sandbox', async () => {
        delete process.env.ACBR_CLIENT_ID_PRODUCAO;
        delete process.env.ACBR_CLIENT_SECRET_PRODUCAO;

        await assert.rejects(
            () => getAcbrAccessToken(['empresa', 'cte'], 'PRODUCAO'),
            /ACBR_CLIENT_ID_PRODUCAO e ACBR_CLIENT_SECRET_PRODUCAO/,
        );
    });
});
