import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { clearEfreteTokenCache, getEfreteToken } from './efreteAuth.js';

describe('eFrete auth environment selection', () => {
    const originalEnv = { ...process.env };
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        process.env = { ...originalEnv };
        globalThis.fetch = originalFetch;
        clearEfreteTokenCache();
    });

    it('uses production credentials when env is producao despite EFRETE_ENV homologacao', async () => {
        process.env.EFRETE_ENV = 'homologacao';
        process.env.EFRETE_HOMOLOGACAO_USUARIO = 'hom-user';
        process.env.EFRETE_HOMOLOGACAO_SENHA = 'hom-secret';
        process.env.EFRETE_HOMOLOGACAO_INTEGRADOR = 'hom-integrator';
        process.env.EFRETE_PRODUCAO_USUARIO = 'prod-user';
        process.env.EFRETE_PRODUCAO_SENHA = 'prod-secret';
        process.env.EFRETE_PRODUCAO_INTEGRADOR = 'prod-integrator';
        let body = '';
        globalThis.fetch = (async (_input, init) => {
            body = String(init?.body);
            return new Response(JSON.stringify({ Sucesso: true, Token: 'dummy-token' }), { status: 200 });
        }) as typeof fetch;

        await getEfreteToken('producao');
        assert.match(body, /prod-user/);
        assert.match(body, /prod-secret/);
        assert.match(body, /prod-integrator/);
        assert.doesNotMatch(body, /hom-user/);
    });
});
