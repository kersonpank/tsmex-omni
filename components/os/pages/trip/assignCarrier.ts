import { manifestsApi } from '../../../../lib/api';
import type { TripCompositionDefaults } from '../../../../types/index';

/**
 * Troca o transportador da viagem SEM perder os motoristas já escolhidos (são independentes).
 * O backend, ao trocar o transportador, só mantém motoristas ligados a ele; por isso a lista
 * anterior é regravada logo depois. Sem motoristas/veículos anteriores, o backend preenche com a
 * última viagem do transportador (ou o cadastro padrão) e devolve o que aplicou em `defaultsApplied`.
 */
export async function assignCarrier(manifestId: string, linkId: string, keepDriverIds: string[] = []): Promise<TripCompositionDefaults | null> {
    const response = await manifestsApi.setResponsible(manifestId, linkId, keepDriverIds[0] ?? undefined);
    if (keepDriverIds.length > 1) await manifestsApi.setDrivers(manifestId, keepDriverIds);
    return response.defaultsApplied ?? null;
}
