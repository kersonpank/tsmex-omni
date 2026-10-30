import { deriveCteCfop } from './cteCfopRule.js';
import { resolveCteServiceLocation } from './cteServiceLocation.js';
/** Defaults fiscais do emitente aplicados ao CT-e/DC-e quando o cálculo não preenche CFOP/CST. */

export type CteTaxEmitterSlice = {
    defaultCteCfop?: string | null;
    defaultCteCst?: string | null;
    person?: { state?: string | null } | null;
};

export function resolveCteCfopCstForEmission(
    calc: { cfop?: string | null; cst?: string | null; originCity?: string | null; destCity?: string | null; status?: string; documentType?: string },
    fiscalEmitter: CteTaxEmitterSlice | null | undefined,
    geography?: { startUf?: string | null; endUf?: string | null },
): { cfop: string | null; cst: string | null } {
    const cfopCalc = String(calc.cfop ?? '').trim();
    const cstCalc = String(calc.cst ?? '').trim();
    const cfopDef = String(fiscalEmitter?.defaultCteCfop ?? '').trim();
    const cstDef = String(fiscalEmitter?.defaultCteCst ?? '').trim();
    const startUf = (geography?.startUf ?? resolveCteServiceLocation({ calculationCity: calc.originCity })?.state)?.trim().toUpperCase();
    const endUf = (geography?.endUf ?? resolveCteServiceLocation({ calculationCity: calc.destCity })?.state)?.trim().toUpperCase();
    const emitterUf = fiscalEmitter?.person?.state?.trim().toUpperCase();
    let cfop = cfopCalc || cfopDef || null;
    if (!['CTE_AUTHORIZED', 'CTE_CANCELLED'].includes(calc.status ?? '') && calc.documentType !== 'DCE' && startUf && endUf && emitterUf && startUf !== 'EX' && endUf !== 'EX') {
        const derived = deriveCteCfop({ startUf, endUf, emitterUf, baseCfop: cfopDef || cfopCalc });
        const contradictory = !cfopCalc || cfopCalc[0] !== (startUf === endUf ? '5' : '6')
            || cfopCalc.endsWith('932') !== (startUf !== emitterUf);
        if (contradictory) cfop = derived.cfop;
    }
    return {
        cfop,
        cst: cstCalc || cstDef || null,
    };
}
