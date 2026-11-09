import { describe, expect, it } from 'vitest';
import type { AnttFloor } from '../../../types/index';
import { ceilAnttCents, distanceSuggestionCaption, formatAnttFloor, formatAnttMoney, isBelowAnttFloor } from './ciot';

const floor: AnttFloor = { value: 25236.13, ccd: 8.2727, cc: 831.66, eixos: 7, eixosUsed: 7, tipoCarga: 5, table: 'A', version: 'SUROC-22-2026', legalReference: 'Portaria SUROC 22/2026', distanceKm: 2950 };
describe('piso ANTT editável', () => {
    it('formata moeda, coeficientes, distância e referência em pt-BR', () => {
        expect(formatAnttMoney(floor.value!).replace(/\s/g, ' ')).toBe('R$ 25.236,13');
        expect(formatAnttFloor(floor)).toContain('2.950 km × 8,2727 + 831,66 (carga geral, 7 eixos · Portaria SUROC 22/2026)');
    });
    it('compara centavos, sem adicionar pedágio', () => {
        expect(isBelowAnttFloor(25000, floor)).toBe(true);
        expect(isBelowAnttFloor(25236.13, floor)).toBe(false);
        expect(isBelowAnttFloor(26000, floor)).toBe(false);
        expect(isBelowAnttFloor(NaN, floor)).toBe(false);
        expect(isBelowAnttFloor(25000, { ...floor, value: null })).toBe(false);
    });
    it('exibe motivos indisponíveis e a coluna superior utilizada', () => {
        expect(formatAnttFloor({ ...floor, value: null, reason: 'Informe os eixos de cada placa' })).toBe('Informe os eixos de cada placa');
        expect(formatAnttFloor({ ...floor, eixos: 8, eixosUsed: 9 })).toContain('8 eixos, coluna de 9');
    });
    it('aplica arredondamento para cima sem acrescentar centavo a valor exato', () => {
        expect(ceilAnttCents(25236.13)).toBe(25236.13);
        expect(ceilAnttCents(25236.131)).toBe(25236.14);
    });
    it('identifica cada fonte da sugestão de distância', () => {
        expect(distanceSuggestionCaption({ distanceKm: 2996, distanceSource: 'OSRM' })).toBe('Sugerido: 2.996 km (rota OSRM)');
        expect(distanceSuggestionCaption({ distanceKm: 2996, distanceSource: 'GOOGLE' })).toContain('(Google Maps)');
        expect(distanceSuggestionCaption({ distanceKm: 2900, distanceSource: 'ESTIMATE' })).toContain('(estimativa em linha reta — confira)');
        expect(distanceSuggestionCaption({ distanceKm: null })).toBeNull();
    });
});
