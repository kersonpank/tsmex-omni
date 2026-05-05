/** Defaults fiscais do emitente aplicados ao CT-e/DC-e quando o cálculo não preenche CFOP/CST. */

export type CteTaxEmitterSlice = {
    defaultCteCfop?: string | null;
    defaultCteCst?: string | null;
};

export function resolveCteCfopCstForEmission(
    calc: { cfop?: string | null; cst?: string | null },
    fiscalEmitter: CteTaxEmitterSlice | null | undefined,
): { cfop: string | null; cst: string | null } {
    const cfopCalc = String(calc.cfop ?? '').trim();
    const cstCalc = String(calc.cst ?? '').trim();
    const cfopDef = String(fiscalEmitter?.defaultCteCfop ?? '').trim();
    const cstDef = String(fiscalEmitter?.defaultCteCst ?? '').trim();
    return {
        cfop: cfopCalc || cfopDef || null,
        cst: cstCalc || cstDef || null,
    };
}
