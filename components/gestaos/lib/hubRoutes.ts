// Lógica pura das rotas de entrega do hub (cadastro). Sem efeitos colaterais; tudo imutável.

export type RouteStopDraft = { cityIbgeCode: string; cityName: string; state: string };
export type RouteDraft = { key: string; id?: string; name: string; notes: string; active: boolean; stops: RouteStopDraft[] };
export type LatLng = { lat: number; lng: number };

export const MAX_ROUTES = 50;
export const MAX_STOPS = 60;

const toRad = (deg: number) => (deg * Math.PI) / 180;

function haversineKm(a: LatLng, b: LatLng): number {
    const R = 6371;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const normName = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');

/** Vizinho mais próximo a partir da sede; sem coordenada vai ao fim na ordem original. Sede nula parte da 1ª cidade com coordenada. */
export function orderByNearest(seat: LatLng | null, cities: RouteStopDraft[], coords: Map<string, LatLng>): RouteStopDraft[] {
    const located: RouteStopDraft[] = [];
    const unlocated: RouteStopDraft[] = [];
    for (const c of cities) (coords.has(c.cityIbgeCode) ? located : unlocated).push(c);

    const ordered: RouteStopDraft[] = [];
    let current: LatLng | null = seat;
    if (!current && located.length > 0) {
        const first = located.shift() as RouteStopDraft;
        ordered.push(first);
        current = coords.get(first.cityIbgeCode) as LatLng;
    }
    while (located.length > 0 && current) {
        let best = 0;
        let bestDist = Infinity;
        for (let i = 0; i < located.length; i++) {
            const d = haversineKm(current, coords.get(located[i].cityIbgeCode) as LatLng);
            if (d < bestDist) { bestDist = d; best = i; }
        }
        const [next] = located.splice(best, 1);
        ordered.push(next);
        current = coords.get(next.cityIbgeCode) as LatLng;
    }
    return [...ordered, ...unlocated];
}

/** Acrescenta cidades ao fim da rota, sem duplicar e respeitando MAX_STOPS. */
export function appendStops(route: RouteDraft, cities: RouteStopDraft[]): { route: RouteDraft; added: number; skipped: number } {
    const seen = new Set(route.stops.map((s) => s.cityIbgeCode));
    const stops = [...route.stops];
    let added = 0;
    let skipped = 0;
    for (const c of cities) {
        if (seen.has(c.cityIbgeCode) || stops.length >= MAX_STOPS) { skipped++; continue; }
        seen.add(c.cityIbgeCode);
        stops.push({ cityIbgeCode: c.cityIbgeCode, cityName: c.cityName, state: c.state });
        added++;
    }
    return { route: added > 0 ? { ...route, stops } : route, added, skipped };
}

export function moveStop(route: RouteDraft, index: number, delta: -1 | 1): RouteDraft {
    const target = index + delta;
    if (index < 0 || index >= route.stops.length || target < 0 || target >= route.stops.length) return route;
    const stops = [...route.stops];
    [stops[index], stops[target]] = [stops[target], stops[index]];
    return { ...route, stops };
}

export function removeStop(route: RouteDraft, cityIbgeCode: string): RouteDraft {
    if (!route.stops.some((s) => s.cityIbgeCode === cityIbgeCode)) return route;
    return { ...route, stops: route.stops.filter((s) => s.cityIbgeCode !== cityIbgeCode) };
}

/** Retorna a primeira mensagem de erro (pt-BR) ou null se tudo certo. */
export function validateRoutes(routes: RouteDraft[]): string | null {
    if (routes.length > MAX_ROUTES) return `O hub pode ter no máximo ${MAX_ROUTES} rotas.`;
    const names = new Set<string>();
    for (const r of routes) {
        const label = r.name.trim();
        if (!label) return 'Toda rota precisa de um nome.';
        const norm = normName(r.name);
        if (names.has(norm)) return `Já existe uma rota chamada "${label}".`;
        names.add(norm);
        if (r.stops.length === 0) return `A rota "${label}" precisa de ao menos uma cidade.`;
        if (r.stops.length > MAX_STOPS) return `A rota "${label}" pode ter no máximo ${MAX_STOPS} cidades.`;
    }
    return null;
}

export function routesPayload(routes: RouteDraft[]): { routes: Array<{ id?: string; name: string; notes?: string; active: boolean; stops: Array<{ cityIbgeCode: string }> }> } {
    return {
        routes: routes.map((r) => {
            const notes = r.notes.trim();
            return {
                ...(r.id ? { id: r.id } : {}),
                name: r.name.trim(),
                ...(notes ? { notes } : {}),
                active: r.active,
                stops: r.stops.map((s) => ({ cityIbgeCode: s.cityIbgeCode })),
            };
        }),
    };
}

/** ibge -> nomes das rotas em que a cidade aparece (somente cidades em mais de uma rota). */
export function citiesInManyRoutes(routes: RouteDraft[]): Map<string, string[]> {
    const all = new Map<string, string[]>();
    for (const r of routes) {
        for (const s of r.stops) {
            const list = all.get(s.cityIbgeCode) ?? [];
            list.push(r.name.trim() || 'Sem nome');
            all.set(s.cityIbgeCode, list);
        }
    }
    for (const [code, names] of [...all]) if (names.length < 2) all.delete(code);
    return all;
}

/** "Coroatá → Timbiras → Codó"; acima de 5 cidades corta e acrescenta "+N". */
export function routeSummary(route: RouteDraft): string {
    const LIMIT = 5;
    const names = route.stops.map((s) => s.cityName);
    if (names.length <= LIMIT) return names.join(' → ');
    return `${names.slice(0, LIMIT).join(' → ')} +${names.length - LIMIT}`;
}
