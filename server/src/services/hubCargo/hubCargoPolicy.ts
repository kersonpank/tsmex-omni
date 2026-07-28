import type { ManifestStatus, OrderStatus } from '@prisma/client';

export const HUB_CARGO_ACTIVE_MANIFEST_STATUSES: ManifestStatus[] = [
    'DRAFT',
    'PENDING_ACCEPT',
    'ACCEPTED',
    'IN_PROGRESS',
];

export type ManifestOrderEligibilityCode =
    | 'ELIGIBLE'
    | 'MANIFEST_NOT_DRAFT'
    | 'MANIFEST_WITHOUT_ORIGIN_HUB'
    | 'ORDER_ALREADY_DELIVERED'
    | 'ORDER_CANCELLED'
    | 'ORDER_NOT_AT_ORIGIN_HUB'
    | 'ORDER_NOT_READY_FOR_COLLECTION'
    | 'ORDER_EXPECTED_AT_ANOTHER_HUB'
    | 'ORDER_IN_ANOTHER_ACTIVE_TRIP';

export interface ManifestOrderEligibility {
    eligible: boolean;
    code: ManifestOrderEligibilityCode;
    message?: string;
    allocationMode?: 'HUB_STOCK' | 'COLLECTION';
    conflictingManifestId?: string;
}
export interface ManifestEligibilityInput {
    id: string;
    status: ManifestStatus;
    hubId: string | null;
    startsWithCollection: boolean;
}

export interface OrderEligibilityInput {
    status: OrderStatus;
    currentHubId: string | null;
    demand: {
        expectedHubId?: string | null;
    };
}

export interface ActiveManifestConflict {
    manifestId: string;
}

export function getManifestOrderEligibility(
    manifest: ManifestEligibilityInput,
    order: OrderEligibilityInput,
    conflict?: ActiveManifestConflict | null,
): ManifestOrderEligibility {
    if (manifest.status !== 'DRAFT') {
        return {
            eligible: false,
            code: 'MANIFEST_NOT_DRAFT',
            message: 'A viagem precisa estar em rascunho para alterar a carga.',
        };
    }
    if (!manifest.hubId) {
        return {
            eligible: false,
            code: 'MANIFEST_WITHOUT_ORIGIN_HUB',
            message: 'Defina o Hub de origem antes de adicionar pedidos.',
        };
    }
    if (conflict) {
        return {
            eligible: false,
            code: 'ORDER_IN_ANOTHER_ACTIVE_TRIP',
            message: 'Este pedido já está planejado em outra viagem ativa.',
            conflictingManifestId: conflict.manifestId,
        };
    }
    if (order.status === 'DELIVERED') {
        return {
            eligible: false,
            code: 'ORDER_ALREADY_DELIVERED',
            message: 'Pedido já entregue não pode ser adicionado a uma nova viagem.',
        };
    }
    if (order.status === 'CANCELLED') {
        return {
            eligible: false,
            code: 'ORDER_CANCELLED',
            message: 'Pedido cancelado não pode ser adicionado a uma viagem.',
        };
    }

    if (order.status === 'AT_HUB' && order.currentHubId === manifest.hubId) {
        return {
            eligible: true,
            code: 'ELIGIBLE',
            allocationMode: 'HUB_STOCK',
        };
    }

    if (!manifest.startsWithCollection) {
        return {
            eligible: false,
            code: 'ORDER_NOT_AT_ORIGIN_HUB',
            message: 'Este pedido não está fisicamente no Hub de origem da viagem.',
        };
    }

    if (order.demand.expectedHubId && order.demand.expectedHubId !== manifest.hubId) {
        return {
            eligible: false,
            code: 'ORDER_EXPECTED_AT_ANOTHER_HUB',
            message: 'A coleta deste pedido está vinculada a outro Hub.',
        };
    }

    if (order.status !== 'PENDING' || order.currentHubId) {
        return {
            eligible: false,
            code: 'ORDER_NOT_READY_FOR_COLLECTION',
            message: 'Este pedido não está disponível para uma viagem iniciada por coleta.',
        };
    }

    return {
        eligible: true,
        code: 'ELIGIBLE',
        allocationMode: 'COLLECTION',
    };
}
