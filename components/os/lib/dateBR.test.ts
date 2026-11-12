import { describe, expect, it } from 'vitest';
import {
    DATETIME_SHORTCUTS,
    displayDateBR,
    displayDateTimeBR,
    formatDateOnlyBR,
    formatDateTimeBR,
    maskDateBR,
    parseDateBR,
    parseDateTimeBR,
} from './dateBR';

describe('dateBR', () => {
    it('aplica máscara progressiva', () => {
        expect(maskDateBR('1', true)).toBe('1');
        expect(maskDateBR('12112026', false)).toBe('12/11/2026');
        expect(maskDateBR('121120261830', true)).toBe('12/11/2026 18:30');
        expect(maskDateBR('12/11/2026 18:30 99', true)).toBe('12/11/2026 18:30');
    });
    it('valida data real de calendário', () => {
        expect(parseDateBR('29/02/2027')).toBeNull();
        expect(parseDateBR('29/02/2028')).toBe('2028-02-29');
        expect(parseDateBR('31/04/2026')).toBeNull();
        expect(parseDateBR('12/11/26')).toBeNull();
    });
    it('valida hora 24 h', () => {
        expect(parseDateTimeBR('12/11/2026 18:30')).toBe('2026-11-12T18:30');
        expect(parseDateTimeBR('12/11/2026 24:00')).toBeNull();
        expect(parseDateTimeBR('12/11/2026 10:60')).toBeNull();
        expect(parseDateTimeBR('12/11/2026')).toBeNull();
    });
    it('exibe valores internos em dd/mm/aaaa', () => {
        expect(displayDateBR('2026-11-12')).toBe('12/11/2026');
        expect(displayDateTimeBR('2026-11-12T08:05')).toBe('12/11/2026 08:05');
        expect(displayDateBR('')).toBe('');
    });
    it('atalhos usam a hora local', () => {
        const now = new Date(2026, 10, 12, 9, 7);
        expect(DATETIME_SHORTCUTS.now.value(now)).toBe('2026-11-12T09:07');
        expect(DATETIME_SHORTCUTS.today18.value(now)).toBe('2026-11-12T18:00');
        expect(DATETIME_SHORTCUTS.tomorrow08.value(now)).toBe('2026-11-13T08:00');
    });
    it('formata instantes na hora local', () => {
        const d = new Date(2026, 10, 12, 18, 30);
        expect(formatDateTimeBR(d.toISOString())).toBe('12/11/2026 18:30');
        expect(formatDateOnlyBR(d)).toBe('12/11/2026');
        expect(formatDateTimeBR('lixo')).toBe('');
    });
});
