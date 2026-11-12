import prisma from '../../lib/prisma.js';
import { uploadBase64Object } from '../../lib/objectStorage.js';
import { getAcbrAccessToken } from './acbrAuth.js';
import { getAcbrApiBaseUrlForEnvironment, type AcbrFiscalEnvironment } from './acbrConfig.js';
import { classifyAcbrErrorResponse } from './acbrHttp.js';
import { mdfeProviderDocId } from './mdfeUfPlan.js';

/** `GET /mdfe/{id}/pdf` (BaixarPdfMdfe) — DAMDFE. `logotipo` é opcional e fica desligado. */
export async function downloadMdfePdf(providerDocId: string, ambiente: AcbrFiscalEnvironment): Promise<Buffer> {
    const baseUrl = getAcbrApiBaseUrlForEnvironment(ambiente);
    const token = await getAcbrAccessToken(['empresa', 'mdfe'], ambiente);
    const path = `/mdfe/${providerDocId}/pdf`;
    const res = await fetch(`${baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) await classifyAcbrErrorResponse(res, path, await res.text());
    return Buffer.from(await res.arrayBuffer());
}

export interface MdfePdfDeps {
    db: typeof prisma;
    download: typeof downloadMdfePdf;
    upload: typeof uploadBase64Object;
}

export type MdfePdfResult = { ok: true; storageKey: string } | { ok: false; error: string };

/**
 * Garante o DAMDFE arquivado no armazenamento (`pdfUrl = "s3:<chave>"`). Idempotente: se já está arquivado,
 * só devolve a chave. Nunca lança — falha aqui jamais desfaz a autorização do MDF-e.
 */
export async function archiveMdfePdf(docId: string, overrides: Partial<MdfePdfDeps> = {}): Promise<MdfePdfResult> {
    const deps: MdfePdfDeps = { db: prisma, download: downloadMdfePdf, upload: uploadBase64Object, ...overrides };
    try {
        const doc = await deps.db.manifestFiscalDocument.findUnique({ where: { id: docId } });
        if (!doc || doc.documentType !== 'MDFE') return { ok: false, error: 'MDF-e não encontrado.' };
        if (doc.pdfUrl?.startsWith('s3:') && doc.pdfUrl.length > 3) return { ok: true, storageKey: doc.pdfUrl.slice(3) };
        const providerId = mdfeProviderDocId(doc);
        if (!providerId) return { ok: false, error: 'MDF-e sem id do provedor: não dá para baixar o PDF.' };
        if (doc.environment !== 'PRODUCAO' && doc.environment !== 'HOMOLOGACAO') return { ok: false, error: 'Ambiente do MDF-e desconhecido.' };
        const pdf = await deps.download(providerId, doc.environment);
        if (!pdf.length || pdf.subarray(0, 4).toString('latin1') !== '%PDF') return { ok: false, error: 'O provedor não devolveu um PDF válido.' };
        const stored = await deps.upload({
            base64: pdf.toString('base64'),
            fileName: `${doc.accessKey ?? doc.id}.pdf`,
            mimeType: 'application/pdf',
            keyPrefix: `fiscal/mdfe/${doc.id}`,
        });
        await deps.db.manifestFiscalDocument.update({ where: { id: doc.id }, data: { pdfUrl: `s3:${stored.storageKey}` } });
        return { ok: true, storageKey: stored.storageKey };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}
