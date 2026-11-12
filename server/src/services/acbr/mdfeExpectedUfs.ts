import { collectDescargaGroupsForManifest } from './acbrMdfeEmit.js';
import { planMdfeByUf } from './mdfeUfPlan.js';

/**
 * UFs de descarregamento da viagem (ordem de emissão). `[]` = não foi possível determinar (viagem sem CT-e
 * autorizado ainda, UF de destino faltando ou falha de leitura): quem chama cai na regra de "ao menos um MDF-e".
 */
export async function expectedMdfeUfs(manifestId: string): Promise<string[]> {
    try {
        const { plans, missingUf } = planMdfeByUf(await collectDescargaGroupsForManifest(manifestId));
        return missingUf.length ? [] : plans.map((plan) => plan.uf);
    } catch {
        return [];
    }
}
