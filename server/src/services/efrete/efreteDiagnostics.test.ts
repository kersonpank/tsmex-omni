import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runEfreteDiagnostics } from './efreteDiagnostics.js';

describe('eFrete diagnostics', () => {
    it('returns only safe OK DTO', async () => {
        const result = await runEfreteDiagnostics('homologacao', {
            resolveConfig: () => ({} as never),
            login: async () => 'dummy-token',
        });
        assert.deepEqual(result, { provider: 'EFRETE', environment: 'HOMOLOGACAO', configured: true, authentication: 'OK', baseUrl: 'https://dev.efrete.com.br' });
    });

    it('reports missing configuration safely', async () => {
        const result = await runEfreteDiagnostics('producao', { resolveConfig: () => { throw new Error('dummy-secret'); } });
        assert.equal(result.configured, false);
        assert.equal(JSON.stringify(result).includes('dummy-secret'), false);
    });

    it('sanitizes login failures and never exposes token or credentials', async () => {
        const result = await runEfreteDiagnostics('homologacao', {
            resolveConfig: () => ({} as never),
            login: async () => { throw new Error('dummy-secret dummy-token Authorization'); },
        });
        const json = JSON.stringify(result);
        assert.equal(result.authentication, 'ERROR');
        assert.equal(json.includes('dummy-secret'), false);
        assert.equal(json.includes('dummy-token'), false);
        assert.equal(json.includes('Authorization'), false);
    });
});
