import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import prisma from '../lib/prisma.js';
import { getManifestReadiness } from './manifestReadinessService.js';

const prismaSnapshot = {
    manifestFindUnique: prisma.manifest.findUnique.bind(prisma.manifest),
};

function restorePrismaMocks() {
    prisma.manifest.findUnique = prismaSnapshot.manifestFindUnique;
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
    state: 'SP',
};

const baseLink = {
    id: 'link-1',
    approvalStatus: 'APPROVED',
    rntrc: 'RNTRC123456',
    carrierType: 'TAC',
    vehicleAxles: 4,
    vehicleChassi: 'ABC123DEF456GHI78',
    vehiclePlate: 'ABC1234',
    vehicleRenavam: '12345678901',
    person: { ...completeAddress },
};

const baseDriver = {
    id: 'driver-1',
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
    freightAgreement: { id: 'fa-1', freteBruto: 1000 },
    tripStops: [],
    _count: { legs: 1 },
};

describe('manifestReadinessService', () => {
    beforeEach(() => restorePrismaMocks());
    afterEach(() => restorePrismaMocks());

    function mockWith(linkOverrides?: object, driverOverrides?: object, manifestOverrides?: object) {
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

    // --- Driver address ---

    it('driver person null → DRIVER_ADDRESS_PENDING blocking, canOffer false', async () => {
        mockWith(undefined, { person: null });
        const r = await getManifestReadiness('manifest-1');
        const issue = r.issues.find((i) => i.code === 'DRIVER_ADDRESS_PENDING');
        assert.ok(issue, 'DRIVER_ADDRESS_PENDING should be present');
        assert.equal(issue?.severity, 'blocking');
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

    // --- RENAVAM is warning only ---

    it('missing RENAVAM → VEHICLE_RENAVAM_PENDING warning, canOffer still true', async () => {
        mockWith({ vehicleRenavam: null });
        const r = await getManifestReadiness('manifest-1');
        const issue = r.issues.find((i) => i.code === 'VEHICLE_RENAVAM_PENDING');
        assert.ok(issue, 'VEHICLE_RENAVAM_PENDING should be present');
        assert.equal(issue?.severity, 'warning');
        assert.equal(r.canOffer, true);
    });

    // --- Expired CNH is warning ---

    it('expired CNH → DRIVER_CNH_EXPIRED warning', async () => {
        mockWith(undefined, { cnhExpiry: pastDate });
        const r = await getManifestReadiness('manifest-1');
        const issue = r.issues.find((i) => i.code === 'DRIVER_CNH_EXPIRED');
        assert.ok(issue, 'DRIVER_CNH_EXPIRED should be present');
        assert.equal(issue?.severity, 'warning');
    });

    // --- Link person address is warning ---

    it('link person with incomplete address → LINK_PERSON_ADDRESS_PENDING warning', async () => {
        mockWith({ person: { ...completeAddress, neighborhood: '' } });
        const r = await getManifestReadiness('manifest-1');
        const issue = r.issues.find((i) => i.code === 'LINK_PERSON_ADDRESS_PENDING');
        assert.ok(issue, 'LINK_PERSON_ADDRESS_PENDING should be present');
        assert.equal(issue?.severity, 'warning');
    });

    it('link person null → LINK_PERSON_ADDRESS_PENDING warning', async () => {
        mockWith({ person: null });
        const r = await getManifestReadiness('manifest-1');
        const issue = r.issues.find((i) => i.code === 'LINK_PERSON_ADDRESS_PENDING');
        assert.ok(issue, 'LINK_PERSON_ADDRESS_PENDING should be present when person is null');
        assert.equal(issue?.severity, 'warning');
    });
});
