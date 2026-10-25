import { describe, expect, it } from 'vitest';
import type { Driver, ManifestReadinessIssue, VehicleUnit } from '../../../types/index';
import type { RegistryUnit } from './carrier';
import { completeTractionSuggestion, tripRegistryDrivers, tripRegistryUnits } from './tripRegistry';

const issue = (partial: Partial<ManifestReadinessIssue>): ManifestReadinessIssue => ({
    step: 'responsible', code: 'VEHICLE_CHASSI_PENDING', message: 'Cavalo NXP0710: chassi obrigatório.', severity: 'blocking', ...partial,
});
const traction: VehicleUnit = { id: 'trip-traction', plate: 'NXP0710', role: 'TRACTION', chassi: null, renavam: null, axles: null };
const trailer: VehicleUnit = { id: 'trip-trailer', plate: 'ABC1D23', role: 'TRAILER' };
const assignments = [{ slot: 1, vehicleUnit: trailer }, { slot: 0, vehicleUnit: traction }];
const standard: RegistryUnit = { id: 'carrier-traction', plate: 'GHN1C91', role: 'TRACTION', issues: [] };
const primary: Driver = { id: 'primary', name: 'José', document: '12345678900', phone: '11912345678', linkId: 'carrier', active: true };
const additional: Driver = { ...primary, id: 'additional', name: 'João' };

describe('cadastro da composição da viagem', () => {
    it('lista assignments por slot e identifica NXP0710, sem trazer GHN1C91 do transportador', () => {
        const missing = issue({ plate: traction.plate, vehicleUnitId: traction.id });
        const units = tripRegistryUnits({ vehicleAssignments: assignments }, [missing]);
        expect(units.map((unit) => unit.plate)).toEqual(['NXP0710', 'ABC1D23']);
        expect(units[0].readinessIssues).toEqual([missing]);
        expect(units[1].readinessIssues).toEqual([]);
        expect(units[0]).toMatchObject({ id: traction.id, chassi: null, renavam: null, axles: null });
    });

    it('ID prevalece sobre placa e campo, sem atribuir ao veículo errado', () => {
        const missing = issue({ vehicleUnitId: trailer.id, plate: traction.plate, field: 'vehicleChassi' });
        const units = tripRegistryUnits({ vehicleAssignments: assignments }, [missing]);
        expect(units[0].readinessIssues).toEqual([]);
        expect(units[1].readinessIssues).toEqual([missing]);
    });

    it('separa pendências legadas por placa e campos genéricos do cavalo', () => {
        const plateIssue = issue({ plate: 'abc-1d23' });
        const fieldIssue = issue({ code: 'MDFE_VEHICLE_CAPACITY_PENDING', field: 'vehicleUnit:ABC1D23' });
        const generic = issue({ field: 'vehicleChassi' });
        const driverIssue = issue({ code: 'DRIVER_CNH_PENDING', driverId: primary.id });
        const units = tripRegistryUnits({ vehicleAssignments: assignments }, [plateIssue, fieldIssue, generic, driverIssue]);
        expect(units[0].readinessIssues).toEqual([generic]);
        expect(units[1].readinessIssues).toEqual([plateIssue, fieldIssue]);
    });

    it('preserva o responsável RNTRC da unidade, inclusive seu nome e documento', () => {
        const holder = { id: 'owner', legalName: 'Proprietário', document: '01234567890', state: 'SP', rntrc: '12345678' };
        const units = tripRegistryUnits({ vehicleAssignments: [{ slot: 0, vehicleUnit: { ...traction, rntrcHolderPerson: holder } }] }, []);
        expect(units[0].rntrcHolder).toEqual({ personId: holder.id, name: holder.legalName, document: holder.document, state: 'SP', rntrc: holder.rntrc });
    });

    it('não usa composição padrão como fallback quando não há assignments', () => {
        expect(tripRegistryUnits({}, [])).toEqual([]);
    });
});

describe('motoristas da viagem', () => {
    const trip = {
        driver: primary, driverId: primary.id,
        driverAssignments: [
            { driverId: additional.id, sequence: 1, isPrimary: false, driver: additional },
            { driverId: primary.id, sequence: 0, isPrimary: true, driver: primary },
        ],
    };

    it('lista cada motorista uma vez e associa o problema ao ID do condutor correto', () => {
        const first = issue({ code: 'DRIVER_CNH_PENDING', driverId: primary.id });
        const second = issue({ code: 'ADDITIONAL_DRIVER_CNH_PENDING', driverId: additional.id });
        const drivers = tripRegistryDrivers(trip, [first, second]);
        expect(drivers.map((driver) => driver.id)).toEqual([primary.id, additional.id]);
        expect(drivers[0].readinessIssues).toEqual([first]);
        expect(drivers[1].readinessIssues).toEqual([second]);
    });

    it('compatibiliza readiness legado do principal e do adicional sem misturar veículos', () => {
        const first = issue({ code: 'DRIVER_ADDRESS_PENDING', field: 'driverAddress' });
        const second = issue({ code: 'ADDITIONAL_DRIVER_CNH_PENDING', field: additional.id });
        const drivers = tripRegistryDrivers(trip, [first, second, issue({ vehicleUnitId: traction.id })]);
        expect(drivers[0].readinessIssues).toEqual([first]);
        expect(drivers[1].readinessIssues).toEqual([second]);
    });
});

describe('sugestão de cavalo com cadastro completo', () => {
    it('propõe GHN1C91 e mantém os reboques escolhidos na viagem na ordem dos slots', () => {
        const next = completeTractionSuggestion({ status: 'DRAFT', vehicleAssignments: assignments }, { units: [standard] });
        expect(next).toEqual({ traction: { plate: 'GHN1C91' }, trailers: [{ plate: 'ABC1D23' }] });
    });

    it('não oferece unidade incompleta, a placa atual nem troca após confirmar a viagem', () => {
        const trip = { status: 'DRAFT' as const, vehicleAssignments: assignments };
        expect(completeTractionSuggestion(trip, { units: [{ ...standard, issues: ['RENAVAM'] }] })).toBeNull();
        expect(completeTractionSuggestion(trip, { units: [{ ...standard, plate: traction.plate }] })).toBeNull();
        expect(completeTractionSuggestion({ ...trip, status: 'ACCEPTED' }, { units: [standard] })).toBeNull();
    });
});
