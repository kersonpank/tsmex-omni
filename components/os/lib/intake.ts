import type { HubCargoItem, HubCargoResolution } from '../../../types/index';

/**
 * Próximo passo depois de um scan (estações Receber e Cargas). A chave da NF-e leva à
 * entrada no balcão como no painel atual: nota esperada → confirmar entrada; nota baixada
 * da SEFAZ (triagem) → preparar e confirmar; nota válida sem cadastro → criar a entrada
 * pela chave e confirmar. Nenhum caminho termina em "vá para outra tela".
 */

export type ScanStep =
    | { kind: 'entry'; item: HubCargoItem }
    | { kind: 'convert_fiscal'; fiscalDocumentId: string; accessKey: string }
    | { kind: 'create_from_key'; accessKey: string; cnpjEmit?: string }
    | { kind: 'item'; item: HubCargoItem; note?: string }
    | { kind: 'info'; message: string }
    | { kind: 'error'; message: string };

export function nextScanStep(res: HubCargoResolution): ScanStep {
    switch (res.resolution) {
        case 'awaiting_arrival':
            return { kind: 'entry', item: res.item };
        case 'fiscal_document_found':
            return res.item.fiscalDocumentId
                ? { kind: 'convert_fiscal', fiscalDocumentId: res.item.fiscalDocumentId, accessKey: res.accessKey }
                : { kind: 'item', item: res.item };
        case 'valid_nfe_not_registered':
            return { kind: 'create_from_key', accessKey: res.accessKey, cnpjEmit: res.cnpjEmit };
        case 'order_at_hub':
            return { kind: 'item', item: res.item };
        case 'order_incoming':
            return { kind: 'item', item: res.item, note: 'Esta carga está em viagem para cá: confira a chegada em Receber.' };
        case 'already_in_trip':
            return { kind: 'item', item: res.item, note: 'Este pedido já está planejado em uma viagem ativa.' };
        case 'order_other':
            return { kind: 'item', item: res.item };
        case 'order_elsewhere':
            return { kind: 'info', message: res.message };
        case 'multiple':
            return { kind: 'info', message: 'Mais de uma carga responde por este código. Use a chave de 44 dígitos ou a busca.' };
        case 'invalid':
        case 'not_found':
            return { kind: 'error', message: res.message };
        default:
            return { kind: 'error', message: 'Não foi possível entender este código.' };
    }
}

/** Texto lido parece uma chave de NF-e/CT-e (44 dígitos)? Útil para Enter na busca (leitor USB). */
export function looksLikeAccessKey(text: string): boolean {
    return text.replace(/\D/g, '').length === 44;
}

/** Resultado final de um scan, depois de preparar/criar a entrada quando preciso. */
export type ScanFinal = Exclude<ScanStep, { kind: 'convert_fiscal' } | { kind: 'create_from_key' }>;
