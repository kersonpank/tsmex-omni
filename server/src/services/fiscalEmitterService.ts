import { openSecret, sealSecret } from '../lib/secretBox.js';

export type FiscalEnvironment = 'HOMOLOGACAO' | 'PRODUCAO';

export interface FiscalEmitterReadinessInput {
    person: {
        documentType: 'CPF' | 'CNPJ' | string;
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
    rntrc?: string | null;
    crt?: string | null;
    cteSeries?: number | null;
    environment?: FiscalEnvironment | string | null;
    certificateStorageKey?: string | null;
    certificatePasswordEncrypted?: string | null;
    provider?: string | null;
    defaultCteCfop?: string | null;
    defaultCteCst?: string | null;
}

export interface FiscalEmitterReadiness {
    readyForMinuta: boolean;
    readyForHomologation: boolean;
    readyForProduction: boolean;
    issues: string[];
}

function isPresent(value: string | null | undefined): boolean {
    return typeof value === 'string' && value.trim().length > 0;
}

export function encryptCertificatePassword(password: string, secret = process.env.FISCAL_SECRET_KEY ?? ''): string {
    if (!secret) {
        throw new Error('FISCAL_SECRET_KEY is required to encrypt certificate passwords');
    }
    return sealSecret(password, secret);
}

export function decryptCertificatePassword(encryptedValue: string, secret = process.env.FISCAL_SECRET_KEY ?? ''): string {
    if (!secret) {
        throw new Error('FISCAL_SECRET_KEY is required to decrypt certificate passwords');
    }
    try {
        return openSecret(encryptedValue, secret);
    } catch (error) {
        if (error instanceof Error && error.message === 'Unsupported secret format') {
            throw new Error('Unsupported certificate password format');
        }
        throw error;
    }
}

export function buildFiscalEmitterReadiness(input: FiscalEmitterReadinessInput): FiscalEmitterReadiness {
    const issues: string[] = [];
    const p = input.person;

    if (p.documentType !== 'CNPJ') issues.push('Emitente deve ser uma Pessoa Jurídica (CNPJ).');
    if (!isPresent(p.document) || !isPresent(p.legalName)) {
        issues.push('Emitente precisa de CNPJ e razão social.');
    }
    if (!isPresent(p.address) || !isPresent(p.number) || !isPresent(p.neighborhood) || !isPresent(p.city) || !isPresent(p.state) || !isPresent(p.cep)) {
        issues.push('Emitente precisa de endereço fiscal completo.');
    }
    if (!isPresent(input.rntrc)) issues.push('RNTRC é obrigatório para CT-e/MDF-e.');
    if (!isPresent(input.crt)) issues.push('CRT/regime tributário é obrigatório.');
    if (!input.cteSeries || input.cteSeries <= 0) issues.push('Série CT-e é obrigatória.');
    if (!input.environment) issues.push('Ambiente fiscal é obrigatório.');

    const needsCteTaxDefaults = input.provider === 'ACBR';
    if (needsCteTaxDefaults) {
        if (!isPresent(input.defaultCteCfop)) {
            issues.push('Defina CFOP padrão do CT-e nas configurações do emitente.');
        }
        if (!isPresent(input.defaultCteCst)) {
            issues.push('Defina CST padrão do CT-e nas configurações do emitente.');
        }
    }

    const readyForMinuta = issues.length === 0;

    if (!isPresent(input.certificateStorageKey) || !isPresent(input.certificatePasswordEncrypted)) {
        issues.push('Certificado A1 e senha são obrigatórios para homologação/produção.');
    }

    const readyForHomologation = issues.length === 0;
    const readyForProduction = readyForHomologation && input.environment === 'PRODUCAO';

    return {
        readyForMinuta,
        readyForHomologation,
        readyForProduction,
        issues,
    };
}

export function getCertificateStatus(params: {
    certificateStorageKey?: string | null;
    certificatePasswordEncrypted?: string | null;
    certificateExpiresAt?: Date | string | null;
}): 'MISSING' | 'READY' | 'EXPIRED' {
    if (!params.certificateStorageKey || !params.certificatePasswordEncrypted) return 'MISSING';
    if (params.certificateExpiresAt && new Date(params.certificateExpiresAt).getTime() < Date.now()) return 'EXPIRED';
    return 'READY';
}
