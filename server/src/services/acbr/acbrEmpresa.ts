import { getAcbrAccessToken } from './acbrAuth.js';
import { getAcbrApiBaseUrlForEnvironment, type AcbrFiscalEnvironment } from './acbrConfig.js';
import { resolveIbgeMunicipio } from './acbrIbge.js';

function digits(s: string): string {
    return s.replace(/\D/g, '');
}

function parseCrt(crt?: string | null): number {
    const n = parseInt(String(crt ?? '3').replace(/\D/g, ''), 10);
    if (n === 1 || n === 2 || n === 3 || n === 4) return n;
    return 3;
}

type PersonLike = {
    document: string;
    legalName: string;
    stateRegistration?: string | null;
    address?: string | null;
    number?: string | null;
    neighborhood?: string | null;
    city?: string | null;
    state?: string | null;
    cep?: string | null;
};

async function acbrJsonRequest(
    path: string,
    init: {
        method: string;
        body?: unknown;
        scopes: string[];
        apiEnvironment: AcbrFiscalEnvironment;
    },
): Promise<{ status: number; json: Record<string, unknown> }> {
    const token = await getAcbrAccessToken(init.scopes);
    const base = getAcbrApiBaseUrlForEnvironment(init.apiEnvironment);
    const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
    };
    const res = await fetch(url, {
        method: init.method,
        headers,
        body: init.body != null ? JSON.stringify(init.body) : undefined,
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
        json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
        json = { raw: text.slice(0, 500) };
    }
    return { status: res.status, json };
}

function buildEmpresaBody(person: PersonLike, email: string): Record<string, unknown> {
    const cnpj = digits(person.document);
    const cep = digits(person.cep ?? '').padStart(8, '0').slice(0, 8) || '01310100';
    return {
        cpf_cnpj: cnpj,
        nome_razao_social: person.legalName.slice(0, 120),
        nome_fantasia: person.legalName.slice(0, 60),
        inscricao_estadual: (person.stateRegistration ?? 'ISENTO').toString().slice(0, 20),
        inscricao_municipal: '0',
        fone: '1133330000',
        email: email.slice(0, 120),
        endereco: {
            logradouro: (person.address ?? 'NAO INFORMADO').slice(0, 60),
            numero: (person.number ?? 'S/N').slice(0, 60),
            complemento: '',
            bairro: (person.neighborhood ?? 'CENTRO').slice(0, 60),
            codigo_municipio: '', // preenchido async
            cidade: (person.city ?? 'NAO INFORMADO').slice(0, 60),
            uf: (person.state ?? 'SP').slice(0, 2).toUpperCase(),
            codigo_pais: '1058',
            pais: 'Brasil',
            cep,
        },
    };
}

/** POST /empresas — 201 criado; 409 já existe (idempotente). */
export async function createAcbrEmpresaForPerson(
    person: PersonLike,
    apiEnvironment: AcbrFiscalEnvironment,
    email = 'fiscal@tsm-ex.local',
): Promise<{ ok: boolean; duplicate?: boolean; message?: string }> {
    const cMun = await resolveIbgeMunicipio(person.city, person.state);
    const body = buildEmpresaBody(person, email) as Record<string, unknown>;
    const end = (body.endereco as Record<string, unknown>);
    end.codigo_municipio = cMun;

    const { status, json } = await acbrJsonRequest('/empresas', {
        method: 'POST',
        body,
        scopes: ['empresa'],
        apiEnvironment,
    });
    if (status === 201 || status === 200) return { ok: true };
    if (status === 409) return { ok: true, duplicate: true };
    const msg =
        typeof json.message === 'string'
            ? json.message
            : typeof json.error === 'string'
              ? json.error
              : `HTTP ${status}`;
    return { ok: false, message: msg };
}

/** PUT /empresas/{cnpj}/cte — CRT + ambiente (obrigatório antes da 1ª emissão na ACBr). */
export async function putAcbrEmpresaCteConfig(
    person: PersonLike,
    apiEnvironment: AcbrFiscalEnvironment,
    crt?: string | null,
): Promise<{ ok: boolean; message?: string }> {
    const cnpj = digits(person.document);
    if (cnpj.length !== 14) return { ok: false, message: 'CNPJ inválido para configuração CT-e na ACBr.' };
    const ambiente = apiEnvironment === 'PRODUCAO' ? 'producao' : 'homologacao';
    const { status, json } = await acbrJsonRequest(`/empresas/${cnpj}/cte`, {
        method: 'PUT',
        body: { CRT: parseCrt(crt), ambiente },
        scopes: ['empresa'],
        apiEnvironment,
    });
    if (status === 200 || status === 201) return { ok: true };
    const msg =
        typeof json.message === 'string'
            ? json.message
            : typeof json.error === 'string'
              ? json.error
              : `HTTP ${status}`;
    return { ok: false, message: msg };
}

/** PUT /empresas/{cnpj}/certificado — certificado Base64 + senha. */
export async function putAcbrEmpresaCertificado(
    person: PersonLike,
    apiEnvironment: AcbrFiscalEnvironment,
    certificadoBase64: string,
    password: string,
): Promise<{ ok: boolean; message?: string }> {
    const cnpj = digits(person.document);
    if (cnpj.length !== 14) return { ok: false, message: 'CNPJ inválido para certificado na ACBr.' };
    const normalized = certificadoBase64.includes('base64,') ? certificadoBase64.split('base64,').pop()! : certificadoBase64;
    const { status, json } = await acbrJsonRequest(`/empresas/${cnpj}/certificado`, {
        method: 'PUT',
        body: { certificado: normalized, password },
        scopes: ['empresa'],
        apiEnvironment,
    });
    if (status === 200 || status === 201) return { ok: true };
    const msg =
        typeof json.message === 'string'
            ? json.message
            : typeof json.error === 'string'
              ? json.error
              : `HTTP ${status}`;
    return { ok: false, message: msg };
}

export type FiscalEmitterAcbrSyncInput = {
    environment: AcbrFiscalEnvironment;
    crt?: string | null;
    person: PersonLike;
};

/** Cadastra empresa na ACBr + configuração CT-e (idempotente na empresa). */
export async function syncFiscalEmitterToAcbr(input: FiscalEmitterAcbrSyncInput): Promise<{ ok: boolean; message?: string }> {
    const email = `fiscal+${digits(input.person.document)}@emitente.tsm`.slice(0, 120);
    const emp = await createAcbrEmpresaForPerson(input.person, input.environment, email);
    if (!emp.ok) return emp;
    const cfg = await putAcbrEmpresaCteConfig(input.person, input.environment, input.crt);
    if (!cfg.ok) return cfg;
    return { ok: true };
}
