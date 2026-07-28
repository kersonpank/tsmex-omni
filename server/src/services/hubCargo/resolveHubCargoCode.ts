import { resolveOrderByCode } from '../orderResolve.js';
import { resolveIntakeByNfeKey } from '../intake/resolveIntakeByNfeKey.js';
import {
    getHubCargoFiscalItem,
    getHubCargoIntakeItem,
    getHubCargoOrderItem,
    type HubCargoCapabilities,
    type HubCargoItem,
} from './hubCargoReadModel.js';
import { normalizeHubCargoCode } from './normalizeHubCargoCode.js';

export type HubCargoResolution =
    | { resolution: 'order_at_hub'; item: HubCargoItem }
    | { resolution: 'order_incoming'; item: HubCargoItem }
    | { resolution: 'order_other'; item: HubCargoItem }
    | { resolution: 'order_elsewhere'; message: string }
    | { resolution: 'already_in_trip'; item: HubCargoItem }
    | { resolution: 'awaiting_arrival'; item: HubCargoItem }
    | { resolution: 'fiscal_document_found'; item: HubCargoItem; accessKey: string }
    | {
          resolution: 'valid_nfe_not_registered';
          accessKey: string;
          cnpjEmit?: string;
          message: string;
      }
    | { resolution: 'multiple'; candidates: HubCargoItem[] }
    | { resolution: 'invalid'; message: string; preservedCode: string }
    | { resolution: 'not_found'; message: string; preservedCode: string };

export interface ResolveHubCargoInput {
    code: string;
    hubId: string;
    roles: string[];
    capabilities: HubCargoCapabilities;
}
function orderResolution(item: HubCargoItem): HubCargoResolution {
    if (item.activeTrip) return { resolution: 'already_in_trip', item };
    if (item.bucket === 'stock') return { resolution: 'order_at_hub', item };
    if (item.bucket === 'incoming') return { resolution: 'order_incoming', item };
    return { resolution: 'order_other', item };
}

export async function resolveHubCargoCode(
    input: ResolveHubCargoInput,
): Promise<HubCargoResolution> {
    const normalized = normalizeHubCargoCode(input.code);
    if (normalized.kind === 'INVALID') {
        return {
            resolution: 'invalid',
            message: 'Informe um pedido, documento ou chave fiscal válida.',
            preservedCode: input.code,
        };
    }

    const orderResult = await resolveOrderByCode(normalized.value, input.hubId);
    if (orderResult.match === 'single') {
        const item = await getHubCargoOrderItem(
            orderResult.order.id,
            input.hubId,
            input.capabilities,
        );
        if (!item) {
            return {
                resolution: 'order_elsewhere',
                message: 'O pedido existe, mas não pertence à operação deste Hub.',
            };
        }
        return orderResolution(item);
    }
    if (orderResult.match === 'multiple') {
        const candidates = (
            await Promise.all(
                orderResult.candidates.map((candidate) =>
                    getHubCargoOrderItem(
                        candidate.id,
                        input.hubId,
                        input.capabilities,
                    ),
                ),
            )
        ).filter((item): item is HubCargoItem => item != null);
        if (candidates.length === 1) return orderResolution(candidates[0]);
        if (candidates.length > 1) return { resolution: 'multiple', candidates };
        return {
            resolution: 'order_elsewhere',
            message: 'Foram encontrados pedidos, mas nenhum pertence à operação deste Hub.',
        };
    }

    const canResolveIntake =
        normalized.kind === 'ACCESS_KEY' ||
        normalized.value.replace(/\D/g, '').length >= 8;
    if (canResolveIntake) {
        const intake = await resolveIntakeByNfeKey({
            chave: normalized.value,
            actingRoles: input.roles,
            actingHubId: input.hubId,
        });
        if (intake.resolution === 'already_received' && intake.orderId) {
            const item = await getHubCargoOrderItem(
                intake.orderId,
                input.hubId,
                input.capabilities,
            );
            if (item) return orderResolution(item);
        }
        if (intake.resolution === 'awaiting_arrival') {
            const summaries = intake.demands?.length
                ? intake.demands
                : intake.demand
                  ? [intake.demand]
                  : [];
            const items = (
                await Promise.all(
                    summaries.map((summary) =>
                        getHubCargoIntakeItem(
                            summary.id,
                            input.hubId,
                            input.capabilities,
                        ),
                    ),
                )
            ).filter((item): item is HubCargoItem => item != null);
            if (items.length === 1) {
                return { resolution: 'awaiting_arrival', item: items[0] };
            }
            if (items.length > 1) {
                return { resolution: 'multiple', candidates: items };
            }
        }
        if (intake.resolution === 'wrong_hub') {
            return {
                resolution: 'order_elsewhere',
                message:
                    intake.message ??
                    'Esta carga está prevista para outro Hub. Consulte a torre de controle.',
            };
        }
        if (intake.resolution === 'blocked') {
            return {
                resolution: 'not_found',
                message:
                    intake.message ??
                    'Este documento já foi processado e não pode ser recebido novamente.',
                preservedCode: input.code,
            };
        }
        if (intake.resolution === 'not_found' && intake.distribuicaoMatch) {
            const item = await getHubCargoFiscalItem(
                intake.distribuicaoMatch.id,
                input.hubId,
                input.capabilities,
            );
            if (item) {
                return {
                    resolution: 'fiscal_document_found',
                    item,
                    accessKey: intake.chaveNormalized,
                };
            }
        }
        if (
            intake.resolution === 'not_found' &&
            normalized.kind === 'ACCESS_KEY'
        ) {
            return {
                resolution: 'valid_nfe_not_registered',
                accessKey: intake.chaveNormalized,
                cnpjEmit: intake.cnpjEmit,
                message:
                    'A chave é válida, mas a carga ainda não foi registrada neste Hub.',
            };
        }
    }

    return {
        resolution: 'not_found',
        message:
            'Nenhuma carga foi encontrada. Confira o código ou faça uma entrada manual.',
        preservedCode: input.code,
    };
}
