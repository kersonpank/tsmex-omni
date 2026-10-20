/** Full operational fixture for departure tests; fiscal evidence is mocked separately. */
export function departureReadyManifest<T extends { legs: unknown[]; linkId?: string }>(base: T) {
    const address = { neighborhood: 'Centro', cep: '01001000', address: 'Rua A', number: '1', city: 'São Paulo', state: 'SP', cityIbgeCode: '3550308' };
    const linkId = base.linkId ?? 'link-ready';
    return {
        ...base,
        originCityIbgeCode: '3550308',
        destinationCityIbgeCode: '2105302',
        vehicleType: { ...((base as { vehicleType?: object }).vehicleType ?? {}), active: true },
        _count: { legs: base.legs.length },
        tripStops: [],
        plannedDepartureAt: new Date('2026-09-26T12:00:00Z'),
        fiscalEmitterId: 'emitter-ready',
        linkId,
        link: {
            id: linkId, approvalStatus: 'APPROVED', carrierType: 'FROTA', person: address,
            tractionUnit: { plate: 'ABC1D23', role: 'TRACTION', chassi: '9BWZZZ377VT004251', renavam: '12345678901', axles: 3, rntrc: '12345678', tareKg: 7200, capacityKg: 18000, bodyType: 'FechadaOuBau', wheelType: 'Cavalo', licensedState: 'SP' },
        },
        driverId: 'driver-ready',
        driver: { id: 'driver-ready', linkId, active: true, cnhNumber: '123456789', birthDate: new Date('1980-01-01'), person: address },
        freightAgreement: { id: 'freight-ready', freteBruto: 100 },
    };
}

export const authorizedCiotFixture = { documentType: 'CIOT', status: 'AUTHORIZED', protocol: 'ciot-test' };
export const authorizedMdfeFixture = {
    documentType: 'MDFE', accessKey: '1'.repeat(44), protocol: '123456789', xmlUrl: 'fiscal/mdfe/test.xml',
};

export function authorizedCteLegFixture(orderId: string) {
    return { orderId, order: { freightCalculations: [{ cteAccessKey: '2'.repeat(44), cteProtocol: '987654321', cteXml: '<cteProc />', cteXmlStorageKey: null }] } };
}
