import { describe, expect, it } from 'vitest';
import { categoryLabel, hoursText, parseTab, percentText, periodError, periodForPreset, periodFromParams, presetOf, routineLabel } from './desempenho';

const NOW = new Date(2026, 10, 23, 15, 0, 0);

describe('período', () => {
    it('7 dias inclui hoje', () => expect(periodForPreset('7', NOW)).toEqual({ from: '2026-11-17', to: '2026-11-23' }));
    it('mês atual e anterior', () => {
        expect(periodForPreset('mes', NOW)).toEqual({ from: '2026-11-01', to: '2026-11-23' });
        expect(periodForPreset('mes-anterior', NOW)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    });
    it('sem URL válida usa 30 dias; com URL respeita', () => {
        expect(periodFromParams(null, null, NOW)).toEqual(periodForPreset('30', NOW));
        expect(periodFromParams('2026-01-01', '2026-01-31', NOW)).toEqual({ from: '2026-01-01', to: '2026-01-31' });
        expect(periodFromParams('x', '2026-01-31', NOW)).toEqual(periodForPreset('30', NOW));
    });
    it('reconhece preset e personalizado', () => {
        expect(presetOf(periodForPreset('90', NOW), NOW)).toBe('90');
        expect(presetOf({ from: '2026-01-01', to: '2026-01-31' }, NOW)).toBe('custom');
    });
    it('valida limites', () => {
        expect(periodError({ from: '2026-02-01', to: '2026-01-01' })).toMatch(/depois/);
        expect(periodError({ from: '2024-01-01', to: '2026-01-01' })).toMatch(/366/);
        expect(periodError({ from: '2026-01-01', to: '2026-01-31' })).toBeNull();
    });
});

describe('formatação', () => {
    it('horas, percentuais, rótulos', () => {
        expect(hoursText(52)).toBe('2 d 4 h');
        expect(hoursText(0.5)).toBe('30 min');
        expect(hoursText(null)).toBe('—');
        expect(percentText(87.5)).toBe('87,5%');
        expect(percentText(null)).toBe('—');
        expect(categoryLabel('OPERATIONAL_TRIP_LATE')).toBe('Viagem atrasada');
        expect(categoryLabel('NOVA_COISA')).toBe('Nova coisa');
        expect(routineLabel('DESCONHECIDA')).toBe('Origem não identificada');
        expect(parseTab('caixa')).toBe('caixa');
        expect(parseTab('zzz')).toBe('operacao');
    });
});
