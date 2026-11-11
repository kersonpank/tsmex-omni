import { describe, expect, it } from 'vitest';
import { manifestIssueTarget } from './manifestIssueTarget';
describe('destino de correção das pendências', () => {
    it('leva RNTRC e tipo do contratado ao cadastro do transportador', () => {
        expect(manifestIssueTarget('LINK_RNTRC_PENDING')).toBe('carrier');
        expect(manifestIssueTarget('LINK_CARRIER_TYPE_PENDING')).toBe('carrier');
    });
    it('distingue endereço do contratado, titular RNTRC, veículo e motorista', () => {
        expect(manifestIssueTarget('LINK_PERSON_ADDRESS_PENDING')).toBe('carrierAddress');
        expect(manifestIssueTarget('RNTRC_HOLDER_ADDRESS_PENDING')).toBe('rntrcHolder');
        expect(manifestIssueTarget('VEHICLE_AXLES_PENDING')).toBe('vehicle');
        expect(manifestIssueTarget('DRIVER_PHONE_PENDING')).toBe('driver');
        expect(manifestIssueTarget('ADDITIONAL_DRIVER_INVALID')).toBe('driver');
    });
});
