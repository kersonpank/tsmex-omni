export interface EmitterNumbering {
    id: string;
    displayName: string | null;
    environment: 'PRODUCAO' | 'HOMOLOGACAO';
    cteSeries: number;
    lastCteNumber: number;
    mdfeSeries: number;
    lastMdfeNumber: number;
    person: { document: string; legalName: string | null };
}

export interface ExternalSeriesSummary {
    emitterCnpj: string;
    model: 'CTE' | 'MDFE';
    series: number;
    environment: 'PRODUCAO' | 'HOMOLOGACAO';
    lastNumber: number;
    lastIssuedAt: Date | null;
    count: number;
}

export type NumberingWarning =
    | 'LEGACY_AHEAD'
    | 'OTHER_SERIES_THAN_LEGACY'
    | 'LEGACY_ACTIVE_RECENTLY';

export interface NumberingRow {
    model: 'CTE' | 'MDFE';
    series: number;
    tsmLastNumber: number;
    legacyLastNumber: number | null;
    legacyLastIssuedAt: Date | null;
    legacyCount: number;
    /** Último número a gravar no TSM para seguir a sequência sem colidir: o maior entre TSM e legado. */
    continueFrom: number;
    warnings: NumberingWarning[];
}

const RECENT_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Para cada emitente ativo, compara a série/número que o TSM vai usar com o que o legado já usou no
 * mesmo CNPJ e ambiente. A regra do corte é: o TSM CONTINUA a série do legado (mesma série, próximo
 * número); o legado só volta a emitir em contingência, a partir do último número do TSM.
 * - LEGACY_AHEAD: o legado está à frente do TSM nessa série — grave o último número antes de emitir.
 * - OTHER_SERIES_THAN_LEGACY: o TSM está numa série que o legado nunca usou, mas o legado usou outra
 *   para o mesmo modelo (o combinado é continuar a série dele).
 * - LEGACY_ACTIVE_RECENTLY: o legado emitiu nessa série nos últimos 30 dias (antes do corte é normal;
 *   depois dele, é contingência — importe os XMLs).
 */
export function buildNumberingStatus(emitters: EmitterNumbering[], external: ExternalSeriesSummary[], now = new Date()) {
    return emitters.map((e) => {
        const cnpj = e.person.document.replace(/\D/g, '');
        const mine = external.filter((x) => x.emitterCnpj === cnpj && x.environment === e.environment);
        const row = (model: 'CTE' | 'MDFE', series: number, tsmLast: number): NumberingRow => {
            const legacy = mine.find((x) => x.model === model && x.series === series) ?? null;
            const warnings: NumberingWarning[] = [];
            if (!legacy && mine.some((x) => x.model === model)) warnings.push('OTHER_SERIES_THAN_LEGACY');
            if (legacy) {
                if (legacy.lastNumber > tsmLast) warnings.push('LEGACY_AHEAD');
                if (legacy.lastIssuedAt && now.getTime() - new Date(legacy.lastIssuedAt).getTime() < RECENT_MS) warnings.push('LEGACY_ACTIVE_RECENTLY');
            }
            return {
                model,
                series,
                tsmLastNumber: tsmLast,
                legacyLastNumber: legacy?.lastNumber ?? null,
                legacyLastIssuedAt: legacy?.lastIssuedAt ?? null,
                legacyCount: legacy?.count ?? 0,
                continueFrom: Math.max(tsmLast, legacy?.lastNumber ?? 0),
                warnings,
            };
        };
        return {
            emitterId: e.id,
            name: e.displayName ?? e.person.legalName ?? cnpj,
            cnpj,
            environment: e.environment,
            cte: row('CTE', e.cteSeries, e.lastCteNumber),
            mdfe: row('MDFE', e.mdfeSeries, e.lastMdfeNumber),
            /** Todas as séries que o legado usou neste CNPJ/ambiente, para escolher uma livre. */
            legacySeries: mine.map((x) => ({ model: x.model, series: x.series, lastNumber: x.lastNumber, lastIssuedAt: x.lastIssuedAt, count: x.count })),
        };
    });
}
