import type { ManifestFiscalDocument } from '../../../types/index';

type FiscalDoc = Pick<ManifestFiscalDocument, 'id' | 'documentType' | 'status' | 'number' | 'statusReason'> & { unloadUf?: string | null; rawPayload?: unknown };

/** UF do MDF-e: coluna nova, ou (registro antigo) o UFFim do payload enviado. */
export function mdfeDocUf(doc: Pick<FiscalDoc, 'unloadUf' | 'rawPayload'>): string | null {
    if (doc.unloadUf) return doc.unloadUf;
    const fim = (doc.rawPayload as { infMDFe?: { ide?: { UFFim?: unknown } } } | null | undefined)?.infMDFe?.ide?.UFFim;
    return typeof fim === 'string' && /^[A-Za-z]{2}$/.test(fim) ? fim.toUpperCase() : null;
}

export type MdfeRowState = 'authorized' | 'processing' | 'rejected' | 'missing';

export interface MdfeUfRow {
    uf: string;
    state: MdfeRowState;
    doc: FiscalDoc | null;
    /** "MDF-e MA · nº 15 · autorizado" / "MDF-e PI · pendente: motivo". */
    text: string;
}

const AUTHORIZED = ['AUTHORIZED', 'CLOSED'];

/**
 * Uma linha por UF de descarregamento. Viagem de uma UF só (ou sem UFs conhecidas) devolve [] — a tela continua
 * como sempre foi, sem falar em UF. MDF-e antigo sem UF (e sem UFFim no payload) cobre todas as UFs.
 */
export function mdfeUfRows(documents: FiscalDoc[] | undefined, expectedUfs: string[] | undefined): MdfeUfRow[] {
    if (!expectedUfs || expectedUfs.length < 2) return [];
    const mdfes = (documents ?? []).filter((doc) => doc.documentType === 'MDFE');
    const legacyAuthorized = mdfes.find((doc) => AUTHORIZED.includes(doc.status) && !mdfeDocUf(doc));
    return expectedUfs.map((uf) => {
        const own = mdfes.filter((doc) => mdfeDocUf(doc) === uf);
        const authorized = own.find((doc) => AUTHORIZED.includes(doc.status)) ?? legacyAuthorized;
        if (authorized) return { uf, state: 'authorized' as const, doc: authorized, text: `MDF-e ${uf} · ${authorized.number ? `nº ${authorized.number} · ` : ''}autorizado` };
        const processing = own.find((doc) => doc.status === 'SENT' || doc.status === 'READY');
        if (processing) return { uf, state: 'processing' as const, doc: processing, text: `MDF-e ${uf} · ${processing.number ? `nº ${processing.number} · ` : ''}em processamento na SEFAZ` };
        const rejected = own.filter((doc) => doc.status === 'REJECTED').at(-1) ?? own.at(-1);
        if (rejected?.status === 'REJECTED') return { uf, state: 'rejected' as const, doc: rejected, text: `MDF-e ${uf} · pendente: ${rejected.statusReason ?? 'recusado'}` };
        return { uf, state: 'missing' as const, doc: null, text: `MDF-e ${uf} · pendente` };
    });
}

/** Documentos que já têm PDF para abrir (autorizados ou já encerrados), CIOT e MDF-e, com rótulo curto. */
export function printableFiscalDocuments(documents: FiscalDoc[] | undefined): Array<{ doc: FiscalDoc; label: string }> {
    const ready = (documents ?? []).filter((doc) => (doc.documentType === 'MDFE' || doc.documentType === 'CIOT') && AUTHORIZED.includes(doc.status));
    const mdfeUfs = new Set(ready.filter((doc) => doc.documentType === 'MDFE').map((doc) => mdfeDocUf(doc)).filter(Boolean));
    return ready
        .map((doc) => {
            const uf = doc.documentType === 'MDFE' && mdfeUfs.size > 1 ? mdfeDocUf(doc) : null;
            const name = doc.documentType === 'CIOT' ? 'CIOT' : 'MDF-e';
            return { doc, label: `${name}${uf ? ` ${uf}` : ''}${doc.number ? ` · nº ${doc.number}` : ''}` };
        })
        .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR', { numeric: true }));
}
