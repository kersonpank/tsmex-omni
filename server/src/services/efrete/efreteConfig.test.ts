import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import {
    getEfreteCredentials,
    isEfreteCredentialsConfigured,
    resolveMatrizCnpj,
    resolveEfreteConfig,
    resolveEfreteCredentials,
    type EfreteEnvironment,
} from './efreteConfig.js';

describe('efreteConfig credential & context resolver', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        // Clear all EFRETE_ variables before each test
        for (const key of Object.keys(process.env)) {
            if (key.startsWith('EFRETE_')) {
                delete process.env[key];
            }
        }
    });

    afterEach(() => {
        // Restore environment
        for (const key of Object.keys(process.env)) {
            if (key.startsWith('EFRETE_')) {
                delete process.env[key];
            }
        }
        for (const [k, v] of Object.entries(originalEnv)) {
            if (k.startsWith('EFRETE_') && v !== undefined) {
                process.env[k] = v;
            }
        }
    });

    it('selects HOMOLOGACAO vars vs PRODUCAO vars based on explicit argument rather than EFRETE_ENV alone', () => {
        process.env.EFRETE_ENV = 'homologacao';
        process.env.EFRETE_HOMOLOGACAO_USUARIO = 'user-homolog';
        process.env.EFRETE_HOMOLOGACAO_SENHA = 'secret-pass-homolog';
        process.env.EFRETE_HOMOLOGACAO_INTEGRADOR = 'int-homolog-uuid';
        process.env.EFRETE_HOMOLOGACAO_INTEGRADOR_CNPJ = '11111111000199';

        process.env.EFRETE_PRODUCAO_USUARIO = 'user-producao';
        process.env.EFRETE_PRODUCAO_SENHA = 'secret-pass-producao';
        process.env.EFRETE_PRODUCAO_INTEGRADOR = 'int-producao-uuid';
        process.env.EFRETE_PRODUCAO_INTEGRADOR_CNPJ = '22222222000188';

        // When requesting homologacao explicitly
        const homCreds = resolveEfreteCredentials('homologacao');
        assert.equal(homCreds.usuario, 'user-homolog');
        assert.equal(homCreds.integrador, 'int-homolog-uuid');
        assert.equal(homCreds.integradorCnpj, '11111111000199');

        // When requesting producao explicitly (even if EFRETE_ENV=homologacao)
        const prodCreds = resolveEfreteCredentials('producao');
        assert.equal(prodCreds.usuario, 'user-producao');
        assert.equal(prodCreds.integrador, 'int-producao-uuid');
        assert.equal(prodCreds.integradorCnpj, '22222222000188');

        // resolveEfreteConfig context contains correct environment and baseUrl
        const homConfig = resolveEfreteConfig('homologacao');
        assert.equal(homConfig.environment, 'homologacao');
        assert.equal(homConfig.baseUrl, 'https://dev.efrete.com.br');
        assert.equal(homConfig.usuario, 'user-homolog');

        const prodConfig = resolveEfreteConfig('producao');
        assert.equal(prodConfig.environment, 'producao');
        assert.equal(prodConfig.baseUrl, 'https://sistema.efrete.com.br');
        assert.equal(prodConfig.usuario, 'user-producao');
    });

    it('legacy EFRETE_* vars are used only as temporary HOMOLOGACAO fallback', () => {
        process.env.EFRETE_USUARIO = 'legacy-user';
        process.env.EFRETE_SENHA = 'legacy-pass';
        process.env.EFRETE_INTEGRADOR = 'legacy-int';
        process.env.EFRETE_INTEGRADOR_CNPJ = '33333333000177';

        // Homologacao succeeds using legacy fallback
        assert.equal(isEfreteCredentialsConfigured('homologacao'), true);
        const homCreds = resolveEfreteCredentials('homologacao');
        assert.equal(homCreds.usuario, 'legacy-user');
        assert.equal(homCreds.integrador, 'legacy-int');
        assert.equal(homCreds.integradorCnpj, '33333333000177');

        // Producao MUST NOT fall back to legacy credentials
        assert.equal(isEfreteCredentialsConfigured('producao'), false);
        assert.throws(
            () => resolveEfreteCredentials('producao'),
            (err: any) => {
                assert.match(err.message, /PRODUCAO/);
                return true;
            },
        );
    });

    it('does not expose secret values in errors or diagnostics', () => {
        const dummyPassword = 'super-secret-password-xyz';
        process.env.EFRETE_PRODUCAO_SENHA = dummyPassword;
        // missing user and integrador for producao
        let thrownError: Error | null = null;
        try {
            resolveEfreteCredentials('producao');
        } catch (err: any) {
            thrownError = err;
        }
        assert.ok(thrownError, 'Should throw error when credentials incomplete');
        assert.doesNotMatch(thrownError.message, new RegExp(dummyPassword), 'Error message must not expose password');

        // When resolved, check safe diagnostics do not expose secrets
        process.env.EFRETE_HOMOLOGACAO_USUARIO = 'hom-user';
        process.env.EFRETE_HOMOLOGACAO_SENHA = dummyPassword;
        process.env.EFRETE_HOMOLOGACAO_INTEGRADOR = 'hom-int';

        const config = resolveEfreteConfig('homologacao');
        if (typeof (config as any).toSafeDiagnostics === 'function') {
            const safe = (config as any).toSafeDiagnostics();
            const safeJson = JSON.stringify(safe);
            assert.doesNotMatch(safeJson, new RegExp(dummyPassword), 'Safe diagnostics must not expose password');
        }
    });

    it('resolveMatrizCnpj uses homologacao integrador CNPJ in homologacao and fiscalEmitterCnpj in producao', () => {
        process.env.EFRETE_HOMOLOGACAO_INTEGRADOR_CNPJ = '99999999000199';
        process.env.EFRETE_PRODUCAO_INTEGRADOR_CNPJ = '88888888000188';

        const emitterCnpj = '12345678000100';

        // Homologacao uses integrador CNPJ
        assert.equal(resolveMatrizCnpj(emitterCnpj, 'homologacao'), '99999999000199');

        // Producao uses fiscal emitter CNPJ
        assert.equal(resolveMatrizCnpj(emitterCnpj, 'producao'), emitterCnpj);
    });
});
