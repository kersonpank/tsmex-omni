import type { CteEmissionInput, CteEnvironment } from '../cteService.js';
import { validateCteReadiness } from '../cteService.js';
import { getAcbrProviderDecision, type AcbrProviderDecisionReason } from '../acbr/acbrConfig.js';
import { getCteCfopOption, getCteCstRule, validateCteTaxSelection, type CteCfopOption, type CteCstRule } from './cteTaxRules.js';

export interface CtePreflightContext {
    environment?: CteEnvironment | null;
    provider?: string | null;
    additionalIssues?: string[];
    additionalWarnings?: string[];
    additionalMissingFields?: string[];
}

export interface CtePreflightResult {
    ok: boolean;
    canEmit: boolean;
    issues: string[];
    warnings: string[];
    missingFields: string[];
    environment: CteEnvironment | null;
    provider: string | null;
    providerDecision: {
        willUseAcbrHttp: boolean;
        acbrRequired: boolean;
        reason: AcbrProviderDecisionReason | 'preflight_failed';
        credentialsConfigured: boolean;
    };
    tax: {
        cfop: CteCfopOption | null;
        cst: CteCstRule | null;
    };
}

function unique(values: string[]): string[] {
    return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

const VALID_UFS = new Set(['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO', 'EX']);

export function normalizeCteUf(value: unknown): string | null {
    const uf = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return VALID_UFS.has(uf) ? uf : null;
}

/** MOC CT-e 4.00, G050/G051/G052. Nunca infere a prestação pelo endereço das partes. */
function validateCfopLocations(input: CteEmissionInput): { issues: string[]; warnings: string[] } {
    const start = normalizeCteUf(input.order.serviceStart?.state);
    const end = normalizeCteUf(input.order.serviceEnd?.state);
    const emitter = normalizeCteUf(input.person.state);
    const cfop = getCteCfopOption(input.calc.cfop)?.code;
    const issues: string[] = [];
    const warnings: string[] = [];

    if (!start || !end || !emitter) {
        warnings.push('Não foi possível verificar as regras SEFAZ 519/524/908: faltam UFs válidas do início, fim ou emitente. Confira os locais da prestação.');
    }
    if (!cfop) return { issues, warnings };
    if (start && end) {
        const expectedPrefix = end === 'EX' ? '7' : start === end ? '5' : '6';
        if (!cfop.startsWith(expectedPrefix)) {
            issues.push(`SEFAZ 519: para a prestação ${start} → ${end}, o CFOP deve começar por ${expectedPrefix}.`);
        }
        if (emitter && start !== 'EX' && end !== 'EX') {
            const isOutsideEmitterUf = cfop === '5932' || cfop === '6932';
            if (emitter !== start && !isOutsideEmitterUf) {
                issues.push(`SEFAZ 524: início em ${start} e emitente em ${emitter} exigem CFOP 5932 ou 6932.`);
            } else if (emitter === start && isOutsideEmitterUf) {
                issues.push(`SEFAZ 908: início e emitente em ${start} não permitem CFOP 5932 ou 6932.`);
            }
        }
    }
    return { issues, warnings };
}

function missingFieldsFromReadiness(input: CteEmissionInput, issues: string[]): string[] {
    const missing: string[] = [];
    if (issues.includes('CT-e precisa de CFOP.')) missing.push('cfop');
    if (issues.includes('CT-e precisa de CST.')) missing.push('cst');
    if (issues.includes('CT-e precisa de origem e fim da prestação.')) {
        if (!input.calc.originCity?.trim()) missing.push('originCity');
        if (!input.calc.destCity?.trim()) missing.push('destCity');
    }
    if (issues.includes('CT-e precisa de valor de frete maior que zero.')) missing.push('freightTotal');
    if (issues.includes('CT-e precisa de documento originário.')) missing.push('invoicesRel');
    return missing;
}

export function buildCtePreflightResult(input: CteEmissionInput | null, context: CtePreflightContext = {}): CtePreflightResult {
    const inputIssues = input ? [] : ['Dados de cálculo e pedido são obrigatórios para o preflight completo do CT-e.'];
    const readiness = input ? validateCteReadiness(input) : { ok: false, issues: [] };
    const tax = input ? validateCteTaxSelection({ cfop: input.calc.cfop, cst: input.calc.cst }) : null;
    const locations = input ? validateCfopLocations(input) : { issues: [], warnings: [] };
    const acbrDecision = getAcbrProviderDecision(context.provider ?? null, context.environment ?? input?.ambiente ?? null);
    const providerIssues =
        acbrDecision.reason === 'missing_credentials'
            ? ['ACBr exigido, mas ACBR_CLIENT_ID e ACBR_CLIENT_SECRET não foram detectados no container da API.']
            : [];
    const issues = unique([
        ...inputIssues,
        ...readiness.issues,
        ...(tax?.issues ?? []),
        ...locations.issues,
        ...providerIssues,
        ...(context.additionalIssues ?? []),
    ]);
    const missingFields = unique([
        ...(input ? missingFieldsFromReadiness(input, readiness.issues) : []),
        ...(tax?.missingFields ?? []),
        ...(locations.issues.length > 0 || (input?.calc.cfop && !tax?.cfop) ? ['cfop'] : []),
        ...(context.additionalMissingFields ?? []),
    ]);
    const warnings = unique([...locations.warnings, ...(context.additionalWarnings ?? [])]);
    const ok = input !== null && issues.length === 0 && missingFields.length === 0;
    const providerDecision = {
        willUseAcbrHttp: ok && acbrDecision.willUseAcbrHttp,
        acbrRequired: acbrDecision.acbrRequired,
        reason: !ok && acbrDecision.willUseAcbrHttp ? 'preflight_failed' as const : acbrDecision.reason,
        credentialsConfigured: acbrDecision.credentialsConfigured,
    };

    return {
        ok,
        canEmit: ok,
        issues,
        warnings,
        missingFields,
        environment: context.environment ?? input?.ambiente ?? null,
        provider: context.provider ?? null,
        providerDecision,
        tax: {
            cfop: input ? getCteCfopOption(input.calc.cfop) : null,
            cst: input ? getCteCstRule(input.calc.cst) : null,
        },
    };
}
