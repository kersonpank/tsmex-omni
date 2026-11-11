import assert from 'node:assert/strict';
import { it } from 'node:test';
import { assertCteFieldsMutable, assertTripPlanningMutable, lockFiscalCadastros, recordPlanningEdit } from './manifestFiscalGuards.js';

function fixture() {
    let status = 'DRAFT'; let reopened = false; let cte = true; let tripDocument = false; let unknown = false;
    const audit: any[] = []; const locks: any[] = [];
    const db: any = {
        $queryRaw: async (...args: any[]) => { locks.push(args); return []; },
        manifest: { findUnique: async () => ({ id: 'trip', status, corrections: reopened ? [{ id: 'reopen' }] : [] }), findMany: async () => [{ id: 'trip', status, fiscalEmitter: { personId: 'emitter' } }] },
        manifestFiscalDocument: { findFirst: async () => tripDocument ? { id: 'active' } : null },
        ciotEmissionJob: { findFirst: async () => unknown ? { id: 'unknown' } : null },
        orderLeg: { findFirst: async () => cte ? { id: 'leg' } : null },
        manifestCorrection: { create: async (input: any) => { audit.push(input.data); return input.data; } },
    };
    return { db, audit, locks, set: (next: any) => { status = next.status ?? status; reopened = next.reopened ?? reopened; cte = next.cte ?? cte; tripDocument = next.tripDocument ?? tripDocument; unknown = next.unknown ?? unknown; } };
}

it('primeiro planejamento pode consolidar vários pedidos com CT-e; reabertura protege rota, pedidos e emitente', async () => {
    const f = fixture();
    await assertCteFieldsMutable('trip', f.db);
    f.set({ reopened: true });
    await assert.rejects(assertCteFieldsMutable('trip', f.db), /CT-e autorizado/);
    await assertTripPlanningMutable('trip', f.db);
});
it('cadastro do motorista pode ser corrigido após recusa de CIOT mesmo com CT-e autorizado', async () => {
    const f = fixture(); f.set({ status: 'ACCEPTED' });
    const related = await lockFiscalCadastros(f.db, { driverId: 'driver' });
    assert.equal(related.length, 1); assert.equal(f.locks.length, 1);
    await recordPlanningEdit(f.db, 'trip', 'operator', 'DRIVER_DETAILS', { phone: 'old' }, { phone: 'new' }, 'Corrigir celular recusado');
    assert.deepEqual(f.audit[0].before, { phone: 'old' });
    assert.deepEqual(f.audit[0].after, { phone: 'new' });
    assert.equal(f.audit[0].actorUserId, 'operator');
});
it('cadastro compartilhado não contorna timeout nem autorização de CIOT/MDF-e', async () => {
    for (const data of [{ unknown: true }, { tripDocument: true }]) {
        const f = fixture(); f.set(data);
        await assert.rejects(lockFiscalCadastros(f.db, { driverId: 'driver' }), /processamento fiscal/);
        await assert.rejects(assertTripPlanningMutable('trip', f.db), /emissão fiscal/);
    }
});
it('capa e Carta Frete exigem reabertura antes da edição de uma viagem liberada ou em execução', async () => {
    for (const status of ['PENDING_ACCEPT', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED']) {
        const f = fixture(); f.set({ status });
        await assert.rejects(assertTripPlanningMutable('trip', f.db), /reabra o planejamento/);
    }
});
