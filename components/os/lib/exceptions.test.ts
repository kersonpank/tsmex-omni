import { describe, expect, it } from 'vitest';
import { ageLabel, dueLabel, exceptionAction, exceptionExplain, groupExceptions, spanLabel } from './exceptions';

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

describe('explicação e agrupamento', () => {
    const item = (id: string, category: string) => ({ id, category }) as never;
    it('cada categoria diz por que aparece e o que fazer; categoria desconhecida tem texto genérico', () => {
        expect(exceptionExplain('OPERATIONAL_STOCK_AGING').why).toMatch(/parada/);
        expect(exceptionExplain('OPERATIONAL_UNROUTED').what).toMatch(/endereço/);
        expect(exceptionExplain('XYZ').why).toMatch(/precisa de uma pessoa/);
    });
    it('agrupa a partir de 3 do mesmo tipo e mantém a ordem', () => {
        const rows = groupExceptions([item('1', 'OPERATIONAL_STOCK_AGING'), item('2', 'OPERATIONAL_TRIP_LATE'), item('3', 'OPERATIONAL_STOCK_AGING'), item('4', 'OPERATIONAL_STOCK_AGING')]);
        expect(rows.map((r) => r.kind)).toEqual(['group', 'single']);
        expect(rows[0].kind === 'group' && rows[0].items.map((i) => i.id)).toEqual(['1', '3', '4']);
        expect(groupExceptions([item('1', 'A'), item('2', 'A')]).every((r) => r.kind === 'single')).toBe(true);
    });
});
