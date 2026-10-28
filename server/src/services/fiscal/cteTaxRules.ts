export type CteIcmsGroup = 'ICMS00' | 'ICMS20' | 'ICMS45' | 'ICMS90';

export interface CteCfopOption {
    code: string;
    label: string;
    nature: string;
}

export interface CteCstRule {
    code: string;
    label: string;
    group: CteIcmsGroup;
}

export interface CteTaxValidationResult {
    ok: boolean;
    issues: string[];
    missingFields: string[];
    cfop: CteCfopOption | null;
    cst: CteCstRule | null;
}

export const CTE_CFOP_OPTIONS: CteCfopOption[] = [
    { code: '5351', label: 'Prestação de serviço de transporte para execução de serviço da mesma natureza', nature: 'PRESTACAO DE SERVICO DE TRANSPORTE' },
    { code: '5352', label: 'Prestação de serviço de transporte a estabelecimento industrial', nature: 'PRESTACAO DE SERVICO DE TRANSPORTE' },
    { code: '5353', label: 'Prestação de serviço de transporte a estabelecimento comercial', nature: 'PRESTACAO DE SERVICO DE TRANSPORTE' },
    { code: '5354', label: 'Prestação de serviço de transporte a prestador de serviço de comunicação', nature: 'PRESTACAO DE SERVICO DE TRANSPORTE' },
    { code: '5355', label: 'Prestação de serviço de transporte a geradora/distribuidora de energia', nature: 'PRESTACAO DE SERVICO DE TRANSPORTE' },
    { code: '5356', label: 'Prestação de serviço de transporte a produtor rural', nature: 'PRESTACAO DE SERVICO DE TRANSPORTE' },
    { code: '5357', label: 'Prestação de serviço de transporte a não contribuinte', nature: 'PRESTACAO DE SERVICO DE TRANSPORTE' },
    { code: '5359', label: 'Prestação de serviço de transporte de mercadoria dispensada de nota fiscal', nature: 'PRESTACAO DE SERVICO DE TRANSPORTE' },
    { code: '5360', label: 'Prestação de serviço de transporte a contribuinte substituto', nature: 'PRESTACAO DE SERVICO DE TRANSPORTE' },
    { code: '5932', label: 'Prestação de serviço de transporte iniciada em UF diversa', nature: 'PRESTACAO DE SERVICO DE TRANSPORTE' },
    { code: '5949', label: 'Outra prestação de serviço não especificada', nature: 'PRESTACAO DE SERVICO DE TRANSPORTE' },
    { code: '6351', label: 'Prestação de serviço de transporte para execução de serviço da mesma natureza', nature: 'PRESTACAO DE SERVICO DE TRANSPORTE' },
    { code: '6352', label: 'Prestação de serviço de transporte a estabelecimento industrial', nature: 'PRESTACAO DE SERVICO DE TRANSPORTE' },
    { code: '6353', label: 'Prestação de serviço de transporte a estabelecimento comercial', nature: 'PRESTACAO DE SERVICO DE TRANSPORTE' },
    { code: '6354', label: 'Prestação de serviço de transporte a prestador de serviço de comunicação', nature: 'PRESTACAO DE SERVICO DE TRANSPORTE' },
    { code: '6355', label: 'Prestação de serviço de transporte a geradora/distribuidora de energia', nature: 'PRESTACAO DE SERVICO DE TRANSPORTE' },
    { code: '6356', label: 'Prestação de serviço de transporte a produtor rural', nature: 'PRESTACAO DE SERVICO DE TRANSPORTE' },
    { code: '6357', label: 'Prestação de serviço de transporte a não contribuinte', nature: 'PRESTACAO DE SERVICO DE TRANSPORTE' },
    { code: '6359', label: 'Prestação de serviço de transporte de mercadoria dispensada de nota fiscal', nature: 'PRESTACAO DE SERVICO DE TRANSPORTE' },
    { code: '6360', label: 'Prestação de serviço de transporte a contribuinte substituto', nature: 'PRESTACAO DE SERVICO DE TRANSPORTE' },
    { code: '6932', label: 'Prestação de serviço de transporte iniciada em UF diversa', nature: 'PRESTACAO DE SERVICO DE TRANSPORTE' },
    { code: '6949', label: 'Outra prestação de serviço não especificada', nature: 'PRESTACAO DE SERVICO DE TRANSPORTE' },
    { code: '7358', label: 'Prestação de serviço de transporte para o exterior', nature: 'PRESTACAO DE SERVICO DE TRANSPORTE' },
];

export const CTE_CST_RULES: CteCstRule[] = [
    { code: '00', label: 'Tributada integralmente', group: 'ICMS00' },
    { code: '20', label: 'Com redução de base de cálculo', group: 'ICMS20' },
    { code: '40', label: 'Isenta', group: 'ICMS45' },
    { code: '41', label: 'Não tributada', group: 'ICMS45' },
    { code: '51', label: 'Diferimento', group: 'ICMS45' },
    { code: '90', label: 'Outras', group: 'ICMS90' },
];

export function normalizeCfop(value: string | null | undefined): string {
    const text = String(value ?? '').trim();
    return /^\d\.\d{3}$/.test(text) ? text.replace('.', '') : text;
}

export function normalizeCst(value: string | null | undefined): string {
    return String(value ?? '').replace(/\D/g, '').padStart(2, '0').slice(-2);
}

export function getCteCfopOption(value: string | null | undefined): CteCfopOption | null {
    const code = normalizeCfop(value);
    return CTE_CFOP_OPTIONS.find((option) => option.code === code) ?? null;
}

export function getCteCstRule(value: string | null | undefined): CteCstRule | null {
    const code = normalizeCst(value);
    return CTE_CST_RULES.find((rule) => rule.code === code) ?? null;
}

export function validateCteTaxSelection(params: { cfop: string | null | undefined; cst: string | null | undefined }): CteTaxValidationResult {
    const issues: string[] = [];
    const missingFields: string[] = [];
    const cfopCode = normalizeCfop(params.cfop);
    const cstCode = normalizeCst(params.cst);
    const cfop = getCteCfopOption(params.cfop);
    const cst = getCteCstRule(params.cst);

    if (!cfopCode) {
        missingFields.push('cfop');
    } else if (!cfop) {
        issues.push(`CFOP ${cfopCode} não está habilitado para CT-e no MVP.`);
    }

    if (!String(params.cst ?? '').trim()) {
        missingFields.push('cst');
    } else if (!cst) {
        issues.push(`CST ${cstCode} não está habilitado para CT-e no MVP.`);
    }

    return { ok: issues.length === 0 && missingFields.length === 0, issues, missingFields, cfop, cst };
}

function taxableValues(vTPrest: number, icmsValue: number | null): { vBC: number; pICMS: number; vICMS: number } {
    const vICMS = Number(Math.max(0, icmsValue ?? 0).toFixed(2));
    const vBC = vICMS > 0 ? Number(Math.max(0, vTPrest - vICMS).toFixed(2)) : Number(Math.max(0, vTPrest).toFixed(2));
    const pICMS = vBC > 0 && vICMS > 0 ? Number(((vICMS / vBC) * 100).toFixed(2)) : 0;
    return { vBC, pICMS, vICMS };
}

export function buildCteIcmsBlock(cst: string | null | undefined, vTPrest: number, icmsValue: number | null): Record<string, unknown> {
    const rule = getCteCstRule(cst);
    if (!rule) throw new Error(`CST ${normalizeCst(cst) || 'não informado'} não está habilitado para CT-e no MVP.`);

    if (rule.group === 'ICMS45') {
        return { ICMS: { ICMS45: { CST: rule.code } } };
    }

    const values = taxableValues(vTPrest, icmsValue);
    if (rule.group === 'ICMS00') {
        return { ICMS: { ICMS00: { CST: rule.code, ...values } } };
    }
    if (rule.group === 'ICMS20') {
        return { ICMS: { ICMS20: { CST: rule.code, pRedBC: 0, ...values } } };
    }
    return { ICMS: { ICMS90: { CST: rule.code, pRedBC: 0, ...values } } };
}
