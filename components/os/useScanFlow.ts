import { useCallback, useState } from 'react';
import { hubCargoApi, intakeDemandsApi, nfeDistribuicaoTriagemApi } from '../../lib/api';
import { nextScanStep, type ScanFinal, type ScanStep } from './lib/intake';
import { apiErrorMessage } from './ui/Sheet';

/**
 * Executa o scan até um resultado final: resolve o código; se a NF-e ainda não é entrada,
 * prepara (triagem) ou cria pela chave e resolve de novo — mesmo caminho do painel atual,
 * sem o operador escolher nada. O cliente (conta faturável) é opcional na criação pela chave.
 */
export function useScanFlow(hubId: string | null) {
    const [busy, setBusy] = useState(false);

    const resolveStep = useCallback(
        async (code: string): Promise<ScanStep> => nextScanStep((await hubCargoApi.resolve(code, hubId ?? undefined)).data),
        [hubId],
    );

    const run = useCallback(
        async (code: string): Promise<ScanFinal> => {
            if (!hubId) return { kind: 'error', message: 'Escolha o hub antes de escanear.' };
            setBusy(true);
            try {
                let step = await resolveStep(code.trim());
                if (step.kind === 'convert_fiscal') {
                    await nfeDistribuicaoTriagemApi.converter(step.fiscalDocumentId);
                    step = await resolveStep(step.accessKey);
                } else if (step.kind === 'create_from_key') {
                    let clientId: string | undefined;
                    if (step.cnpjEmit) {
                        try {
                            clientId = (await intakeDemandsApi.resolveClientByDocument(step.cnpjEmit)).data.client?.id ?? undefined;
                        } catch {
                            clientId = undefined; // conta faturável se resolve depois (Demand.clientId opcional)
                        }
                    }
                    await intakeDemandsApi.createFromNfeKey({ chave: step.accessKey, expectedHubId: hubId, ...(clientId ? { clientId } : {}) });
                    step = await resolveStep(step.accessKey);
                }
                if (step.kind === 'convert_fiscal' || step.kind === 'create_from_key') {
                    return { kind: 'info', message: 'A entrada foi preparada. Toque em "Aguardando entrada" para confirmar.' };
                }
                return step;
            } catch (cause) {
                return { kind: 'error', message: apiErrorMessage(cause, 'Não foi possível consultar o código. Verifique a conexão e tente de novo.') };
            } finally {
                setBusy(false);
            }
        },
        [hubId, resolveStep],
    );

    /** Nota da triagem (baixada da SEFAZ) tocada na lista: prepara a entrada e segue o mesmo caminho. */
    const prepareFiscal = useCallback(
        async (fiscalDocumentId: string): Promise<ScanFinal> => {
            setBusy(true);
            try {
                const demand = (await nfeDistribuicaoTriagemApi.converter(fiscalDocumentId)).data?.demand;
                const key = demand?.documentKey ?? null;
                if (!key) return { kind: 'info', message: 'Nota preparada. Ela aparece em "Aguardando entrada" para confirmar.' };
                const step = await resolveStep(key);
                return step.kind === 'convert_fiscal' || step.kind === 'create_from_key'
                    ? { kind: 'info', message: 'Nota preparada. Ela aparece em "Aguardando entrada" para confirmar.' }
                    : step;
            } catch (cause) {
                return { kind: 'error', message: apiErrorMessage(cause, 'Não foi possível preparar esta nota.') };
            } finally {
                setBusy(false);
            }
        },
        [resolveStep],
    );

    return { run, prepareFiscal, busy };
}
