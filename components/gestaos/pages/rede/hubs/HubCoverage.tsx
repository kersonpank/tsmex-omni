import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { hubCoverageApi, locationsApi, type GeoCity } from '../../../../../lib/api';
import type { Hub } from '../../../../../types/index';
import { applyTeiaSelection, coverageCounts, setServed } from '../../../lib/coverageTeia';
import { coveragePayload, validateCoverage, type CoverageRow } from '../../../lib/redeCadastro';
import { invalidate, useResource } from '../../../lib/resource';
import { Checkbox, FormFooter, NumberInput } from '../../../ui/form';
import { IconClose } from '../../../ui/icons';
import { Button, EmptyState, Loadable, Skeleton, Tabs } from '../../../ui/kit';
import { useAction, useToast } from '../../../ui/overlay';
import { CityPicker } from '../../../ui/pickers';

const CoverageMap = React.lazy(() => import('./CoverageMap'));

/**
 * Cobertura do hub: a tabela de roteamento da rede. Cada cidade aqui faz os pedidos com esse destino
 * cair na fila deste hub; prioridade menor vence quando dois hubs cobrem a mesma cidade.
 */
export const HubCoverage: React.FC<{ hub: Hub }> = ({ hub }) => {
    const key = `hubs:coverage:${hub.id}`;
    const entries = useResource<CoverageRow[]>(
        key,
        async () =>
            ((await hubCoverageApi.list(hub.id)).data ?? []).map((e) => ({
                cityIbgeCode: e.cityIbgeCode, cityName: e.cityName, state: e.state, leadTimeDays: e.leadTimeDays, priority: e.priority, active: e.active,
            })),
        { staleMs: 10_000 },
    );
    const [rows, setRows] = useState<CoverageRow[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [tab, setTab] = useState<'list' | 'map'>('list');
    const [teiaBusy, setTeiaBusy] = useState(false);
    const { busy, run } = useAction();
    const toast = useToast();

    // Cache simples em useRef<Map> por código IBGE
    const coordsCache = useRef<Map<string, GeoCity>>(new Map());
    const requestedCoords = useRef<Set<string>>(new Set());
    const [coordsVersion, setCoordsVersion] = useState(0);
    const rowsRef = useRef<CoverageRow[] | null>(null);
    rowsRef.current = rows;
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    // O rascunho nasce do que o servidor devolveu e só é trocado de novo ao salvar.
    useEffect(() => {
        if (entries.data && rows == null) setRows(entries.data);
    }, [entries.data, rows]);

    // Coordenadas das linhas atuais: refazer quando o conjunto de códigos mudar
    useEffect(() => {
        if (tab !== 'map' || !rows || rows.length === 0) return;
        // Cada código é pedido uma só vez: códigos sem coordenada não geram nova requisição a cada edição.
        const missing = rows
            .map((r) => r.cityIbgeCode)
            .filter((code) => !coordsCache.current.has(code) && !requestedCoords.current.has(code));
        if (missing.length === 0) return;
        for (const code of missing) requestedCoords.current.add(code);

        locationsApi
            .cityCoords(missing)
            .then((cities) => {
                if (!mounted.current || !cities || cities.length === 0) return;
                for (const city of cities) {
                    coordsCache.current.set(city.ibgeCode, city);
                }
                setCoordsVersion((v) => v + 1);
            })
            .catch((err) => {
                for (const code of missing) requestedCoords.current.delete(code);
                console.error('Falha ao obter coordenadas das cidades:', err);
            });
    }, [rows, tab]);

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

    const dirty = rows != null && entries.data != null && JSON.stringify(rows) !== JSON.stringify(entries.data);
    const patch = (code: string, change: Partial<CoverageRow>) => {
        setError(null);
        setRows((current) => (current ?? []).map((row) => (row.cityIbgeCode === code ? { ...row, ...change } : row)));
    };

    const handleTeia = async (polygon: Array<[number, number]>) => {
        if (rowsRef.current == null) return;
        setError(null);
        setTeiaBusy(true);
        try {
            const cities = await locationsApi.citiesWithin(polygon);
            if (cities && cities.length > 0) {
                for (const city of cities) {
                    coordsCache.current.set(city.ibgeCode, city);
                }
                setCoordsVersion((v) => v + 1);
            }
            const currentRows = rowsRef.current ?? [];
            const result = applyTeiaSelection(currentRows, cities ?? [], hub.cityIbgeCode ?? null);
            setRows(result.rows);

            toast.success(`Teia capturou ${result.added} ${result.added === 1 ? 'cidade nova' : 'cidades novas'} (${result.alreadyPresent} já ${result.alreadyPresent === 1 ? 'estava' : 'estavam'})`);
            if (result.truncated > 0) {
                toast.error(`Limite de 500 cidades: ${result.truncated} ficaram de fora`);
            }
        } catch (err) {
            toast.error(`Falha ao buscar cidades na teia: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setTeiaBusy(false);
        }
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
                    onChange={(id) => setTab(id as 'list' | 'map')}
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
                    <p className="gx-muted text-[13px]">
                        Desenhe a teia sobre a região. Cidades dentro entram como Atende; clique numa cidade para marcar Não atende.
                    </p>
                    <Suspense fallback={<Skeleton rows={6} height={60} />}>
                        <CoverageMap
                            seat={hub.lat != null && hub.lng != null ? { lat: hub.lat, lng: hub.lng } : null}
                            cities={mapCities}
                            onTeia={handleTeia}
                            onToggle={handleToggle}
                            busy={teiaBusy}
                        />
                    </Suspense>
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
                                    return [...list, { cityIbgeCode: city.ibgeCode, cityName: city.city, state: city.state, leadTimeDays: null, priority: 100, active: true }];
                                });
                            }}
                        />
                    </div>
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
                                                <th>Situação</th>
                                                <th />
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rows.map((row) => (
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
                                                    <td>
                                                        <Checkbox label="Atende" checked={row.active} onChange={(checked) => patch(row.cityIbgeCode, { active: checked })} />
                                                    </td>
                                                    <td className="text-right">
                                                        <button type="button" className="gx-icon-btn" aria-label={`Remover ${row.cityName}`} onClick={() => { setError(null); setRows((current) => (current ?? []).filter((r) => r.cityIbgeCode !== row.cityIbgeCode)); }}>
                                                            <IconClose size={16} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
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
