import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import prisma from '../lib/prisma.js';
import { getManifestReadiness } from './manifestReadinessService.js';

const prismaSnapshot = {
    manifestFindUnique: prisma.manifest.findUnique.bind(prisma.manifest),
    orderLegFindMany: prisma.orderLeg.findMany,
    fiscalFindMany: prisma.manifestFiscalDocument.findMany,
};

function restorePrismaMocks() {
    prisma.manifest.findUnique = prismaSnapshot.manifestFindUnique;
    prisma.orderLeg.findMany = prismaSnapshot.orderLegFindMany;
    prisma.manifestFiscalDocument.findMany = prismaSnapshot.fiscalFindMany;
}

// Dates used throughout
const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);

const completeAddress = {
    neighborhood: 'Centro',
    cep: '01001000',
    address: 'Rua Principal',
    number: '100',
    city: 'São Paulo',
    cityIbgeCode: '3550308',
    state: 'SP',
};

const baseLink = {
    id: 'link-1',
    approvalStatus: 'APPROVED',
    rntrc: '123456789',
    carrierType: 'TAC',
    vehicleAxles: 4,
    vehicleChassi: 'ABC123DEF456GHI78',
    vehiclePlate: 'ABC1234',
    vehicleRenavam: '12345678901',
    person: { ...completeAddress },
};

const baseDriver = {
    id: 'driver-1',
    name: 'João Silva',
    linkId: 'link-1',
    cnhNumber: '12345678901',
    cnhExpiry: futureDate,
    birthDate: new Date('1990-01-01'),
    person: { ...completeAddress },
};

const baseManifest = {
    id: 'manifest-1',
    status: 'DRAFT' as const,
    origin: 'São Paulo, SP',
    destination: 'Rio de Janeiro, RJ',
    originCityIbgeCode: '3550308',
    destinationCityIbgeCode: '3304557',
    vehicleType: { id: 'vt-1', active: true },
    tripType: 'COLLECTION',
    destHubId: null,
    plannedDepartureAt: new Date('2026-09-20T10:00:00Z'),
    plannedArrivalAt: new Date('2026-09-20T18:00:00Z'),
    fiscalEmitterId: 'fe-1',
    linkId: 'link-1',
    link: baseLink,
    driverId: 'driver-1',
    driver: baseDriver,
    driverAssignments: [],
    freightAgreement: { id: 'fa-1', freteBruto: 1000 },
    tripStops: [],
    _count: { legs: 1 },
};

describe('manifestReadinessService', () => {
    beforeEach(() => restorePrismaMocks());
    afterEach(() => restorePrismaMocks());

    function mockWith(linkOverrides?: object, driverOverrides?: object, manifestOverrides?: object) {
        prisma.orderLeg.findMany = (async () => []) as any;
        const link = linkOverrides !== undefined ? { ...baseLink, ...linkOverrides } : baseLink;
        const driver = driverOverrides !== undefined ? { ...baseDriver, ...driverOverrides } : baseDriver;
        prisma.manifest.findUnique = (async () => ({
            ...baseManifest,
            ...manifestOverrides,
            link,
            driver,
        })) as any;
    }

    it('base fixture: no blocking issues, canOffer true', async () => {
        mockWith();
        const r = await getManifestReadiness('manifest-1');
        const blocking = r.issues.filter((i) => i.severity === 'blocking');
        assert.equal(blocking.length, 0, `unexpected blocking: ${blocking.map((i) => i.code).join(', ')}`);
        assert.equal(r.canOffer, true);
    });

    it('permite planejar e ofertar com CT-e pendente, mostrando atenção nos pedidos', async () => {
        mockWith();
        prisma.orderLeg.findMany = (async () => [{ order: { freightCalculations: [] } }]) as any;
        const result = await getManifestReadiness('manifest-1');
        assert.equal(result.canOffer, true);
        assert.equal(result.steps.orders.state, 'attention');
        assert.ok(result.issues.some(item => item.code === 'ORDER_DOCUMENTATION_PENDING'));
    });

    it('bloqueia saída quando o segundo pedido não tem CT-e e não dispensa CIOT por FROTA', async () => {
        mockWith({ carrierType: 'FROTA' }, undefined, { status: 'ACCEPTED' });
        prisma.orderLeg.findMany = (async () => [
            { orderId: 'order-1', order: { freightCalculations: [{ cteAccessKey: '1'.repeat(44), cteProtocol: 'protocol', cteXml: '<xml/>' }] } },
            { orderId: 'order-2', order: { freightCalculations: [] } },
        ]) as any;
        prisma.manifestFiscalDocument.findMany = (async () => [{ documentType: 'MDFE', accessKey: '2'.repeat(44), protocol: 'protocol', xmlUrl: 'stored' }]) as any;
        const result = await getManifestReadiness('manifest-1');
        assert.equal(result.canStart, false);
        assert.ok(result.issues.some(item => item.code === 'CTE_AUTHORIZATION_REQUIRED' && item.field === 'order-2'));
        assert.ok(result.issues.some(item => item.code === 'CIOT_REQUIRED'));
    });

    it('transportador sem app só avisa (o hub opera a viagem — NORTE #24); motorista adicional inativo bloqueia', async () => {
        mockWith({ userId: null }, undefined, { driverAssignments: [{ isPrimary: false, driver: { id: 'driver-2', name: 'Segundo', active: false } }] });
        const result = await getManifestReadiness('manifest-1');
        assert.equal(result.canOffer, false);
        const access = result.issues.find(item => item.code === 'LINK_ACCESS_PENDING');
        assert.equal(access?.severity, 'warning');
        assert.ok(result.issues.some(item => item.code === 'ADDITIONAL_DRIVER_INVALID' && item.severity === 'blocking' && item.driverId === 'driver-2'));
    });

    it('não oferece viagem antiga sem composição confirmada, mesmo com placa no transportador', async () => {
        mockWith(undefined, undefined, { vehicleAssignments: [], compositionSnapshot: null });
        const readiness = await getManifestReadiness('manifest-1');
        assert.equal(readiness.canOffer, false);
        assert.ok(readiness.issues.some((item) => item.code === 'VEHICLE_PLATE_PENDING'));
    });

    // --- Driver address ---

    it('driver person null → DRIVER_ADDRESS_PENDING blocking, canOffer false', async () => {
        mockWith(undefined, { person: null });
        const r = await getManifestReadiness('manifest-1');
        const issue = r.issues.find((i) => i.code === 'DRIVER_ADDRESS_PENDING');
        assert.ok(issue, 'DRIVER_ADDRESS_PENDING should be present');
        assert.equal(issue?.severity, 'blocking');
        assert.equal(issue?.driverId, 'driver-1');
        assert.match(issue!.message, /^Motorista João Silva:/);
        assert.equal(r.canOffer, false);
    });

    it('driver person with empty cep → DRIVER_ADDRESS_PENDING blocking', async () => {
        mockWith(undefined, { person: { ...completeAddress, cep: '' } });
        const r = await getManifestReadiness('manifest-1');
        const issue = r.issues.find((i) => i.code === 'DRIVER_ADDRESS_PENDING');
        assert.ok(issue, 'DRIVER_ADDRESS_PENDING should be present when cep is empty');
        assert.equal(issue?.severity, 'blocking');
        assert.equal(r.canOffer, false);
    });

    // --- Vehicle fields ---

    it('link without chassi → VEHICLE_CHASSI_PENDING blocking, canOffer false', async () => {
        mockWith({ vehicleChassi: null });
        const r = await getManifestReadiness('manifest-1');
        const issue = r.issues.find((i) => i.code === 'VEHICLE_CHASSI_PENDING');
        assert.ok(issue, 'VEHICLE_CHASSI_PENDING should be present');
        assert.equal(issue?.severity, 'blocking');
        assert.equal(issue?.plate, 'ABC1234');
        assert.equal(issue?.field, 'vehicleChassi');
        assert.equal(issue?.message, 'Cavalo ABC1234: chassi obrigatório para emissão do CIOT.');
        assert.equal(r.canOffer, false);
    });

    it('link without axles → VEHICLE_AXLES_PENDING blocking, canOffer false', async () => {
        mockWith({ vehicleAxles: null });
        const r = await getManifestReadiness('manifest-1');
        const issue = r.issues.find((i) => i.code === 'VEHICLE_AXLES_PENDING');
        assert.ok(issue, 'VEHICLE_AXLES_PENDING should be present');
        assert.equal(issue?.severity, 'blocking');
        assert.equal(r.canOffer, false);
    });

    it('link without rntrc → VEHICLE_RNTRC_PENDING blocking, canOffer false', async () => {
        mockWith({ rntrc: null });
        const r = await getManifestReadiness('manifest-1');
        const issue = r.issues.find((i) => i.code === 'VEHICLE_RNTRC_PENDING');
        assert.ok(issue, 'VEHICLE_RNTRC_PENDING should be present');
        assert.equal(issue?.severity, 'blocking');
        assert.equal(r.canOffer, false);
    });

    // --- CNH and birthDate are blocking ---

    it('driver without cnhNumber → DRIVER_CNH_PENDING blocking, canOffer false', async () => {
        mockWith(undefined, { cnhNumber: null });
        const r = await getManifestReadiness('manifest-1');
        const issue = r.issues.find((i) => i.code === 'DRIVER_CNH_PENDING');
        assert.ok(issue, 'DRIVER_CNH_PENDING should be present');
        assert.equal(issue?.severity, 'blocking');
        assert.equal(r.canOffer, false);
    });

    it('driver without birthDate → DRIVER_BIRTH_DATE_PENDING blocking, canOffer false', async () => {
        mockWith(undefined, { birthDate: null });
        const r = await getManifestReadiness('manifest-1');
        const issue = r.issues.find((i) => i.code === 'DRIVER_BIRTH_DATE_PENDING');
        assert.ok(issue, 'DRIVER_BIRTH_DATE_PENDING should be present');
        assert.equal(issue?.severity, 'blocking');
        assert.equal(r.canOffer, false);
    });

    // --- RENAVAM é obrigatório (decisão do negócio: junto com chassi e eixos) ---

    it('missing RENAVAM → VEHICLE_RENAVAM_PENDING blocking, canOffer false', async () => {
        mockWith({ vehicleRenavam: null });
        const r = await getManifestReadiness('manifest-1');
        const issue = r.issues.find((i) => i.code === 'VEHICLE_RENAVAM_PENDING');
        assert.ok(issue, 'VEHICLE_RENAVAM_PENDING should be present');
        assert.equal(issue?.severity, 'blocking');
        assert.equal(r.canOffer, false);
    });

    // --- Unidade de Veículo: pendência só quando a unidade realmente não tem o dado ---

    const completeUnit = (overrides: object = {}) => ({
        id: 'unit-t', plate: 'ABC1D23', role: 'TRACTION', chassi: '9BWZZZ377VT004251', renavam: '12345678901',
        axles: 3, rntrc: '123456789', ...overrides,
    });
    const completeTrailerUnit = (overrides: object = {}) => ({ ...completeUnit(), id: 'unit-r', plate: 'REB1A11', role: 'TRAILER', ...overrides });
    const legacyEmpty = { vehiclePlate: null, vehicleChassi: null, vehicleAxles: null, rntrc: null, vehicleRenavam: null };

    it('identifica as pendências do cavalo da viagem, mesmo com cavalo padrão do transportador completo', async () => {
        mockWith({ tractionUnit: completeUnit({ id: 'unit-carrier', plate: 'GHN1C91' }) }, undefined, {
            vehicleAssignments: [{ slot: 0, vehicleUnit: completeUnit({ id: 'unit-trip', plate: 'NXP0710', chassi: null, renavam: null, axles: null }) }],
        });
        const r = await getManifestReadiness('manifest-1');
        const pending = r.issues.filter((item) => item.code.startsWith('VEHICLE_'));
        assert.deepEqual(pending.map((item) => item.code), ['VEHICLE_CHASSI_PENDING', 'VEHICLE_RENAVAM_PENDING', 'VEHICLE_AXLES_PENDING']);
        assert.deepEqual(pending.map((item) => item.field), ['vehicleChassi', 'vehicleRenavam', 'vehicleAxles']);
        for (const item of pending) {
            assert.equal(item.plate, 'NXP0710');
            assert.equal(item.vehicleUnitId, 'unit-trip');
            assert.match(item.message, /^Cavalo NXP0710:/);
        }
        assert.equal(r.canOffer, false);
    });

    it('identifica unidade e placa também nas pendências de MDF-e que bloqueiam a saída', async () => {
        mockWith(undefined, undefined, {
            status: 'ACCEPTED',
            vehicleAssignments: [{ slot: 0, vehicleUnit: completeUnit() }, { slot: 1, vehicleUnit: completeTrailerUnit() }],
        });
        prisma.manifestFiscalDocument.findMany = (async () => []) as any;
        const r = await getManifestReadiness('manifest-1');
        const pending = r.issues.filter((item) => item.code === 'MDFE_VEHICLE_DATA_PENDING' || item.code === 'MDFE_VEHICLE_CAPACITY_PENDING');
        assert.equal(pending.length, 4);
        for (const item of pending) {
            assert.equal(item.severity, 'blocking');
            assert.ok(item.vehicleUnitId === 'unit-t' || item.vehicleUnitId === 'unit-r');
            assert.equal(item.plate, item.vehicleUnitId === 'unit-t' ? 'ABC1D23' : 'REB1A11');
            assert.ok(item.message.startsWith(`${item.vehicleUnitId === 'unit-t' ? 'Cavalo' : 'Reboque'} ${item.plate}:`));
        }
    });

    it('identifica a unidade cujo responsável RNTRC tem endereço incompleto', async () => {
        mockWith(undefined, undefined, {
            vehicleAssignments: [{ slot: 0, vehicleUnit: completeUnit({
                rntrcHolderPerson: { id: 'holder-1', document: '12345678901', legalName: 'Proprietário', rntrc: '12345678', ...completeAddress, cep: null },
            }) }],
        });
        const r = await getManifestReadiness('manifest-1');
        const pending = r.issues.find((item) => item.code === 'RNTRC_HOLDER_ADDRESS_PENDING');
        assert.equal(pending?.vehicleUnitId, 'unit-t');
        assert.equal(pending?.plate, 'ABC1D23');
        assert.equal(pending?.field, 'rntrcHolder:holder-1');
        assert.match(pending!.message, /^Cavalo ABC1D23: endereço de Proprietário/);
    });

    it('cavalo e reboque completos na unidade → sem pendência de veículo, mesmo com colunas legadas vazias', async () => {
        mockWith({ ...legacyEmpty, tractionUnit: completeUnit(), trailer1Unit: completeTrailerUnit() });
        const r = await getManifestReadiness('manifest-1');
        assert.deepEqual(r.issues.filter((i) => i.code.startsWith('VEHICLE_') || i.code === 'TRAILER_UNIT_PENDING'), []);
        assert.equal(r.canOffer, true);
    });

    it('reboque sem chassi/RENAVAM/eixos/RNTRC → TRAILER_UNIT_PENDING blocking, sem pendência do cavalo', async () => {
        mockWith({ ...legacyEmpty, tractionUnit: completeUnit(), trailer1Unit: completeTrailerUnit({ chassi: null, renavam: null, axles: null, rntrc: null }) });
        const r = await getManifestReadiness('manifest-1');
        const issue = r.issues.find((i) => i.code === 'TRAILER_UNIT_PENDING');
        assert.ok(issue, 'TRAILER_UNIT_PENDING should be present');
        assert.equal(issue?.severity, 'blocking');
        assert.equal(issue?.field, 'trailerUnit:REB1A11');
        assert.equal(issue?.plate, 'REB1A11');
        assert.equal(issue?.vehicleUnitId, 'unit-r');
        assert.match(issue!.message, /REB1A11.*Chassi, RENAVAM, Número de eixos, RNTRC/);
        assert.equal(r.issues.some((i) => i.code.startsWith('VEHICLE_')), false);
        assert.equal(r.canOffer, false);
    });

    it('reboque só com placa legada (sem backfill) também gera pendência do reboque', async () => {
        mockWith({ trailerPlate: 'REB1A11' });
        const r = await getManifestReadiness('manifest-1');
        assert.ok(r.issues.some((i) => i.code === 'TRAILER_UNIT_PENDING' && i.field === 'trailerUnit:REB1A11'));
        assert.equal(r.canOffer, false);
    });

    it('chassi com tamanho errado é pendência de dado inválido, não de ausente', async () => {
        mockWith({ vehicleChassi: 'CURTO' });
        const r = await getManifestReadiness('manifest-1');
        const issue = r.issues.find((i) => i.code === 'VEHICLE_CHASSI_PENDING');
        assert.match(issue!.message, /inválido/);
    });

    // --- Expired CNH is warning ---

    it('expired CNH → DRIVER_CNH_EXPIRED warning', async () => {
        mockWith(undefined, { cnhExpiry: pastDate });
        const r = await getManifestReadiness('manifest-1');
        const issue = r.issues.find((i) => i.code === 'DRIVER_CNH_EXPIRED');
        assert.ok(issue, 'DRIVER_CNH_EXPIRED should be present');
        assert.equal(issue?.severity, 'warning');
        assert.equal(issue?.driverId, 'driver-1');
        assert.match(issue!.message, /^Motorista João Silva:/);
    });

    it('mantém os campos das pendências do motorista e inclui seu nome e id', async () => {
        mockWith(undefined, { cnhNumber: null, birthDate: null, person: null });
        const r = await getManifestReadiness('manifest-1');
        const pending = r.issues.filter((item) => item.code.startsWith('DRIVER_'));
        assert.deepEqual(pending.map((item) => item.code), ['DRIVER_CNH_PENDING', 'DRIVER_BIRTH_DATE_PENDING', 'DRIVER_ADDRESS_PENDING']);
        assert.deepEqual(pending.map((item) => item.field), ['driverId', 'driverId', 'driverAddress']);
        for (const item of pending) {
            assert.equal(item.driverId, 'driver-1');
            assert.match(item.message, /^Motorista João Silva:/);
        }
    });

    it('identifica a CNH pendente do motorista adicional', async () => {
        mockWith(undefined, undefined, {
            driverAssignments: [{ isPrimary: false, driver: { id: 'driver-2', name: 'Maria', active: true, linkId: 'link-1', cnhNumber: null } }],
        });
        const r = await getManifestReadiness('manifest-1');
        const pending = r.issues.find((item) => item.code === 'ADDITIONAL_DRIVER_CNH_PENDING');
        assert.equal(pending?.driverId, 'driver-2');
        assert.equal(pending?.field, 'driver-2');
        assert.match(pending!.message, /Maria/);
    });

    // --- Link person address is blocking ---

    it('link person with incomplete address → LINK_PERSON_ADDRESS_PENDING blocking', async () => {
        mockWith({ person: { ...completeAddress, neighborhood: '' } });
        const r = await getManifestReadiness('manifest-1');
        const issue = r.issues.find((i) => i.code === 'LINK_PERSON_ADDRESS_PENDING');
        assert.ok(issue, 'LINK_PERSON_ADDRESS_PENDING should be present');
        assert.equal(issue?.severity, 'blocking');
    });

    it('link person null → LINK_PERSON_ADDRESS_PENDING blocking', async () => {
        mockWith({ person: null });
        const r = await getManifestReadiness('manifest-1');
        const issue = r.issues.find((i) => i.code === 'LINK_PERSON_ADDRESS_PENDING');
        assert.ok(issue, 'LINK_PERSON_ADDRESS_PENDING should be present when person is null');
        assert.equal(issue?.severity, 'blocking');
    });
});
