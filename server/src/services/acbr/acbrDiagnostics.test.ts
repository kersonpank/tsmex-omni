import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildAcbrRuntimeDiagnostics } from './acbrDiagnostics.js';

describe('buildAcbrRuntimeDiagnostics', () => {
    it('expõe somente status booleano/metadados seguros das envs fiscais', () => {
        const env = {
            ACBR_CLIENT_ID: process.env.ACBR_CLIENT_ID,
            ACBR_CLIENT_SECRET: process.env.ACBR_CLIENT_SECRET,
            ACBR_CLIENT_ID_PRODUCAO: process.env.ACBR_CLIENT_ID_PRODUCAO,
            ACBR_CLIENT_SECRET_PRODUCAO: process.env.ACBR_CLIENT_SECRET_PRODUCAO,
            FISCAL_CTE_PROVIDER: process.env.FISCAL_CTE_PROVIDER,
            FISCAL_PROVIDER: process.env.FISCAL_PROVIDER,
            FISCAL_SECRET_KEY: process.env.FISCAL_SECRET_KEY,
            S3_ENDPOINT: process.env.S3_ENDPOINT,
            S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
            S3_SECRET_KEY: process.env.S3_SECRET_KEY,
            NODE_ENV: process.env.NODE_ENV,
        };
        process.env.ACBR_CLIENT_ID = 'client-id-secret-value';
        process.env.ACBR_CLIENT_SECRET = 'client-secret-value';
        delete process.env.ACBR_CLIENT_ID_PRODUCAO;
        delete process.env.ACBR_CLIENT_SECRET_PRODUCAO;
        process.env.FISCAL_CTE_PROVIDER = 'acbr';
        process.env.FISCAL_PROVIDER = '';
        process.env.FISCAL_SECRET_KEY = 'fiscal-secret-key-value';
        process.env.S3_ENDPOINT = 'https://storage.example.com';
        process.env.S3_ACCESS_KEY = 'access-key';
        process.env.S3_SECRET_KEY = 'secret-key';
        process.env.NODE_ENV = 'production';

        try {
            const result = buildAcbrRuntimeDiagnostics();

            assert.equal(result.acbrClientIdConfigured, true);
            assert.equal(result.acbrClientSecretConfigured, true);
            assert.equal(result.acbrCredentialsConfigured, true);
            assert.equal(result.acbrProdClientIdConfigured, false);
            assert.equal(result.acbrProdClientSecretConfigured, false);
            assert.equal(result.acbrProdCredentialsConfigured, false);
            assert.equal(result.fiscalCteProvider, 'acbr');
            assert.equal(result.fiscalProvider, '');
            assert.equal(typeof result.fiscalSecretKeyConfigured, 'boolean');
            assert.equal(result.fiscalSecretKeyConfigured, true);
            assert.equal(typeof result.acbrHttpForcedByEnv, 'boolean');
            assert.equal(result.acbrHttpForcedByEnv, true);
            assert.equal(typeof result.willUseAcbrHttpWithSimulatedEmitter, 'boolean');
            assert.equal(result.willUseAcbrHttpWithSimulatedEmitter, true);
            assert.equal(typeof result.simulatedEmitterAcbrDecisionReason, 'string');
            assert.equal(result.simulatedEmitterAcbrDecisionReason, 'forced_by_env');
            assert.equal(result.s3Configured, true);
            assert.equal(result.nodeEnv, 'production');
            assert.equal(result.effectiveAcbrBaseUrlHomologacao, 'https://hom.acbr.api.br');
            assert.equal(JSON.stringify(result).includes('client-id-secret-value'), false);
            assert.equal(JSON.stringify(result).includes('client-secret-value'), false);
            assert.equal(JSON.stringify(result).includes('secret-key'), false);
            assert.equal(JSON.stringify(result).includes('fiscal-secret-key-value'), false);
        } finally {
            for (const [key, value] of Object.entries(env)) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        }
    });

    it('reporta credenciais de PRODUCAO separadas do par sandbox', () => {
        const env = {
            ACBR_CLIENT_ID: process.env.ACBR_CLIENT_ID,
            ACBR_CLIENT_SECRET: process.env.ACBR_CLIENT_SECRET,
            ACBR_CLIENT_ID_PRODUCAO: process.env.ACBR_CLIENT_ID_PRODUCAO,
            ACBR_CLIENT_SECRET_PRODUCAO: process.env.ACBR_CLIENT_SECRET_PRODUCAO,
        };
        delete process.env.ACBR_CLIENT_ID;
        delete process.env.ACBR_CLIENT_SECRET;
        process.env.ACBR_CLIENT_ID_PRODUCAO = 'prod-id';
        process.env.ACBR_CLIENT_SECRET_PRODUCAO = 'prod-secret';

        try {
            const result = buildAcbrRuntimeDiagnostics();
            assert.equal(result.acbrCredentialsConfigured, false, 'sandbox vazio não deve reportar OK');
            assert.equal(result.acbrProdCredentialsConfigured, true, 'par _PRODUCAO configurado deve reportar OK');
        } finally {
            for (const [key, value] of Object.entries(env)) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        }
    });
});
