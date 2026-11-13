import { describe, expect, it } from 'vitest';
import { certificateView, nfeCountRows, sameRoles, sortEmitters, toggleManualRole } from './sistema';

const now = new Date('2026-11-13T12:00:00Z');
const day = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString();

describe('certificateView', () => {
    it('vencido é vermelho', () => {
        expect(certificateView({ certificateStatus: 'READY', certificateExpiresAt: day(-3) }, now)).toMatchObject({ tone: 'red', label: 'Vencido' });
        expect(certificateView({ certificateStatus: 'EXPIRED', certificateExpiresAt: null }, now).tone).toBe('red');
    });
    it('até 30 dias é amarelo, depois disso em dia', () => {
        expect(certificateView({ certificateStatus: 'READY', certificateExpiresAt: day(30) }, now).tone).toBe('yellow');
        expect(certificateView({ certificateStatus: 'READY', certificateExpiresAt: day(31) }, now).tone).toBe('neutral');
    });
    it('sem certificado é vermelho', () => {
        expect(certificateView({ certificateStatus: 'MISSING', certificateExpiresAt: null }, now).tone).toBe('red');
    });
});

describe('sortEmitters', () => {
    it('pior primeiro, inativo ao fim', () => {
        const list = [
            { id: 'ok', active: true, certificateStatus: 'READY' as const, certificateExpiresAt: day(200) },
            { id: 'off', active: false, certificateStatus: 'EXPIRED' as const, certificateExpiresAt: day(-9) },
            { id: 'venc', active: true, certificateStatus: 'EXPIRED' as const, certificateExpiresAt: day(-1) },
            { id: 'breve', active: true, certificateStatus: 'READY' as const, certificateExpiresAt: day(5) },
        ];
        expect(sortEmitters(list, now).map((e) => e.id)).toEqual(['venc', 'breve', 'ok', 'off']);
    });
});

describe('nfeCountRows', () => {
    it('traduz, mantém a ordem e destaca falhas', () => {
        const rows = nfeCountRows({ FAILED: 2, DISCOVERED: 5, NOVA: 1 });
        expect(rows[0]).toMatchObject({ status: 'DISCOVERED', label: 'Descoberta', count: 5 });
        expect(rows.find((r) => r.status === 'FAILED')).toMatchObject({ tone: 'red', label: 'Falhou' });
        expect(rows[rows.length - 1]).toMatchObject({ status: 'NOVA', label: 'Outra situação' });
    });
    it('aceita ausência de contagem', () => {
        expect(nfeCountRows(null).every((r) => r.count === 0)).toBe(true);
    });
});

describe('papéis do status manual', () => {
    it('Administrador não sai', () => {
        expect(toggleManualRole(['ADMIN', 'HUB'], 'ADMIN', false)).toEqual(['ADMIN', 'HUB']);
    });
    it('marca e desmarca Hub', () => {
        expect(toggleManualRole(['ADMIN'], 'HUB', true)).toEqual(['ADMIN', 'HUB']);
        expect(toggleManualRole(['ADMIN', 'HUB'], 'HUB', false)).toEqual(['ADMIN']);
    });
    it('compara sem depender da ordem nem do ADMIN', () => {
        expect(sameRoles(['HUB', 'ADMIN'], ['HUB'])).toBe(true);
        expect(sameRoles(['HUB'], ['LINK'])).toBe(false);
    });
});
