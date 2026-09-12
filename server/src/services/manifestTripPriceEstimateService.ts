import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { buildTripPriceEstimate, type TripPriceEstimate } from './tripPriceEstimateService.js';

function cleanCity(value: string | null | undefined): string {
    return (value ?? '').split(/[,|-]/)[0].trim();
}

function calculateLinkAgreementValue(agreement: any, manifest: any): number | null {
    if (!agreement) return null;
    if (agreement.costMode === 'PER_M3') return (agreement.ratePerM3 ?? 0) * manifest.totalVolume;
    if (agreement.costMode === 'PER_KG') return (agreement.ratePerKg ?? 0) * manifest.totalWeight;
    return agreement.flatRate ?? null;
}

export interface ManifestTripPriceEstimate extends TripPriceEstimate {
    sources: {
        linkFreight: 'CARTA_FRETE' | 'ACORDO_LINK' | 'UNAVAILABLE';
        toll: 'CARTA_FRETE' | 'ROUTE_PROVIDER_UNAVAILABLE';
        anttFloor: 'ANTT_PROVIDER_UNAVAILABLE';
    };
}

/**
 * Prévia auditável da viagem. Não escreve nem substitui a Carta Frete negociada.
 * A integração de rota/pedágio e tabela ANTT será adicionada por adapters separados.
 */
export async function getManifestTripPriceEstimate(manifestId: string): Promise<ManifestTripPriceEstimate> {
    const manifest = await prisma.manifest.findUnique({
        where: { id: manifestId },
        include: {
            link: true,
            vehicleType: true,
            freightAgreement: true,
            orders: {
                include: {
                    freightCalculations: { orderBy: { createdAt: 'desc' }, take: 1 },
                },
            },
        },
    });
    if (!manifest) throw new AppError('Manifest not found', 404);

    const orderFreights = manifest.orders
        .map((order) => order.freightCalculations[0]?.freightTotal ?? null)
        .filter((value): value is number => value !== null && value > 0);
    const orderFreightMissingCount = manifest.orders.length - orderFreights.length;

    let suggestedFreteBruto: number | null = manifest.freightAgreement?.freteBruto ?? null;
    let linkFreightSource: ManifestTripPriceEstimate['sources']['linkFreight'] = manifest.freightAgreement ? 'CARTA_FRETE' : 'UNAVAILABLE';
    if (suggestedFreteBruto === null && manifest.link && manifest.vehicleType) {
        const agreement = await prisma.linkPricingAgreement.findFirst({
            where: {
                linkId: manifest.link.id,
                originCity: { contains: cleanCity(manifest.origin), mode: 'insensitive' },
                destinationCity: { contains: cleanCity(manifest.destination), mode: 'insensitive' },
                vehicleTypeCode: manifest.vehicleType.code,
                active: true,
            },
            orderBy: { updatedAt: 'desc' },
        });
        suggestedFreteBruto = calculateLinkAgreementValue(agreement, manifest);
        if (suggestedFreteBruto !== null) linkFreightSource = 'ACORDO_LINK';
    }

    const suggestedPedagio = manifest.freightAgreement ? manifest.freightAgreement.pedagio : null;
    const estimate = buildTripPriceEstimate({
        orderFreights,
        orderFreightMissingCount,
        suggestedFreteBruto,
        suggestedPedagio,
        anttMinimumFreight: null,
    });

    return {
        ...estimate,
        sources: {
            linkFreight: linkFreightSource,
            toll: manifest.freightAgreement ? 'CARTA_FRETE' : 'ROUTE_PROVIDER_UNAVAILABLE',
            anttFloor: 'ANTT_PROVIDER_UNAVAILABLE',
        },
    };
}
