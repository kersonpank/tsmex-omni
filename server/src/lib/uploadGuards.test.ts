import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSafeUpload } from './uploadGuards.js';

const b64 = (bytes: number[] | string) => Buffer.from(typeof bytes === 'string' ? bytes : Buffer.from(bytes)).toString('base64');
const PNG = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = b64([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const PDF = b64('%PDF-1.7\n...');

test('aceita arquivos cujos magic bytes batem com o tipo', () => {
    assertSafeUpload('image/png', PNG);
    assertSafeUpload('image/jpeg', `data:image/jpeg;base64,${JPG}`);
    assertSafeUpload('application/pdf', PDF);
    assertSafeUpload('text/plain', b64('olá'));
});

test('bloqueia svg e html, por mime ou extensão', () => {
    assert.throws(() => assertSafeUpload('image/svg+xml', b64('<svg onload=alert(1)>')), /não permitido/);
    assert.throws(() => assertSafeUpload('text/html', b64('<script>')), /não permitido/);
    assert.throws(() => assertSafeUpload('image/png', PNG, 'x.svg'), /não permitido/);
});

test('recusa conteúdo que não corresponde ao tipo declarado', () => {
    assert.throws(() => assertSafeUpload('image/png', b64('<html><script>alert(1)</script>')), /não corresponde/);
    assert.throws(() => assertSafeUpload('application/pdf', PNG), /não corresponde/);
    assert.throws(() => assertSafeUpload('image/jpeg', PNG), /não corresponde/);
});
