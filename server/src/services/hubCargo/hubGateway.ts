import { AppError } from '../../middleware/errorHandler.js';
import { MAX_GATEWAY_DEPTH } from './consolidationQueue.js';

export interface GatewayHubRow {
    id: string;
    active: boolean;
    gatewayHubId: string | null;
}

/**
 * Valida "esta unidade é abastecida por": o gateway deve existir, estar ativo, não ser o
 * próprio hub e não fechar ciclo. `hubId` null = hub ainda não criado (sem risco de ciclo).
 */
export function validateGatewayAssignment(hubId: string | null, gatewayHubId: string | null, hubs: GatewayHubRow[]): void {
    if (!gatewayHubId) return;
    if (hubId && gatewayHubId === hubId) throw new AppError('Uma unidade não pode ser abastecida por ela mesma.', 400);
    const byId = new Map(hubs.map((h) => [h.id, h]));
    const gateway = byId.get(gatewayHubId);
    if (!gateway) throw new AppError('O hub tronco informado não existe.', 400);
    if (!gateway.active) throw new AppError('O hub tronco informado está inativo.', 400);
    if (!hubId) return;
    let current: string | null = gatewayHubId;
    for (let depth = 0; current && depth < MAX_GATEWAY_DEPTH; depth++) {
        if (current === hubId) throw new AppError('Esse hub tronco criaria um ciclo (o tronco já é abastecido por esta unidade).', 400);
        current = byId.get(current)?.gatewayHubId ?? null;
    }
}
