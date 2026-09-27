import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import type { ParsedNfeCargo } from '../acbr/nfeXmlParser.js';
import { getCargoDataFromDistribuicaoDocument } from '../fiscal/nfeDistribuicaoCargoData.js';

export type LocalNfeCargoResult =
    | { status: 'available'; source: 'demand' | 'distribution_storage'; cargo: ParsedNfeCargo }
    | { status: 'pending' | 'invalid'; reason: string };

function storedCargo(raw: Prisma.JsonValue | null): ParsedNfeCargo | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = (raw as Record<string, unknown>).nfeXmlData;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as unknown as ParsedNfeCargo : null;
}

export async function resolveLocalNfeCargo(demandId: string): Promise<LocalNfeCargoResult> {
    const demand = await prisma.demand.findUnique({
        where: { id: demandId },
        select: { id: true, sourceType: true, documentKey: true, rawInputData: true },
    });
    if (!demand) return { status: 'invalid', reason: 'Demanda não encontrada.' };

    const embedded = storedCargo(demand.rawInputData);
    if (embedded) return { status: 'available', source: 'demand', cargo: embedded };
    if (demand.sourceType !== 'DFE_ACBR') {
        return { status: 'pending', reason: 'Esta entrada não possui XML da Distribuição e deve ser preenchida manualmente.' };
    }

    const accessKey = demand.documentKey?.replace(/\D/g, '') ?? '';
    if (accessKey.length !== 44) return { status: 'invalid', reason: 'Demanda da Distribuição sem chave NF-e válida.' };
    const document = await prisma.nfeDistribuicaoDocumento.findUnique({
        where: { accessKey }, select: { tipo: true, xmlStorageKey: true },
    });
    if (!document?.xmlStorageKey) {
        return { status: 'pending', reason: 'XML da Distribuição não disponível no armazenamento. Verifique a integração fiscal.' };
    }

    try {
        const cargo = await getCargoDataFromDistribuicaoDocument(document);
        if (!cargo || cargo.chave.replace(/\D/g, '') !== accessKey) {
            return { status: 'invalid', reason: 'O XML armazenado é inválido ou não corresponde à chave da demanda.' };
        }
        const current = demand.rawInputData && typeof demand.rawInputData === 'object' && !Array.isArray(demand.rawInputData)
            ? demand.rawInputData as Prisma.JsonObject : {};
        await prisma.demand.update({
            where: { id: demand.id },
            data: { rawInputData: { ...current, nfeXmlData: JSON.parse(JSON.stringify(cargo)) } as Prisma.InputJsonValue },
        });
        return { status: 'available', source: 'distribution_storage', cargo };
    } catch (error) {
        return { status: 'invalid', reason: `Falha ao ler o XML armazenado: ${error instanceof Error ? error.message : String(error)}` };
    }
}
