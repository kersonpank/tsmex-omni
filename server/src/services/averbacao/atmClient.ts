/**
 * Cliente da averbação eletrônica AT&M (SOAP 1.1 RPC, namespace urn:ATMWebSvr).
 * Fonte: docs/fiscal/atm-averbacao-pesquisa.md. NADA aqui foi validado contra a AT&M real:
 * nomes de operação e formato de resposta estão isolados em constantes para ajuste após o WSDL oficial.
 * Credenciais nunca são logadas nem devolvidas em `raw`.
 */
import { XMLParser } from 'fast-xml-parser';

export interface AtmCredentials {
    codigo: string;
    usuario: string;
    senha: string;
}

export type AtmEnvironment = 'HOMOLOGACAO' | 'PRODUCAO';

/** Nomes de operação/tag. O manual v3.0 cita averbaCTe20; clientes funcionais usam averbaCTe. */
export const ATM_OPERATIONS = {
    averbaCTe: { operation: 'averbaCTe', xmlTag: 'xmlCTe' },
    declaraMDFe: { operation: 'declaraMDFe', xmlTag: 'xmlMDFe' },
} as const;

export const ATM_NAMESPACE = 'urn:ATMWebSvr';
export const ATM_ENDPOINTS: Record<AtmEnvironment, string> = {
    PRODUCAO: 'http://webserver.averba.com.br/20/index.soap',
    HOMOLOGACAO: 'http://homologaws.averba.com.br/20/index.soap',
};
export const ATM_TIMEOUT_MS = 30_000;

/** Códigos em que o manual autoriza reenvio automático (000, 002, 907, 910). Branco/timeout também. */
export const ATM_TRANSIENT_CODES = new Set(['000', '002', '907', '910']);

export interface AtmHttpRequest {
    url: string;
    soapAction: string;
    body: string;
    timeoutMs: number;
}
export interface AtmHttpResponse {
    status: number;
    body: string;
}
export type AtmTransport = (request: AtmHttpRequest) => Promise<AtmHttpResponse>;

export type AtmResult =
    | { kind: 'AVERBADO'; numeroAverbacao: string | null; protocolo: string | null; dhAverbacao: string | null; raw: unknown }
    | { kind: 'JA_AVERBADO'; numeroAverbacao: string | null; protocolo: string | null; dhAverbacao: string | null; raw: unknown }
    | { kind: 'ERRO_DEFINITIVO'; codigo: string; mensagem: string; raw?: unknown }
    | { kind: 'ERRO_TRANSITORIO'; codigo: string; mensagem: string; raw?: unknown };

/** Transporte padrão (fetch com timeout). Só é usado fora dos testes. */
export const defaultAtmTransport: AtmTransport = async ({ url, soapAction, body, timeoutMs }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/xml;charset=UTF-8', SOAPAction: soapAction },
            body,
            signal: controller.signal,
        });
        return { status: res.status, body: await res.text() };
    } finally {
        clearTimeout(timer);
    }
};

function escapeXmlText(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** CDATA seguro: divide qualquer `]]>` presente no documento. */
function cdata(xml: string): string {
    return `<![CDATA[${xml.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;
}

export function buildAtmEnvelope(op: { operation: string; xmlTag: string }, xml: string, credentials: AtmCredentials): string {
    return '<?xml version="1.0" encoding="utf-8"?>'
        + '<soapenv:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"'
        + ` xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="${ATM_NAMESPACE}">`
        + '<soapenv:Body>'
        + `<${op.operation}>`
        + `<usuario>${escapeXmlText(credentials.usuario)}</usuario>`
        + `<senha>${escapeXmlText(credentials.senha)}</senha>`
        + `<codatm>${escapeXmlText(credentials.codigo)}</codatm>`
        + `<${op.xmlTag}>${cdata(xml)}</${op.xmlTag}>`
        + `</${op.operation}>`
        + '</soapenv:Body></soapenv:Envelope>';
}

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false, trimValues: true });

type Node = Record<string, unknown>;
const asNode = (v: unknown): Node | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Node) : null);
const asList = (v: unknown): unknown[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const str = (v: unknown): string | null => {
    if (v == null) return null;
    if (typeof v === 'string') return v.trim() || null;
    if (typeof v === 'number') return String(v);
    return null;
};

/** Procura a primeira chave (case-insensitive) em profundidade. */
function findKey(node: unknown, name: string): unknown {
    const lower = name.toLowerCase();
    const n = asNode(node);
    if (!n) return undefined;
    for (const [k, v] of Object.entries(n)) if (k.toLowerCase() === lower) return v;
    for (const v of Object.values(n)) {
        const found = findKey(v, name);
        if (found !== undefined) return found;
    }
    return undefined;
}

/** Remove credenciais eventualmente ecoadas e limita o tamanho do que é persistido. */
export function sanitizeRaw(text: string, credentials?: AtmCredentials): string {
    let out = text;
    for (const secret of [credentials?.senha, credentials?.usuario]) {
        if (secret && secret.length >= 3) out = out.split(secret).join('***');
    }
    return out.slice(0, 20_000);
}

/** Interpreta o corpo SOAP. Exportado para teste. */
export function parseAtmResponse(soapBody: string, httpStatus = 200): AtmResult {
    let tree: unknown;
    try {
        tree = parser.parse(soapBody);
    } catch {
        return { kind: 'ERRO_TRANSITORIO', codigo: 'PARSE', mensagem: 'Resposta da AT&M ilegível.' };
    }
    const fault = findKey(tree, 'Fault');
    if (fault !== undefined) {
        const msg = str(findKey(fault, 'faultstring')) ?? 'SOAP Fault da AT&M.';
        return { kind: 'ERRO_TRANSITORIO', codigo: 'FAULT', mensagem: msg, raw: fault };
    }
    // O retorno do RPC costuma vir como string XML escapada dentro de <return>.
    const body = findKey(tree, 'Body');
    let payload: unknown = body ?? tree;
    const ret = findKey(payload, 'return');
    if (typeof ret === 'string' && ret.trim().startsWith('<')) {
        try { payload = parser.parse(ret); } catch { /* mantém o corpo */ }
    } else if (ret !== undefined) {
        payload = ret;
    }

    const erros = asList(findKey(findKey(payload, 'Erros'), 'Erro'));
    const legacyErro = findKey(payload, 'ERRODETALHE');
    const averbado = asNode(findKey(payload, 'Averbado')) ?? asNode(findKey(payload, 'AVERBADO'));
    const infos = asList(findKey(findKey(payload, 'Infos'), 'Info'));

    const numeroAverbacao = str(findKey(averbado, 'NumeroAverbacao'));
    const protocolo = str(findKey(averbado, 'Protocolo'))
        ?? str(findKey(findKey(averbado, 'PROTOCOLO'), 'PROTOCOLONUMERO'));
    const dhAverbacao = str(findKey(averbado, 'dhAverbacao'));
    const jaAverbado = infos.some((i) => str(asNode(i)?.Codigo) === '001') || erros.some((e) => str(asNode(e)?.Codigo) === '001');

    if (averbado && (numeroAverbacao || protocolo)) {
        const base = { numeroAverbacao, protocolo, dhAverbacao, raw: payload };
        return jaAverbado ? { kind: 'JA_AVERBADO', ...base } : { kind: 'AVERBADO', ...base };
    }

    const firstErro = asNode(erros[0]) ?? asNode(legacyErro);
    if (firstErro) {
        const codigo = str(firstErro.Codigo) ?? str(firstErro.CODIGO) ?? '000';
        const mensagem = str(firstErro.Descricao) ?? str(firstErro.DESCCOMPLETA) ?? 'Erro da AT&M.';
        const transitorio = ATM_TRANSIENT_CODES.has(codigo);
        return { kind: transitorio ? 'ERRO_TRANSITORIO' : 'ERRO_DEFINITIVO', codigo, mensagem, raw: payload };
    }
    if (httpStatus >= 500 || httpStatus === 429) {
        return { kind: 'ERRO_TRANSITORIO', codigo: `HTTP_${httpStatus}`, mensagem: `AT&M indisponível (HTTP ${httpStatus}).` };
    }
    return { kind: 'ERRO_TRANSITORIO', codigo: 'SEM_RESULTADO', mensagem: 'Resposta da AT&M sem averbação nem erro reconhecível.', raw: payload };
}

async function call(
    op: { operation: string; xmlTag: string },
    xml: string,
    credentials: AtmCredentials,
    environment: AtmEnvironment,
    transport: AtmTransport,
): Promise<AtmResult> {
    let response: AtmHttpResponse;
    try {
        response = await transport({
            url: ATM_ENDPOINTS[environment],
            soapAction: `${ATM_NAMESPACE}#${op.operation}`,
            body: buildAtmEnvelope(op, xml, credentials),
            timeoutMs: ATM_TIMEOUT_MS,
        });
    } catch (error) {
        const aborted = error instanceof Error && error.name === 'AbortError';
        return { kind: 'ERRO_TRANSITORIO', codigo: aborted ? 'TIMEOUT' : 'REDE', mensagem: aborted ? 'Timeout na AT&M.' : 'Falha de rede ao chamar a AT&M.' };
    }
    const result = parseAtmResponse(response.body, response.status);
    return result;
}

/** Averba um CT-e já autorizado (XML com protocolo). Reenvio do mesmo XML é idempotente (JA_AVERBADO). */
export function averbarCte(xmlCteAutorizado: string, credentials: AtmCredentials, environment: AtmEnvironment, transport: AtmTransport = defaultAtmTransport) {
    return call(ATM_OPERATIONS.averbaCTe, xmlCteAutorizado, credentials, environment, transport);
}

/** Cancelamento: reenvia o XML do evento de cancelamento protocolado à mesma operação (Manual §13). Sem uso em fluxo ainda. */
export function cancelarAverbacaoCte(xmlEventoCancelamento: string, credentials: AtmCredentials, environment: AtmEnvironment, transport: AtmTransport = defaultAtmTransport) {
    return call(ATM_OPERATIONS.averbaCTe, xmlEventoCancelamento, credentials, environment, transport);
}

/** Declaração do MDF-e autorizado. Contrato de resposta NÃO confirmado (nós Declarado/Protocolo). */
export async function declararMdfe(xmlMdfeAutorizado: string, credentials: AtmCredentials, environment: AtmEnvironment, transport: AtmTransport = defaultAtmTransport): Promise<AtmResult> {
    const result = await call(ATM_OPERATIONS.declaraMDFe, xmlMdfeAutorizado, credentials, environment, transport);
    if (result.kind !== 'ERRO_TRANSITORIO' || result.codigo !== 'SEM_RESULTADO') return result;
    const declarado = asNode(findKey(result.raw, 'Declarado'));
    const protocolo = str(findKey(declarado, 'Protocolo'));
    if (protocolo) return { kind: 'AVERBADO', numeroAverbacao: null, protocolo, dhAverbacao: str(findKey(declarado, 'dhChancela')), raw: result.raw };
    return result;
}
