import { describe, expect, it } from 'vitest';
import {
    MAX_ROUTES, MAX_STOPS, appendStops, citiesInManyRoutes, moveStop, orderByNearest, removeStop, routeSummary, routesPayload, validateRoutes,
    type LatLng, type RouteDraft, type RouteStopDraft,
} from './hubRoutes';

const stop = (code: string, name = `C${code}`): RouteStopDraft => ({ cityIbgeCode: code, cityName: name, state: 'MA' });
const route = (name: string, codes: string[], over: Partial<RouteDraft> = {}): RouteDraft => ({
    key: `k-${name}`, name, notes: '', active: true, stops: codes.map((c) => stop(c)), ...over,
});

describe('orderByNearest', () => {
    // cidades em linha no eixo lng; sede no meio (lng 0)
    const coords = new Map<string, LatLng>([
        ['a', { lat: 0, lng: -2 }], ['b', { lat: 0, lng: -1 }], ['c', { lat: 0, lng: 1.1 }], ['d', { lat: 0, lng: 2 }],
    ]);
    const seat = { lat: 0, lng: 0 };

    it('segue vizinho mais próximo a partir da sede', () => {
        const r = orderByNearest(seat, [stop('d'), stop('a'), stop('c'), stop('b')], coords);
        expect(r.map((s) => s.cityIbgeCode)).toEqual(['b', 'a', 'c', 'd']);
    });

    it('cidade sem coordenada vai ao fim na ordem original', () => {
        const r = orderByNearest(seat, [stop('x'), stop('c'), stop('y'), stop('b')], coords);
        expect(r.map((s) => s.cityIbgeCode)).toEqual(['b', 'c', 'x', 'y']);
    });

    it('sede null usa a 1ª cidade como partida', () => {
        const r = orderByNearest(null, [stop('d'), stop('a'), stop('c')], coords);
        expect(r.map((s) => s.cityIbgeCode)).toEqual(['d', 'c', 'a']);
    });

    it('não altera a entrada', () => {
        const input = [stop('d'), stop('a')];
        orderByNearest(seat, input, coords);
        expect(input.map((s) => s.cityIbgeCode)).toEqual(['d', 'a']);
    });
});

describe('appendStops', () => {
    it('acrescenta ao fim, sem duplicar', () => {
        const base = route('R', ['1']);
        const r = appendStops(base, [stop('2'), stop('1'), stop('2')]);
        expect(r.added).toBe(1);
        expect(r.skipped).toBe(2);
        expect(r.route.stops.map((s) => s.cityIbgeCode)).toEqual(['1', '2']);
        expect(base.stops).toHaveLength(1);
    });

    it('respeita MAX_STOPS', () => {
        const full = route('R', Array.from({ length: MAX_STOPS - 1 }, (_, i) => `f${i}`));
        const r = appendStops(full, [stop('n1'), stop('n2')]);
        expect(r.added).toBe(1);
        expect(r.skipped).toBe(1);
        expect(r.route.stops).toHaveLength(MAX_STOPS);
    });
});

describe('moveStop / removeStop', () => {
    it('move para cima e para baixo', () => {
        const r = route('R', ['1', '2', '3']);
        expect(moveStop(r, 1, -1).stops.map((s) => s.cityIbgeCode)).toEqual(['2', '1', '3']);
        expect(moveStop(r, 1, 1).stops.map((s) => s.cityIbgeCode)).toEqual(['1', '3', '2']);
    });

    it('bordas são no-op', () => {
        const r = route('R', ['1', '2']);
        expect(moveStop(r, 0, -1)).toBe(r);
        expect(moveStop(r, 1, 1)).toBe(r);
        expect(moveStop(r, 5, -1)).toBe(r);
    });

    it('remove por código', () => {
        const r = route('R', ['1', '2']);
        expect(removeStop(r, '1').stops.map((s) => s.cityIbgeCode)).toEqual(['2']);
        expect(removeStop(r, '9')).toBe(r);
        expect(r.stops).toHaveLength(2);
    });
});

describe('validateRoutes', () => {
    it('aceita rotas válidas', () => {
        expect(validateRoutes([route('A', ['1']), route('B', ['2'])])).toBeNull();
    });

    it('rejeita nome vazio', () => {
        expect(validateRoutes([route('   ', ['1'])])).toBe('Toda rota precisa de um nome.');
    });

    it('rejeita nome duplicado com caixa/espaço diferentes', () => {
        expect(validateRoutes([route('Rota Codó', ['1']), route('  rota   CODÓ ', ['2'])])).toContain('Já existe uma rota');
    });

    it('rejeita rota sem parada', () => {
        expect(validateRoutes([route('A', [])])).toContain('ao menos uma cidade');
    });

    it('rejeita acima dos limites', () => {
        const many = Array.from({ length: MAX_ROUTES + 1 }, (_, i) => route(`R${i}`, ['1']));
        expect(validateRoutes(many)).toContain(String(MAX_ROUTES));
        const tooLong = route('L', Array.from({ length: MAX_STOPS + 1 }, (_, i) => `c${i}`));
        expect(validateRoutes([tooLong])).toContain(String(MAX_STOPS));
    });
});

describe('routesPayload', () => {
    it('mantém a ordem das paradas, apara textos e omite vazios', () => {
        const p = routesPayload([
            route(' A ', ['3', '1', '2'], { id: 'id-1', notes: '  obs ' }),
            route('B', ['9'], { active: false }),
        ]);
        expect(p).toEqual({
            routes: [
                { id: 'id-1', name: 'A', notes: 'obs', active: true, stops: [{ cityIbgeCode: '3' }, { cityIbgeCode: '1' }, { cityIbgeCode: '2' }] },
                { name: 'B', active: false, stops: [{ cityIbgeCode: '9' }] },
            ],
        });
    });
});

describe('citiesInManyRoutes', () => {
    it('lista só cidades presentes em mais de uma rota', () => {
        const m = citiesInManyRoutes([route('A', ['1', '2']), route('B', ['2', '3']), route('C', ['2'])]);
        expect([...m.keys()]).toEqual(['2']);
        expect(m.get('2')).toEqual(['A', 'B', 'C']);
    });
});

describe('routeSummary', () => {
    it('junta com setas', () => {
        const r: RouteDraft = { ...route('R', []), stops: [stop('1', 'Coroatá'), stop('2', 'Timbiras'), stop('3', 'Codó')] };
        expect(routeSummary(r)).toBe('Coroatá → Timbiras → Codó');
    });

    it('corta acima de 5 com +N', () => {
        const r = route('R', ['1', '2', '3', '4', '5', '6', '7']);
        expect(routeSummary(r)).toBe('C1 → C2 → C3 → C4 → C5 +2');
    });

    it('rota vazia devolve string vazia', () => {
        expect(routeSummary(route('R', []))).toBe('');
    });
});
