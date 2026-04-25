import { buildCtePayload } from './freightEmission.js';

export type CteEnvironment = 'HOMOLOGACAO' | 'PRODUCAO';

export type CteProviderMode = 'simulate-authorized' | 'simulate-rejected';

type NullableString = string | null | undefined;

export interface CtePerson {
    legalName: string;
    document: string;
    stateRegistration?: NullableString;
    address?: NullableString;
    number?: NullableString;
    neighborhood?: NullableString;
    city?: NullableString;
    state?: NullableString;
    cep?: NullableString;
}

export interface CteInvoice {
    type: 'NFE' | 'OUTRAS' | string;
    nfNumber: string;
    nfKey?: NullableString;
    volumes?: number;
    weight?: number;
    value?: number;
}

export interface CteEmissionInput {
    calc: {
        id: string;
        originCity: NullableString;
        destCity: NullableString;
        cfop: NullableString;
        cst: NullableString;
        tipoFrete: NullableString;
        observacoes?: NullableString;
        volumes: number;
        weight: number;
        effectiveWeight: number | null;
        cubage: number | null;
        nfValue: number;
        commodity: NullableString;
        freightTotal: number;
        breakdown: unknown;
        icmsValue: number | null;
    };
    order: {
        freightTerm: NullableString;
        remetentePerson: CtePerson | null;
        destinatarioPerson: CtePerson | null;
        consignatarioPerson: CtePerson | null;
        expedidorPerson: CtePerson | null;
        invoicesRel: CteInvoice[];
    };
    hub: {
        id: string;
        name: string;
        code: string;
        phone?: NullableString;
        rntrc?: NullableString;
    };
    person: CtePerson;
    numero: number;
    serie: number;
    ambiente: CteEnvironment;
}

export interface CteReadinessResult {
    ok: boolean;
    issues: string[];
}

export interface CteProviderOptions {
    mode?: CteProviderMode;
}

export interface CteProviderResult {
    status: 'AUTHORIZED' | 'REJECTED';
    accessKey?: string;
    protocol?: string;
    xml?: string;
    pdfUrl?: string;
    rejectionCode?: string;
    rejectionReason?: string;
    rawResponse: Record<string, unknown>;
}

function present(value: NullableString): boolean {
    return typeof value === 'string' && value.trim().length > 0;
}

function nullable(value: NullableString): string | null {
    return value ?? null;
}

function getTomador(input: CteEmissionInput): CtePerson | null {
    if (input.order.freightTerm === 'CIF') return input.order.remetentePerson;
    if (input.order.freightTerm === 'FOB') return input.order.destinatarioPerson;
    return input.order.consignatarioPerson ?? input.order.destinatarioPerson;
}

function hasFiscalAddress(person: CtePerson | null): boolean {
    if (!person) return false;
    return present(person.address) && present(person.city) && present(person.state) && present(person.cep);
}

export function validateCteReadiness(input: CteEmissionInput): CteReadinessResult {
    const issues: string[] = [];
    const tomador = getTomador(input);

    if (!present(input.hub.rntrc)) issues.push('Hub emissor precisa de RNTRC para CT-e.');
    if (!present(input.person.document) || !present(input.person.legalName)) {
        issues.push('Emitente precisa de CNPJ e razão social.');
    }
    if (!hasFiscalAddress(input.person)) issues.push('Emitente precisa de endereço, município, UF e CEP.');
    if (!tomador) {
        issues.push(`Tomador do frete não identificado para o termo ${input.order.freightTerm ?? 'não informado'}.`);
    } else {
        if (!present(tomador.document) || !present(tomador.legalName)) {
            issues.push('Tomador precisa de documento e razão social/nome.');
        }
        if (!hasFiscalAddress(tomador)) issues.push('Tomador precisa de endereço, município, UF e CEP.');
    }

    if (!present(input.calc.cfop)) issues.push('CT-e precisa de CFOP.');
    if (!present(input.calc.cst)) issues.push('CT-e precisa de CST.');
    if (!present(input.calc.originCity) || !present(input.calc.destCity)) {
        issues.push('CT-e precisa de origem e fim da prestação.');
    }
    if (input.calc.freightTotal <= 0) issues.push('CT-e precisa de valor de frete maior que zero.');
    if (input.order.invoicesRel.length === 0) issues.push('CT-e precisa de documento originário.');

    for (const invoice of input.order.invoicesRel) {
        if (invoice.type === 'NFE' && (!invoice.nfKey || !/^\d{44}$/.test(invoice.nfKey))) {
            issues.push(`NF-e ${invoice.nfNumber} precisa de chave de acesso com 44 dígitos.`);
        }
    }

    return { ok: issues.length === 0, issues };
}

function buildSimulatedAccessKey(input: CteEmissionInput): string {
    const ufCode = input.person.state === 'MA' ? '21' : '99';
    const cnpj = input.person.document.replace(/\D/g, '').padStart(14, '0').slice(0, 14);
    const model = '57';
    const series = String(input.serie).padStart(3, '0').slice(-3);
    const number = String(input.numero).padStart(9, '0').slice(-9);
    const emissionType = '1';
    const numericCode = String(input.numero * 97).padStart(8, '0').slice(-8);
    const base = `${ufCode}2604${cnpj}${model}${series}${number}${emissionType}${numericCode}`;
    return `${base}${base.length % 10}`.padEnd(44, '0').slice(0, 44);
}

export async function authorizeCteWithProvider(
    input: CteEmissionInput,
    options: CteProviderOptions = {},
): Promise<CteProviderResult> {
    const readiness = validateCteReadiness(input);
    if (!readiness.ok) {
        return {
            status: 'REJECTED',
            rejectionCode: 'VALIDATION',
            rejectionReason: readiness.issues.join(' '),
            rawResponse: { provider: 'simulation', issues: readiness.issues },
        };
    }

    if ((options.mode ?? 'simulate-authorized') === 'simulate-rejected') {
        return {
            status: 'REJECTED',
            rejectionCode: 'SIMULATED_REJECTION',
            rejectionReason: 'Rejeição simulada do provedor fiscal.',
            rawResponse: { provider: 'simulation', status: 'rejected' },
        };
    }

    const payload = buildCtePayload({
        calc: {
            ...input.calc,
            originCity: nullable(input.calc.originCity),
            destCity: nullable(input.calc.destCity),
            cfop: nullable(input.calc.cfop),
            cst: nullable(input.calc.cst),
            tipoFrete: nullable(input.calc.tipoFrete),
            observacoes: nullable(input.calc.observacoes),
            commodity: nullable(input.calc.commodity),
        },
        order: {
            ...input.order,
            freightTerm: nullable(input.order.freightTerm),
        },
        hub: input.hub,
        person: input.person,
        numero: input.numero,
        serie: input.serie,
        ambiente: input.ambiente,
    });
    const accessKey = buildSimulatedAccessKey(input);

    return {
        status: 'AUTHORIZED',
        accessKey,
        protocol: `SIM${Date.now()}`,
        xml: `<cte ambiente="${input.ambiente}" chave="${accessKey}">${JSON.stringify(payload)}</cte>`,
        pdfUrl: `/documents/cte/${input.numero}.pdf`,
        rawResponse: { provider: 'simulation', status: 'authorized', accessKey },
    };
}
