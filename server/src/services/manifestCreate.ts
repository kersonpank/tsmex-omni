import prisma from '../lib/prisma.js';
import { selectedManifestCity } from './manifestSelectedCity.js';
import { validateCreateManifestInput, type OperationalTripType } from './manifestLifecycle.js';

/**
 * Criação do rascunho de viagem (DRAFT) — caminho único usado pela rota POST /manifests
 * e pela consolidação a partir da fila de próximo salto.
 */
export interface ManifestDraftInput {
    vehicleTypeId: string;
    origin: string;
    originCity?: string;
    originState?: string;
    originCityIbgeCode?: string;
    destination: string;
    destinationCity?: string;
    destinationState?: string;
    destinationCityIbgeCode?: string;
    startsWithCollection?: boolean;
    tripType: OperationalTripType;
    destHubId?: string;
    stops?: { city: string; order: number }[];
}

interface ManifestDraftOptions {
    /** Rascunho operacional: o IBGE ausente continua como pendência bloqueante da viagem. */
    allowIncompleteHubCity?: boolean;
}

async function selectDraftCity(
    data: ManifestDraftInput,
    prefix: 'origin' | 'destination',
    hubId: string | undefined,
    allowIncompleteHubCity: boolean,
) {
    const cityKey = `${prefix}City` as const;
    const stateKey = `${prefix}State` as const;
    const codeKey = `${prefix}CityIbgeCode` as const;
    if (allowIncompleteHubCity && hubId && !data[cityKey] && !data[stateKey] && !data[codeKey]) {
        const hub = await prisma.hub.findUnique({
            where: { id: hubId },
            select: { city: true, state: true, cityIbgeCode: true },
        });
        if (hub && !hub.cityIbgeCode && hub.city && hub.state) {
            return {
                [prefix]: `${hub.city}, ${hub.state}`,
                [cityKey]: hub.city,
                [stateKey]: hub.state,
                [codeKey]: null,
            };
        }
    }
    return selectedManifestCity(data, prefix, hubId);
}

export async function createManifestDraft(
    data: ManifestDraftInput,
    hubId: string | undefined,
    options: ManifestDraftOptions = {},
) {
    await validateCreateManifestInput({
        vehicleTypeId: data.vehicleTypeId,
        origin: data.origin,
        destination: data.destination,
        tripType: data.tripType,
        hubId,
        destHubId: data.destHubId,
        stops: data.stops,
    });

    const allowIncompleteHubCity = options.allowIncompleteHubCity === true;
    const originSelection = await selectDraftCity(data, 'origin', hubId, allowIncompleteHubCity);
    const destinationSelection = await selectDraftCity(
        data,
        'destination',
        data.tripType === 'TRANSFER' ? data.destHubId : allowIncompleteHubCity && data.tripType === 'DELIVERY' ? hubId : undefined,
        allowIncompleteHubCity,
    );
    return prisma.manifest.create({
        data: {
            vehicleTypeId: data.vehicleTypeId,
            origin: data.origin,
            originCity: data.originCity,
            originState: data.originState,
            originCityIbgeCode: data.originCityIbgeCode,
            destination: data.destination,
            destinationCity: data.destinationCity,
            destinationState: data.destinationState,
            destinationCityIbgeCode: data.destinationCityIbgeCode,
            ...originSelection,
            ...destinationSelection,
            startsWithCollection: data.startsWithCollection ?? false,
            tripType: data.tripType,
            hubId,
            destHubId:
                data.tripType === 'TRANSFER' || data.tripType === 'TRANSFER_DELIVERY' ? data.destHubId : undefined,
            stops: data.stops ? data.stops : undefined,
        },
        include: {
            vehicleType: true,
            destHub: { select: { id: true, code: true, name: true } },
        },
    });
}
