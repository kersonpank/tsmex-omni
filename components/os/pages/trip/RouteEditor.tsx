import React, { useEffect, useState } from 'react';
import { hubsApi, locationsApi, manifestsApi } from '../../../../lib/api';
import type { Hub } from '../../../../types/index';
import type { ManifestWithLegs } from '../../lib/arrival';
import { buildRoutePayload, cityLabel, routeBlockedReason, toRouteCity, tripUsesDestHub, type RouteCity } from '../../lib/route';
import { OsButton } from '../../ui/kit';
import OsSheet, { apiErrorMessage, osFieldClass } from '../../ui/Sheet';

const CityField: React.FC<{
    label: string;
    current: string;
    ibgeOk: boolean;
    value: RouteCity | null;
    onChange: (city: RouteCity | null) => void;
}> = ({ label, current, ibgeOk, value, onChange }) => {
    const [q, setQ] = useState('');
    const [hits, setHits] = useState<RouteCity[]>([]);

    useEffect(() => {
        const term = q.trim();
        if (term.length < 3) {
            setHits([]);
            return;
        }
        const timer = window.setTimeout(() => {
            locationsApi
                .getCities({ q: term })
                .then((body) => setHits(((body.data ?? []) as Array<Parameters<typeof toRouteCity>[0]>).map(toRouteCity).filter((c): c is RouteCity => Boolean(c)).slice(0, 8)))
                .catch(() => setHits([]));
        }, 300);
        return () => window.clearTimeout(timer);
    }, [q]);

    return (
        <div>
            <p className="text-[13px] font-bold text-tower-600 dark:text-tower-300">{label}</p>
            <p className="mt-0.5 text-[13px] text-tower-700 dark:text-tower-200">
                {value ? <strong>{cityLabel(value)}</strong> : current || 'Não informado'}
                {!value && !ibgeOk ? <span className="ml-1.5 font-semibold text-brand-red-600 dark:text-brand-red-400">· falta selecionar na busca</span> : null}
            </p>
            <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar cidade (mín. 3 letras)"
                inputMode="search"
                aria-label={`Buscar ${label.toLowerCase()}`}
                className={`${osFieldClass} mt-1.5`}
            />
            {hits.length > 0 ? (
                <div className="mt-1.5 flex flex-col gap-1.5">
                    {hits.map((city) => (
                        <button
                            key={city.ibgeCode}
                            type="button"
                            onClick={() => {
                                onChange(city);
                                setQ('');
                                setHits([]);
                            }}
                            className="min-h-[44px] rounded-xl border-2 border-tower-200 px-3.5 text-left text-[14px] font-semibold text-tower-900 dark:border-tower-700 dark:text-white"
                        >
                            {cityLabel(city)}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
};

/** Corrige origem, destino (com IBGE) e hub de destino da viagem em rascunho, via PATCH /manifests/:id/setup. */
const RouteEditor: React.FC<{
    manifest: ManifestWithLegs;
    onClose: () => void;
    onSaved: () => void;
}> = ({ manifest, onClose, onSaved }) => {
    const [origin, setOrigin] = useState<RouteCity | null>(null);
    const [destination, setDestination] = useState<RouteCity | null>(null);
    const [hubs, setHubs] = useState<Hub[]>([]);
    const [destHubId, setDestHubId] = useState(manifest.destHubId ?? '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const usesHub = tripUsesDestHub(manifest.tripType);
    const blocked = routeBlockedReason(manifest.status);

    useEffect(() => {
        if (!usesHub) return;
        hubsApi.list().then((body) => setHubs(body.data ?? [])).catch(() => setError('Não foi possível carregar os hubs.'));
    }, [usesHub]);

    const chosenHub = hubs.find((hub) => hub.id === destHubId) ?? null;
    const hubChanged = usesHub && Boolean(chosenHub) && destHubId !== (manifest.destHubId ?? '');
    const payload = buildRoutePayload({
        tripType: manifest.tripType,
        origin,
        destination,
        destHub: usesHub && (hubChanged || !manifest.destinationCityIbgeCode) ? chosenHub : null,
    });

    const save = async () => {
        if (!payload) return;
        setBusy(true);
        setError(null);
        try {
            await manifestsApi.updateSetup(manifest.id, payload);
            onSaved();
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível salvar a rota.'));
            setBusy(false);
        }
    };

    const withdraw = async () => {
        setBusy(true);
        setError(null);
        try {
            await manifestsApi.withdrawOffer(manifest.id);
            onSaved();
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível retirar a oferta.'));
            setBusy(false);
        }
    };

    return (
        <OsSheet
            title="Rota da viagem"
            subtitle="Origem e destino com código IBGE para os documentos fiscais"
            onClose={onClose}
            footer={
                <div className="flex flex-col gap-2">
                    {error ? <p role="alert" className="rounded-lg bg-brand-red-500/10 p-3 text-[13px] font-semibold text-brand-red-600 dark:text-brand-red-400">{error}</p> : null}
                    {blocked ? (
                        manifest.status === 'PENDING_ACCEPT' ? (
                            <OsButton full disabled={busy} onClick={() => void withdraw()}>{busy ? 'Retirando…' : 'Retirar oferta'}</OsButton>
                        ) : null
                    ) : (
                        <OsButton full disabled={!payload || busy} onClick={() => void save()}>{busy ? 'Salvando…' : 'Salvar rota'}</OsButton>
                    )}
                </div>
            }
        >
            {blocked ? <p className="mb-3 rounded-xl bg-tower-100 p-3 text-[13px] text-tower-700 dark:bg-tower-800 dark:text-tower-200">{blocked}</p> : null}
            <div className="flex flex-col gap-4">
                <CityField label="Origem" current={manifest.origin} ibgeOk={Boolean(manifest.originCityIbgeCode)} value={origin} onChange={setOrigin} />
                {usesHub ? (
                    <label className="block text-[13px] font-bold text-tower-600 dark:text-tower-300">
                        Hub de destino
                        <select value={destHubId} onChange={(e) => setDestHubId(e.target.value)} className={`${osFieldClass} mt-1.5`}>
                            <option value="">Selecione o hub</option>
                            {hubs.map((hub) => <option key={hub.id} value={hub.id}>{hub.name} · {hub.city}/{hub.state}</option>)}
                        </select>
                    </label>
                ) : null}
                {manifest.tripType !== 'TRANSFER' ? (
                    <CityField label="Destino" current={manifest.destination} ibgeOk={Boolean(manifest.destinationCityIbgeCode)} value={destination} onChange={setDestination} />
                ) : (
                    <p className="text-[13px] text-tower-600 dark:text-tower-300">
                        Destino: <strong>{chosenHub ? `${chosenHub.city}, ${chosenHub.state}` : manifest.destination || 'definido pelo hub'}</strong>
                        {!manifest.destinationCityIbgeCode && !chosenHub ? ' · escolha o hub para preencher o IBGE' : ''}
                    </p>
                )}
            </div>
        </OsSheet>
    );
};

export default RouteEditor;
