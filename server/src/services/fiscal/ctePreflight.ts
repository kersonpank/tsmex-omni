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
    const acbrDecision = getAcbrProviderDecision(context.provider ?? null);
    const providerIssues =
        acbrDecision.reason === 'missing_credentials'
            ? ['ACBr exigido, mas ACBR_CLIENT_ID e ACBR_CLIENT_SECRET não foram detectados no container da API.']
            : [];
    const issues = unique([
        ...inputIssues,
        ...readiness.issues,
        ...(tax?.issues ?? []),
        ...providerIssues,
        ...(context.additionalIssues ?? []),
    ]);
    const missingFields = unique([
        ...(input ? missingFieldsFromReadiness(input, readiness.issues) : []),
        ...(tax?.missingFields ?? []),
        ...(context.additionalMissingFields ?? []),
    ]);
    const warnings = unique(context.additionalWarnings ?? []);
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
