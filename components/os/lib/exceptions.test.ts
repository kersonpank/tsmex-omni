import { describe, expect, it } from 'vitest';
import { ageLabel, dueLabel, exceptionAction, spanLabel } from './exceptions';

const NOW = new Date('2026-11-11T12:00:00Z');

describe('exceptions helpers', () => {
    it('spanLabel usa horas ate 48 h e dias depois', () => {
        expect(spanLabel(10 * 60_000)).toBe('menos de 1 h');
        expect(spanLabel(5 * 3_600_000)).toBe('5 h');
        expect(spanLabel(72 * 3_600_000)).toBe('3 dias');
    });

    it('dueLabel distingue vencida, a vencer e sem prazo', () => {
        expect(dueLabel({ dueAt: '2026-11-11T09:00:00Z', overdue: true }, NOW)).toBe('venceu há 3 h');
        expect(dueLabel({ dueAt: '2026-11-11T14:00:00Z', overdue: false }, NOW)).toBe('vence em 2 h');
        expect(dueLabel({ dueAt: null, overdue: false }, NOW)).toBe('sem prazo');
    });

    it('ageLabel conta desde a abertura', () => {
        expect(ageLabel({ createdAt: '2026-11-08T12:00:00Z' }, NOW)).toBe('aberta há 3 dias');
    });

    it('encerramento fiscal pendente vira retry; pedido e viagem viram link direto', () => {
        expect(exceptionAction({ category: 'FISCAL_ENCERRAMENTO_PENDENTE', orderId: null, manifestId: 'm1' }))
            .toMatchObject({ kind: 'retryFiscalClosure', manifestId: 'm1' });
        expect(exceptionAction({ category: 'OPERATIONAL_ARRIVAL_DIVERGENCE', orderId: 'o1', manifestId: 'm1' }))
            .toEqual({ kind: 'link', to: '/hubs/pedidos/o1', label: 'Abrir pedido' });
        expect(exceptionAction({ category: 'OPERATIONAL_TRIP_LATE', orderId: null, manifestId: 'm1' }))
            .toEqual({ kind: 'link', to: '/hubs/viagens/m1', label: 'Abrir viagem' });
        expect(exceptionAction({ category: 'GENERIC', orderId: null, manifestId: null })).toEqual({ kind: 'none' });
    });
});
