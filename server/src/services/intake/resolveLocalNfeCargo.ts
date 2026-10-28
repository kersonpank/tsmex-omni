import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import type { ParsedNfeCargo } from '../acbr/nfeXmlParser.js';
import { getCargoDataFromDistribuicaoDocument } from '../fiscal/nfeDistribuicaoCargoData.js';

export type LocalNfeCargoResult =
    | { status: 'available'; source: 'demand' | 'distribution_storage'; cargo: ParsedNfeCargo; ieRecovery?: 'source_unavailable' | 'read_failed' }
    | { status: 'pending' | 'invalid'; reason: string };

function storedCargo(raw: Prisma.JsonValue | null): ParsedNfeCargo | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = (raw as Record<string, unknown>).nfeXmlData;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as unknown as ParsedNfeCargo : null;
}

export async function resolveLocalNfeCargo(
    demandId: string,
    readStoredCargo: typeof getCargoDataFromDistribuicaoDocument = getCargoDataFromDistribuicaoDocument,
): Promise<LocalNfeCargoResult> {
    const demand = await prisma.demand.findUnique({
        where: { id: demandId },
        select: { id: true, sourceType: true, documentKey: true, rawInputData: true },
    });
    if (!demand) return { status: 'invalid', reason: 'Demanda não encontrada.' };

    const embedded = storedCargo(demand.rawInputData);
    const raw = demand.rawInputData && typeof demand.rawInputData === 'object' && !Array.isArray(demand.rawInputData)
        ? demand.rawInputData as Prisma.JsonObject : {};
    const checkedIe = raw.nfeXmlIeChecked === true;
    if (embedded && (checkedIe || (!lacksRecipientDocument(embedded) && !mayLackCachedIe(embedded)))) {
        return { status: 'available', source: 'demand', cargo: embedded };
    }
    // Caches antigos podem não ter CPF/IE; relê o XML local uma vez e mantém o cache se falhar.
    const keep = (fallback: LocalNfeCargoResult): LocalNfeCargoResult =>
        embedded ? {
            status: 'available', source: 'demand', cargo: embedded,
            ieRecovery: fallback.status === 'invalid' ? 'read_failed' : 'source_unavailable',
        } : fallback;
    const accessKey = demand.documentKey?.replace(/\D/g, '') ?? '';
    const fromDistribution = demand.sourceType === 'DFE_ACBR';
    if (accessKey.length !== 44) {
        if (fromDistribution) return keep({ status: 'invalid', reason: 'Demanda da Distribuição sem chave NF-e válida.' });
        return keep({ status: 'pending', reason: 'Esta entrada não possui chave NF-e e deve ser preenchida manualmente.' });
    }
    const upload = raw.nfeXmlUpload;
    const uploadKey = upload && typeof upload === 'object' && !Array.isArray(upload) && typeof upload.storageKey === 'string'
        ? upload.storageKey : null;
    let document: Parameters<typeof readStoredCargo>[0] | null;
    try {
        document = uploadKey ? { tipo: 'NFE_PROC' as const, xmlStorageKey: uploadKey } : await prisma.nfeDistribuicaoDocumento.findUnique({
            where: { accessKey }, select: { tipo: true, xmlStorageKey: true },
        });
    } catch {
        return keep({ status: 'invalid', reason: 'Falha ao localizar o XML armazenado.' });
    }
    if (!document?.xmlStorageKey) {
        return keep({
            status: 'pending',
            reason: fromDistribution
                ? 'XML da Distribuição não disponível no armazenamento. Verifique a integração fiscal.'
                : 'O XML desta NF-e ainda não está no sistema.',
        });
    }

    try {
        const cargo = await readStoredCargo(document);
        if (!cargo || cargo.chave.replace(/\D/g, '') !== accessKey) {
            return keep({ status: 'invalid', reason: 'O XML armazenado é inválido ou não corresponde à chave da demanda.' });
        }
        await prisma.demand.update({
            where: { id: demand.id },
            data: { rawInputData: { ...raw, nfeXmlData: JSON.parse(JSON.stringify(cargo)), nfeXmlIeChecked: true } as Prisma.InputJsonValue },
        });
        return { status: 'available', source: uploadKey ? 'demand' : 'distribution_storage', cargo };
    } catch (error) {
        return keep({ status: 'invalid', reason: `Falha ao ler o XML armazenado: ${error instanceof Error ? error.message : String(error)}` });
    }
}

function mayLackCachedIe(cargo: ParsedNfeCargo): boolean {
    const emit = cargo.emitente;
    const dest = cargo.destinatario;
    return Boolean(
        (emit?.cnpj && !emit.ie?.trim()) ||
        (dest?.cnpj && !dest.ie?.trim() && dest.indIEDest !== '2' && dest.indIEDest !== '9'),
    );
}

function lacksRecipientDocument(cargo: ParsedNfeCargo): boolean {
    const dest = cargo.destinatario;
    if (!dest?.razaoSocial) return false;
    return !(dest.cnpj ?? '').replace(/\D/g, '') && !(dest.cpf ?? '').replace(/\D/g, '');
}
