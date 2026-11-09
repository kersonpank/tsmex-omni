import { ANTT_FLOOR_VERSION, ANTT_TABLE_A, ANTT_TABLE_C } from './anttFloorTables.js';

export function computeAnttFloor({ tipoCarga, eixos, distanceKm, altoDesempenho = false }: {
    tipoCarga: number; eixos: number | null; distanceKm: number | null; altoDesempenho?: boolean;
}) {
    const table = altoDesempenho ? 'C' as const : 'A' as const;
    const base = { eixos, tipoCarga, table, version: ANTT_FLOOR_VERSION.id, legalReference: ANTT_FLOOR_VERSION.legalReference, distanceKm };
    const unavailable = (reason: string) => ({ ...base, value: null, reason });
    if (eixos == null || !Number.isInteger(eixos) || eixos < 1) return unavailable('Informe os eixos de cada placa');
    if (distanceKm == null || !Number.isFinite(distanceKm) || distanceKm <= 0) return unavailable('Informe a distância da viagem');
    const row = (altoDesempenho ? ANTT_TABLE_C : ANTT_TABLE_A)[tipoCarga];
    if (!row) return unavailable('Tipo de carga sem piso ANTT disponível');
    const eixosUsed = Object.keys(row).map(Number).sort((a, b) => a - b).find((column) => column >= eixos);
    if (eixosUsed == null) return unavailable('Não há coluna de eixos disponível para esta composição');
    const [ccd, cc] = row[eixosUsed]!;
    return { ...base, value: Math.round((distanceKm * ccd + cc + Number.EPSILON) * 100) / 100, ccd, cc, eixosUsed };
}
