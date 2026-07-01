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

function extractErrorMessage(json: Record<string, unknown>, status: number): string {
    if (json.error && typeof json.error === 'object') {
        const errObj = json.error as Record<string, unknown>;
        if (typeof errObj.message === 'string') return errObj.message;
        if (typeof errObj.code === 'string') return errObj.code;
    }
    if (typeof json.message === 'string') return json.message;
    if (typeof json.error === 'string') return json.error;
    return `HTTP ${status}`;
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
    cityIbgeCode?: string | null;
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
    if (res.status >= 400) {
        console.warn(
            JSON.stringify({
                level: 'warn',
                source: 'acbrJsonRequest',
                path,
                httpStatus: res.status,
                requestBody: init.body ? JSON.stringify(init.body).slice(0, 300) : null,
                response: text.slice(0, 800),
            }),
        );
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
    const cMun = await resolveIbgeMunicipio(person.city, person.state, person.cityIbgeCode);
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
    const msg = extractErrorMessage(json, status);

    const lowerMsg = msg.toLowerCase();
    const code = (json.error && typeof json.error === 'object') ? String((json.error as Record<string, unknown>).code ?? '') : '';
    if (
        status === 409 ||
        code === 'EmpresaAlreadyExists' ||
        (status === 400 &&
            (lowerMsg.includes('cadastrad') ||
                lowerMsg.includes('existe') ||
                lowerMsg.includes('conflict') ||
                lowerMsg.includes('duplicad')))
    ) {
        return { ok: true, duplicate: true };
    }

    return { ok: false, message: msg };
}

/**
 * PUT /empresas/{cnpj}/cte — OpenAPI oficial: apenas CRT + ambiente (homologação/produção).
 * Série e último número ficam como fonte de verdade no TSM (`FiscalEmitter`); não há campos neste PUT para reconciliar numeração na nuvem.
 */
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
    const msg = extractErrorMessage(json, status);
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
    const msg = extractErrorMessage(json, status);
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

// ─── Just-in-time auto-provisioning before CT-e emission ───

export type EnsureEmpresaInput = {
    environment: AcbrFiscalEnvironment;
    crt?: string | null;
    person: PersonLike;
    /** Storage key of the PFX certificate in S3/MinIO. */
    certificateStorageKey?: string | null;
    /** Encrypted certificate password (AES-GCM). */
    certificatePasswordEncrypted?: string | null;
};

/**
 * In-memory cache: "cnpj:env" → timestamp.
 * Avoids re-provisioning the same empresa multiple times in quick succession.
 */
const provisionedCache = new Map<string, number>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Exported for testing — clears the provisioned cache. */
export function clearProvisionedCache(): void {
    provisionedCache.clear();
}

/**
 * Ensure the empresa is fully registered on ACBr before CT-e emission.
 * Idempotent: POST /empresas returns 409 if already exists (treated as success).
 * Cached: skips re-provisioning for the same CNPJ+env within 10 minutes.
 */
export async function ensureEmpresaRegistered(input: EnsureEmpresaInput): Promise<{ ok: boolean; message?: string }> {
    const cnpj = digits(input.person.document);
    if (cnpj.length !== 14) {
        return { ok: false, message: `CNPJ inválido para registro na ACBr: "${input.person.document}".` };
    }

    const cacheKey = `${cnpj}:${input.environment}`;
    const cached = provisionedCache.get(cacheKey);
    if (cached && Date.now() - cached < CACHE_TTL_MS) {
        return { ok: true }; // Already provisioned recently
    }

    // Step 1: Register empresa (idempotent)
    const sync = await syncFiscalEmitterToAcbr({
        environment: input.environment,
        crt: input.crt,
        person: input.person,
    });
    if (!sync.ok) {
        return { ok: false, message: `Falha ao registrar empresa na ACBr: ${sync.message ?? 'erro desconhecido'}` };
    }

    // Step 2: Upload certificate if available
    if (input.certificateStorageKey && input.certificatePasswordEncrypted) {
        try {
            const { getObjectAsBase64 } = await import('../../lib/objectStorage.js');
            const { decryptCertificatePassword } = await import('../fiscalEmitterService.js');
            const certBase64 = await getObjectAsBase64(input.certificateStorageKey);
            const certPassword = decryptCertificatePassword(input.certificatePasswordEncrypted);
            const certResult = await putAcbrEmpresaCertificado(input.person, input.environment, certBase64, certPassword);
            if (!certResult.ok) {
                console.warn(JSON.stringify({
                    level: 'warn',
                    source: 'ensureEmpresaRegistered',
                    cnpj,
                    event: 'certificate_upload_failed',
                    message: certResult.message?.slice(0, 200),
                }));
                // Certificate upload failure is non-fatal for the ensure step;
                // the CT-e emission itself may still work if cert was uploaded previously.
            }
        } catch (certErr) {
            console.warn(JSON.stringify({
                level: 'warn',
                source: 'ensureEmpresaRegistered',
                cnpj,
                event: 'certificate_upload_error',
                message: certErr instanceof Error ? certErr.message.slice(0, 200) : String(certErr).slice(0, 200),
            }));
        }
    }

    provisionedCache.set(cacheKey, Date.now());
    return { ok: true };
}
