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
    | 'SAME_SERIES_AS_LEGACY'
    | 'LEGACY_AHEAD'
    | 'LEGACY_ACTIVE_RECENTLY';

export interface NumberingRow {
    model: 'CTE' | 'MDFE';
    series: number;
    tsmLastNumber: number;
    legacyLastNumber: number | null;
    legacyLastIssuedAt: Date | null;
    legacyCount: number;
    warnings: NumberingWarning[];
}

const RECENT_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Para cada emitente ativo, compara a série/número que o TSM vai usar com o arquivo do legado no
 * mesmo CNPJ e ambiente. A regra de convivência é: cada sistema na sua série.
 * - SAME_SERIES_AS_LEGACY: o TSM está configurado numa série que o legado também usou.
 * - LEGACY_AHEAD: o legado já passou do último número do TSM nessa série (o TSM vai pular números).
 * - LEGACY_ACTIVE_RECENTLY: o legado emitiu nessa série nos últimos 30 dias (ainda está em uso).
 */
export function buildNumberingStatus(emitters: EmitterNumbering[], external: ExternalSeriesSummary[], now = new Date()) {
    return emitters.map((e) => {
        const cnpj = e.person.document.replace(/\D/g, '');
        const mine = external.filter((x) => x.emitterCnpj === cnpj && x.environment === e.environment);
        const row = (model: 'CTE' | 'MDFE', series: number, tsmLast: number): NumberingRow => {
            const legacy = mine.find((x) => x.model === model && x.series === series) ?? null;
            const warnings: NumberingWarning[] = [];
            if (legacy) {
                warnings.push('SAME_SERIES_AS_LEGACY');
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
