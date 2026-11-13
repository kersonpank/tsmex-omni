import { describe, expect, it } from 'vitest';
import type { Link } from '../../../types/index';
import { approvalCounts, approvalVehicleType, matchesCarrier, sortApproved } from './redeCarriers';

const link = (extra: Partial<Link>): Link => ({ id: 'l', name: 'José Açaí', document: '123.456.789-09', vehiclePlate: 'ABC1D23', approvalStatus: 'PENDING', score: 0, ...extra }) as Link;

describe('redeCarriers', () => {
    it('conta por situação', () => {
        expect(approvalCounts([link({}), link({ approvalStatus: 'APPROVED' }), link({ approvalStatus: 'APPROVED' })])).toEqual({ PENDING: 1, APPROVED: 2, REJECTED: 0, SUSPENDED: 0 });
    });

    it('busca por nome sem acento, documento e placa', () => {
        const l = link({ trailerPlate: 'XYZ9K88' });
        expect(matchesCarrier(l, 'jose acai')).toBe(true);
        expect(matchesCarrier(l, '12345678909')).toBe(true);
        expect(matchesCarrier(l, 'abc-1d23')).toBe(true);
        expect(matchesCarrier(l, 'xyz9')).toBe(true);
        expect(matchesCarrier(l, 'maria')).toBe(false);
        expect(matchesCarrier(l, '')).toBe(true);
    });

    it('aprovação usa o tipo escolhido ou o já cadastrado', () => {
        expect(approvalVehicleType({ vehicleTypeId: undefined }, undefined)).toBeNull();
        expect(approvalVehicleType({ vehicleTypeId: 'v1' }, undefined)).toBe('v1');
        expect(approvalVehicleType({ vehicleTypeId: 'v1' }, 'v2')).toBe('v2');
    });

    it('aprovados: melhor nota primeiro', () => {
        expect(sortApproved([link({ name: 'A', score: 3 }), link({ name: 'B', score: 5 })]).map((l) => l.name)).toEqual(['B', 'A']);
    });
});
