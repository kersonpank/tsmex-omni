import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { hubCoverageApi, locationsApi, pricingApi, type GeoCity } from '../../../../../lib/api';
import type { Hub, PricingTable } from '../../../../../types/index';
import { applyTeiaSelection, coverageCounts, MAX_COVERAGE, setServed } from '../../../lib/coverageTeia';
import { coveragePayload, validateCoverage, type CoverageRow } from '../../../lib/redeCadastro';
import { invalidate, useResource } from '../../../lib/resource';
import { Checkbox, FormFooter, NumberInput } from '../../../ui/form';
import { IconAlert, IconClose, IconRefresh } from '../../../ui/icons';
import { Button, EmptyState, ErrorState, Loadable, Pill, SelectInput, Skeleton, Tabs } from '../../../ui/kit';
import { useAction, useToast } from '../../../ui/overlay';
import { CityPicker } from '../../../ui/pickers';
import type { CoverageViewport } from './CoverageMap';

type Polygon = Array<[number, number]>;
type MapViewport = CoverageViewport & { zoom: number };
type CoordsStatus = 'pending' | 'settled' | 'failed';

function lazyWithRetry(error?: unknown, attempt = 0) {
    // Uma importação de módulo rejeitada pode ficar em cache no navegador até recarregar a página.
    if (error instanceof TypeError) {
        const failedUrl = error.message.match(/https?:\/\/[^\s"'<>]+\/CoverageMap(?:-[\w-]+\.js|\.tsx)(?:\?[^\s"'<>]*)?/u)?.[0];
        // Alguns navegadores omitem a URL no erro. O Vite anuncia o chunk no preload.
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
                <Button variant="soft" size="sm" icon={<IconRefresh size={14} />} onClick={() => {
                    this.props.onRetry(failure.error);
                    this.setState({ failure: null });
                }}>
                    Tentar de novo
                </Button>
            </div>
        );
    }
}

const mapSkeleton = <div className="gx-skeleton gx-map-skeleton" role="status" aria-busy="true" aria-label="Carregando mapa" />;

/**
 * Cobertura do hub: a tabela de roteamento da rede. Cada cidade aqui faz os pedidos com esse destino
 * cair na fila deste hub; prioridade menor vence quando dois hubs cobrem a mesma cidade.
 */
const HubCoverageEditor: React.FC<{ hub: Hub }> = ({ hub }) => {
    const key = `hubs:coverage:${hub.id}`;
    const entries = useResource<CoverageRow[]>(
        key,
        async () =>
            ((await hubCoverageApi.list(hub.id)).data ?? []).map((e) => ({
                cityIbgeCode: e.cityIbgeCode, cityName: e.cityName, state: e.state, leadTimeDays: e.leadTimeDays, priority: e.priority, active: e.active, pricingTableId: e.pricingTableId ?? null,
            })),
        { staleMs: 10_000 },
    );
    const pricingTables = useResource<PricingTable[]>(
        'pricing:tables:general:active',
        async () => (await pricingApi.listTables({ type: 'GENERAL', active: true })).data ?? [],
        { staleMs: 60_000 },
    );
    const generalTables = useMemo(
        () => (pricingTables.data ?? []).filter((t) => (t.type === 'GENERAL' || !t.type) && t.active !== false),
        [pricingTables.data],
    );
    const [rows, setRows] = useState<CoverageRow[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [tab, setTab] = useState<'list' | 'map'>('list');
    const [CoverageMap, setCoverageMap] = useState(() => lazyWithRetry());
    const [initialViewReady, setInitialViewReady] = useState(false);
    const [viewport, setViewport] = useState<MapViewport | null>(null);
    const [polygon, setPolygon] = useState<Polygon>([]);
    const [previewCities, setPreviewCities] = useState<GeoCity[] | null>(null);
    const [batchTarget, setBatchTarget] = useState<'all' | 'served'>('all');
    const [batchTableId, setBatchTableId] = useState<string>('');
    const [recentTeiaCodes, setRecentTeiaCodes] = useState<string[]>([]);
    const [teiaTableId, setTeiaTableId] = useState<string>('');
    const [teiaBusy, setTeiaBusy] = useState(false);
    const { busy, run } = useAction();
    const toast = useToast();

    const seatCode = hub.cityIbgeCode ?? null;
    const needsSeatCoords = hub.lat == null || hub.lng == null;
    const coordsCache = useRef<Map<string, GeoCity>>(new Map());
    const coordRequests = useRef(new Map<string, CoordsStatus>());
    const [coordsVersion, setCoordsVersion] = useState(0);
    const teiaRequest = useRef(0);
    const mapRetry = useRef(0);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    // O rascunho nasce do que o servidor devolveu e só é trocado de novo ao salvar.
    useEffect(() => {
        if (entries.data && rows == null) setRows(entries.data);
    }, [entries.data, rows]);

    const coordCodes = useMemo(() => {
        const codes = (rows ?? []).map((row) => row.cityIbgeCode);
        if (needsSeatCoords && seatCode) codes.push(seatCode);
        return [...new Set(codes.filter((code) => /^\d{7}$/u.test(code)))];
    }, [rows, needsSeatCoords, seatCode]);

    useEffect(() => {
        if (tab !== 'map' || !rows) return;
        const missing = coordCodes
            .filter((code) => !coordsCache.current.has(code) && !coordRequests.current.has(code));
        if (missing.length === 0) return;
        for (const code of missing) coordRequests.current.set(code, 'pending');

        const settle = (status: 'settled' | 'failed') => {
            for (const code of missing) coordRequests.current.set(code, status);
            setCoordsVersion((v) => v + 1);
        };

        locationsApi
            .cityCoords(missing)
            .then((cities) => {
                if (!mounted.current) return;
                for (const city of cities ?? []) coordsCache.current.set(city.ibgeCode, city);
                settle('settled');
            })
            .catch((err) => {
                if (!mounted.current) return;
                console.error('Falha ao obter coordenadas das cidades:', err);
                settle('failed');
            });
    }, [coordCodes, rows, tab]);

    const coordsReady = coordCodes.every((code) => {
        const request = coordRequests.current.get(code);
        return coordsCache.current.has(code) || request === 'settled' || request === 'failed';
    });
    useEffect(() => {
        if (tab === 'map' && rows && coordsReady) setInitialViewReady(true);
    }, [tab, rows, coordsReady]);

    useEffect(() => {
        if (tab !== 'map' || !viewport || viewport.zoom < 8) return;
        const { south, north } = viewport;
        const west = Math.max(viewport.west, -180);
        const east = Math.min(viewport.east, 180);
        if (west >= east) return;

        let current = true;
        const timeout = window.setTimeout(async () => {
            try {
                const cities = await locationsApi.citiesWithin([[south, west], [south, east], [north, east], [north, west]]);
                if (!current || !cities?.length) return;
                for (const city of cities) coordsCache.current.set(city.ibgeCode, city);
                setCoordsVersion((v) => v + 1);
            } catch (err) {
                if (current) console.error('Falha ao buscar cidades da região:', err);
            }
        }, 400);
        return () => {
            current = false;
            window.clearTimeout(timeout);
        };
    }, [tab, viewport]);

    const seat = useMemo(() => {
        if (hub.lat != null && hub.lng != null) return { lat: hub.lat, lng: hub.lng };
        const city = seatCode ? coordsCache.current.get(seatCode) : undefined;
        return city ? { lat: city.lat, lng: city.lng } : null;
    }, [hub.lat, hub.lng, seatCode, coordsVersion]);

    const mapCities = useMemo(() => {
        if (!rows) return [];
        return rows
            .map((row) => {
                const coord = coordsCache.current.get(row.cityIbgeCode);
                if (!coord) return null;
                return {
                    ibgeCode: row.cityIbgeCode,
                    name: row.cityName,
                    state: row.state,
                    lat: coord.lat,
                    lng: coord.lng,
                    served: row.active,
                };
            })
            .filter((c): c is NonNullable<typeof c> => c !== null);
    }, [rows, coordsVersion]);

    const nearby = useMemo(() => {
        if (!viewport || viewport.zoom < 8) return [];
        const covered = new Set((rows ?? []).map((row) => row.cityIbgeCode));
        return [...coordsCache.current.values()].filter((city) =>
            city.ibgeCode !== seatCode && !covered.has(city.ibgeCode) &&
            city.lat >= viewport.south && city.lat <= viewport.north && city.lng >= viewport.west && city.lng <= viewport.east,
        );
    }, [coordsVersion, rows, seatCode, viewport]);

    const dirty = rows != null && entries.data != null && JSON.stringify(rows) !== JSON.stringify(entries.data);
    const patch = (code: string, change: Partial<CoverageRow>) => {
        setError(null);
        setRows((current) => (current ?? []).map((row) => (row.cityIbgeCode === code ? { ...row, ...change } : row)));
    };

    const clearTeia = () => {
        teiaRequest.current++;
        setPolygon([]);
        setPreviewCities(null);
        setTeiaBusy(false);
        setRecentTeiaCodes([]);
    };

    const handleTeia = async (points: Polygon) => {
        if (!rows) return;
        const request = ++teiaRequest.current;
        const isCurrent = () => mounted.current && request === teiaRequest.current;
        setError(null);
        setPolygon(points);
        setPreviewCities(null);
        setTeiaBusy(true);
        try {
            const cities = (await locationsApi.citiesWithin(points)) ?? [];
            if (!isCurrent()) return;
            if (cities.length > 0) {
                for (const city of cities) coordsCache.current.set(city.ibgeCode, city);
                setCoordsVersion((v) => v + 1);
            }
            setPreviewCities(cities);
        } catch (err) {
            if (isCurrent()) toast.error(`Falha ao buscar cidades na teia: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            if (isCurrent()) setTeiaBusy(false);
        }
    };

    const preview = useMemo(() => rows && previewCities ? applyTeiaSelection(rows, previewCities, seatCode) : null, [rows, previewCities, seatCode]);

    const applyPreview = () => {
        if (!preview) return;
        setError(null);
        if (preview.added > 0) {
            const existingCodes = new Set((rows ?? []).map((r) => r.cityIbgeCode));
            const newlyAdded = preview.rows.filter((r) => !existingCodes.has(r.cityIbgeCode)).map((r) => r.cityIbgeCode);
            setRows(preview.rows);
            setRecentTeiaCodes(newlyAdded);
            setTeiaTableId('');
        }
        setPreviewCities(null);
        const { added, alreadyPresent, truncated } = preview;
        toast.success(`Teia capturou ${added} ${added === 1 ? 'cidade nova' : 'cidades novas'} (${alreadyPresent} já ${alreadyPresent === 1 ? 'estava' : 'estavam'})`);
        if (truncated > 0) toast.error(`Limite de ${MAX_COVERAGE} cidades: ${truncated} ficaram de fora`);
    };

    const handleApplyBatch = () => {
        if (!rows || rows.length === 0) return;
        const targetId = batchTableId || null;
        let count = 0;
        const next = rows.map((row) => {
            const match = batchTarget === 'all' || (batchTarget === 'served' && row.active);
            if (match) {
                count++;
                return { ...row, pricingTableId: targetId };
            }
            return row;
        });
        if (count > 0) {
            setError(null);
            setRows(next);
            toast.success(`Tarifa aplicada a ${count} ${count === 1 ? 'cidade' : 'cidades'}`);
        }
    };

    const handleAdd = (code: string) => {
        const city = coordsCache.current.get(code);
        if (!city || !rows) return;
        const result = applyTeiaSelection(rows, [city], seatCode);
        if (result.truncated > 0) toast.error(`Limite de ${MAX_COVERAGE} cidades na cobertura.`);
        if (result.added === 0) return;
        setError(null);
        setRows(result.rows);
    };

    const handleViewport = (bounds: CoverageViewport, zoom: number) => {
        const { south, west, north, east } = bounds;
        setViewport((current) => current?.zoom === zoom && current.south === south && current.west === west &&
            current.north === north && current.east === east ? current : { ...bounds, zoom });
    };

    const handleToggle = (code: string) => {
        setError(null);
        setRows((current) => {
            if (!current) return current;
            const target = current.find((r) => r.cityIbgeCode === code);
            if (!target) return current;
            return setServed(current, code, !target.active);
        });
    };

    const save = async () => {
        if (!rows) return;
        const problem = validateCoverage(rows);
        setError(problem);
        if (problem) return;
        const ok = await run('coverage:save', () => hubCoverageApi.replace(hub.id, coveragePayload(rows)), { success: 'Cobertura salva.', error: 'A cobertura não foi salva.' });
        if (ok) invalidate(key);
    };

    const { served, notServed } = coverageCounts(rows ?? []);

    return (
        <div className="flex flex-col gap-5">
            <p className="gx-muted max-w-[60ch] text-[13.5px]">
                Cidades que este hub atende como próximo salto. Desenhe uma teia no mapa ou adicione manualmente pela lista. A cidade-sede ({hub.city}/{hub.state}) já conta sozinha. Prioridade menor vence quando dois hubs cobrem a mesma cidade; prazo em dias é opcional.
            </p>

            <div className="flex flex-wrap items-center justify-between gap-3">
                <Tabs
                    label="Modo de visualização da cobertura"
                    value={tab}
                    onChange={(id) => {
                        if (id === tab) return;
                        if (id === 'map') {
                            for (const [code, status] of coordRequests.current) {
                                if (status === 'failed') coordRequests.current.delete(code);
                            }
                            setTab('map');
                        } else {
                            setInitialViewReady(false);
                            setViewport(null);
                            setTab('list');
                        }
                    }}
                    tabs={[
                        { id: 'list', label: 'Lista' },
                        { id: 'map', label: 'Teia no mapa' },
                    ]}
                />
                {rows && rows.length > 0 ? (
                    <span className="gx-muted text-[13px] font-medium">
                        {served} atende · {notServed} não atende
                    </span>
                ) : null}
            </div>

            {tab === 'map' ? (
                <div className="flex flex-col gap-3">
                    <p className="gx-muted max-w-[60ch] text-[13px]">
                        Desenhe e feche a teia para revisar as cidades da região. Toque em uma cidade para incluir ou alternar o atendimento. Ao salvar, só a lista de cidades é gravada.
                    </p>
                    {preview ? (
                        <div className="gx-map-preview">
                            <p role="status">
                                <strong>{preview.added} {preview.added === 1 ? 'cidade nova' : 'cidades novas'} na teia</strong>
                                {preview.truncated > 0 ? <span className="gx-muted block">{preview.truncated} {preview.truncated === 1 ? 'fica' : 'ficam'} de fora pelo limite de {MAX_COVERAGE} cidades.</span> : null}
                            </p>
                            <div className="gx-map-preview-actions">
                                <Button size="sm" variant="primary" onClick={applyPreview}>Aplicar</Button>
                                <Button size="sm" onClick={() => setPreviewCities(null)}>Descartar</Button>
                            </div>
                        </div>
                    ) : null}
                    {recentTeiaCodes.length > 0 ? (
                        <div className="gx-map-preview flex flex-wrap items-center justify-between gap-3 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[13px] font-semibold">
                                    Aplicar uma tarifa às {recentTeiaCodes.length} {recentTeiaCodes.length === 1 ? 'cidade' : 'cidades'} da teia?
                                </span>
                                <SelectInput
                                    className="w-auto text-[13px]"
                                    value={teiaTableId}
                                    onChange={(e) => setTeiaTableId(e.target.value)}
                                    aria-label="Tarifa para cidades da teia"
                                >
                                    <option value="">Sem tarifa própria</option>
                                    {generalTables.map((t) => (
                                        <option key={t.id} value={t.id}>
                                            {t.description}{t.coverageOnly ? ' (só cobertura)' : ''}
                                        </option>
                                    ))}
                                </SelectInput>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button
                                    size="sm"
                                    variant="primary"
                                    onClick={() => {
                                        const targetId = teiaTableId || null;
                                        const teiaSet = new Set(recentTeiaCodes);
                                        setRows((current) => (current ?? []).map((row) => (teiaSet.has(row.cityIbgeCode) ? { ...row, pricingTableId: targetId } : row)));
                                        toast.success(`Tarifa aplicada a ${recentTeiaCodes.length} ${recentTeiaCodes.length === 1 ? 'cidade' : 'cidades'}`);
                                        setRecentTeiaCodes([]);
                                    }}
                                >
                                    Aplicar
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setRecentTeiaCodes([])}>
                                    Agora não
                                </Button>
                            </div>
                        </div>
                    ) : null}
                    <Loadable state={entries} skeleton={mapSkeleton}>
                        {() => initialViewReady ? (
                            <MapErrorBoundary onRetry={(failure) => {
                                setViewport(null);
                                setCoverageMap(lazyWithRetry(failure, ++mapRetry.current));
                            }}>
                                <Suspense fallback={mapSkeleton}>
                                    <CoverageMap
                                        seat={seat}
                                        cities={mapCities}
                                        nearby={nearby}
                                        polygon={polygon}
                                        onTeia={handleTeia}
                                        onClearTeia={clearTeia}
                                        onToggle={handleToggle}
                                        onAdd={handleAdd}
                                        onViewport={handleViewport}
                                        busy={teiaBusy}
                                    />
                                </Suspense>
                            </MapErrorBoundary>
                        ) : mapSkeleton}
                    </Loadable>
                </div>
            ) : (
                <>
                    <div>
                        <span className="gx-label mb-1.5 block">Adicionar cidade</span>
                        <CityPicker
                            ariaLabel="Adicionar cidade à cobertura"
                            value={null}
                            onChange={(city) => {
                                if (!city) return;
                                setError(null);
                                setRows((current) => {
                                    const list = current ?? [];
                                    if (list.some((row) => row.cityIbgeCode === city.ibgeCode)) return list;
                                    return [...list, { cityIbgeCode: city.ibgeCode, cityName: city.city, state: city.state, leadTimeDays: null, priority: 100, active: true, pricingTableId: null }];
                                });
                            }}
                        />
                    </div>
                    {rows && rows.length > 0 ? (
                        <div className="flex flex-wrap items-center justify-between gap-3 py-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="gx-muted text-[13px]">Aplicar tarifa a:</span>
                                <SelectInput
                                    className="w-auto text-[13px]"
                                    value={batchTarget}
                                    onChange={(e) => setBatchTarget(e.target.value as 'all' | 'served')}
                                    aria-label="Escopo da tarifa em lote"
                                >
                                    <option value="all">todas as cidades</option>
                                    <option value="served">só as que atendem</option>
                                </SelectInput>
                                <SelectInput
                                    className="w-auto max-w-[220px] text-[13px]"
                                    value={batchTableId}
                                    onChange={(e) => setBatchTableId(e.target.value)}
                                    aria-label="Tarifa em lote"
                                >
                                    <option value="">Sem tarifa própria</option>
                                    {generalTables.map((t) => (
                                        <option key={t.id} value={t.id}>
                                            {t.description}{t.coverageOnly ? ' (só cobertura)' : ''}
                                        </option>
                                    ))}
                                </SelectInput>
                                <Button size="sm" variant="soft" onClick={handleApplyBatch}>
                                    Aplicar
                                </Button>
                            </div>
                            <a href="#/gestaos/comercial?aba=tarifas" className="gx-muted hover:gx-soft text-[12.5px] underline">
                                Gerenciar tabelas
                            </a>
                        </div>
                    ) : null}
                    <Loadable state={entries} skeleton={<Skeleton rows={3} />}>
                        {() =>
                            !rows || rows.length === 0 ? (
                                <EmptyState title="Só a cidade-sede" hint="Adicione as cidades que este hub distribui." />
                            ) : (
                                <div className="gx-scroll-x">
                                    <table className="gx-table">
                                        <thead>
                                            <tr>
                                                <th>Cidade</th>
                                                <th>Prazo (dias)</th>
                                                <th>Prioridade</th>
                                                <th>Tarifa</th>
                                                <th>Situação</th>
                                                <th />
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rows.map((row) => {
                                                const selectedTable = generalTables.find((t) => t.id === row.pricingTableId);
                                                return (
                                                    <tr key={row.cityIbgeCode} className={!row.active ? 'gx-map-row-unserved' : undefined}>
                                                        <td>
                                                            <span className="font-semibold">{row.cityName}/{row.state}</span>
                                                            <span className="gx-mono gx-soft block text-[12px]">{row.cityIbgeCode}</span>
                                                        </td>
                                                        <td className="w-[110px]">
                                                            <NumberInput aria-label={`Prazo de ${row.cityName}`} value={row.leadTimeDays} min={0} max={60} onChange={(value) => patch(row.cityIbgeCode, { leadTimeDays: value })} />
                                                        </td>
                                                        <td className="w-[110px]">
                                                            <NumberInput aria-label={`Prioridade de ${row.cityName}`} value={row.priority} min={1} max={9999} onChange={(value) => patch(row.cityIbgeCode, { priority: value })} />
                                                        </td>
                                                        <td className="min-w-[180px]">
                                                            <div className="flex flex-col gap-1">
                                                                <SelectInput
                                                                    aria-label={`Tarifa de ${row.cityName}`}
                                                                    value={row.pricingTableId ?? ''}
                                                                    onChange={(e) => patch(row.cityIbgeCode, { pricingTableId: e.target.value || null })}
                                                                >
                                                                    <option value="">Sem tarifa própria</option>
                                                                    {generalTables.map((t) => (
                                                                        <option key={t.id} value={t.id}>
                                                                            {t.description}
                                                                        </option>
                                                                    ))}
                                                                    {row.pricingTableId && pricingTables.data && !selectedTable ? (
                                                                        <option value={row.pricingTableId}>Tabela indisponível (escolha outra)</option>
                                                                    ) : null}
                                                                </SelectInput>
                                                                {selectedTable?.coverageOnly ? (
                                                                    <Pill tone="neutral" className="self-start text-[11px]">
                                                                        Só cobertura
                                                                    </Pill>
                                                                ) : null}
                                                            </div>
                                                        </td>
                                                        <td>
                                                            <Checkbox label="Atende" checked={row.active} onChange={(checked) => patch(row.cityIbgeCode, { active: checked })} />
                                                        </td>
                                                        <td className="text-right">
                                                            <button type="button" className="gx-icon-btn" aria-label={`Remover ${row.cityName}`} onClick={() => { setError(null); setRows((current) => (current ?? []).filter((r) => r.cityIbgeCode !== row.cityIbgeCode)); }}>
                                                                <IconClose size={16} />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )
                        }
                    </Loadable>
                </>
            )}

            <FormFooter
                error={error}
                secondary={dirty ? <Button onClick={() => { setError(null); setRows(entries.data); }} disabled={busy != null || teiaBusy}>Descartar mudanças</Button> : undefined}
                primary={
                    <Button variant="primary" disabled={!dirty} loading={busy === 'coverage:save'} onClick={() => void save()}>
                        Salvar cobertura{rows ? ` (${rows.length} cidade${rows.length === 1 ? '' : 's'})` : ''}
                    </Button>
                }
            />
        </div>
    );
};

export const HubCoverage: React.FC<{ hub: Hub }> = ({ hub }) => <HubCoverageEditor key={hub.id} hub={hub} />;
