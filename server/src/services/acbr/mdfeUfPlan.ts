/**
 * Um MDF-e por UF de descarregamento (Ajuste SINIEF 21/2010): vários municípios da MESMA UF vão no mesmo
 * MDF-e (`infMunDescarga[]`); descargas em UFs diferentes exigem um MDF-e para cada UF.
 * Funções puras — o acesso a banco/provedor fica em acbrMdfeEmit.ts.
 */
import type { MdfeDescargaGroup } from './acbrMdfeEmit.js';

export interface MdfeUfPlan {
    uf: string;
    groups: MdfeDescargaGroup[];
    chaves: string[];
}

export interface MdfeUfPlanResult {
    plans: MdfeUfPlan[];
    /** Grupos com chaves de CT-e mas sem UF de destino: impedem o planejamento. */
    missingUf: MdfeDescargaGroup[];
}

export function groupUf(group: Pick<MdfeDescargaGroup, 'destHub' | 'destState'>): string {
    return (group.destHub?.state ?? group.destState ?? '').trim().slice(0, 2).toUpperCase();
}

/**
 * Ordem estável: UFs na ordem em que aparecem nas paradas (grupos com `stopId`, já ordenados por sequência);
 * as demais (viagem sem paradas, entrega por município) em ordem alfabética.
 */
export function planMdfeByUf(groups: MdfeDescargaGroup[]): MdfeUfPlanResult {
    const withKeys = groups.filter((group) => group.chaves.length > 0);
    const missingUf = withKeys.filter((group) => !groupUf(group));
    const byUf = new Map<string, MdfeUfPlan>();
    const stopOrder: string[] = [];
    for (const group of withKeys) {
        const uf = groupUf(group);
        if (!uf) continue;
        const plan = byUf.get(uf) ?? { uf, groups: [], chaves: [] };
        plan.groups.push(group);
        for (const key of group.chaves) if (!plan.chaves.includes(key)) plan.chaves.push(key);
        byUf.set(uf, plan);
        if (group.stopId && !stopOrder.includes(uf)) stopOrder.push(uf);
    }
    const rest = [...byUf.keys()].filter((uf) => !stopOrder.includes(uf)).sort();
    return { plans: [...stopOrder, ...rest].map((uf) => byUf.get(uf)!), missingUf };
}

/** UFs das paradas até a ÚLTIMA parada da UF de descarregamento (inclusive) — base do infPercurso daquele MDF-e. */
export function stopUfsUpTo(stopUfs: string[], targetUf: string): string[] {
    const normalized = stopUfs.map((uf) => uf.trim().toUpperCase());
    const last = normalized.lastIndexOf(targetUf.trim().toUpperCase());
    return last < 0 ? normalized : normalized.slice(0, last + 1);
}

/** UF do documento: coluna nova, ou (registro antigo) o UFFim do payload enviado. */
export function mdfeDocumentUf(doc: { unloadUf?: string | null; rawPayload?: unknown }): string | null {
    if (doc.unloadUf) return doc.unloadUf;
    const fim = (doc.rawPayload as { infMDFe?: { ide?: { UFFim?: unknown } } } | null | undefined)?.infMDFe?.ide?.UFFim;
    return typeof fim === 'string' && /^[A-Za-z]{2}$/.test(fim) ? fim.toUpperCase() : null;
}

/** Id do documento no provedor: coluna nova, com fallback para o formato antigo `pdfUrl = "mdfe:<id>"`. */
export function mdfeProviderDocId(doc: { providerDocId?: string | null; pdfUrl?: string | null }): string | null {
    if (doc.providerDocId) return doc.providerDocId;
    return doc.pdfUrl?.startsWith('mdfe:') && doc.pdfUrl.length > 5 ? doc.pdfUrl.slice(5) : null;
}

export interface MdfeCoverageDoc { unloadUf?: string | null; status: string; accessKey?: string | null; protocol?: string | null; xmlUrl?: string | null }

/** UFs que ainda não têm MDF-e autorizado completo (chave, protocolo, XML). Registro antigo sem UF cobre a viagem toda. */
export function uncoveredMdfeUfs(expectedUfs: string[], docs: MdfeCoverageDoc[]): string[] {
    const ok = docs.filter((doc) => doc.status === 'AUTHORIZED' && /^\d{44}$/.test(doc.accessKey ?? '') && !!doc.protocol && !!doc.xmlUrl);
    if (ok.some((doc) => !doc.unloadUf)) return [];
    const covered = new Set(ok.map((doc) => doc.unloadUf));
    return expectedUfs.filter((uf) => !covered.has(uf));
}

export interface MdfeUfSummaryInput { uf: string; status: 'AUTHORIZED' | 'PENDING' | 'REJECTED'; message: string | null }

/** Resposta HTTP de `POST /manifests/:id/emit-mdfe`: 200 todos autorizados, 202 algum em processamento, 422 algum recusado. */
export function summarizeMdfeEmission(mdfes: MdfeUfSummaryInput[]): { httpStatus: 200 | 202 | 422; pending: boolean; message: string | null } {
    const describe = (items: MdfeUfSummaryInput[], fallback: string) =>
        items.map((item) => `${item.uf ? `MDF-e ${item.uf}` : 'MDF-e'}: ${item.message ?? fallback}`).join(' | ');
    const rejected = mdfes.filter((item) => item.status === 'REJECTED');
    const processing = mdfes.filter((item) => item.status === 'PENDING');
    if (rejected.length) return { httpStatus: 422, pending: processing.length > 0, message: describe(rejected, 'recusado') };
    if (processing.length) return { httpStatus: 202, pending: true, message: describe(processing, 'em processamento') };
    return { httpStatus: 200, pending: false, message: null };
}
