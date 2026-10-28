import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getAcbrProviderDecision } from './acbrConfig.js';

describe('ambiente do provedor fiscal', () => {
    it('usa somente as credenciais do ambiente de emissão', () => {
        const keys = ['ACBR_CLIENT_ID', 'ACBR_CLIENT_SECRET', 'ACBR_CLIENT_ID_PRODUCAO', 'ACBR_CLIENT_SECRET_PRODUCAO', 'FISCAL_CTE_PROVIDER', 'FISCAL_PROVIDER'] as const;
        const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
        try {
            for (const key of keys) delete process.env[key];
            process.env.ACBR_CLIENT_ID_PRODUCAO = 'test-id';
            process.env.ACBR_CLIENT_SECRET_PRODUCAO = 'test-secret';
            assert.equal(getAcbrProviderDecision('ACBR', 'PRODUCAO').willUseAcbrHttp, true);
            assert.equal(getAcbrProviderDecision('ACBR', 'HOMOLOGACAO').reason, 'missing_credentials');
        } finally {
            for (const key of keys) {
                if (previous[key] === undefined) delete process.env[key];
                else process.env[key] = previous[key];
            }
        }
    });
});
