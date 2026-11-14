import type { FiscalEmitter, FiscalEnvironment, FiscalProvider, FiscalTaxRegime, MdfeCargoTotalsSource, Person } from '../../../types/index';
import { onlyDigits } from '../ui/form';

/** Formulário do emitente fiscal e regras puras da tela Sistema (mesmo corpo da gestão clássica). */

export interface EmitterForm {
    id?: string;
    personId: string;
    hubId: string | null;
    displayName: string;
    tradeName: string;
    logoUrl: string;
    logoStorageKey: string;
    footerNote: string;
    rntrc: string;
    taxRegime: FiscalTaxRegime | '';
    crt: string;
    cteSeries: number;
    lastCteNumber: number;
    lastDceNumber: number;
    lastMinutaNumber: number;
    environment: FiscalEnvironment;
    efreteEnvironment: FiscalEnvironment;
    provider: FiscalProvider;
    active: boolean;
    defaultForHub: boolean;
    distribuicaoNfeEnabled: boolean;
    defaultCteCfop: string;
    defaultCteCst: string;
    cargoInsurerName: string;
    cargoInsurerCnpj: string;
    cargoInsurancePolicyNumber: string;
    averbacaoProvider: 'NONE' | 'ATM';
    atmCode: string;
    atmUser: string;
    /** Sempre vazia ao carregar; vazia ao salvar = não altera a senha gravada. */
    atmPassword: string;
    atmEnvironment: FiscalEnvironment;
    cargoTracked: boolean;
    cargoLoadUnloadCovered: boolean;
    atmDeclareMdfe: boolean;
    rcvBlocksDeparture: boolean;
    mdfeCargoTotalsSource: MdfeCargoTotalsSource;
    hasAtmPassword: boolean;
}

export const emptyEmitterForm = (): EmitterForm => ({
    personId: '',
    hubId: null,
    displayName: '',
    tradeName: '',
    logoUrl: '',
    logoStorageKey: '',
    footerNote: '',
    rntrc: '',
    taxRegime: '',
    crt: '1',
    cteSeries: 1,
    lastCteNumber: 0,
    lastDceNumber: 0,
    lastMinutaNumber: 0,
    environment: 'HOMOLOGACAO',
    efreteEnvironment: 'HOMOLOGACAO',
    provider: 'SIMULATED',
    active: true,
    defaultForHub: false,
    distribuicaoNfeEnabled: false,
    defaultCteCfop: '',
    defaultCteCst: '',
    cargoInsurerName: '',
    cargoInsurerCnpj: '',
    cargoInsurancePolicyNumber: '',
    averbacaoProvider: 'NONE',
    atmCode: '',
    atmUser: '',
    atmPassword: '',
    atmEnvironment: 'HOMOLOGACAO',
    cargoTracked: false,
    cargoLoadUnloadCovered: false,
    atmDeclareMdfe: true,
    rcvBlocksDeparture: false,
    mdfeCargoTotalsSource: 'TRIP_COUNTER',
    hasAtmPassword: false,
});

export function emitterToForm(e: FiscalEmitter): EmitterForm {
    return {
        id: e.id,
        personId: e.personId,
        hubId: e.hubId ?? null,
        displayName: e.displayName ?? '',
        tradeName: e.tradeName ?? '',
        logoUrl: e.logoUrl ?? '',
        logoStorageKey: e.logoStorageKey ?? '',
        footerNote: e.footerNote ?? '',
        rntrc: e.rntrc ?? '',
        taxRegime: e.taxRegime ?? '',
        crt: e.crt ?? '',
        cteSeries: e.cteSeries ?? 1,
        lastCteNumber: e.lastCteNumber ?? 0,
        lastDceNumber: e.lastDceNumber ?? 0,
        lastMinutaNumber: e.lastMinutaNumber ?? 0,
        environment: e.environment,
        efreteEnvironment: e.efreteEnvironment ?? 'HOMOLOGACAO',
        provider: e.provider ?? 'SIMULATED',
        active: e.active,
        defaultForHub: e.defaultForHub,
        distribuicaoNfeEnabled: e.distribuicaoNfeEnabled ?? false,
        defaultCteCfop: e.defaultCteCfop ?? '',
        defaultCteCst: e.defaultCteCst ?? '',
        cargoInsurerName: e.cargoInsurerName ?? '',
        cargoInsurerCnpj: e.cargoInsurerCnpj ?? '',
        cargoInsurancePolicyNumber: e.cargoInsurancePolicyNumber ?? '',
        averbacaoProvider: e.averbacaoProvider ?? 'NONE',
        atmCode: e.atmCode ?? '',
        atmUser: e.atmUser ?? '',
        atmPassword: '',
        atmEnvironment: e.atmEnvironment ?? 'HOMOLOGACAO',
        cargoTracked: Boolean(e.cargoTracked),
        cargoLoadUnloadCovered: Boolean(e.cargoLoadUnloadCovered),
        atmDeclareMdfe: e.atmDeclareMdfe ?? true,
        rcvBlocksDeparture: Boolean(e.rcvBlocksDeparture),
        mdfeCargoTotalsSource: e.mdfeCargoTotalsSource ?? 'TRIP_COUNTER',
        hasAtmPassword: Boolean(e.hasAtmPassword),
    };
}

const nonNegative = (n: number) => Math.max(0, Number(n) || 0);

/** Corpo igual ao da clássica. A senha da AT&M só vai se foi digitada (vazia = manter a gravada). */
export function buildEmitterPayload(form: EmitterForm, person?: Pick<Person, 'tradeName'> | null): Record<string, unknown> & { personId: string } {
    return {
        personId: form.personId,
        hubId: form.hubId || null,
        displayName: form.displayName || null,
        tradeName: form.tradeName || person?.tradeName || null,
        logoUrl: form.logoUrl || null,
        logoStorageKey: form.logoStorageKey || null,
        footerNote: form.footerNote || null,
        rntrc: form.rntrc || null,
        taxRegime: form.taxRegime || null,
        crt: form.crt || null,
        cteSeries: Number(form.cteSeries) || 1,
        lastCteNumber: nonNegative(form.lastCteNumber),
        lastDceNumber: nonNegative(form.lastDceNumber),
        lastMinutaNumber: nonNegative(form.lastMinutaNumber),
        environment: form.environment,
        efreteEnvironment: form.efreteEnvironment,
        provider: form.provider,
        active: form.active,
        defaultForHub: form.defaultForHub,
        distribuicaoNfeEnabled: form.distribuicaoNfeEnabled,
        defaultCteCfop: form.defaultCteCfop.trim() || null,
        defaultCteCst: form.defaultCteCst.trim() || null,
        cargoInsurerName: form.cargoInsurerName.trim() || null,
        cargoInsurerCnpj: form.cargoInsurerCnpj.trim() || null,
        cargoInsurancePolicyNumber: form.cargoInsurancePolicyNumber.trim() || null,
        averbacaoProvider: form.averbacaoProvider,
        atmCode: form.atmCode.trim() || null,
        atmUser: form.atmUser.trim() || null,
        ...(form.atmPassword ? { atmPassword: form.atmPassword } : {}),
        atmEnvironment: form.atmEnvironment,
        cargoTracked: form.cargoTracked,
        cargoLoadUnloadCovered: form.cargoLoadUnloadCovered,
        atmDeclareMdfe: form.atmDeclareMdfe,
        rcvBlocksDeparture: form.rcvBlocksDeparture,
        mdfeCargoTotalsSource: form.mdfeCargoTotalsSource,
    };
}

export function validateEmitterForm(form: EmitterForm): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!form.personId) errors.personId = 'Escolha o CNPJ do emitente.';
    const insurer = onlyDigits(form.cargoInsurerCnpj);
    if (insurer && insurer.length !== 14) errors.cargoInsurerCnpj = 'O CNPJ da seguradora precisa ter 14 dígitos.';
    return errors;
}

/** A clássica só aceita .pfx ou .p12 e exige a senha junto do arquivo. */
export function certificateProblem(file: { name: string } | null, password: string): string | null {
    if (!file) return null;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.pfx') && !lower.endsWith('.p12')) return 'O certificado A1 precisa ser um arquivo .pfx ou .p12.';
    if (!password) return 'Informe a senha do certificado A1 para enviá-lo.';
    return null;
}

export const SEED_KEY_LENGTH = 44;

export function seedProblem(mode: 'chave' | 'nsu', value: string): string | null {
    const digits = onlyDigits(value);
    if (mode === 'chave') return digits.length === SEED_KEY_LENGTH ? null : `A chave da NF-e tem ${SEED_KEY_LENGTH} dígitos.`;
    return digits ? null : 'Informe o último NSU.';
}

export const TAX_REGIME_LABEL: Record<FiscalTaxRegime, string> = {
    SIMPLES_NACIONAL: 'Simples Nacional',
    LUCRO_PRESUMIDO: 'Lucro Presumido',
    LUCRO_REAL: 'Lucro Real',
    MEI: 'MEI',
    OUTRO: 'Outro',
};

export const TOTALS_SOURCE_LABEL: Record<MdfeCargoTotalsSource, string> = {
    TRIP_COUNTER: 'Totais da viagem (peso taxado: maior entre o real e o cubado)',
    ORDER_REAL_WEIGHT: 'Soma dos pedidos (peso real)',
};
