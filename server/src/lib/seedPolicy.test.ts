import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSeedPolicy } from '../../prisma/seedPolicy.js';

test('produção sem SEED_ADMIN_PASSWORD não cria usuários', () => {
    const p = resolveSeedPolicy({ NODE_ENV: 'production' });
    assert.equal(p.adminPassword, null);
    assert.equal(p.demoUsers, false);
    assert.ok(p.warnings.length > 0);
});

test('produção com senha curta é recusada', () => {
    const p = resolveSeedPolicy({ NODE_ENV: 'production', SEED_ADMIN_PASSWORD: 'curta123', SEED_DEMO_USERS: 'true' });
    assert.equal(p.adminPassword, null);
    assert.equal(p.demoUsers, false);
});

test('produção com senha forte usa a senha e não cria demo por padrão', () => {
    const p = resolveSeedPolicy({ NODE_ENV: 'production', SEED_ADMIN_PASSWORD: 'uma-senha-bem-longa-1' });
    assert.equal(p.adminPassword, 'uma-senha-bem-longa-1');
    assert.equal(p.demoUsers, false);
});

test('produção com SEED_DEMO_USERS=true usa a senha forte também nos demos', () => {
    const p = resolveSeedPolicy({ NODE_ENV: 'production', SEED_ADMIN_PASSWORD: 'uma-senha-bem-longa-1', SEED_DEMO_USERS: 'true' });
    assert.equal(p.demoUsers, true);
    assert.equal(p.demoPassword('hub123'), 'uma-senha-bem-longa-1');
});

test('desenvolvimento mantém o comportamento legado', () => {
    const p = resolveSeedPolicy({ NODE_ENV: 'development' });
    assert.equal(p.adminPassword, 'admin123');
    assert.equal(p.demoUsers, true);
    assert.equal(p.demoPassword('hub123'), 'hub123');
});
