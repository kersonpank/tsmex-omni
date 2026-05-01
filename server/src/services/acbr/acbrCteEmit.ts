import type { CteEmissionInput, CteProviderResult } from '../cteService.js';
import { getAcbrAccessToken } from './acbrAuth.js';
import { buildAcbrCteEmitBody } from './acbrCteMapper.js';
import { getAcbrApiBaseUrlForEnvironment } from './acbrConfig.js';
import { acbrFetchJson } from './acbrHttp.js';

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

export async function emitCteViaAcbr(input: CteEmissionInput, referencia: string): Promise<CteProviderResult> {
    const apiEnv = input.ambiente;
    const baseUrl = getAcbrApiBaseUrlForEnvironment(apiEnv);
    const body = await buildAcbrCteEmitBody(input, referencia);
    const created = await acbrFetchJson<Record<string, unknown>>('/cte', {
        method: 'POST',
        body: JSON.stringify(body),
        scopes: ['empresa', 'cte'],
        apiEnvironment: apiEnv,
    });
    const id = String(created.id ?? '');
    if (!id) {
        return {
            status: 'REJECTED',
            rejectionCode: 'ACBR',
            rejectionReason: 'Resposta sem id de documento na ACBr.',
            rawResponse: created,
        };
    }

    for (let attempt = 0; attempt < 24; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
        try {
            await acbrFetchJson(`/cte/${id}/sincronizar`, { method: 'POST', scopes: ['empresa', 'cte'], apiEnvironment: apiEnv });
        } catch {
            /* sync opcional */
        }
        const doc = await acbrFetchJson<Record<string, unknown>>(`/cte/${id}`, { method: 'GET', scopes: ['empresa', 'cte'], apiEnvironment: apiEnv });
        const st = norm(doc.status);
        const auth = (doc.autorizacao ?? {}) as Record<string, unknown>;
        const authSt = norm(auth.status);
        if (authSt.includes('autorizado') || st === 'autorizado') {
            let xml: string | undefined;
            try {
                const token = await getAcbrAccessToken(['empresa', 'cte']);
                const xmlRes = await fetch(`${baseUrl}/cte/${id}/xml`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (xmlRes.ok) xml = await xmlRes.text();
            } catch {
                /* opcional */
            }
            const ok = mapDocToResult(doc, id, baseUrl);
            return { ...ok, xml: xml ?? ok.xml };
        }
        if (st.includes('rejeit') || st.includes('erro') || authSt.includes('rejeit')) {
            return mapDocToResult(doc, id, baseUrl);
        }
    }

    return {
        status: 'REJECTED',
        rejectionCode: 'TIMEOUT',
        rejectionReason: 'Timeout aguardando retorno da SEFAZ via ACBr.',
        rawResponse: { id },
    };
}
