import { manifestsApi } from '../../../../lib/api';

/**
 * Troca o transportador da viagem SEM perder os motoristas já escolhidos (são independentes).
 * O backend, ao trocar o transportador, só mantém motoristas ligados a ele; por isso a lista
 * anterior é regravada logo depois. Sem motoristas anteriores, o backend sugere o único
 * motorista do transportador (se houver).
 */
export async function assignCarrier(manifestId: string, linkId: string, keepDriverIds: string[] = []): Promise<void> {
    await manifestsApi.setResponsible(manifestId, linkId, keepDriverIds[0] ?? undefined);
    if (keepDriverIds.length > 1) await manifestsApi.setDrivers(manifestId, keepDriverIds);
}
