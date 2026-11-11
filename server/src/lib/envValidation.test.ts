import assert from 'node:assert/strict';
import test from 'node:test';
import { assertProductionEnv, collectEnvProblems } from './envValidation.js';

const OK = { NODE_ENV: 'production', DATABASE_URL: 'x', REDIS_URL: 'y', JWT_SECRET: 'j'.repeat(32), FISCAL_SECRET_KEY: 'f' };

test('fora de produção não valida', () => {
    assert.deepEqual(collectEnvProblems({ NODE_ENV: 'development' }, 'api'), []);
});

test('produção lista o que falta, sem imprimir valores', () => {
    const problems = collectEnvProblems({ NODE_ENV: 'production', JWT_SECRET: 'segredo-curto' }, 'api');
    assert.deepEqual(problems.sort(), ['DATABASE_URL ausente', 'FISCAL_SECRET_KEY ausente', 'JWT_SECRET curto demais (mínimo 32 caracteres)', 'REDIS_URL ausente'].sort());
    assert.ok(!problems.join().includes('segredo-curto'));
});

test('produção completa passa; worker não exige JWT_SECRET', () => {
    assert.doesNotThrow(() => assertProductionEnv('api', OK));
    const { JWT_SECRET: _ignored, ...worker } = OK;
    assert.doesNotThrow(() => assertProductionEnv('worker', worker));
    assert.throws(() => assertProductionEnv('api', worker), /JWT_SECRET ausente/);
});
