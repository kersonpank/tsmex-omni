/**
 * Seguro da carga no MDF-e (grupo `seg`, MdfeSefazSeg do OpenAPI ACBr).
 * Ordem do schema: infResp, infSeg, nApol, nAver[]. respSeg 1 = emitente do MDF-e (RCTR-C da transportadora).
 * Nunca monta `seg` parcial: sem dado completo devolve null e o chamador bloqueia a emissão.
 */
export interface CargoInsuranceEmitter {
    cargoInsurerName?: string | null;
    cargoInsurerCnpj?: string | null;
    cargoInsurancePolicyNumber?: string | null;
}

const onlyDigits = (value?: string | null) => (value ?? '').replace(/\D/g, '');

/** Separa averbações por vírgula, ponto e vírgula ou quebra de linha; remove vazios e repetidos. */
export function parseAverbacoes(raw?: string | null): string[] {
    const seen = new Set<string>();
    for (const part of (raw ?? '').split(/[,;\r\n]+/)) {
        const value = part.trim();
        if (value) seen.add(value);
    }
    return [...seen];
}

/** Seguradora, CNPJ (14 dígitos) e apólice completos no emitente? */
export function emitterCargoInsuranceComplete(emitter?: CargoInsuranceEmitter | null): boolean {
    return Boolean(
        emitter?.cargoInsurerName?.trim()
        && onlyDigits(emitter.cargoInsurerCnpj).length === 14
        && emitter.cargoInsurancePolicyNumber?.trim(),
    );
}

export const MDFE_CARGO_INSURANCE_ERROR = 'Informe o seguro da carga (seguradora, CNPJ e apólice) no emitente e a averbação na viagem antes de emitir o MDF-e.';

export function buildMdfeSeg(emitter: CargoInsuranceEmitter | null | undefined, averbacao: string | null | undefined): Record<string, unknown>[] | null {
    const nAver = parseAverbacoes(averbacao);
    if (!emitterCargoInsuranceComplete(emitter) || !nAver.length) return null;
    return [{
        infResp: { respSeg: 1 },
        infSeg: { xSeg: emitter!.cargoInsurerName!.trim().slice(0, 30), CNPJ: onlyDigits(emitter!.cargoInsurerCnpj) },
        nApol: emitter!.cargoInsurancePolicyNumber!.trim().slice(0, 20),
        nAver,
    }];
}
