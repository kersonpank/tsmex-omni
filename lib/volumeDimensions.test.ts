import { describe, expect, it } from 'vitest';
import {
    allVolumeRowsComplete,
    cmNumberToFormString,
    normalizeDecimalInput,
    parseCmDimension,
    parseRowDimsCm,
    totalCubedM3FromRows,
    volumeCmStringsToStored,
    volumeRowIsComplete,
} from './volumeDimensions';

describe('normalizeDecimalInput', () => {
    it('troca vírgula por ponto e remove espaços', () => {
        expect(normalizeDecimalInput(' 1,25 ')).toBe('1.25');
        expect(normalizeDecimalInput('10 0')).toBe('100');
    });
});

describe('parseCmDimension', () => {
    it('retorna null para vazio ou só ponto', () => {
        expect(parseCmDimension('')).toBeNull();
        expect(parseCmDimension('   ')).toBeNull();
        expect(parseCmDimension('.')).toBeNull();
    });
    it('retorna null se termina em ponto (digitação incompleta)', () => {
        expect(parseCmDimension('1.')).toBeNull();
        expect(parseCmDimension('12.')).toBeNull();
    });
    it('aceita decimais', () => {
        expect(parseCmDimension('1.25')).toBe(1.25);
        expect(parseCmDimension('0.25')).toBe(0.25);
        expect(parseCmDimension('1,12')).toBe(1.12);
    });
});

describe('parseRowDimsCm', () => {
    it('retorna null se algum lado inválido ou ≤ 0', () => {
        expect(parseRowDimsCm({ qty: 1, altCm: '1', largCm: '', compCm: '1' })).toBeNull();
        expect(parseRowDimsCm({ qty: 1, altCm: '0', largCm: '1', compCm: '1' })).toBeNull();
    });
    it('retorna dimensões quando válidas', () => {
        expect(parseRowDimsCm({ qty: 2, altCm: '0.25', largCm: '1.12', compCm: '1.25' })).toEqual({
            a: 0.25,
            l: 1.12,
            c: 1.25,
        });
    });
});

describe('totalCubedM3FromRows', () => {
    it('soma cubagem em m³ (cm³ / 1e6) sem perder volumes pequenos por float', () => {
        const m3 = totalCubedM3FromRows([
            { qty: 2, altCm: '0.25', largCm: '1.12', compCm: '1.25' },
        ]);
        // 2 × 0,25 × 1,12 × 1,25 cm³ = 0,7 cm³ = 7e-7 m³
        expect(m3).toBeCloseTo(7e-7, 12);
    });
    it('ignora linha incompleta', () => {
        expect(
            totalCubedM3FromRows([
                { qty: 1, altCm: '1.', largCm: '1', compCm: '1' },
            ]),
        ).toBe(0);
    });
});

describe('cmNumberToFormString / volumeCmStringsToStored', () => {
    it('cmNumberToFormString', () => {
        expect(cmNumberToFormString(0)).toBe('');
        expect(cmNumberToFormString(1.25)).toBe('1.25');
    });
    it('volumeCmStringsToStored', () => {
        expect(
            volumeCmStringsToStored({ qty: 1, alturaCm: '10', larguraCm: '20', comprimentoCm: '30' }),
        ).toEqual({ qty: 1, altura: 10, largura: 20, comprimento: 30 });
        expect(volumeCmStringsToStored({ qty: 1, alturaCm: '1.', larguraCm: '1', comprimentoCm: '1' })).toBeNull();
    });
});

describe('volumeRowIsComplete / allVolumeRowsComplete', () => {
    it('exige qty e três lados > 0', () => {
        expect(volumeRowIsComplete({ qty: 0, altCm: '1', largCm: '1', compCm: '1' })).toBe(false);
        expect(volumeRowIsComplete({ qty: 1, altCm: '1', largCm: '1', compCm: '1' })).toBe(true);
    });
    it('allVolumeRowsComplete', () => {
        expect(
            allVolumeRowsComplete([
                { qty: 1, altCm: '1', largCm: '1', compCm: '1' },
                { qty: 2, altCm: '0.5', largCm: '2', compCm: '3' },
            ]),
        ).toBe(true);
        expect(
            allVolumeRowsComplete([{ qty: 1, altCm: '1', largCm: '1', compCm: '' }]),
        ).toBe(false);
    });
});
