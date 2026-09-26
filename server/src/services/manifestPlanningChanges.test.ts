import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planningActionsFor, type PlanningFacts } from './manifestPlanningChanges.js';

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
