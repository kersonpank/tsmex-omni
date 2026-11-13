import { describe, expect, it } from 'vitest';
import { carrierKindOptions, emptyVehicleType, newCarrierBody, newCarrierErrors, pendingItems, vehicleTypeBody, vehicleTypeErrors, type NewCarrierDraft } from './redeFrota';

const draft = (extra: Partial<NewCarrierDraft> = {}): NewCarrierDraft => ({ document: '52998224725', name: 'José', phone: '(99) 98888-7777', vehiclePlate: '', vehicleTypeId: '', homeBase: '', carrierType: '', ...extra });

describe('redeFrota', () => {
    it('tipos por documento', () => {
        expect(carrierKindOptions('529.982.247-25')).toEqual(['TAC']);
        expect(carrierKindOptions('11222333000181')).toEqual(['ETC', 'CTC', 'FROTA']);
        expect(carrierKindOptions('123')).toEqual([]);
    });

    it('valida e monta o corpo do novo transportador', () => {
        expect(newCarrierErrors(draft())).toEqual({});
        expect(newCarrierErrors(draft({ document: '11222333000181' })).carrierType).toBeTruthy();
        expect(newCarrierErrors(draft({ vehiclePlate: 'ABC' })).vehiclePlate).toBeTruthy();
        expect(newCarrierBody(draft({ vehiclePlate: 'abc-1d23' }))).toEqual({ document: '52998224725', name: 'José', phone: '99988887777', vehiclePlate: 'ABC1D23' });
        expect(newCarrierBody(draft({ document: '11222333000181', carrierType: 'CTC' })).carrierType).toBe('CTC');
    });

    it('pendências levam ao item certo', () => {
        const items = pendingItems({ carrierIssues: ['endereço'], units: [{ plate: 'ABC1D23', role: 'TRACTION', issues: ['RENAVAM'] }], drivers: [] } as never);
        expect(items.map((i) => i.target.kind)).toEqual(['carrier', 'unit', 'new-driver']);
        expect(pendingItems({ carrierIssues: [], units: [], drivers: [] } as never).map((i) => i.key)).toEqual(['no-traction', 'no-driver']);
    });

    it('valida tipo de veículo', () => {
        expect(Object.keys(vehicleTypeErrors(emptyVehicleType())).sort()).toEqual(['code', 'maxValue', 'maxVolume', 'maxWeight', 'name']);
        expect(vehicleTypeBody({ ...emptyVehicleType(), name: ' Truck ', code: 'tk', maxWeight: 1, maxVolume: 2, maxValue: 3 }).code).toBe('TK');
    });
});
