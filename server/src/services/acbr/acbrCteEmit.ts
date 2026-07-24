import type { CteEmissionInput, CteProviderResult } from '../cteService.js';
import { getAcbrAccessToken } from './acbrAuth.js';
import { buildAcbrCteEmitBody } from './acbrCteMapper.js';
import { getAcbrApiBaseUrlForEnvironment, type AcbrFiscalEnvironment } from './acbrConfig.js';
import { acbrFetchJson, classifyAcbrErrorResponse } from './acbrHttp.js';
import { ensureEmpresaRegistered, type EnsureEmpresaInput } from './acbrEmpresa.js';

/** Optional fiscal emitter context for just-in-time empresa auto-provisioning. */
export type FiscalEmitterContext = {
    crt?: string | null;
    environment: 'HOMOLOGACAO' | 'PRODUCAO';
    certificateStorageKey?: string | null;
    certificatePasswordEncrypted?: string | null;
};

function norm(s: unknown): string {
    return String(s ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '');
}

function mapDocToResult(doc: Record<string, unknown>, id: string, baseUrl: string): CteProviderResult {
    const auth = (doc.autorizacao ?? {}) as Record<string, unknown>;
    const st = norm(doc.status);
    const authSt = norm(auth.status);
    const chave = (auth.chave_acesso ?? doc.chave) as string | undefined;
    const proto = (auth.numero_protocolo ?? doc.numero_protocolo) as string | undefined;
    const motivo = [auth.motivo_status, doc.motivo_status].filter(Boolean).join(' | ') || 'Sem motivo informado.';

    if (authSt.includes('autorizado') || st === 'autorizado' || (chave && /^\d{44}$/.test(String(chave).replace(/\D/g, '')) && !st.includes('rejeit'))) {
        const cleanKey = String(chave ?? '').replace(/\D/g, '').slice(0, 44);
        return {
            status: 'AUTHORIZED',
            accessKey: cleanKey || undefined,
            protocol: proto ? String(proto) : undefined,
            xml: undefined,
            pdfUrl: id ? `${baseUrl}/cte/${id}/pdf` : undefined,
            rawResponse: doc as Record<string, unknown>,
        };
    }
    if (st.includes('rejeit') || st.includes('erro') || authSt.includes('rejeit')) {
        return {
            status: 'REJECTED',
            rejectionCode: String(doc.codigo_status ?? auth.codigo_status ?? 'ACBR'),
            rejectionReason: motivo,
            rawResponse: doc as Record<string, unknown>,
        };
    }
    return {
        status: 'REJECTED',
        rejectionCode: 'PENDENTE',
        rejectionReason: motivo,
        rawResponse: doc as Record<string, unknown>,
    };
}

/** Status normalizado de UM poll — não decide timeout nem retry, isso é responsabilidade do processor. */
export type CtePollOutcome =
    | { kind: 'AUTHORIZED'; result: CteProviderResult; providerDocId: string }
    | { kind: 'REJECTED'; result: CteProviderResult }
    | { kind: 'PENDING' };

/**
 * Faz o `POST /cte` (com auto-provisionamento de empresa se necessário) UMA ÚNICA VEZ.
 * Chamador é responsável por nunca invocar isto de novo para o mesmo `CteEmissionJob`
 * depois que `providerDocId` tiver sido persistido.
 */
export async function submitCteToAcbr(
    input: CteEmissionInput,
    referencia: string,
    fiscalEmitter?: FiscalEmitterContext | null,
): Promise<{ providerDocId: string } | { rejected: CteProviderResult }> {
    if (fiscalEmitter) {
        const ensureInput: EnsureEmpresaInput = {
            environment: fiscalEmitter.environment,
            crt: fiscalEmitter.crt,
            person: input.person,
            certificateStorageKey: fiscalEmitter.certificateStorageKey,
            certificatePasswordEncrypted: fiscalEmitter.certificatePasswordEncrypted,
        };
        const ensureResult = await ensureEmpresaRegistered(ensureInput);
        if (!ensureResult.ok) {
            return {
                rejected: {
                    status: 'REJECTED',
                    rejectionCode: 'ACBR_EMPRESA',
                    rejectionReason: ensureResult.message ?? 'Falha ao registrar empresa na ACBr antes da emissão.',
                    rawResponse: { provider: 'acbr', ensureEmpresa: ensureResult },
                },
            };
        }
    }

    const body = await buildAcbrCteEmitBody(input, referencia);
    const created = await acbrFetchJson<Record<string, unknown>>('/cte', {
        method: 'POST',
        body: JSON.stringify(body),
        scopes: ['empresa', 'cte'],
        apiEnvironment: input.ambiente,
    });
    const id = String(created.id ?? '');
    if (!id) {
        return {
            rejected: {
                status: 'REJECTED',
                rejectionCode: 'ACBR',
                rejectionReason: 'Resposta sem id de documento na ACBr.',
                rawResponse: created,
            },
        };
    }
    return { providerDocId: id };
}

/**
 * Uma única checagem de status (`GET /cte/{id}`, com `sincronizar` esporádico).
 * Não decide o que fazer com timeout/erro — isso é o processor da fila que decide,
 * porque só ele sabe a `attemptCount`/`maxAttempts` do `CteEmissionJob`.
 */
export async function pollCteStatusOnce(
    providerDocId: string,
    ambiente: AcbrFiscalEnvironment,
    attempt: number,
): Promise<CtePollOutcome> {
    const baseUrl = getAcbrApiBaseUrlForEnvironment(ambiente);

    if (attempt >= 5 && attempt % 3 === 0) {
        try {
            await acbrFetchJson(`/cte/${providerDocId}/sincronizar`, { method: 'POST', scopes: ['empresa', 'cte'], apiEnvironment: ambiente });
        } catch {
            /* sync opcional — não deve derrubar o polling */
        }
    }

    const doc = await acbrFetchJson<Record<string, unknown>>(`/cte/${providerDocId}`, {
        method: 'GET',
        scopes: ['empresa', 'cte'],
        apiEnvironment: ambiente,
    });
    const st = norm(doc.status);
    const auth = (doc.autorizacao ?? {}) as Record<string, unknown>;
    const authSt = norm(auth.status);

    if (authSt.includes('autorizado') || st === 'autorizado') {
        return { kind: 'AUTHORIZED', result: mapDocToResult(doc, providerDocId, baseUrl), providerDocId };
    }
    if (st.includes('rejeit') || st.includes('erro') || authSt.includes('rejeit')) {
        return { kind: 'REJECTED', result: mapDocToResult(doc, providerDocId, baseUrl) };
    }
    return { kind: 'PENDING' };
}

/**
 * Baixa o XML autorizado — chamar só quando ainda não foi baixado (idempotência é
 * responsabilidade do chamador). Usa `fetch` puro (não `acbrFetchJson`, que é JSON-only)
 * porque o corpo de sucesso é texto XML — mas em caso de erro (ex.: 402/429) reusa o mesmo
 * `classifyAcbrErrorResponse` de `acbrFetchJson`, para que um 402 aqui pause a fila e dispare
 * o alerta administrativo igual a qualquer outro 402 da integração ACBr, e um 429 respeite
 * `Retry-After`/`X-Retry-In` em vez de cair no backoff genérico.
 */
export async function downloadCteXml(providerDocId: string, ambiente: AcbrFiscalEnvironment): Promise<string> {
    const baseUrl = getAcbrApiBaseUrlForEnvironment(ambiente);
    const token = await getAcbrAccessToken(['empresa', 'cte'], ambiente);
    const path = `/cte/${providerDocId}/xml`;
    const res = await fetch(`${baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
        await classifyAcbrErrorResponse(res, path, await res.text());
    }
    return res.text();
}

/**
 * Baixa o PDF (DACTE) autorizado — chamar só quando ainda não foi baixado. Ver nota em
 * `downloadCteXml` sobre por que não usa `acbrFetchJson` mas reusa a classificação de erro.
 */
export async function downloadCtePdf(providerDocId: string, ambiente: AcbrFiscalEnvironment): Promise<Buffer> {
    const baseUrl = getAcbrApiBaseUrlForEnvironment(ambiente);
    const token = await getAcbrAccessToken(['empresa', 'cte'], ambiente);
    const path = `/cte/${providerDocId}/pdf`;
    const res = await fetch(`${baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
        await classifyAcbrErrorResponse(res, path, await res.text());
    }
    return Buffer.from(await res.arrayBuffer());
}

/**
 * Fluxo síncrono ORIGINAL, preservado só para o modo simulado local (`cteService.ts`
 * chama isto quando `willUseAcbrHttp` é true mas ainda em modo de desenvolvimento sem
 * fila). Novas integrações reais devem usar `submitCteToAcbr`/`pollCteStatusOnce` via
 * `cteEmissionProcessor.ts`, não esta função.
 */
export async function emitCteViaAcbr(
    input: CteEmissionInput,
    referencia: string,
    fiscalEmitter?: FiscalEmitterContext | null,
): Promise<CteProviderResult> {
    const submitted = await submitCteToAcbr(input, referencia, fiscalEmitter);
    if ('rejected' in submitted) return submitted.rejected;
    const { providerDocId } = submitted;

    for (let attempt = 0; attempt < 24; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
        const outcome = await pollCteStatusOnce(providerDocId, input.ambiente, attempt);
        if (outcome.kind === 'AUTHORIZED') {
            let xml: string | undefined;
            try {
                xml = await downloadCteXml(providerDocId, input.ambiente);
            } catch {
                /* opcional no fluxo síncrono legado */
            }
            return { ...outcome.result, xml: xml ?? outcome.result.xml };
        }
        if (outcome.kind === 'REJECTED') return outcome.result;
    }

    return {
        status: 'REJECTED',
        rejectionCode: 'TIMEOUT',
        rejectionReason: 'Timeout aguardando retorno da SEFAZ via ACBr.',
        rawResponse: { id: providerDocId },
    };
}
