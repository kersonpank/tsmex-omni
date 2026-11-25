import assert from 'node:assert/strict';
import { it } from 'node:test';
import { cancelMdfeDocument, includeMdfeDriver, interpretMdfeEvent, MDFE_CANCEL_WINDOW_MS, validateCancelJustification } from './mdfeEvents.js';

const NOW = new Date('2026-11-25T12:00:00Z');
const JUST = 'Carga alterada depois da emissão do manifesto';

function authorizedDoc(over: Record<string, unknown> = {}) {
    return {
        id: 'doc1', manifestId: 'm1', documentType: 'MDFE', status: 'AUTHORIZED', environment: 'HOMOLOGACAO',
        providerDocId: 'acbr-1', authorizedAt: new Date(NOW.getTime() - 60 * 60 * 1000), rawResponse: { id: 'acbr-1' }, ...over,
    };
}

function fakeDb(doc: Record<string, any> | null, opts: { driver?: Record<string, any>; assignments?: Array<{ driverId: string; sequence: number }> } = {}) {
    const updates: Array<Record<string, any>> = [];
    const created: Array<Record<string, any>> = [];
    const tx = {
        manifestFiscalDocument: { update: async (a: any) => { updates.push(a); return {}; } },
        manifestDriverAssignment: {
            findMany: async () => opts.assignments ?? [],
            create: async (a: any) => { created.push(a.data); return a.data; },
        },
    };
    const db = {
        ...tx,
        manifestFiscalDocument: {
            ...tx.manifestFiscalDocument,
            findFirst: async ({ where }: any) => (doc && doc.id === where.id && doc.manifestId === where.manifestId ? doc : null),
        },
        driver: { findUnique: async () => opts.driver ?? null },
        $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    } as any;
    return { db, updates, created };
}

it('interpreta evento: registrado só com protocolo; pendente; rejeitado', () => {
    assert.equal(interpretMdfeEvent({ status: 'registrado', codigo_status: 135, numero_protocolo: '935260000000001' }).state, 'registered');
    assert.equal(interpretMdfeEvent({ status: 'registrado', codigo_status: 135 }).state, 'rejected');
    assert.equal(interpretMdfeEvent({ status: 'pendente' }).state, 'pending');
    const rej = interpretMdfeEvent({ status: 'rejeitado', codigo_status: 218, motivo_status: 'MDF-e já está cancelado' });
    assert.equal(rej.state, 'rejected');
    assert.equal(rej.cStat, 218);
});

it('valida a justificativa (15 a 255 caracteres)', () => {
    assert.match(validateCancelJustification('curta')!, /15/);
    assert.equal(validateCancelJustification(JUST), null);
    assert.match(validateCancelJustification('x'.repeat(256))!, /255/);
});

it('cancela: chama o endpoint da ACBr e grava CANCELLED com protocolo e o evento no histórico', async () => {
    const { db, updates } = fakeDb(authorizedDoc());
    const posts: Array<{ path: string; body: any }> = [];
    const r = await cancelMdfeDocument('m1', 'doc1', JUST, {
        db, now: () => NOW,
        post: async (path, body) => { posts.push({ path, body }); return { status: 'registrado', codigo_status: 135, numero_protocolo: 'P1' }; },
    });
    assert.equal(r.ok, true);
    assert.deepEqual(posts, [{ path: '/mdfe/acbr-1/cancelamento', body: { justificativa: JUST } }]);
    assert.equal(updates[0].data.status, 'CANCELLED');
    assert.match(updates[0].data.statusReason, /P1/);
    assert.equal(updates[0].data.rawResponse.id, 'acbr-1');
    assert.equal(updates[0].data.rawResponse.eventos[0].tipo, 'CANCELAMENTO');
});

it('cancela: rejeição da SEFAZ mantém autorizado e registra o motivo', async () => {
    const { db, updates } = fakeDb(authorizedDoc());
    const r = await cancelMdfeDocument('m1', 'doc1', JUST, { db, now: () => NOW, post: async () => ({ status: 'rejeitado', codigo_status: 220, motivo_status: 'Prazo de cancelamento superior' }) });
    assert.equal(r.ok, false);
    assert.equal(r.pending, false);
    assert.equal(updates[0].data.status, undefined);
    assert.match(updates[0].data.statusReason, /220/);
});

it('cancela: fora das 24 h nem chama a SEFAZ e orienta encerrar e emitir outro', async () => {
    const { db } = fakeDb(authorizedDoc({ authorizedAt: new Date(NOW.getTime() - MDFE_CANCEL_WINDOW_MS - 1) }));
    let called = false;
    const r = await cancelMdfeDocument('m1', 'doc1', JUST, { db, now: () => NOW, post: async () => { called = true; return {}; } });
    assert.equal(r.ok, false);
    assert.equal(called, false);
    assert.match(r.error!, /24 h/);
});

it('cancela: recusa MDF-e encerrado, já cancelado ou sem id da ACBr', async () => {
    for (const [over, pattern] of [[{ status: 'CLOSED' }, /encerrado/], [{ status: 'CANCELLED' }, /já está cancelado/], [{ providerDocId: null, rawResponse: null }, /sem id/]] as const) {
        const { db } = fakeDb(authorizedDoc(over as Record<string, unknown>));
        const r = await cancelMdfeDocument('m1', 'doc1', JUST, { db, now: () => NOW, post: async () => ({}) });
        assert.equal(r.ok, false);
        assert.match(r.error!, pattern);
    }
});

it('cancela: falha de rede fica pendente e não muda o documento', async () => {
    const { db, updates } = fakeDb(authorizedDoc());
    const r = await cancelMdfeDocument('m1', 'doc1', JUST, { db, now: () => NOW, post: async () => { throw new Error('timeout'); } });
    assert.equal(r.pending, true);
    assert.equal(updates.length, 0);
});

it('inclui condutor: envia nome e CPF e coloca o motorista no fim da escala', async () => {
    const { db, created } = fakeDb(authorizedDoc(), {
        driver: { id: 'd2', name: ' Maria Souza ', document: '123.456.789-09', active: true },
        assignments: [{ driverId: 'd1', sequence: 1 }],
    });
    const posts: Array<{ path: string; body: any }> = [];
    const r = await includeMdfeDriver('m1', 'doc1', 'd2', {
        db, now: () => NOW,
        post: async (path, body) => { posts.push({ path, body }); return { status: 'registrado', codigo_status: 135, numero_protocolo: 'P2' }; },
    });
    assert.equal(r.ok, true);
    assert.deepEqual(posts, [{ path: '/mdfe/acbr-1/inclusao-condutor', body: { nome: 'Maria Souza', cpf: '12345678909' } }]);
    assert.deepEqual(created, [{ manifestId: 'm1', driverId: 'd2', sequence: 2, isPrimary: false }]);
});

it('inclui condutor: recusa motorista sem CPF válido e não chama a SEFAZ', async () => {
    const { db } = fakeDb(authorizedDoc(), { driver: { id: 'd2', name: 'X', document: '123', active: true } });
    let called = false;
    const r = await includeMdfeDriver('m1', 'doc1', 'd2', { db, now: () => NOW, post: async () => { called = true; return {}; } });
    assert.equal(r.ok, false);
    assert.equal(called, false);
});
