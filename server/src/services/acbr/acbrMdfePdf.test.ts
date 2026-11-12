import assert from 'node:assert/strict';
import { it } from 'node:test';
import { archiveMdfePdf } from './acbrMdfePdf.js';

const pdf = Buffer.from('%PDF-1.4 test');
function fakeDb(doc: Record<string, unknown>) {
    const updates: unknown[] = [];
    return {
        updates,
        db: {
            manifestFiscalDocument: {
                findUnique: async () => doc,
                update: async (args: unknown) => { updates.push(args); return doc; },
            },
        } as any,
    };
}
const base = { id: 'd1', documentType: 'MDFE', environment: 'HOMOLOGACAO', accessKey: '9'.repeat(44), pdfUrl: null };

it('baixa pelo providerDocId, arquiva e grava pdfUrl s3:', async () => {
    const { db, updates } = fakeDb({ ...base, providerDocId: 'abc' });
    let downloaded = '';
    const result = await archiveMdfePdf('d1', {
        db, download: async (id) => { downloaded = id; return pdf; },
        upload: async () => ({ storageKey: 'fiscal/mdfe/d1/x.pdf' }) as any,
    });
    assert.deepEqual(result, { ok: true, storageKey: 'fiscal/mdfe/d1/x.pdf' });
    assert.equal(downloaded, 'abc');
    assert.deepEqual((updates[0] as any).data, { pdfUrl: 's3:fiscal/mdfe/d1/x.pdf' });
});

it('aceita o formato antigo pdfUrl=mdfe:<id> como fonte do id', async () => {
    const { db } = fakeDb({ ...base, pdfUrl: 'mdfe:old' });
    let downloaded = '';
    await archiveMdfePdf('d1', { db, download: async (id) => { downloaded = id; return pdf; }, upload: async () => ({ storageKey: 'k' }) as any });
    assert.equal(downloaded, 'old');
});

it('já arquivado não baixa de novo', async () => {
    const { db } = fakeDb({ ...base, providerDocId: 'abc', pdfUrl: 's3:k1' });
    const result = await archiveMdfePdf('d1', { db, download: async () => { throw new Error('não deve baixar'); } });
    assert.deepEqual(result, { ok: true, storageKey: 'k1' });
});

it('falha do provedor ou resposta que não é PDF devolve erro sem lançar nem gravar', async () => {
    const a = fakeDb({ ...base, providerDocId: 'abc' });
    const r1 = await archiveMdfePdf('d1', { db: a.db, download: async () => { throw new Error('HTTP 500'); } });
    assert.equal(r1.ok, false);
    const b = fakeDb({ ...base, providerDocId: 'abc' });
    const r2 = await archiveMdfePdf('d1', { db: b.db, download: async () => Buffer.from('<html>') });
    assert.equal(r2.ok, false);
    assert.equal(a.updates.length + b.updates.length, 0);
});
