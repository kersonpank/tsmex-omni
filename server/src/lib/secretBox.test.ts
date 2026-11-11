import assert from 'node:assert/strict';
import test from 'node:test';
import { isSealedSecret, openSecret, openSecretOrLegacy, sealSecret } from './secretBox.js';

const KEY = '0'.repeat(64);

test('sealSecret/openSecret fazem round-trip com IV aleatório', () => {
    const a = sealSecret('sk-abc123', KEY);
    const b = sealSecret('sk-abc123', KEY);
    assert.notEqual(a, b);
    assert.ok(a.startsWith('v1:'));
    assert.equal(openSecret(a, KEY), 'sk-abc123');
});

test('sealSecret falha fechado sem chave', () => {
    const prev = process.env.FISCAL_SECRET_KEY;
    delete process.env.FISCAL_SECRET_KEY;
    try {
        assert.throws(() => sealSecret('x'), /FISCAL_SECRET_KEY/);
    } finally {
        if (prev !== undefined) process.env.FISCAL_SECRET_KEY = prev;
    }
});

test('openSecret rejeita adulteração e chave errada', () => {
    const sealed = sealSecret('segredo', KEY);
    assert.throws(() => openSecret(sealed, '1'.repeat(64)));
    const parts = sealed.split(':');
    parts[3] = Buffer.from('adulterado').toString('base64');
    assert.throws(() => openSecret(parts.join(':'), KEY));
});

test('isSealedSecret distingue valor cifrado de texto puro legado', () => {
    assert.equal(isSealedSecret(sealSecret('x', KEY)), true);
    assert.equal(isSealedSecret('sk-ant-api03-abc'), false);
    assert.equal(isSealedSecret(''), false);
});

test('openSecretOrLegacy devolve valor legado em claro sem exigir chave', () => {
    assert.equal(openSecretOrLegacy('sk-legado'), 'sk-legado');
    assert.equal(openSecretOrLegacy(sealSecret('novo', KEY), KEY), 'novo');
});
