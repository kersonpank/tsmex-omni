/** Regra determinística para prestações nacionais; não substitui a validação fiscal. */
export function deriveCteCfop({ startUf, endUf, emitterUf, baseCfop }: {
    startUf: string; endUf: string; emitterUf: string; baseCfop?: string | null;
}): { cfop: string; reason: string } {
    const start = startUf.trim().toUpperCase();
    const end = endUf.trim().toUpperCase();
    const emitter = emitterUf.trim().toUpperCase();
    const prefix = start === end ? '5' : '6';
    const family = /^[56]\d{3}$/.test(baseCfop?.trim() ?? '') && !baseCfop!.trim().endsWith('932')
        ? baseCfop!.trim().slice(-3) : '353';
    const cfop = prefix + (start !== emitter ? '932' : family);
    return { cfop, reason: `início em ${start} (${start === emitter ? 'UF do emitente' : `emitente em ${emitter}`}), destino ${end} → ${cfop}` };
}
