import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { assertHubInvite, signHubInvite } from './hubInvite.js';

process.env.JWT_SECRET = 'test-secret';

test('convite válido para o hub correto passa', () => {
    assert.doesNotThrow(() => assertHubInvite(signHubInvite('hub-1'), 'hub-1'));
});

test('convite sem token é rejeitado (403)', () => {
    assert.throws(() => assertHubInvite(undefined, 'hub-1'), { statusCode: 403 });
    assert.throws(() => assertHubInvite('', 'hub-1'), { statusCode: 403 });
});

test('convite de outro hub é rejeitado (403)', () => {
    assert.throws(() => assertHubInvite(signHubInvite('hub-2'), 'hub-1'), { statusCode: 403 });
});

test('convite expirado é rejeitado (403)', () => {
    const expired = jwt.sign({ hubId: 'hub-1', purpose: 'hub-invite', exp: Math.floor(Date.now() / 1000) - 10 }, 'test-secret:hub-invite');
    assert.throws(() => assertHubInvite(expired, 'hub-1'), { statusCode: 403 });
});

test('token de sessão (mesmo JWT_SECRET) não serve como convite', () => {
    const session = jwt.sign({ userId: 'u1', hubId: 'hub-1', purpose: 'hub-invite' }, 'test-secret');
    assert.throws(() => assertHubInvite(session, 'hub-1'), { statusCode: 403 });
});
