import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useManifests } from '../lib/data';
import { plural } from '../lib/format';
import { sortByAttention } from '../lib/trips';
import { countTripsByFilter, matchesTripFilter, matchesTripQuery, parseTripFilter, TRIP_FILTERS, type TripFilter } from '../lib/viagens';
import { IconSearch } from '../ui/icons';
import { Chip, EmptyState, Loadable, PageHeader, Panel, Skeleton, TextInput } from '../ui/kit';
import { TripDrawer } from './viagens/TripDrawer';
import { TripRow } from './viagens/TripRow';

/** Viagens: qual viagem precisa de atenção, e o que falta para ela andar. */
const ViagensPage: React.FC = () => {
    const [params, setParams] = useSearchParams();
    const manifests = useManifests();
    const filter = parseTripFilter(params.get('f'));
    const urlQuery = params.get('q') ?? '';
    const openId = params.get('v');
    const [draft, setDraft] = useState(urlQuery);

    const patch = useCallback(
        (changes: Record<string, string | null>) => {
            setParams(
                (current) => {
                    const next = new URLSearchParams(current);
                    for (const [key, value] of Object.entries(changes)) {
                        if (value) next.set(key, value);
                        else next.delete(key);
                    }
                    return next;
                },
                { replace: true },
            );
        },
        [setParams],
    );

    // O texto da busca vai para a URL com um respiro; mudança vinda de fora (Ctrl K, link) entra no campo.
    useEffect(() => setDraft(urlQuery), [urlQuery]);
    useEffect(() => {
        if (draft.trim() === urlQuery.trim()) return;
        const timer = window.setTimeout(() => patch({ q: draft.trim() || null }), 300);
        return () => window.clearTimeout(timer);
    }, [draft, urlQuery, patch]);

    const now = useMemo(() => new Date(), [manifests.loadedAt]);
    const sorted = useMemo(() => sortByAttention(manifests.data ?? [], now), [manifests.data, now]);
    const counts = useMemo(() => countTripsByFilter(sorted, now), [sorted, now]);
    const visible = useMemo(() => sorted.filter((trip) => matchesTripFilter(trip, filter, now) && matchesTripQuery(trip, urlQuery)), [sorted, filter, urlQuery, now]);
    const selected = useMemo(() => (openId ? sorted.find((trip) => trip.id === openId) ?? null : null), [sorted, openId]);

    const setFilter = (next: TripFilter) => patch({ f: next === 'all' ? null : next });

    return (
        <>
            <PageHeader
                title="Viagens"
                question="Qual viagem precisa de atenção, e o que falta para ela andar?"
                actions={
                    <Link to="/manifests/new" className="gx-btn gx-btn-primary">
                        Nova viagem
                    </Link>
                }
            />

            <div className="gx-rise mb-5 flex flex-col gap-3">
                <div className="relative max-w-[520px]">
                    <IconSearch size={17} className="gx-muted pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <TextInput
                        type="search"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        placeholder="Buscar rota, transportador, placa ou código"
                        aria-label="Buscar viagem"
                        className="!pl-10"
                    />
                </div>
                <div className="gx-no-scrollbar flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filtrar viagens">
                    {TRIP_FILTERS.map((item) => (
                        <Chip key={item.id} active={filter === item.id} count={manifests.data ? counts[item.id] : null} onClick={() => setFilter(item.id)}>
                            {item.label}
                        </Chip>
                    ))}
                </div>
            </div>

            <Panel
                title="Viagens"
                hint="Travadas primeiro, depois as que pedem atenção."
                count={manifests.data ? visible.length : null}
                padded={false}
                className="gx-rise"
            >
                <Loadable
                    state={manifests}
                    skeleton={<Skeleton rows={6} height={72} className="px-5 pb-3" />}
                    isEmpty={() => visible.length === 0}
                    empty={
                        <div className="px-5 pb-3">
                            <EmptyState
                                title={urlQuery || filter !== 'all' ? 'Nenhuma viagem com esse filtro' : 'Nenhuma viagem ainda'}
                                hint={urlQuery || filter !== 'all' ? 'Mude o filtro ou limpe a busca para ver as outras viagens.' : 'Crie a primeira viagem para ela aparecer aqui.'}
                            />
                        </div>
                    }
                >
                    {() => (
                        <div className="gx-stagger flex flex-col px-2" role="list" aria-label={plural(visible.length, 'viagem', 'viagens')}>
                            {visible.map((trip) => (
                                <div key={trip.id} role="listitem" className="gx-hair-b last:border-b-0">
                                    <TripRow trip={trip} now={now} selected={trip.id === openId} onOpen={() => patch({ v: trip.id })} />
                                </div>
                            ))}
                        </div>
                    )}
                </Loadable>
            </Panel>

            <TripDrawer trip={selected} onClose={() => patch({ v: null })} />
        </>
    );
};

export default ViagensPage;
