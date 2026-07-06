import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { acbrFetchJson } from './acbrHttp.js';
import { clearAcbrTokenCache } from './acbrAuth.js';

const originalFetch = globalThis.fetch;

function restoreAcbrEnv(snapshot: Record<string, string | undefined>): void {
    for (const [key, value] of Object.entries(snapshot)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
}

describe('acbrFetchJson — timeout', () => {
    afterEach(() => {
        globalThis.fetch = originalFetch;
        clearAcbrTokenCache();
    });

    it('rejeita com erro quando a requisição excede o timeoutMs configurado', async () => {
        const env = {
            ACBR_CLIENT_ID: process.env.ACBR_CLIENT_ID,
            ACBR_CLIENT_SECRET: process.env.ACBR_CLIENT_SECRET,
        };
        process.env.ACBR_CLIENT_ID = 'test';
        process.env.ACBR_CLIENT_SECRET = 'test';

        // O token endpoint resolve normalmente (senão o hang aconteceria dentro de
        // getAcbrAccessToken, que hoje não recebe nenhum AbortSignal, e nunca chegaríamos
        // a exercitar o timeout da própria chamada ACBr sob teste).
        globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
            const url = String(input);
            if (url.includes('/protocol/openid-connect/token')) {
                return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 });
            }
            return new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () =>
                    reject(new DOMException('The operation was aborted.', 'AbortError')),
                );
            });
        }) as typeof fetch;

        try {
            await assert.rejects(
                acbrFetchJson('/cte/123', { method: 'GET', scopes: ['cte'], timeoutMs: 20 }),
                /timeout|abort/i,
            );
        } finally {
            restoreAcbrEnv(env);
        }
    });
});
