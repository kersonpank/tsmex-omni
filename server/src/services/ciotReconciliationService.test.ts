import assert from 'node:assert/strict';
import { it } from 'node:test';
import { reconcileCiot } from './ciotReconciliationService.js';

function fixture(result: any, overrides: object = {}) {
    const writes: any[] = []; const queued: any[] = [];
    const job = { id: 'job', phase: 'PENDING_RECONCILIATION', environment: 'HOMOLOGACAO', idOperacaoCliente: 'op-original', requestData: { original: true, matrizCnpj: '11222333000181' }, updatedAt: new Date(), ...overrides };
    const deps: any = {
        db: { $transaction: async (fn: any) => fn(deps.db), manifestFiscalDocument: { findFirst: async () => null, create: async (input: any) => ({ id: 'doc', ...input.data }), update: async () => ({}) }, ciotEmissionJob: { findFirst: async () => job, updateMany: async (input: any) => { writes.push(input); return { count: 1 }; } } },
        consult: async (id: string, environment: string) => { assert.equal(id, 'op-original'); assert.equal(environment, 'homologacao'); if (result instanceof Error) throw result; return result; },
        enqueue: async (input: any) => { queued.push(input); return 'job'; },
    };
    return { deps, writes, queued };
}
it('CIOT encontrado recupera arquivos com o mesmo ID e sem alterar dados da operação', async () => {
    const f = fixture({ exists: true, codigoIdentificacaoOperacao: 'ciot-original', estado: 'EmViagem' });
    await reconcileCiot('trip', f.deps);
    assert.deepEqual(f.writes[0].data, { phase: 'DOWNLOADING_FILES', codigoIdentificacaoOperacao: 'ciot-original', lastError: null });
    assert.deepEqual(f.queued, [{ ciotEmissionJobId: 'job' }]);
    assert.ok(f.writes[0].where.updatedAt);
});
it('ausência confirmada permite corrigir sem enviar nova operação', async () => {
    const f = fixture({ exists: false });
    await reconcileCiot('trip', f.deps);
    assert.equal(f.writes[0].data.phase, 'FAILED');
    assert.equal(f.queued.length, 0);
});
it('timeout, ambiente ausente ou código conhecido continuam protegidos', async () => {
    for (const f of [fixture(new Error('timeout')), fixture({ exists: false }, { environment: null }), fixture({ exists: false }, { codigoIdentificacaoOperacao: 'known' })]) {
        await assert.rejects(reconcileCiot('trip', f.deps));
        assert.equal(f.writes.length, 0);
        assert.equal(f.queued.length, 0);
    }
});
it('consulta de tentativa ativa e consulta de CIOT encerrado não liberam reemissão', async () => {
    for (const f of [fixture({ exists: false }, { phase: 'QUEUED' }), fixture({ exists: true, estado: 'Encerrado' })]) {
        await assert.rejects(reconcileCiot('trip', f.deps));
        assert.equal(f.writes.length, 0);
    }
});

it('cancelamento e encerramento confirmados atualizam histórico sem emitir nem recuperar PDF', async () => {
    for (const estado of ['Cancelado', 'Encerrado']) {
        const f = fixture({ exists: true, codigoIdentificacaoOperacao: '123', estado });
        const documents: any[] = [];
        f.deps.db.manifestFiscalDocument.create = async (input: any) => { documents.push(input.data); return { id: 'doc', ...input.data }; };
        await reconcileCiot('trip', f.deps);
        assert.equal(f.writes[0].data.phase, 'DONE');
        assert.equal(documents[0].status, estado === 'Cancelado' ? 'CANCELLED' : 'CLOSED');
        assert.equal(f.queued.length, 0);
    }
});
it('consulta concorrente não sobrescreve tentativa que mudou de versão', async () => {
    const f = fixture({ exists: true, codigoIdentificacaoOperacao: '123', estado: 'EmViagem' });
    f.deps.db.ciotEmissionJob.updateMany = async () => ({ count: 0 });
    await assert.rejects(reconcileCiot('trip', f.deps), /mudou de estado/);
    assert.equal(f.queued.length, 0);
});
