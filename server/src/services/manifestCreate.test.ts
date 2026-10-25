import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import prisma from '../lib/prisma.js';
import { createManifestDraft, type ManifestDraftInput } from './manifestCreate.js';
import { getManifestReadiness } from './manifestReadinessService.js';

describe('createManifestDraft — município incompleto apenas no rascunho da consolidação', () => {
    const originals = {
        hub: prisma.hub.findUnique,
        city: prisma.city.findUnique,
        vehicleType: prisma.vehicleType.findUnique,
        create: prisma.manifest.create,
        find: prisma.manifest.findUnique,
    };
    let originIbge: string | null;
    let destinationIbge: string | null;
    let saved: any;
    const transfer: ManifestDraftInput = {
        vehicleTypeId: 'vehicle', tripType: 'TRANSFER',
        origin: 'Guarulhos, SP', destination: 'Imperatriz, MA', destHubId: 'destination',
    };

    beforeEach(() => {
        originIbge = null;
        destinationIbge = null;
        saved = undefined;
        prisma.vehicleType.findUnique = (async () => ({ id: 'vehicle', active: true })) as any;
        prisma.hub.findUnique = (async ({ where }: any) => where.id === 'origin'
            ? { id: 'origin', city: 'Guarulhos', state: 'SP', cityIbgeCode: originIbge, active: true }
            : { id: 'destination', city: 'Imperatriz', state: 'MA', cityIbgeCode: destinationIbge, active: true }) as any;
        prisma.city.findUnique = (async ({ where }: any) => {
            if (where.ibgeCode === '3518800') return { name: 'Guarulhos', state: { code: 'SP' }, ibgeCode: '3518800' };
            if (where.ibgeCode === '2105302') return { name: 'Imperatriz', state: { code: 'MA' }, ibgeCode: '2105302' };
            return null;
        }) as any;
        prisma.manifest.create = (async ({ data }: any) => {
            saved = data;
            return { id: 'trip', ...data };
        }) as any;
        prisma.manifest.findUnique = (async () => ({
            ...saved, id: 'trip', status: 'DRAFT', vehicleType: { active: true },
            _count: { legs: 0 }, tripStops: [], driverAssignments: [],
        })) as any;
    });

    afterEach(() => {
        prisma.hub.findUnique = originals.hub;
        prisma.city.findUnique = originals.city;
        prisma.vehicleType.findUnique = originals.vehicleType;
        prisma.manifest.create = originals.create;
        prisma.manifest.findUnique = originals.find;
    });

    it('a criação padrão continua rejeitando hub sem IBGE', async () => {
        await assert.rejects(createManifestDraft(transfer, 'origin'), /Origem: selecione/);
        assert.equal(saved, undefined);
    });

    it('a consolidação cria transferência com cidades dos hubs e IBGE ausente, sem inferir códigos', async () => {
        await createManifestDraft(transfer, 'origin', { allowIncompleteHubCity: true });
        assert.equal(saved.originCity, 'Guarulhos');
        assert.equal(saved.originState, 'SP');
        assert.equal(saved.originCityIbgeCode, null);
        assert.equal(saved.destinationCity, 'Imperatriz');
        assert.equal(saved.destinationState, 'MA');
        assert.equal(saved.destinationCityIbgeCode, null);
        assert.equal(saved.destHubId, 'destination');
        assert.equal(saved.hubId, 'origin');
    });

    it('entrega local usa a cidade operacional do próprio hub', async () => {
        await createManifestDraft({ ...transfer, tripType: 'DELIVERY', destHubId: undefined }, 'origin', { allowIncompleteHubCity: true });
        assert.equal(saved.destination, 'Guarulhos, SP');
        assert.equal(saved.destinationCity, 'Guarulhos');
        assert.equal(saved.destinationState, 'SP');
        assert.equal(saved.destinationCityIbgeCode, null);
        assert.equal(saved.destHubId, undefined);
    });

    it('IBGE ausente continua bloqueando a prontidão e a saída', async () => {
        await createManifestDraft(transfer, 'origin', { allowIncompleteHubCity: true });
        const readiness = await getManifestReadiness('trip');
        for (const code of ['ORIGIN_IBGE_PENDING', 'DESTINATION_IBGE_PENDING']) {
            assert.equal(readiness.issues.find((issue) => issue.code === code)?.severity, 'blocking');
        }
        assert.equal(readiness.canOffer, false);
        assert.equal(readiness.canStart, false);
    });

    it('códigos configurados continuam validados e persistidos', async () => {
        originIbge = '3518800';
        destinationIbge = '2105302';
        await createManifestDraft(transfer, 'origin', { allowIncompleteHubCity: true });
        assert.equal(saved.originCityIbgeCode, '3518800');
        assert.equal(saved.destinationCityIbgeCode, '2105302');
    });

    it('não ignora código configurado inválido na origem ou no destino', async () => {
        originIbge = '9999999';
        await assert.rejects(createManifestDraft(transfer, 'origin', { allowIncompleteHubCity: true }), /não correspondem/);
        originIbge = '3518800';
        destinationIbge = '9999999';
        await assert.rejects(createManifestDraft(transfer, 'origin', { allowIncompleteHubCity: true }), /não correspondem/);
        assert.equal(saved, undefined);
    });

    it('não permite município digitado sem seleção mesmo com a opção de consolidação', async () => {
        await assert.rejects(createManifestDraft({ ...transfer, originCity: 'Campinas', originState: 'SP' }, 'origin', {
            allowIncompleteHubCity: true,
        }), /Origem: selecione/);
        assert.equal(saved, undefined);
    });
});
