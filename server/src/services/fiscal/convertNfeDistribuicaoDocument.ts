import type { Demand } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import { resolveIntakeByNfeKey } from '../intake/resolveIntakeByNfeKey.js';
import { resolveIntakeClientByDocument } from '../intake/resolveIntakeClientByDocument.js';
import { createIntakeDemandFromNfeKey } from '../intake/createIntakeDemand.js';
import { getCargoDataFromDistribuicaoDocument } from './nfeDistribuicaoCargoData.js';
import { markConverted } from './nfeDistribuicaoRepo.js';

export interface ConvertNfeDistribuicaoDocumentOptions {
    clientId?: string;
    actingRoles?: string[];
    actingHubId?: string | null;
}

export type ConvertNfeDistribuicaoDocumentResult =
    | { converted: true; demand: Demand }
    | { converted: false; reason: 'not_ready' | 'already_has_demand' | 'concurrent_conversion' };

/**
 * Converte um `NfeDistribuicaoDocumento` (READY_FOR_TRIAGE) numa Demand de recebimento. Usada
 * tanto pelo clique manual em "Pendências fiscais" (`nfeDistribuicaoTriagem.ts`) quanto pela
 * auto-conversão disparada pelo pipeline de ingestão (`distribuicaoNfeSyncProcessor.ts`) assim
 * que o XML termina de baixar — mesma lógica, dois gatilhos.
 */
export async function convertNfeDistribuicaoDocument(
    documentId: string,
    options: ConvertNfeDistribuicaoDocumentOptions = {},
): Promise<ConvertNfeDistribuicaoDocumentResult> {
    const doc = await prisma.nfeDistribuicaoDocumento.findUnique({
        where: { id: documentId },
        include: { fiscalEmitter: { select: { hubId: true } } },
    });
    if (!doc) {
        throw new AppError('Documento não encontrado', 404);
    }
    if (doc.status !== 'READY_FOR_TRIAGE') {
        return { converted: false, reason: 'not_ready' };
    }

    // Evita duplicar: alguém pode já ter bipado esta chave manualmente antes do worker rodar.
    const existing = await resolveIntakeByNfeKey({
        chave: doc.accessKey,
        actingRoles: options.actingRoles ?? ['ADMIN'],
        actingHubId: options.actingHubId ?? null,
    });
    if (existing.resolution !== 'not_found' && existing.resolution !== 'invalid_key') {
        return { converted: false, reason: 'already_has_demand' };
    }

    // Cliente (conta faturável) não é pré-requisito pra converter em Demanda — se resolve
    // depois, na confirmação de chegada, conforme o frete (CIF/FOB/REDESPACHO). Ver
    // `resolvePayerClient.ts` e `Demand.clientId` (opcional por propósito no schema).
    let clientId = options.clientId;
    if (!clientId) {
        const clientLookup = await resolveIntakeClientByDocument(doc.cnpjEmitente);
        if (clientLookup.status !== 'not_found') {
            clientId = clientLookup.client!.id;
        }
    }

    const cargoData = await getCargoDataFromDistribuicaoDocument(doc).catch(() => null);

    const { demand } = await createIntakeDemandFromNfeKey({
        chave: doc.accessKey,
        clientId,
        expectedHubId: doc.fiscalEmitter.hubId,
        sourceType: 'DFE_ACBR',
        ...(cargoData ? { cargoData } : {}),
    });

    const converted = await markConverted(doc.id, demand.id);
    if (!converted) {
        return { converted: false, reason: 'concurrent_conversion' };
    }

    return { converted: true, demand };
}
