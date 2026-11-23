import { describe, expect, it } from 'vitest';
import { deleteConsequence, demandStep, nextDemandStatus, reorderedIds, validateColumn } from './comercialFunnel';

describe('nextDemandStatus', () => {
    it('segue a sequência aceita pelo servidor', () => {
        expect(nextDemandStatus('QUOTED')).toBe('APPROVED');
        expect(nextDemandStatus('APPROVED')).toBe('COLLECTED');
    });
    it('não repete o erro da clássica: ASSIGNED não volta para QUOTED', () => {
        expect(nextDemandStatus('ASSIGNED')).toBe('COLLECTED');
    });
    it('não oferece passo para PENDING, convertida, entregue ou desconhecida', () => {
        for (const status of ['PENDING', 'CONVERTED', 'DELIVERED', 'CANCELLED', 'AWAITING_ARRIVAL', 'XYZ', null, undefined]) expect(nextDemandStatus(status)).toBeNull();
    });
    it('pede confirmação só no passo que gera o pedido', () => {
        expect(demandStep('QUOTED')?.needsConfirm).toBe(false);
        expect(demandStep('APPROVED')?.needsConfirm).toBe(true);
    });
});

describe('colunas do funil', () => {
    it('valida nome e cor', () => {
        expect(validateColumn('', '#12AB34')).toEqual({ name: 'Informe o nome da coluna.' });
        expect(validateColumn('Ok', 'azul').color).toBeTruthy();
        expect(validateColumn('Ok', '#12ab34')).toEqual({});
    });
    it('reordena trocando vizinhas e ignora as pontas', () => {
        const cols = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
        expect(reorderedIds(cols, 1, -1)).toEqual(['b', 'a', 'c']);
        expect(reorderedIds(cols, 1, 1)).toEqual(['a', 'c', 'b']);
        expect(reorderedIds(cols, 0, -1)).toBeNull();
        expect(reorderedIds(cols, 2, 1)).toBeNull();
    });
    it('avisa que coluna fixa só é desativada', () => {
        expect(deleteConsequence({ name: 'Perdida', stage: 'LOST' })).toMatch(/desativada/);
        expect(deleteConsequence({ name: 'Minha', stage: null })).toMatch(/apagada/);
    });
});
