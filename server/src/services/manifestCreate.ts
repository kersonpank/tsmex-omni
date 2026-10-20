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

export async function createManifestDraft(data: ManifestDraftInput, hubId: string | undefined) {
    await validateCreateManifestInput({
        vehicleTypeId: data.vehicleTypeId,
        origin: data.origin,
        destination: data.destination,
        tripType: data.tripType,
        hubId,
        destHubId: data.destHubId,
        stops: data.stops,
    });

    const originSelection = await selectedManifestCity(data, 'origin', hubId);
    const destinationSelection = await selectedManifestCity(
        data,
        'destination',
        data.tripType === 'TRANSFER' ? data.destHubId : undefined,
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
