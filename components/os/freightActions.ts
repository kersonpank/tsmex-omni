import { ordersFreightApi } from '../../lib/api';
import type { BrandingForDocuments, CtePreflightResult, FreightBreakdownValues, FreightDocType, OrderFreightCalculation } from '../../types/index';
import { apiErrorMessage } from './ui/Sheet';

/**
 * Emissão do documento do frete pelo O.S. — usada pelo pedido (um toque) e pela fila (lote).
 * Prepara no servidor sem duplicar (trava por pedido) e emite pelos endpoints de sempre; a
 * emissão do CT-e tem compare-and-swap, então repetir é seguro.
 */

export type EmitOutcome =
    | { kind: 'authorized' | 'sent'; calc: OrderFreightCalculation }
    | { kind: 'rejected'; calc: OrderFreightCalculation; reason: string }
    | { kind: 'minuta'; calc: OrderFreightCalculation; payload: unknown; branding: BrandingForDocuments | null }
    | { kind: 'already'; calc: OrderFreightCalculation }
    | { kind: 'blocked'; issues: string[]; missingFields: string[] }
    | { kind: 'error'; message: string };

export interface EmitOptions {
    documentType: FreightDocType;
    pricingTableId?: string;
    informed?: Partial<FreightBreakdownValues>;
    reason?: string;
    newDocument?: boolean;
    /** CFOP/CST escolhidos na tela quando o emitente do hub não tem padrão. */
    tax?: { cfop?: string; cst?: string };
}

function blockedFrom(preflight: CtePreflightResult): EmitOutcome {
    return { kind: 'blocked', issues: preflight.issues, missingFields: preflight.missingFields };
}

function statusOutcome(calc: OrderFreightCalculation): EmitOutcome {
    if (calc.status === 'CTE_AUTHORIZED' || calc.status === 'DCE_AUTHORIZED') return { kind: 'authorized', calc };
    if (calc.status === 'CTE_REJECTED' || calc.status === 'DCE_REJECTED') {
        return { kind: 'rejected', calc, reason: calc.cteStatusReason ?? calc.dceStatusReason ?? 'Rejeitado pela SEFAZ.' };
    }
    return { kind: 'sent', calc };
}

export async function emitFreightDocument(orderId: string, opts: EmitOptions): Promise<EmitOutcome> {
    try {
        const prepared = (
            await ordersFreightApi.prepare(orderId, {
                documentType: opts.documentType,
                pricingTableId: opts.pricingTableId,
                informed: opts.informed,
                reason: opts.reason,
                newDocument: opts.newDocument,
            })
        ).data;
        if (prepared.alreadyActive) return { kind: 'already', calc: prepared.calc };
        let calc = prepared.calc;

        if (opts.tax?.cfop || opts.tax?.cst) {
            calc = (await ordersFreightApi.update(orderId, calc.id, { ...(opts.tax.cfop ? { cfop: opts.tax.cfop } : {}), ...(opts.tax.cst ? { cst: opts.tax.cst } : {}) })).data;
        } else if (prepared.preflight && !prepared.preflight.ok) {
            return blockedFrom(prepared.preflight);
        }

        if (calc.documentType === 'MINUTA') {
            const res = await ordersFreightApi.emitMinuta(orderId, calc.id);
            return { kind: 'minuta', calc: res.data, payload: res.payload ?? null, branding: res.branding ?? null };
        }
        if (calc.documentType === 'DCE') return statusOutcome((await ordersFreightApi.emitDce(orderId, calc.id)).data);
        return statusOutcome((await ordersFreightApi.emitCte(orderId, calc.id)).data);
    } catch (cause) {
        const preflight = (cause as { response?: { data?: { preflight?: CtePreflightResult } } })?.response?.data?.preflight;
        if (preflight) return blockedFrom(preflight);
        return { kind: 'error', message: apiErrorMessage(cause, 'Não foi possível emitir o documento. Tente de novo.') };
    }
}

/** CT-e autorizado usa o DACTE do provedor; minuta usa a impressão operacional. */
export async function loadFreightPrint(
    orderId: string,
    doc: { id: string; documentType: FreightDocType; status: string },
): Promise<{ payload: unknown; branding: BrandingForDocuments | null } | null> {
    if (doc.documentType === 'CTE' && doc.status === 'CTE_AUTHORIZED') {
        try {
            const url = (await ordersFreightApi.getCteDocumentUrl(orderId, doc.id, 'pdf')).data?.downloadUrl;
            if (url) {
                window.open(url, '_blank', 'noopener');
                return null;
            }
        } catch {
            // Não substituir o DACTE oficial por um desenho gerado localmente.
        }
        throw new Error('O DACTE autorizado ainda não está disponível. Atualize o pedido ou peça apoio à torre.');
    }
    const res = await ordersFreightApi.getPrintPreview(orderId, doc.id);
    return { payload: res.payload ?? null, branding: res.branding ?? null };
}
