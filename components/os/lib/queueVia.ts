import type { ConsolidationQueueGroup } from '../../../types/index';

/** Linha "via": o grupo vai ao próximo salto, mas parte da carga segue adiante até o hub final. */
export function queueViaLabel(group: ConsolidationQueueGroup): string | null {
    if (group.kind !== 'TRANSFER') return null;
    if (group.finalHubName) {
        const lead = group.leadTimeDays != null ? ` · prazo cadastrado ${group.leadTimeDays} d` : '';
        return `Destino final: ${group.finalHubName}${lead}`;
    }
    const names = [...new Set(group.orders.map((order) => order.finalHubName).filter((name): name is string => Boolean(name)))];
    return names.length > 0 ? `Segue para: ${names.join(', ')}` : null;
}
