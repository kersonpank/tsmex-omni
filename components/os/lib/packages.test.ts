import { describe, expect, it } from 'vitest';
import { cubedWeightKg, isCubageInformed, packagesVolumeM3, parsePackageRows, parseTotalM3 } from './packages';

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
