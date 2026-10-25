import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { linksApi, manifestsApi } from '../../../../lib/api';
import type { Manifest, ManifestReadiness } from '../../../../types/index';
import type { CarrierRegistry, RegistryDriver, RegistryUnit } from '../../lib/carrier';
import { tripRegistryUnits } from '../../lib/tripRegistry';
import { OsActionBar, OsBadge, OsButton, OsEmpty, OsErrorNotice, OsRow, OsSectionTitle, OsSkeletonRows } from '../../ui/kit';
import CarrierInfoEditor from './CarrierInfoEditor';
import DriverEditor from './DriverEditor';
import UnitEditor from './UnitEditor';

/**
 * FICHA DO TRANSPORTADOR — "o que falta para este transportador rodar com CIOT e MDF-e?"
 * Transportador, cada placa e cada motorista, com as pendências calculadas pelo backend
 * (mesmas regras do motor de pendências e da emissão). A composição padrão do transportador
 * é independente das placas e dos motoristas escolhidos em cada viagem.
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
    const [trip, setTrip] = useState<Manifest | null>(null);
    const [readiness, setReadiness] = useState<ManifestReadiness | null>(null);
    const [tripError, setTripError] = useState(false);

    const load = useCallback(async () => {
        const tripData = tripId
            ? Promise.all([manifestsApi.getById(tripId), manifestsApi.readiness(tripId)])
                .then(([manifestBody, readinessBody]) => {
                    setTrip(manifestBody.data);
                    setReadiness(readinessBody.data);
                    setTripError(false);
                })
                .catch(() => {
                    setTrip(null);
                    setReadiness(null);
                    setTripError(true);
                })
            : Promise.resolve();
        try {
            const body = await linksApi.registry(linkId);
            setRegistry(body.data);
            setError(null);
            return body.data;
        } catch {
            setError('Não foi possível carregar o transportador.');
            return null;
        } finally {
            await tripData;
            setLoading(false);
        }
    }, [linkId, tripId]);

    useEffect(() => {
        void load();
    }, [load]);

    const afterSave = async () => {
        setEditing(null);
        await load();
    };

    if (loading) return <OsSkeletonRows count={4} />;
    if (!registry) return <OsErrorNotice message={error ?? 'Transportador não encontrado.'} onRetry={() => void load()} />;

    const traction = registry.units.find((u) => u.role === 'TRACTION') ?? null;
    const trailers = registry.units.filter((u) => u.role === 'TRAILER');
    const tripTraction = trip ? tripRegistryUnits(trip, readiness?.issues ?? []).find((unit) => unit.slot === 0) : null;
    const total =
        registry.carrierIssues.length +
        registry.units.reduce((n, u) => n + u.issues.length, 0) +
        (registry.drivers.length ? registry.drivers.reduce((n, d) => n + d.issues.length, 0) : 1);
    const edit = (e: Editing) => registry.canEdit && setEditing(e);

    return (
        <div className="pb-36">
            <div className="mb-2 rounded-xl bg-brand-500 p-4 text-white dark:bg-brand-600">
                <p className="mb-1 text-[12px] font-semibold text-brand-100">Cadastro do transportador (composição padrão)</p>
                <p className="font-display text-[17px] font-bold">{registry.link.name}</p>
                <p className="text-[13px] text-brand-100">
                    {registry.link.document} · {total === 0 ? 'cadastro padrão completo' : `${total} pendência(s) no cadastro padrão`}
                </p>
            </div>
            {tripId ? (
                <div className="mb-3 rounded-xl bg-tower-100 p-3 text-[13px] text-tower-600 dark:bg-tower-800 dark:text-tower-300">
                    <p>
                        {tripTraction
                            ? `Nesta viagem: cavalo ${tripTraction.plate} — ${tripTraction.issues.length ? 'dados incompletos' : 'cadastro completo'}`
                            : tripError ? 'Não foi possível conferir o cadastro desta viagem.' : 'Nesta viagem: cavalo ainda não definido.'}
                    </p>
                    <button type="button" className="mt-1.5 font-bold text-brand-600 underline underline-offset-2 dark:text-brand-300" onClick={() => navigate(`/hubs/viagens/${tripId}?cadastro=1`)}>
                        Ver cadastro desta viagem
                    </button>
                </div>
            ) : null}
            {!registry.canEdit ? (
                <p className="mb-2 rounded-lg bg-tower-100 p-3 text-[13px] text-tower-600 dark:bg-tower-800 dark:text-tower-300">
                    Cadastrado por outro hub: somente leitura. Use-o numa viagem deste hub para poder completar.
                </p>
            ) : null}
            {error ? <OsErrorNotice message={error} /> : null}

            <OsSectionTitle>Dados do transportador</OsSectionTitle>
            <OsRow tone={registry.carrierIssues.length ? 'bad' : 'ok'} onClick={() => edit({ kind: 'carrier' })}>
                <div className="flex items-center justify-between gap-2 pr-1">
                    <p className="truncate font-semibold text-tower-900 dark:text-white">Dados e endereço</p>
                    <Status issues={registry.carrierIssues} />
                </div>
                <p className="mt-0.5 truncate text-[13px] text-tower-500">
                    {registry.carrierIssues.join(', ') || [registry.link.person?.city, registry.link.person?.state].filter(Boolean).join('/')}
                </p>
            </OsRow>

            <OsSectionTitle>Veículos da composição padrão</OsSectionTitle>
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

            <OsSectionTitle>Motoristas do transportador</OsSectionTitle>
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
                    onSaved={() => void afterSave()}
                />
            ) : null}
        </div>
    );
};

export default CarrierPage;
