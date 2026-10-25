import prisma from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import { convertNfeDistribuicaoDocument } from '../fiscal/convertNfeDistribuicaoDocument.js';

export interface ConvertHubCargoTriageInput {
    hubId: string;
    actingRoles: string[];
}

export interface ConvertHubCargoTriageResult {
    converted: number;
    failed: Array<{ id: string; message: string }>;
}

interface ConvertHubCargoTriageDeps {
    convertDocument: typeof convertNfeDistribuicaoDocument;
}

const failureMessages = {
    not_ready: 'Documento não está pronto para preparação. Confira o XML da NF-e.',
    already_has_demand: 'Já existe uma entrada para esta NF-e.',
    concurrent_conversion: 'Documento já foi preparado ou descartado por outra ação.',
} as const;

/** Retenta a preparação do backlog somente dos emitentes fiscais deste hub. */
export async function convertHubCargoTriage(
    input: ConvertHubCargoTriageInput,
    deps: ConvertHubCargoTriageDeps = { convertDocument: convertNfeDistribuicaoDocument },
): Promise<ConvertHubCargoTriageResult> {
    if (!input.hubId.trim()) {
        throw new AppError('Selecione um Hub para preparar as NF-e.', 400);
    }
    const documents = await prisma.nfeDistribuicaoDocumento.findMany({
        where: {
            status: 'READY_FOR_TRIAGE',
            fiscalEmitter: { hubId: input.hubId },
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
    });
    const result: ConvertHubCargoTriageResult = { converted: 0, failed: [] };

    for (const document of documents) {
        try {
            const conversion = await deps.convertDocument(document.id, {
                actingRoles: input.actingRoles,
                actingHubId: input.hubId,
            });
            if (conversion.converted) {
                result.converted += 1;
            } else {
                result.failed.push({ id: document.id, message: failureMessages[conversion.reason] });
            }
        } catch (error) {
            result.failed.push({
                id: document.id,
                message: error instanceof Error ? error.message : 'Não foi possível preparar esta NF-e.',
            });
        }
    }

    return result;
}
