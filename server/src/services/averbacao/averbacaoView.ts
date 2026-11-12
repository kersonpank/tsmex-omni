/** Visão da averbação do CT-e para as telas (hub e torre): estado, número e seguros devolvidos pela AT&M. */
import { emitterUsesAtm, type AtmEmitterConfig } from './cargoAverbacaoService.js';

export interface AverbacaoView {
    status: string;
    numeroAverbacao: string | null;
    protocolo: string | null;
    averbadoAt: string | null;
    lastError: string | null;
    seguros: Array<{ ramo: string | null; nomeSeguradora: string | null; numApolice: string | null }>;
}

interface AverbacaoRow {
    status: string;
    numeroAverbacao?: string | null;
    protocolo?: string | null;
    averbadoAt?: Date | string | null;
    lastError?: string | null;
    dadosSeguro?: unknown;
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

export function summarizeAverbacao(row: AverbacaoRow | null | undefined): AverbacaoView | null {
    if (!row) return null;
    const seguros = (Array.isArray(row.dadosSeguro) ? row.dadosSeguro : []).flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const o = item as Record<string, unknown>;
        return [{ ramo: text(o.ramo), nomeSeguradora: text(o.nomeSeguradora), numApolice: text(o.numApolice) }];
    });
    const at = row.averbadoAt;
    return {
        status: row.status,
        numeroAverbacao: row.numeroAverbacao ?? null,
        protocolo: row.protocolo ?? null,
        averbadoAt: at ? (at instanceof Date ? at.toISOString() : String(at)) : null,
        lastError: row.lastError ?? null,
        seguros,
    };
}

/** O botão "Averbar" aparece só para CT-e de emitente que usa AT&M. */
export function averbacaoRequiredFor(calc: { documentType?: string | null; fiscalEmitter?: AtmEmitterConfig | null }): boolean {
    return calc.documentType === 'CTE' && emitterUsesAtm(calc.fiscalEmitter);
}
