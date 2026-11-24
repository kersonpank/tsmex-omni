import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { hubCoverageApi, hubRoutesApi, locationsApi, type GeoCity, type HubRoute } from '../../../../../lib/api';
import type { Hub, HubCoverageEntry } from '../../../../../types/index';
import {
    appendStops,
    citiesInManyRoutes,
    moveStop,
    orderByNearest,
    removeStop,
    routesPayload,
    routeSummary,
    validateRoutes,
    MAX_ROUTES,
    MAX_STOPS,
    type LatLng,
    type RouteDraft,
    type RouteStopDraft,
} from '../../../lib/hubRoutes';
import { invalidate, useResource } from '../../../lib/resource';
import { Checkbox, FormFooter } from '../../../ui/form';
import { IconAlert, IconClose, IconRefresh } from '../../../ui/icons';
import { Button, EmptyState, ErrorState, Loadable, Pill, SelectInput, Skeleton, Tabs, TextInput } from '../../../ui/kit';
import { useAction, useToast } from '../../../ui/overlay';
import type { CoverageViewport } from './CoverageMap';

type Polygon = Array<[number, number]>;
type CoordsStatus = 'pending' | 'settled' | 'failed';

function lazyWithRetry(error?: unknown, attempt = 0) {
    if (error instanceof TypeError) {
        const failedUrl = error.message.match(/https?:\/\/[^\s"'<>]+\/CoverageMap(?:-[\w-]+\.js|\.tsx)(?:\?[^\s"'<>]*)?/u)?.[0];
        const preload = document.querySelector<HTMLLinkElement>('link[rel="modulepreload"][href*="/CoverageMap-"]');
        const href = failedUrl ?? preload?.href;
        if (href) {
            const url = new URL(href);
            if (url.origin === window.location.origin) {
                url.searchParams.set('retry', String(attempt));
                return React.lazy((): Promise<typeof import('./CoverageMap')> => import(/* @vite-ignore */ url.href));
            }
        }
    }
    return React.lazy(() => import('./CoverageMap'));
}

type MapErrorProps = { children: React.ReactNode; onRetry: (error: unknown) => void };
type MapErrorState = { failure: { error: unknown } | null };

class MapErrorBoundary extends React.Component<MapErrorProps, MapErrorState> {
    declare readonly props: MapErrorProps;
    declare setState: (state: MapErrorState) => void;
    state: MapErrorState = { failure: null };

    static getDerivedStateFromError(error: unknown) {
        return { failure: { error } };
    }

    render() {
        const { failure } = this.state;
        if (!failure) return this.props.children;

        return (
            <div className="gx-map-error gx-inset flex flex-wrap items-center gap-3 px-4 py-3.5" role="alert">
                <IconAlert size={18} className="gx-red-text flex-none" />
                <p className="min-w-0 flex-1 text-[13.5px] font-semibold">Não foi possível carregar o mapa.</p>
                <Button
                    variant="soft"
                    size="sm"
                    icon={<IconRefresh size={14} />}
                    onClick={() => {
                        this.props.onRetry(failure.error);
                        this.setState({ failure: null });
                    }}
                >
                    Tentar de novo
                </Button>
            </div>
        );
    }
}

const mapSkeleton = <div className="gx-skeleton gx-map-skeleton" role="status" aria-busy="true" aria-label="Carregando mapa" />;

const toDrafts = (routes: HubRoute[]): RouteDraft[] =>
    routes.map((r, idx) => ({
        key: r.id || `route-${idx}`,
        id: r.id,
        name: r.name,
        notes: r.notes ?? '',
        active: r.active,
        stops: r.stops.map((s) => ({ cityIbgeCode: s.cityIbgeCode, cityName: s.cityName, state: s.state })),
    }));

export interface HubRoutesProps {
    hub: Hub;
    onGoCoverage?: () => void;
}

export const HubRoutes: React.FC<HubRoutesProps> = ({ hub, onGoCoverage }) => {
    const [, setParams] = useSearchParams();

    const routesKey = `hubs:routes:${hub.id}`;
    const routesResource = useResource<HubRoute[]>(
        routesKey,
        async () => (await hubRoutesApi.list(hub.id)).data ?? [],
        { staleMs: 10_000 },
    );

    const coverageKey = `hubs:coverage:${hub.id}`;
    const coverageResource = useResource<HubCoverageEntry[]>(
        coverageKey,
        async () => (await hubCoverageApi.list(hub.id)).data ?? [],
        { staleMs: 10_000 },
    );

    const [drafts, setDrafts] = useState<RouteDraft[] | null>(null);
    const [editingKey, setEditingKey] = useState<string | null>(null);
    const [editorTab, setEditorTab] = useState<'stops' | 'map'>('stops');
    const [error, setError] = useState<string | null>(null);

    const [CoverageMapComponent, setCoverageMapComponent] = useState(() => lazyWithRetry());
    const [polygon, setPolygon] = useState<Polygon>([]);
    const [teiaBusy, setTeiaBusy] = useState(false);
    const mapRetry = useRef(0);

    const coordsCache = useRef<Map<string, GeoCity>>(new Map());
    const coordRequests = useRef<Map<string, CoordsStatus>>(new Map());
    const [coordsVersion, setCoordsVersion] = useState(0);
    const mounted = useRef(true);

    const { busy, run } = useAction();
    const toast = useToast();

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    // Inicializa rascunho de rotas
    useEffect(() => {
        if (routesResource.data && drafts == null) {
            setDrafts(toDrafts(routesResource.data));
        }
    }, [routesResource.data, drafts]);

    // Cidades elegíveis para rota: cobertura ativa + cidade-sede
    const candidateCities = useMemo(() => {
        const list: RouteStopDraft[] = [];
        const seen = new Set<string>();

        if (hub.cityIbgeCode && hub.city && hub.state) {
            list.push({
                cityIbgeCode: hub.cityIbgeCode,
                cityName: hub.city,
                state: hub.state,
            });
            seen.add(hub.cityIbgeCode);
        }

        for (const c of coverageResource.data ?? []) {
            if (c.active && !seen.has(c.cityIbgeCode)) {
                list.push({
                    cityIbgeCode: c.cityIbgeCode,
                    cityName: c.cityName,
                    state: c.state,
                });
                seen.add(c.cityIbgeCode);
            }
        }
        return list;
    }, [hub.cityIbgeCode, hub.city, hub.state, coverageResource.data]);

    // Busca de coordenadas para candidatas, paradas e sede
    const allRelevantIbgeCodes = useMemo(() => {
        const codes = candidateCities.map((c) => c.cityIbgeCode);
        if (hub.cityIbgeCode) codes.push(hub.cityIbgeCode);
        for (const r of drafts ?? []) {
            for (const s of r.stops) codes.push(s.cityIbgeCode);
        }
        return [...new Set(codes.filter((c) => /^\d{7}$/u.test(c)))];
    }, [candidateCities, hub.cityIbgeCode, drafts]);

    useEffect(() => {
        const missing = allRelevantIbgeCodes.filter(
            (code) => !coordsCache.current.has(code) && !coordRequests.current.has(code),
        );
        if (missing.length === 0) return;

        for (const code of missing) coordRequests.current.set(code, 'pending');

        locationsApi
            .cityCoords(missing)
            .then((cities) => {
                if (!mounted.current) return;
                for (const city of cities ?? []) {
                    coordsCache.current.set(city.ibgeCode, city);
                    coordRequests.current.set(city.ibgeCode, 'settled');
                }
                setCoordsVersion((v) => v + 1);
            })
            .catch((err) => {
                if (!mounted.current) return;
                console.error('Falha ao obter coordenadas para rotas:', err);
                for (const code of missing) coordRequests.current.set(code, 'failed');
            });
    }, [allRelevantIbgeCodes]);

    // Coordenadas da sede do hub
    const seat = useMemo(() => {
        if (hub.lat != null && hub.lng != null) return { lat: hub.lat, lng: hub.lng };
        if (hub.cityIbgeCode) {
            const c = coordsCache.current.get(hub.cityIbgeCode);
            if (c) return { lat: c.lat, lng: c.lng };
        }
        return null;
    }, [hub.lat, hub.lng, hub.cityIbgeCode, coordsVersion]);

    // Detecção de alterações
    const dirty = useMemo(() => {
        if (!drafts || !routesResource.data) return false;
        const currentPayload = routesPayload(drafts);
        const initialPayload = {
            routes: routesResource.data.map((r) => ({
                ...(r.id ? { id: r.id } : {}),
                name: r.name.trim(),
                ...(r.notes?.trim() ? { notes: r.notes.trim() } : {}),
                active: r.active,
                stops: r.stops.map((s) => ({ cityIbgeCode: s.cityIbgeCode })),
            })),
        };
        return JSON.stringify(currentPayload) !== JSON.stringify(initialPayload);
    }, [drafts, routesResource.data]);

    // Mapeamento de cidades em múltiplas rotas
    const multiMap = useMemo(() => citiesInManyRoutes(drafts ?? []), [drafts]);

    const handleGoCoverage = useCallback(() => {
        if (onGoCoverage) {
            onGoCoverage();
        } else {
            setParams((p) => {
                const next = new URLSearchParams(p);
                next.set('hp', 'cobertura');
                return next;
            }, { replace: true });
        }
    }, [onGoCoverage, setParams]);

    const handleAddRoute = () => {
        if ((drafts?.length ?? 0) >= MAX_ROUTES) {
            toast.error(`O hub pode ter no máximo ${MAX_ROUTES} rotas.`);
            return;
        }
        const newRoute: RouteDraft = {
            key: `route-new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: '',
            notes: '',
            active: true,
            stops: [],
        };
        setDrafts((curr) => [...(curr ?? []), newRoute]);
        setEditingKey(newRoute.key);
        setEditorTab('stops');
        setError(null);
    };

    const updateRoute = (nextRoute: RouteDraft) => {
        setError(null);
        setDrafts((curr) => (curr ?? []).map((r) => (r.key === nextRoute.key ? nextRoute : r)));
    };

    const handleDeleteRoute = (key: string) => {
        setError(null);
        setDrafts((curr) => (curr ?? []).filter((r) => r.key !== key));
        if (editingKey === key) {
            setEditingKey(null);
        }
    };

    const handleDiscard = () => {
        setError(null);
        if (!routesResource.data) return;
        setDrafts(toDrafts(routesResource.data));
    };

    const save = async () => {
        if (!drafts) return;
        const problem = validateRoutes(drafts);
        setError(problem);
        if (problem) return;

        let saved = null as HubRoute[] | null;
        const ok = await run(
            'routes:save',
            async () => {
                saved = (await hubRoutesApi.replace(hub.id, routesPayload(drafts))).data ?? null;
            },
            { success: 'Rotas salvas.', error: 'As rotas não foram salvas.' },
        );
        if (ok) {
            // Reancora o rascunho no que o servidor gravou (ids novos); senão "dirty" ficaria preso.
            if (mounted.current && saved) {
                setDrafts(toDrafts(saved));
                setEditingKey(null);
            }
            invalidate(routesKey);
        }
    };

    const editingRoute = useMemo(() => {
        if (!editingKey || !drafts) return null;
        return drafts.find((r) => r.key === editingKey) ?? null;
    }, [editingKey, drafts]);

    // Dados para o mapa da rota em edição
    const editingRoutePath = useMemo(() => {
        if (!editingRoute) return [];
        const points: Array<{ lat: number; lng: number }> = [];
        if (seat) points.push(seat);
        for (const stop of editingRoute.stops) {
            const coord = coordsCache.current.get(stop.cityIbgeCode);
            if (coord) points.push({ lat: coord.lat, lng: coord.lng });
        }
        return points;
    }, [editingRoute, seat, coordsVersion]);

    const editingRouteMapCities = useMemo(() => {
        if (!editingRoute) return [];
        const inRoute = new Set(editingRoute.stops.map((s) => s.cityIbgeCode));
        const list: Array<GeoCity & { served: boolean }> = [];
        const seen = new Set<string>();

        for (const candidate of candidateCities) {
            const coord = coordsCache.current.get(candidate.cityIbgeCode);
            if (!coord) continue;
            seen.add(candidate.cityIbgeCode);
            list.push({
                ibgeCode: candidate.cityIbgeCode,
                name: candidate.cityName,
                state: candidate.state,
                lat: coord.lat,
                lng: coord.lng,
                served: inRoute.has(candidate.cityIbgeCode),
            });
        }

        for (const stop of editingRoute.stops) {
            if (seen.has(stop.cityIbgeCode)) continue;
            const coord = coordsCache.current.get(stop.cityIbgeCode);
            if (!coord) continue;
            seen.add(stop.cityIbgeCode);
            list.push({
                ibgeCode: stop.cityIbgeCode,
                name: stop.cityName,
                state: stop.state,
                lat: coord.lat,
                lng: coord.lng,
                served: true,
            });
        }

        return list;
    }, [editingRoute, candidateCities, coordsVersion]);

    const handleTeia = async (points: Polygon) => {
        if (!editingRoute) return;
        setPolygon(points);
        setTeiaBusy(true);
        setError(null);
        try {
            const within = (await locationsApi.citiesWithin(points)) ?? [];
            if (!mounted.current) return;
            for (const city of within) coordsCache.current.set(city.ibgeCode, city);
            setCoordsVersion((v) => v + 1);

            const candidateMap = new Map<string, RouteStopDraft>(candidateCities.map((c) => [c.cityIbgeCode, c]));
            const matching: RouteStopDraft[] = within
                .filter((c) => candidateMap.has(c.ibgeCode))
                .map((c) => candidateMap.get(c.ibgeCode)!);

            const inRoute = new Set(editingRoute.stops.map((s) => s.cityIbgeCode));
            const novas = matching.filter((c) => !inRoute.has(c.cityIbgeCode));

            if (novas.length === 0) {
                toast.error('Nenhuma cidade nova da cobertura encontrada dentro da teia.');
                return;
            }

            const coordsMap = new Map<string, LatLng>();
            for (const n of novas) {
                const found = coordsCache.current.get(n.cityIbgeCode);
                if (found) coordsMap.set(n.cityIbgeCode, { lat: found.lat, lng: found.lng });
            }

            const ordered = orderByNearest(seat, novas, coordsMap);
            const { route: nextRoute, added, skipped } = appendStops(editingRoute, ordered);
            updateRoute(nextRoute);

            toast.success(`${added} ${added === 1 ? 'cidade adicionada' : 'cidades adicionadas'} à rota`);
            if (skipped > 0) {
                toast.error(`Limite de ${MAX_STOPS} cidades: ${skipped} ficaram de fora.`);
            }
        } catch (err) {
            if (mounted.current) {
                toast.error(`Falha ao buscar cidades na teia: ${err instanceof Error ? err.message : String(err)}`);
            }
        } finally {
            if (mounted.current) setTeiaBusy(false);
        }
    };

    const handleToggleMapCity = (code: string) => {
        if (!editingRoute) return;
        const isPresent = editingRoute.stops.some((s) => s.cityIbgeCode === code);
        if (isPresent) {
            updateRoute(removeStop(editingRoute, code));
        } else {
            const candidate = candidateCities.find((c) => c.cityIbgeCode === code);
            if (!candidate) return;
            const { route: nextRoute, added, skipped } = appendStops(editingRoute, [candidate]);
            if (added > 0) {
                updateRoute(nextRoute);
                toast.success(`${candidate.cityName} adicionada à rota`);
            } else if (skipped > 0) {
                toast.error(`Limite de ${MAX_STOPS} paradas na rota`);
            }
        }
    };

    // Verificação de erro ou carregamento
    if (coverageResource.error) {
        return <ErrorState message={coverageResource.error} onRetry={coverageResource.reload} />;
    }
    if (routesResource.error) {
        return <ErrorState message={routesResource.error} onRetry={routesResource.reload} />;
    }

    const hasNoActiveCoverage =
        coverageResource.data != null &&
        coverageResource.data.filter((c) => c.active).length === 0;

    return (
        <div className="flex flex-col gap-5">
            <p className="gx-muted max-w-[60ch] text-[13.5px]">
                Linhas de entrega que este hub opera. O copiloto usa essas rotas para agrupar pedidos que seguem juntos na consolidação.
            </p>

            <Loadable state={coverageResource} skeleton={<Skeleton rows={3} height={120} />}>
                {() =>
                    hasNoActiveCoverage ? (
                        <EmptyState
                            title="Cadastre primeiro a cobertura do hub"
                            hint="As rotas são formadas pelas cidades atendidas por este hub."
                            action={
                                <Button variant="primary" onClick={handleGoCoverage}>
                                    Ir para Cobertura
                                </Button>
                            }
                        />
                    ) : (
                        <Loadable state={routesResource} skeleton={<Skeleton rows={3} height={120} />}>
                            {() =>
                                !drafts || (drafts.length === 0 && !editingKey) ? (
                                    <EmptyState
                                        title="Nenhuma rota cadastrada"
                                        hint="Cadastre as linhas de entrega que este hub roda — o copiloto usa isso para montar cargas que seguem juntas."
                                        action={
                                            <Button variant="primary" onClick={handleAddRoute}>
                                                Nova rota
                                            </Button>
                                        }
                                    />
                                ) : (
                                    <div className="flex flex-col gap-4">
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            <span className="gx-muted text-[13px] font-medium">
                                                {drafts.length} {drafts.length === 1 ? 'rota cadastrada' : 'rotas cadastradas'}
                                            </span>
                                            <Button
                                                variant="primary"
                                                size="sm"
                                                onClick={handleAddRoute}
                                                disabled={drafts.length >= MAX_ROUTES}
                                            >
                                                Nova rota
                                            </Button>
                                        </div>

                                        {/* Lista de cards ou editor expandido */}
                                        <div className="flex flex-col gap-3">
                                            {drafts.map((route) => {
                                                const isEditing = route.key === editingKey;
                                                const routeMultiNames = route.stops
                                                    .map((s) => {
                                                        const others = (multiMap.get(s.cityIbgeCode) ?? []).filter(
                                                            (name) => name !== (route.name.trim() || 'Sem nome'),
                                                        );
                                                        return others.length > 0 ? `${s.cityName} (${others.join(', ')})` : null;
                                                    })
                                                    .filter(Boolean) as string[];

                                                if (isEditing) {
                                                    const availableUnselectedCities = candidateCities.filter(
                                                        (c) => !route.stops.some((s) => s.cityIbgeCode === c.cityIbgeCode),
                                                    );

                                                    return (
                                                        <div key={route.key} className="gx-route-editor flex flex-col gap-4">
                                                            <h4 className="gx-h3 border-b pb-3">Editando rota: {route.name || 'Nova rota'}</h4>

                                                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                                                <div>
                                                                    <span className="gx-label mb-1 block">Nome da rota</span>
                                                                    <TextInput
                                                                        value={route.name}
                                                                        onChange={(e) => updateRoute({ ...route, name: e.target.value })}
                                                                        placeholder="ex.: Rota Codó"
                                                                        aria-label="Nome da rota"
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <span className="gx-label mb-1 block">Observação</span>
                                                                    <TextInput
                                                                        value={route.notes}
                                                                        onChange={(e) => updateRoute({ ...route, notes: e.target.value })}
                                                                        placeholder="ex.: Saídas terças e quintas (opcional)"
                                                                        aria-label="Observação da rota"
                                                                    />
                                                                </div>
                                                            </div>

                                                            <div className="flex items-center gap-2">
                                                                <Checkbox
                                                                    label="Rota ativa"
                                                                    checked={route.active}
                                                                    onChange={(checked) => updateRoute({ ...route, active: checked })}
                                                                />
                                                            </div>

                                                            <Tabs
                                                                label="Modo de edição da rota"
                                                                value={editorTab}
                                                                onChange={(id) => setEditorTab(id as 'stops' | 'map')}
                                                                tabs={[
                                                                    { id: 'stops', label: `Paradas (${route.stops.length})` },
                                                                    { id: 'map', label: 'Desenhar no mapa' },
                                                                ]}
                                                            />

                                                            {editorTab === 'stops' ? (
                                                                <div className="flex flex-col gap-3">
                                                                    <div className="flex flex-wrap items-center gap-2">
                                                                        <SelectInput
                                                                            aria-label="Adicionar cidade à rota"
                                                                            value=""
                                                                            onChange={(e) => {
                                                                                const code = e.target.value;
                                                                                if (!code) return;
                                                                                const found = candidateCities.find((c) => c.cityIbgeCode === code);
                                                                                if (found) {
                                                                                    const { route: next, added, skipped } = appendStops(route, [found]);
                                                                                    if (added > 0) {
                                                                                        updateRoute(next);
                                                                                        toast.success(`${found.cityName} adicionada à rota`);
                                                                                    } else if (skipped > 0) {
                                                                                        toast.error(`Limite de ${MAX_STOPS} paradas na rota`);
                                                                                    }
                                                                                }
                                                                            }}
                                                                        >
                                                                            <option value="">Adicionar cidade à rota…</option>
                                                                            {availableUnselectedCities.map((c) => (
                                                                                <option key={c.cityIbgeCode} value={c.cityIbgeCode}>
                                                                                    {c.cityName}/{c.state}
                                                                                </option>
                                                                            ))}
                                                                        </SelectInput>
                                                                    </div>

                                                                    {route.stops.length === 0 ? (
                                                                        <p className="gx-muted py-2 text-[13px]">
                                                                            Nenhuma cidade nesta rota. Adicione pelo menu acima ou desenhe no mapa.
                                                                        </p>
                                                                    ) : (
                                                                        <div className="flex flex-col gap-2">
                                                                            {route.stops.map((stop, index) => {
                                                                                const others = (multiMap.get(stop.cityIbgeCode) ?? []).filter(
                                                                                    (n) => n !== (route.name.trim() || 'Sem nome'),
                                                                                );
                                                                                return (
                                                                                    <div
                                                                                        key={stop.cityIbgeCode}
                                                                                        className="gx-route-stop-item"
                                                                                    >
                                                                                        <div className="flex min-w-0 items-center gap-2.5">
                                                                                            <span className="gx-route-stop-seq">{index + 1}</span>
                                                                                            <div className="min-w-0">
                                                                                                <span className="block truncate text-[13.5px] font-semibold">
                                                                                                    {stop.cityName}/{stop.state}
                                                                                                </span>
                                                                                                <span className="gx-mono gx-soft block text-[11.5px]">
                                                                                                    {stop.cityIbgeCode}
                                                                                                </span>
                                                                                                {others.length > 0 ? (
                                                                                                    <span className="gx-route-multi-warn mt-0.5">
                                                                                                        Também está na {others.join(', ')}
                                                                                                    </span>
                                                                                                ) : null}
                                                                                            </div>
                                                                                        </div>
                                                                                        <div className="flex flex-none items-center gap-1">
                                                                                            <button
                                                                                                type="button"
                                                                                                className="gx-btn gx-btn-ghost gx-btn-sm"
                                                                                                aria-label={`Mover ${stop.cityName} para cima`}
                                                                                                disabled={index === 0}
                                                                                                onClick={() => updateRoute(moveStop(route, index, -1))}
                                                                                            >
                                                                                                ↑
                                                                                            </button>
                                                                                            <button
                                                                                                type="button"
                                                                                                className="gx-btn gx-btn-ghost gx-btn-sm"
                                                                                                aria-label={`Mover ${stop.cityName} para baixo`}
                                                                                                disabled={index === route.stops.length - 1}
                                                                                                onClick={() => updateRoute(moveStop(route, index, 1))}
                                                                                            >
                                                                                                ↓
                                                                                            </button>
                                                                                            <button
                                                                                                type="button"
                                                                                                className="gx-icon-btn"
                                                                                                aria-label={`Remover ${stop.cityName}`}
                                                                                                onClick={() => updateRoute(removeStop(route, stop.cityIbgeCode))}
                                                                                            >
                                                                                                <IconClose size={16} />
                                                                                            </button>
                                                                                        </div>
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ) : (
                                                                <div className="flex flex-col gap-3">
                                                                    <p className="gx-muted text-[13px]">
                                                                        Desenhe a teia para capturar as cidades da cobertura que fazem parte desta rota. Toque em uma cidade para adicionar ou remover da rota.
                                                                    </p>
                                                                    <MapErrorBoundary
                                                                        onRetry={(failure) => {
                                                                            setCoverageMapComponent(lazyWithRetry(failure, ++mapRetry.current));
                                                                        }}
                                                                    >
                                                                        <Suspense fallback={mapSkeleton}>
                                                                            <CoverageMapComponent
                                                                                seat={seat}
                                                                                cities={editingRouteMapCities}
                                                                                nearby={[]}
                                                                                polygon={polygon}
                                                                                onTeia={handleTeia}
                                                                                onClearTeia={() => setPolygon([])}
                                                                                onToggle={handleToggleMapCity}
                                                                                onAdd={handleToggleMapCity}
                                                                                onViewport={() => undefined}
                                                                                busy={teiaBusy}
                                                                                path={editingRoutePath}
                                                                            />
                                                                        </Suspense>
                                                                    </MapErrorBoundary>
                                                                </div>
                                                            )}

                                                            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                                                                <Button
                                                                    variant="danger"
                                                                    size="sm"
                                                                    onClick={() => handleDeleteRoute(route.key)}
                                                                >
                                                                    Excluir rota
                                                                </Button>
                                                                <Button size="sm" onClick={() => setEditingKey(null)}>
                                                                    Concluir edição
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    );
                                                }

                                                return (
                                                    <div
                                                        key={route.key}
                                                        className={`gx-route-card flex flex-col gap-2.5 ${!route.active ? 'gx-route-card-inactive' : ''}`}
                                                    >
                                                        <div className="flex flex-wrap items-start justify-between gap-2">
                                                            <div className="min-w-0">
                                                                <div className="flex flex-wrap items-center gap-2">
                                                                    <h4 className="text-[15px] font-bold">
                                                                        {route.name || '(Sem nome)'}
                                                                    </h4>
                                                                    {route.active ? (
                                                                        <Pill tone="positive">Ativa</Pill>
                                                                    ) : (
                                                                        <Pill tone="neutral">Inativa</Pill>
                                                                    )}
                                                                    <span className="gx-muted text-[12.5px]">
                                                                        {route.stops.length}{' '}
                                                                        {route.stops.length === 1 ? 'cidade' : 'cidades'}
                                                                    </span>
                                                                </div>
                                                                {route.notes ? (
                                                                    <p className="gx-muted mt-0.5 text-[12.5px]">{route.notes}</p>
                                                                ) : null}
                                                            </div>
                                                            <Button
                                                                size="sm"
                                                                variant="soft"
                                                                onClick={() => {
                                                                    setEditingKey(route.key);
                                                                    setEditorTab('stops');
                                                                }}
                                                            >
                                                                Editar
                                                            </Button>
                                                        </div>

                                                        <div className="gx-inset p-2 text-[12.5px]">
                                                            {route.stops.length > 0 ? (
                                                                <span className="font-medium text-slate-800 dark:text-slate-200">
                                                                    {routeSummary(route)}
                                                                </span>
                                                            ) : (
                                                                <span className="gx-muted italic">Nenhuma cidade cadastrada</span>
                                                            )}
                                                        </div>

                                                        {routeMultiNames.length > 0 ? (
                                                            <div className="gx-route-multi-warn self-start">
                                                                Também em outra rota: {routeMultiNames.join(' · ')}
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )
                            }
                        </Loadable>
                    )
                }
            </Loadable>

            <FormFooter
                error={error}
                secondary={
                    dirty ? (
                        <Button onClick={handleDiscard} disabled={busy != null || teiaBusy}>
                            Descartar mudanças
                        </Button>
                    ) : undefined
                }
                primary={
                    <Button
                        variant="primary"
                        disabled={!dirty}
                        loading={busy === 'routes:save'}
                        onClick={() => void save()}
                    >
                        Salvar rotas{drafts ? ` (${drafts.length} ${drafts.length === 1 ? 'rota' : 'rotas'})` : ''}
                    </Button>
                }
            />
        </div>
    );
};
