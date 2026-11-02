import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planningActionsFor, type PlanningFacts } from './manifestPlanningChanges.js';
import { reopenAcceptedManifest } from './manifestPlanningChanges.js';
import prisma from '../lib/prisma.js';
import { Prisma } from '@prisma/client';

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

it('reabre viagem com CT-e do pedido, ignora jobs terminais e limpa retrato', async () => {
    const original = { find: prisma.manifest.findUnique, transaction: prisma.$transaction };
    let updated: any;
    let documentQuery: any;
    let jobQuery: any;
    try {
        prisma.manifest.findUnique = (async () => ({ status: 'ACCEPTED', startedAt: null })) as any;
        prisma.$transaction = (async (callback: any) => callback({
            $queryRaw: async () => [],
            manifestFiscalDocument: { findFirst: async (query: any) => { documentQuery = query; return null; } },
            ciotEmissionJob: { findFirst: async (query: any) => { jobQuery = query; return null; } },
            orderLeg: { findFirst: () => { throw new Error('CT-e pertence ao pedido, não à viagem'); } },
            manifest: { updateMany: async (query: any) => { updated = query.data; return { count: 1 }; }, findUniqueOrThrow: async () => ({ status: 'DRAFT' }) },
            manifestCorrection: { create: async () => ({}) },
        })) as any;
        await reopenAcceptedManifest('trip', 'operator', 'Corrigir composição');
        assert.equal(updated.status, 'DRAFT');
        assert.equal(updated.compositionSnapshot, Prisma.DbNull);
        assert.equal(updated.acceptedAt, null);
        assert.deepEqual(documentQuery.where.documentType.in, ['MDFE', 'CIOT']);
        assert.deepEqual(documentQuery.where.status.in, ['SENT', 'READY', 'AUTHORIZED']);
        assert.deepEqual(jobQuery.where.phase.notIn, ['DONE', 'FAILED']);
    } finally {
        prisma.manifest.findUnique = original.find;
        prisma.$transaction = original.transaction;
    }
});

it('não reabre com MDF-e/CIOT ativo ou job pendente', async () => {
    const original = { find: prisma.manifest.findUnique, transaction: prisma.$transaction };
    try {
        prisma.manifest.findUnique = (async () => ({ status: 'ACCEPTED', startedAt: null })) as any;
        for (const [document, job] of [[{ documentType: 'MDFE', status: 'SENT' }, null], [{ documentType: 'CIOT', status: 'AUTHORIZED' }, null], [null, { id: 'pending' }]]) {
            prisma.$transaction = (async (callback: any) => callback({
                $queryRaw: async () => [], manifestFiscalDocument: { findFirst: async () => document }, ciotEmissionJob: { findFirst: async () => job },
            })) as any;
            await assert.rejects(() => reopenAcceptedManifest('trip', 'operator', 'Corrigir'), /emissão fiscal/);
        }
    } finally {
        prisma.manifest.findUnique = original.find;
        prisma.$transaction = original.transaction;
    }
});
