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

/** O provedor pode ter recebido o POST mesmo sem devolver uma resposta utilizável. */
export class AcbrCteSubmissionUncertainError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AcbrCteSubmissionUncertainError';
    }
}

export function cteProviderDocIdFromCreateResponse(created: unknown): string {
    const id = created && typeof created === 'object' ? (created as { id?: unknown }).id : null;
    if ((typeof id !== 'string' && typeof id !== 'number') || !String(id).trim()) {
        throw new AcbrCteSubmissionUncertainError('Resposta da ACBr sem id de documento; o resultado do envio é incerto.');
    }
    return String(id).trim();
}

function norm(s: unknown): string {
    return String(s ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '');
}

function mapAuthorizedResult(doc: Record<string, unknown>, auth: Record<string, unknown>, id: string, baseUrl: string): CteProviderResult {
    const chave = (auth.chave_acesso ?? doc.chave) as string | undefined;
    const proto = (auth.numero_protocolo ?? doc.numero_protocolo) as string | undefined;
    return {
        status: 'AUTHORIZED',
        accessKey: String(chave ?? '').replace(/\D/g, '') || undefined,
        protocol: proto ? String(proto) : undefined,
        pdfUrl: id ? `${baseUrl}/cte/${id}/pdf` : undefined,
        rawResponse: doc,
    };
}

/** Status normalizado de UM poll — não decide timeout nem retry, isso é responsabilidade do processor. */
export type CtePollOutcome =
    | { kind: 'AUTHORIZED'; result: CteProviderResult; providerDocId: string }
    | { kind: 'REJECTED'; result: CteProviderResult }
    | { kind: 'RECONCILIATION_REQUIRED'; reason: string; rejectionCode?: string; rejectionReason?: string }
    | { kind: 'PENDING' };

export interface CteSubmitDeps {
    ensureEmpresaRegistered: typeof ensureEmpresaRegistered;
    buildAcbrCteEmitBody: typeof buildAcbrCteEmitBody;
    acbrFetchJson: typeof acbrFetchJson;
}

const defaultCteSubmitDeps: CteSubmitDeps = { ensureEmpresaRegistered, buildAcbrCteEmitBody, acbrFetchJson };

/**
 * Faz o `POST /cte` (com auto-provisionamento de empresa se necessário) UMA ÚNICA VEZ.
 * O worker fornece `beforeCtePost` para gravar um marcador atômico depois de preparar o
 * payload e cadastrar a empresa, mas antes de qualquer tentativa de POST /cte. Retornar
 * false significa que outra execução ganhou o CAS ou o estado deixou de ser elegível.
 */
export async function submitCteToAcbr(
    input: CteEmissionInput,
    referencia: string,
    fiscalEmitter?: FiscalEmitterContext | null,
    beforeCtePost?: () => Promise<boolean>,
    deps: CteSubmitDeps = defaultCteSubmitDeps,
): Promise<{ providerDocId: string } | { rejected: CteProviderResult } | { skipped: true }> {
    if (fiscalEmitter) {
        const ensureInput: EnsureEmpresaInput = {
            environment: fiscalEmitter.environment,
            crt: fiscalEmitter.crt,
            person: input.person,
            certificateStorageKey: fiscalEmitter.certificateStorageKey,
            certificatePasswordEncrypted: fiscalEmitter.certificatePasswordEncrypted,
        };
        const ensureResult = await deps.ensureEmpresaRegistered(ensureInput);
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

    const body = JSON.stringify(await deps.buildAcbrCteEmitBody(input, referencia));
    if (beforeCtePost && !(await beforeCtePost())) return { skipped: true };
    const created = await deps.acbrFetchJson<Record<string, unknown>>('/cte', {
        method: 'POST',
        body,
        scopes: ['empresa', 'cte'],
        apiEnvironment: input.ambiente,
    });
    return { providerDocId: cteProviderDocIdFromCreateResponse(created) };
}

/**
 * Uma única consulta de status (`GET /cte/{id}`), sem POST na reconciliação.
 * Não decide o que fazer com timeout/erro — isso é o processor da fila que decide,
 * porque só ele sabe a `attemptCount`/`maxAttempts` do `CteEmissionJob`.
 */
export async function pollCteStatusOnce(
    providerDocId: string,
    ambiente: AcbrFiscalEnvironment,
    _attempt: number,
    fetchJson: typeof acbrFetchJson = acbrFetchJson,
): Promise<CtePollOutcome> {
    const baseUrl = getAcbrApiBaseUrlForEnvironment(ambiente);

    const doc = await fetchJson<Record<string, unknown>>(`/cte/${providerDocId}`, {
        method: 'GET',
        scopes: ['empresa', 'cte'],
        apiEnvironment: ambiente,
    });
    const st = norm(doc.status);
    const auth = doc.autorizacao && typeof doc.autorizacao === 'object' && !Array.isArray(doc.autorizacao)
        ? doc.autorizacao as Record<string, unknown> : {};
    const authSt = norm(auth.status);
    const authReason = String(auth.motivo_status ?? auth.xMotivo ?? auth.motivo ?? '').trim();
    const reason = authReason || String(doc.motivo_status ?? '').trim();
    const authRejects = authSt.includes('rejeit') || norm(authReason).includes('rejeic');
    const authAuthorizes = authSt === 'autorizado' || authSt === 'uso autorizado';
    // `cStat` é do retorno fiscal; codigo_status de topo só é usado com rejeição explícita na autorização.
    const codeValue = auth.cStat ?? auth.cstat ?? auth.codigo_status ?? doc.cStat ?? doc.cstat ?? (authRejects ? doc.codigo_status : undefined);
    const code = codeValue == null ? '' : String(codeValue).trim();
    const correctionCodes = new Set(['524', '519', '676', '908']); // regras CFOP no MOC CT-e 4.00
    const unsafeCode = new Set(['204', '205', '206', '218', '539', '656', '999']).has(code);
    const unsafeReason = /duplic|consumo indevido|indisponivel|paralisad|timeout|processamento|falha de comunicacao|erro interno|erro tecnico/.test(norm(reason));

    if ((code === '100' && authRejects) || (correctionCodes.has(code) && authAuthorizes)) {
        return { kind: 'RECONCILIATION_REQUIRED', reason: 'Retorno fiscal contraditório; confirme o estado na SEFAZ.' };
    }
    if (code === '100') {
        return { kind: 'AUTHORIZED', result: mapAuthorizedResult(doc, auth, providerDocId, baseUrl), providerDocId };
    }
    if (unsafeCode || (unsafeReason && (authRejects || st.includes('rejeit') || st.includes('erro') || authSt.includes('erro')))) {
        return {
            kind: 'RECONCILIATION_REQUIRED', reason: `Retorno fiscal exige conferência: ${reason || code}.`,
            ...((['204', '205', '206', '218', '539'].includes(code) || (authRejects && code)) ? { rejectionCode: code, rejectionReason: reason || undefined } : {}),
        };
    }
    if (/^\d{3}$/.test(code) && Number(code) >= 200 && (correctionCodes.has(code) || (authRejects && authReason))) {
        return {
            kind: 'REJECTED',
            result: { status: 'REJECTED', rejectionCode: code, rejectionReason: reason || `Rejeição SEFAZ ${code}.`, rawResponse: doc },
        };
    }
    if ((authAuthorizes && !code) || (st === 'autorizado' && !code && !authRejects)) {
        return { kind: 'AUTHORIZED', result: mapAuthorizedResult(doc, auth, providerDocId, baseUrl), providerDocId };
    }
    if (st.includes('erro') || st.includes('rejeit') || authSt.includes('erro') || authRejects) {
        return { kind: 'RECONCILIATION_REQUIRED', reason: `Retorno do provedor não comprova rejeição fiscal definitiva: ${reason || 'sem detalhes'}.` };
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
    if ('skipped' in submitted) throw new Error('Envio de CT-e não iniciado.');
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
        if (outcome.kind === 'RECONCILIATION_REQUIRED') throw new AcbrCteSubmissionUncertainError(outcome.reason);
    }

    throw new AcbrCteSubmissionUncertainError(`Timeout aguardando retorno da SEFAZ via ACBr para o documento ${providerDocId}.`);
}
