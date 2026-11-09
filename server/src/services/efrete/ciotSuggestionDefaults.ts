/** Padrões de data/embalagem. A rota é acrescentada por getManifestAnttSuggestion;
 * o operador confirma a distância no editor de CIOT. */
export function ciotSuggestionDefaults(manifest: {
    plannedDepartureAt: Date | null;
    plannedArrivalAt: Date | null;
}, now = new Date()) {
    const departure = manifest.plannedDepartureAt ?? now;
    return {
        distanceKm: null,
        endDate: (manifest.plannedArrivalAt ?? new Date(departure.getTime() + 86400000)).toISOString(),
        // eFrete v8.2, AP14: enum textual, não código numérico.
        embalagem: 'Caixa',
        tipoEmbalagem: 'Caixa',
    };
}
