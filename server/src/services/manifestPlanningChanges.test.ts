import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import prisma from '../lib/prisma.js';
import { Prisma } from '@prisma/client';
import { getPlanningActions, reopenAcceptedManifest, planningActionsFor, type PlanningFacts } from './manifestPlanningChanges.js';

const base: PlanningFacts = {
    status: 'DRAFT', started: false, legsStarted: false, fiscalActivity: false, billing: false,
    everOffered: false, creationAuditComplete: true, hasHistory: false,
};
const allowed = (facts: Partial<PlanningFacts>) => {
    const actions = planningActionsFor({ ...base, ...facts });
    return Object.entries(actions).filter(([, state]) => state.allowed).map(([key]) => key).sort();
};

describe('planningActionsFor', () => {
    it('rascunho vazio nunca ofertado: edita, cancela e exclui', () => {
        assert.deepEqual(allowed({}), ['cancel', 'delete', 'editPlanning']);
    });

    it('rascunho com histórico ou já ofertado não é excluído — só cancelado', () => {
        assert.deepEqual(allowed({ hasHistory: true }), ['cancel', 'editPlanning']);
        assert.deepEqual(allowed({ everOffered: true }), ['cancel', 'editPlanning']);
        assert.match(planningActionsFor({ ...base, everOffered: true }).delete.reason!, /Cancelar viagem/);
    });

    it('oferta pendente: retirar oferta para editar', () => {
        assert.deepEqual(allowed({ status: 'PENDING_ACCEPT', everOffered: true }), ['cancel', 'withdrawOffer']);
        assert.match(planningActionsFor({ ...base, status: 'PENDING_ACCEPT' }).editPlanning.reason!, /Retire a oferta/);
    });

    it('aceita sem fiscal: reabre (novo aceite) ou cancela; com fiscal, nenhum dos dois', () => {
        assert.deepEqual(allowed({ status: 'ACCEPTED', everOffered: true }), ['cancel', 'reopen']);
        const fiscal = planningActionsFor({ ...base, status: 'ACCEPTED', everOffered: true, fiscalActivity: true });
        assert.equal(fiscal.reopen.allowed, false);
        assert.equal(fiscal.cancel.allowed, false);
        assert.match(fiscal.reopen.reason!, /emissão fiscal/);
    });

    it('em execução: só correção; cancelamento exige resolver custódia', () => {
        const actions = planningActionsFor({ ...base, status: 'IN_PROGRESS', started: true, everOffered: true });
        assert.deepEqual(allowed({ status: 'IN_PROGRESS', started: true, everOffered: true }), ['requestCorrection']);
        assert.match(actions.cancel.reason!, /custódia/);
    });

    it('faturamento vinculado bloqueia cancelamento', () => {
        assert.match(planningActionsFor({ ...base, billing: true }).cancel.reason!, /faturas/);
    });

    it('concluída/cancelada: nada além do histórico', () => {
        assert.deepEqual(allowed({ status: 'COMPLETED', everOffered: true, started: true }), []);
        assert.deepEqual(allowed({ status: 'CANCELLED', hasHistory: true }), []);
    });
});

it('rejeição CIOT permite reabrir, resultado desconhecido e autorizado continuam bloqueados', async () => {
    const original = { manifest: prisma.manifest.findUnique, fiscal: prisma.manifestFiscalDocument.findFirst, ciot: prisma.ciotEmissionJob.findFirst, leg: prisma.orderLeg.findFirst, transaction: prisma.$transaction };
    let phase = 'FAILED'; let authorized = false; const writes: any[] = [];
    const findFiscal = async () => authorized ? { documentType: 'CIOT', status: 'AUTHORIZED' } : null;
    const findCiot = async (input: any) => {
        assert.deepEqual(input.where.phase.notIn, ['FAILED', 'DONE']);
        return ['FAILED', 'DONE'].includes(phase) ? null : { id: 'job' };
    };
    const manifest = { id: 'trip', status: 'ACCEPTED', startedAt: null, legs: [], freightAgreement: null, creationAuditComplete: true, _count: { legs: 1, fiscalDocuments: 1, ciotEmissionJobs: 1, invoices: 0, payables: 0, deliveryAttempts: 0, corrections: 0, cancelledLegs: 0 } };
    try {
        prisma.manifest.findUnique = (async () => manifest) as any;
        prisma.manifestFiscalDocument.findFirst = findFiscal as any;
        prisma.ciotEmissionJob.findFirst = findCiot as any;
        prisma.orderLeg.findFirst = (async () => null) as any;
        prisma.$transaction = (async (fn: any) => fn({ $queryRaw: async () => [], manifestFiscalDocument: { findFirst: findFiscal }, ciotEmissionJob: { findFirst: findCiot }, orderLeg: { findFirst: async () => null }, manifest: { updateMany: async ({ data }: any) => { writes.push(data); return { count: 1 }; }, findUniqueOrThrow: async () => ({ ...manifest, status: 'DRAFT' }) }, manifestCorrection: { create: async () => ({}) } })) as any;
        assert.equal((await getPlanningActions('trip')).reopen.allowed, true);
        await reopenAcceptedManifest('trip', 'operator', 'Corrigir rejeição fiscal');
        assert.equal(writes[0].releaseSource, null);
        assert.equal(writes[0].compositionSnapshot, Prisma.DbNull);
        phase = 'PENDING_RECONCILIATION';
        assert.equal((await getPlanningActions('trip')).reopen.allowed, false);
        await assert.rejects(reopenAcceptedManifest('trip', 'operator', 'Corrigir dados'), /emissão fiscal/);
        phase = 'DONE'; authorized = true;
        assert.equal((await getPlanningActions('trip')).reopen.allowed, false);
    } finally {
        prisma.manifest.findUnique = original.manifest; prisma.manifestFiscalDocument.findFirst = original.fiscal; prisma.ciotEmissionJob.findFirst = original.ciot; prisma.orderLeg.findFirst = original.leg; prisma.$transaction = original.transaction;
    }
});
