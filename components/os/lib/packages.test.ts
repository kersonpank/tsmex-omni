import { describe, expect, it } from 'vitest';
import { cubedWeightKg, isCubageInformed, packagesVolumeM3, parsePackageRows, parseTotalM3, volumeCountCheck } from './packages';

describe('cubagem por volume', () => {
    it('soma qtd × C×L×A em m³ e ignora linhas incompletas', () => {
        const rows = [
            { quantity: '10', lengthCm: '50', widthCm: '40', heightCm: '30' },
            { quantity: '', lengthCm: '', widthCm: '', heightCm: '' },
            { quantity: '2', lengthCm: '10', widthCm: '', heightCm: '10' },
        ];
        const parsed = parsePackageRows(rows);
        expect(parsed).toHaveLength(1);
        expect(packagesVolumeM3(parsed)).toBe(0.6);
        expect(cubedWeightKg(0.6)).toBe(180);
    });
    it('aceita vírgula decimal', () => {
        expect(packagesVolumeM3(parsePackageRows([{ quantity: '1', lengthCm: '100,5', widthCm: '100', heightCm: '100' }]))).toBe(1.005);
        expect(parseTotalM3('2,5')).toBe(2.5);
    });
    it('m³ de placeholder não conta como informado', () => {
        expect(isCubageInformed(0.001)).toBe(false);
        expect(isCubageInformed(0)).toBe(false);
        expect(isCubageInformed(undefined)).toBe(false);
        expect(isCubageInformed(0.6)).toBe(true);
    });
});

describe('conferência de volumes com a NF', () => {
    const rows = (...qty: string[]) => qty.map((quantity) => ({ quantity, lengthCm: '10', widthCm: '10', heightCm: '10' }));

    it('avisa quando passa do total da NF', () => {
        const check = volumeCountCheck(rows('12'), 10);
        expect(check.status).toBe('over');
        expect(check.message).toBe('As medidas somam 12 volumes; a NF tem 10. Confira antes de salvar.');
    });

    it('avisa quando faltam volumes medidos', () => {
        const check = volumeCountCheck(rows('5', '3'), 10);
        expect(check.status).toBe('under');
        expect(check.message).toBe('As medidas somam 8 volumes; a NF tem 10 — faltam 2 volumes medidos.');
    });

    it('confirma quando bate', () => {
        const check = volumeCountCheck(rows('4', '6'), 10);
        expect(check.status).toBe('match');
        expect(check.message).toBe('Bate com a NF (10 volumes)');
    });

    it('fica desconhecido sem total da NF ou sem linhas completas', () => {
        expect(volumeCountCheck(rows('3'), null).status).toBe('unknown');
        expect(volumeCountCheck(rows('3'), 0).status).toBe('unknown');
        expect(volumeCountCheck([{ quantity: '', lengthCm: '', widthCm: '', heightCm: '' }], 10).status).toBe('unknown');
    });
});
