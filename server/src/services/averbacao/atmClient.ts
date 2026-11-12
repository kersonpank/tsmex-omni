/**
 * Cliente da averbação eletrônica AT&M (SOAP 1.1 RPC, namespace urn:ATMWebSvr).
 * Fonte: docs/fiscal/atm-averbacao-pesquisa.md. Validado em homologação real em 2026-11-11:
 * `averbaCTe` e `declaraMDFe` respondem em `http://webserver.averba.com.br/20/index.soap`.
 * Homologação e produção usam o MESMO endpoint; o que distingue teste de produção é a caixa postal
 * (usuário/senha/código). Credenciais nunca são logadas nem devolvidas em `raw`.
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
/** Endpoint único (teste e produção). Sobreponível por `ATM_SOAP_URL`. */
export const ATM_SOAP_URL_DEFAULT = 'http://webserver.averba.com.br/20/index.soap';
export function atmEndpoint(env: NodeJS.ProcessEnv = process.env): string {
    return env.ATM_SOAP_URL?.trim() || ATM_SOAP_URL_DEFAULT;
}
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

/** Um `DadosSeguro` da resposta (um por ramo/apólice: 54 = RCTR-C, 55 = RC-DC). */
export interface AtmDadosSeguro {
    numeroAverbacao: string | null;
    cnpjSeguradora: string | null;
    nomeSeguradora: string | null;
    numApolice: string | null;
    ramo: string | null;
    valorAverbado: string | null;
    tpMov: string | null;
}

export type AtmResult =
    | { kind: 'AVERBADO'; numeroAverbacao: string | null; protocolo: string | null; dhAverbacao: string | null; dadosSeguro: AtmDadosSeguro[]; raw: unknown }
    | { kind: 'JA_AVERBADO'; numeroAverbacao: string | null; protocolo: string | null; dhAverbacao: string | null; dadosSeguro: AtmDadosSeguro[]; raw: unknown }
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

type Payload = { fault: unknown } | { payload: unknown };

/** Abre o envelope SOAP; o retorno do RPC pode vir como string XML escapada em <return> ou como nós inline. */
function extractPayload(soapBody: string): Payload | null {
    let tree: unknown;
    try {
        tree = parser.parse(soapBody);
    } catch {
        return null;
    }
    const fault = findKey(tree, 'Fault');
    if (fault !== undefined) return { fault };
    const body = findKey(tree, 'Body');
    let payload: unknown = body ?? tree;
    const ret = findKey(payload, 'return');
    if (typeof ret === 'string' && ret.trim().startsWith('<')) {
        try { payload = parser.parse(ret); } catch { /* mantém o corpo */ }
    } else if (ret !== undefined) {
        payload = ret;
    }
    return { payload };
}

export function parseDadosSeguro(averbado: unknown): AtmDadosSeguro[] {
    return asList(findKey(averbado, 'DadosSeguro')).flatMap((item) => {
        const n = asNode(item);
        if (!n) return [];
        return [{
            numeroAverbacao: str(findKey(n, 'NumeroAverbacao')),
            cnpjSeguradora: str(findKey(n, 'CNPJSeguradora')),
            nomeSeguradora: str(findKey(n, 'NomeSeguradora')),
            numApolice: str(findKey(n, 'NumApolice')),
            ramo: str(findKey(n, 'RamoAverbado')),
            valorAverbado: str(findKey(n, 'ValorAverbado')),
            tpMov: str(findKey(n, 'TpMov')),
        }];
    });
}

function firstError(payload: unknown): { codigo: string; mensagem: string } | null {
    const erros = asList(findKey(findKey(payload, 'Erros'), 'Erro'));
    const first = asNode(erros[0]) ?? asNode(findKey(payload, 'ERRODETALHE'));
    if (!first) return null;
    return {
        codigo: str(first.Codigo) ?? str(first.CODIGO) ?? '000',
        mensagem: str(first.Descricao) ?? str(first.DESCCOMPLETA) ?? 'Erro da AT&M.',
    };
}

function httpFailure(httpStatus: number): { kind: 'ERRO_TRANSITORIO'; codigo: string; mensagem: string } | null {
    if (httpStatus >= 500 || httpStatus === 429) {
        return { kind: 'ERRO_TRANSITORIO', codigo: `HTTP_${httpStatus}`, mensagem: `AT&M indisponível (HTTP ${httpStatus}).` };
    }
    return null;
}

/** Interpreta o corpo SOAP. Exportado para teste. */
export function parseAtmResponse(soapBody: string, httpStatus = 200): AtmResult {
    const extracted = extractPayload(soapBody);
    if (!extracted) return { kind: 'ERRO_TRANSITORIO', codigo: 'PARSE', mensagem: 'Resposta da AT&M ilegível.' };
    if ('fault' in extracted) {
        const msg = str(findKey(extracted.fault, 'faultstring')) ?? 'SOAP Fault da AT&M.';
        return { kind: 'ERRO_TRANSITORIO', codigo: 'FAULT', mensagem: msg, raw: extracted.fault };
    }
    const payload = extracted.payload;
    const erros = asList(findKey(findKey(payload, 'Erros'), 'Erro'));
    const averbado = asNode(findKey(payload, 'Averbado')) ?? asNode(findKey(payload, 'AVERBADO'));
    const infos = asList(findKey(findKey(payload, 'Infos'), 'Info'));
    const dadosSeguro = parseDadosSeguro(averbado);

    const numeroAverbacao = dadosSeguro[0]?.numeroAverbacao ?? str(findKey(averbado, 'NumeroAverbacao'));
    const protocolo = str(findKey(averbado, 'Protocolo'))
        ?? str(findKey(findKey(averbado, 'PROTOCOLO'), 'PROTOCOLONUMERO'));
    const dhAverbacao = str(findKey(averbado, 'dhAverbacao'));
    const jaAverbado = infos.some((i) => str(asNode(i)?.Codigo) === '001') || erros.some((e) => str(asNode(e)?.Codigo) === '001');

    if (averbado && (numeroAverbacao || protocolo)) {
        const base = { numeroAverbacao, protocolo, dhAverbacao, dadosSeguro, raw: payload };
        return jaAverbado ? { kind: 'JA_AVERBADO', ...base } : { kind: 'AVERBADO', ...base };
    }

    const erro = firstError(payload);
    if (erro) {
        const transitorio = ATM_TRANSIENT_CODES.has(erro.codigo);
        return { kind: transitorio ? 'ERRO_TRANSITORIO' : 'ERRO_DEFINITIVO', codigo: erro.codigo, mensagem: erro.mensagem, raw: payload };
    }
    return httpFailure(httpStatus) ?? { kind: 'ERRO_TRANSITORIO', codigo: 'SEM_RESULTADO', mensagem: 'Resposta da AT&M sem averbação nem erro reconhecível.', raw: payload };
}

/** Resultado do RC-V (ramo 59) devolvido junto da declaração do MDF-e. */
export type AtmRcvOutcome =
    | { status: 'AVERBADO'; conteudo: unknown }
    | { status: 'RECUSADO'; codigo: string; mensagem: string }
    | { status: 'TRANSITORIO'; codigo: string; mensagem: string }
    | { status: 'AUSENTE' };

export type AtmMdfeResult =
    | { kind: 'DECLARADO'; protocolo: string | null; dhChancela: string | null; rcv: AtmRcvOutcome; raw: unknown }
    | { kind: 'ERRO_DEFINITIVO'; codigo: string; mensagem: string; raw?: unknown }
    | { kind: 'ERRO_TRANSITORIO'; codigo: string; mensagem: string; raw?: unknown };

/** Nó cujo nome contém RCV e não é ErroRCV: averbação do RC-V aceita (nome exato ainda não visto; guarda o conteúdo bruto). */
function findRcvSuccessNode(node: unknown): unknown {
    const n = asNode(node);
    if (!n) return undefined;
    for (const [k, v] of Object.entries(n)) {
        const lower = k.toLowerCase();
        if (lower.includes('rcv') && lower !== 'errorcv') return v ?? '';
        const inner = findRcvSuccessNode(v);
        if (inner !== undefined) return inner;
    }
    return undefined;
}

/** Interpreta a resposta de `declaraMDFe`. Exportado para teste. */
export function parseMdfeResponse(soapBody: string, httpStatus = 200): AtmMdfeResult {
    const extracted = extractPayload(soapBody);
    if (!extracted) return { kind: 'ERRO_TRANSITORIO', codigo: 'PARSE', mensagem: 'Resposta da AT&M ilegível.' };
    if ('fault' in extracted) {
        return { kind: 'ERRO_TRANSITORIO', codigo: 'FAULT', mensagem: str(findKey(extracted.fault, 'faultstring')) ?? 'SOAP Fault da AT&M.', raw: extracted.fault };
    }
    const payload = extracted.payload;
    const declarado = asNode(findKey(payload, 'Declarado'));
    const erro = firstError(payload);
    if (!declarado) {
        if (erro) return { kind: ATM_TRANSIENT_CODES.has(erro.codigo) ? 'ERRO_TRANSITORIO' : 'ERRO_DEFINITIVO', ...erro, raw: payload };
        return httpFailure(httpStatus) ?? { kind: 'ERRO_TRANSITORIO', codigo: 'SEM_RESULTADO', mensagem: 'Resposta da AT&M sem declaração nem erro reconhecível.', raw: payload };
    }
    const erroRcv = asNode(findKey(payload, 'ErroRCV'));
    const rcvSuccess = erroRcv ? undefined : findRcvSuccessNode(payload);
    let rcv: AtmRcvOutcome = { status: 'AUSENTE' };
    if (erroRcv) {
        const codigo = str(erroRcv.Codigo) ?? '000';
        const mensagem = str(erroRcv.Descricao) ?? 'RC-V recusado pela AT&M.';
        rcv = ATM_TRANSIENT_CODES.has(codigo) ? { status: 'TRANSITORIO', codigo, mensagem } : { status: 'RECUSADO', codigo, mensagem };
    } else if (rcvSuccess !== undefined) {
        rcv = { status: 'AVERBADO', conteudo: rcvSuccess };
    }
    return { kind: 'DECLARADO', protocolo: str(findKey(declarado, 'Protocolo')), dhChancela: str(findKey(declarado, 'dhChancela')), rcv, raw: payload };
}

async function send(
    op: { operation: string; xmlTag: string },
    xml: string,
    credentials: AtmCredentials,
    transport: AtmTransport,
): Promise<AtmHttpResponse | { error: { codigo: string; mensagem: string } }> {
    try {
        return await transport({
            url: atmEndpoint(),
            soapAction: `${ATM_NAMESPACE}#${op.operation}`,
            body: buildAtmEnvelope(op, xml, credentials),
            timeoutMs: ATM_TIMEOUT_MS,
        });
    } catch (error) {
        const aborted = error instanceof Error && error.name === 'AbortError';
        return { error: { codigo: aborted ? 'TIMEOUT' : 'REDE', mensagem: aborted ? 'Timeout na AT&M.' : 'Falha de rede ao chamar a AT&M.' } };
    }
}

async function call(
    op: { operation: string; xmlTag: string },
    xml: string,
    credentials: AtmCredentials,
    transport: AtmTransport,
): Promise<AtmResult> {
    const response = await send(op, xml, credentials, transport);
    if ('error' in response) return { kind: 'ERRO_TRANSITORIO', ...response.error };
    return parseAtmResponse(response.body, response.status);
}

/** Averba um CT-e já autorizado (XML com protocolo). Reenvio do mesmo XML é idempotente (JA_AVERBADO). */
/** `environment` é só rótulo: teste e produção usam o mesmo endpoint (a caixa postal distingue). */
export function averbarCte(xmlCteAutorizado: string, credentials: AtmCredentials, _environment: AtmEnvironment, transport: AtmTransport = defaultAtmTransport) {
    return call(ATM_OPERATIONS.averbaCTe, xmlCteAutorizado, credentials, transport);
}

/** Cancelamento: reenvia o XML do evento de cancelamento protocolado à mesma operação (Manual §13). Usado pelo varredor (`cancelarAverbacaoCalculo`). */
export function cancelarAverbacaoCte(xmlEventoCancelamento: string, credentials: AtmCredentials, _environment: AtmEnvironment, transport: AtmTransport = defaultAtmTransport) {
    return call(ATM_OPERATIONS.averbaCTe, xmlEventoCancelamento, credentials, transport);
}

/** Declaração do MDF-e autorizado: devolve a chancela (Declarado) e o resultado do RC-V (ramo 59). */
export async function declararMdfe(xmlMdfeAutorizado: string, credentials: AtmCredentials, _environment: AtmEnvironment, transport: AtmTransport = defaultAtmTransport): Promise<AtmMdfeResult> {
    const response = await send(ATM_OPERATIONS.declaraMDFe, xmlMdfeAutorizado, credentials, transport);
    if ('error' in response) return { kind: 'ERRO_TRANSITORIO', ...response.error };
    return parseMdfeResponse(response.body, response.status);
}
