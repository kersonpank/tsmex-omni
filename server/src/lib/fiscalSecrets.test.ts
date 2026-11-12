import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fiscalSecretsGuard, stripFiscalSecrets } from './fiscalSecrets.js';

describe('stripFiscalSecrets', () => {
    it('remove as senhas em qualquer profundidade, inclusive em listas, e preserva o resto', () => {
        const when = new Date('2026-11-11T00:00:00Z');
        const payload = {
            success: true,
            data: [{
                id: 'c1', at: when,
                fiscalEmitter: { id: 'e1', atmUser: 'u', atmPasswordEncrypted: 'v1:xxx', certificatePasswordEncrypted: 'v1:yyy', person: { name: 'TSM' }, hub: { code: 'H1' } },
            }],
            nested: { deep: [{ emitter: { atmPasswordEncrypted: 'z', keep: 1 } }] },
        };
        const out = stripFiscalSecrets(payload);
        const text = JSON.stringify(out);
        assert.ok(!text.includes('atmPasswordEncrypted') && !text.includes('certificatePasswordEncrypted'));
        assert.ok(!text.includes('v1:xxx') && !text.includes('v1:yyy'));
        assert.equal(out.data[0]!.fiscalEmitter.atmUser, 'u');
        assert.equal(out.data[0]!.fiscalEmitter.person.name, 'TSM');
        assert.equal(out.data[0]!.at, when);
        assert.equal(out.nested.deep[0]!.emitter.keep, 1);
        assert.ok('atmPasswordEncrypted' in payload.data[0]!.fiscalEmitter, 'não muta o original');
    });
    it('aceita null, primitivos e referências circulares', () => {
        assert.equal(stripFiscalSecrets(null), null);
        assert.equal(stripFiscalSecrets('x'), 'x');
        const a: Record<string, unknown> = { atmPasswordEncrypted: 's' };
        a.self = a;
        assert.doesNotThrow(() => stripFiscalSecrets(a));
    });
    it('o guard filtra tudo que passa por res.json', () => {
        let sent: unknown;
        const res: any = { json(body: unknown) { sent = body; return this; } };
        fiscalSecretsGuard({} as never, res, () => undefined);
        res.json({ data: { fiscalEmitter: { atmPasswordEncrypted: 'a', certificatePasswordEncrypted: 'b', id: '1' } } });
        assert.deepEqual(sent, { data: { fiscalEmitter: { id: '1' } } });
    });
});
