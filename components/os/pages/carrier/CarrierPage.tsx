import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { linksApi, manifestsApi } from '../../../../lib/api';
import type { CarrierRegistry, RegistryDriver, RegistryUnit } from '../../lib/carrier';
import { OsActionBar, OsBadge, OsButton, OsEmpty, OsErrorNotice, OsRow, OsSectionTitle, OsSkeletonRows } from '../../ui/kit';
import CarrierInfoEditor from './CarrierInfoEditor';
import DriverEditor from './DriverEditor';
import UnitEditor from './UnitEditor';

/**
 * FICHA DO TRANSPORTADOR — "o que falta para este transportador rodar com CIOT e MDF-e?"
 * Transportador, cada placa e cada motorista, com as pendências calculadas pelo backend
 * (mesmas regras do motor de pendências e da emissão). Aberta a partir da viagem
 * (?viagem=id), reaplica placas e motorista nela ao salvar, se ela ainda está em montagem.
 */

type Editing =
    | { kind: 'carrier' }
    | { kind: 'unit'; role: 'TRACTION' | 'TRAILER'; unit: RegistryUnit | null }
    | { kind: 'driver'; driver: RegistryDriver | null }
    | null;

const Status: React.FC<{ issues: string[] }> = ({ issues }) =>
    issues.length ? <OsBadge tone="bad">{issues.length} pendência(s)</OsBadge> : <OsBadge tone="ok">completo</OsBadge>;

const CarrierPage: React.FC = () => {
    const { linkId = '' } = useParams<{ linkId: string }>();
    const [params] = useSearchParams();
    const tripId = params.get('viagem');
    const navigate = useNavigate();
    const [registry, setRegistry] = useState<CarrierRegistry | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<Editing>(null);

    const load = useCallback(async () => {
        try {
            const body = await linksApi.registry(linkId);
            setRegistry(body.data);
            setError(null);
            return body.data;
        } catch {
            setError('Não foi possível carregar o transportador.');
            return null;
        } finally {
            setLoading(false);
        }
    }, [linkId]);

    useEffect(() => {
        void load();
    }, [load]);

    /** Leva placas (e o motorista recém-cadastrado) para a viagem de origem, se ainda em montagem. */
    const syncTrip = async (fresh: CarrierRegistry | null, driverId?: string) => {
        if (!tripId || !fresh) return;
        const traction = fresh.units.find((u) => u.role === 'TRACTION');
        try {
            const trip = (await manifestsApi.getById(tripId)).data;
            if (!trip || trip.status !== 'DRAFT' || trip.linkId !== fresh.link.id) return;
            if (driverId && !trip.driverId) await manifestsApi.setResponsible(tripId, fresh.link.id, driverId);
            if (traction) {
                await manifestsApi.setVehicles(tripId, {
                    traction: { plate: traction.plate },
                    trailers: fresh.units.filter((u) => u.role === 'TRAILER').map((u) => ({ plate: u.plate })),
                });
            }
        } catch {
            // Viagem já confirmada: a composição dela só muda reabrindo o planejamento.
        }
    };

    const afterSave = async (driverId?: string) => {
        setEditing(null);
        const fresh = await load();
        await syncTrip(fresh, driverId);
    };

    if (loading) return <OsSkeletonRows count={4} />;
    if (!registry) return <OsErrorNotice message={error ?? 'Transportador não encontrado.'} onRetry={() => void load()} />;

    const traction = registry.units.find((u) => u.role === 'TRACTION') ?? null;
    const trailers = registry.units.filter((u) => u.role === 'TRAILER');
    const total =
        registry.carrierIssues.length +
        registry.units.reduce((n, u) => n + u.issues.length, 0) +
        (registry.drivers.length ? registry.drivers.reduce((n, d) => n + d.issues.length, 0) : 1);
    const edit = (e: Editing) => registry.canEdit && setEditing(e);

    return (
        <div className="pb-36">
            <div className="mb-2 rounded-xl bg-brand-500 p-4 text-white dark:bg-brand-600">
                <p className="font-display text-[17px] font-bold">{registry.link.name}</p>
                <p className="text-[13px] text-brand-100">
                    {registry.link.document} · {total === 0 ? 'pronto para CIOT e MDF-e' : `${total} pendência(s) para CIOT/MDF-e`}
                </p>
            </div>
            {!registry.canEdit ? (
                <p className="mb-2 rounded-lg bg-tower-100 p-3 text-[13px] text-tower-600 dark:bg-tower-800 dark:text-tower-300">
                    Cadastrado por outro hub: somente leitura. Use-o numa viagem deste hub para poder completar.
                </p>
            ) : null}
            {error ? <OsErrorNotice message={error} /> : null}

            <OsSectionTitle>Transportador</OsSectionTitle>
            <OsRow tone={registry.carrierIssues.length ? 'bad' : 'ok'} onClick={() => edit({ kind: 'carrier' })}>
                <div className="flex items-center justify-between gap-2 pr-1">
                    <p className="truncate font-semibold text-tower-900 dark:text-white">Dados e endereço</p>
                    <Status issues={registry.carrierIssues} />
                </div>
                <p className="mt-0.5 truncate text-[13px] text-tower-500">
                    {registry.carrierIssues.join(', ') || [registry.link.person?.city, registry.link.person?.state].filter(Boolean).join('/')}
                </p>
            </OsRow>

            <OsSectionTitle>Veículo</OsSectionTitle>
            <div className="flex flex-col gap-2.5">
                {registry.units.map((u) => (
                    <OsRow key={u.plate} tone={u.issues.length ? 'bad' : 'ok'} onClick={() => edit({ kind: 'unit', role: u.role, unit: u })}>
                        <div className="flex items-center justify-between gap-2 pr-1">
                            <p className="truncate font-semibold text-tower-900 dark:text-white">
                                <span className="font-mono">{u.plate}</span> · {u.role === 'TRACTION' ? 'cavalo' : 'reboque'}
                            </p>
                            <Status issues={u.issues} />
                        </div>
                        {u.issues.length ? <p className="mt-0.5 truncate text-[13px] text-tower-500">Falta: {u.issues.join(', ')}</p> : null}
                    </OsRow>
                ))}
                {registry.canEdit && !traction ? (
                    <OsButton variant="secondary" onClick={() => edit({ kind: 'unit', role: 'TRACTION', unit: null })}>
                        Cadastrar cavalo / veículo
                    </OsButton>
                ) : null}
                {registry.canEdit && traction && trailers.length < 3 ? (
                    <OsButton variant="secondary" onClick={() => edit({ kind: 'unit', role: 'TRAILER', unit: null })}>
                        Adicionar reboque
                    </OsButton>
                ) : null}
            </div>

            <OsSectionTitle>Motoristas</OsSectionTitle>
            <div className="flex flex-col gap-2.5">
                {registry.drivers.length === 0 ? <OsEmpty title="Nenhum motorista" detail="Cadastre quem vai dirigir — obrigatório para CIOT e MDF-e." /> : null}
                {registry.drivers.map((d) => (
                    <OsRow key={d.id} tone={d.issues.length ? 'bad' : 'ok'} onClick={() => edit({ kind: 'driver', driver: d })}>
                        <div className="flex items-center justify-between gap-2 pr-1">
                            <p className="truncate font-semibold text-tower-900 dark:text-white">{d.name}</p>
                            <Status issues={d.issues} />
                        </div>
                        {d.issues.length ? <p className="mt-0.5 truncate text-[13px] text-tower-500">Falta: {d.issues.join(', ')}</p> : null}
                    </OsRow>
                ))}
                {registry.canEdit ? (
                    <OsButton variant="secondary" onClick={() => edit({ kind: 'driver', driver: null })}>
                        Adicionar motorista
                    </OsButton>
                ) : null}
            </div>

            {tripId ? (
                <OsActionBar>
                    <OsButton full onClick={() => navigate(`/hubs/viagens/${tripId}`)}>
                        Voltar para a viagem
                    </OsButton>
                </OsActionBar>
            ) : null}

            {editing?.kind === 'carrier' ? (
                <CarrierInfoEditor registry={registry} onClose={() => setEditing(null)} onSaved={() => void afterSave()} />
            ) : editing?.kind === 'unit' ? (
                <UnitEditor registry={registry} unit={editing.unit} role={editing.role} onClose={() => setEditing(null)} onSaved={() => void afterSave()} />
            ) : editing?.kind === 'driver' ? (
                <DriverEditor
                    linkId={registry.link.id}
                    driver={editing.driver}
                    onClose={() => setEditing(null)}
                    onSaved={(driverId) => void afterSave(editing.driver ? undefined : driverId)}
                />
            ) : null}
        </div>
    );
};

export default CarrierPage;
