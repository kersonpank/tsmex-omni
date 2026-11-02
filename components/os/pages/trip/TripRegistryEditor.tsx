import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { linksApi, manifestsApi } from '../../../../lib/api';
import type { Manifest, ManifestReadinessIssue, TripCompositionSuggestion } from '../../../../types/index';
import { manifestPlates, type CarrierRegistry } from '../../lib/carrier';
import { groupOf } from '../../lib/trip';
import { carrierDefaultForTrip, suggestionTitle, tripRegistryDrivers, tripRegistryUnits, type TripRegistryDriver, type TripRegistryUnit } from '../../lib/tripRegistry';
import { OsBadge, OsButton, OsEmpty, OsErrorNotice, OsRow, OsSectionTitle, OsSkeletonRows } from '../../ui/kit';
import OsSheet, { apiErrorMessage } from '../../ui/Sheet';
import CarrierInfoEditor from '../carrier/CarrierInfoEditor';
import DriverEditor from '../carrier/DriverEditor';
import UnitEditor from '../carrier/UnitEditor';
import CarrierPaymentEditor from './CarrierPaymentEditor';
import TripCompositionPicker from './TripCompositionPicker';

type Editing =
    | { kind: 'unit'; unit: TripRegistryUnit }
    | { kind: 'driver'; driver: TripRegistryDriver }
    | { kind: 'carrier' }
    | { kind: 'plates'; mode: 'traction' | 'trailers' }
    | null;

const PendingStatus: React.FC<{ issues: ManifestReadinessIssue[] }> = ({ issues }) => {
    const blocking = issues.filter((issue) => issue.severity === 'blocking').length;
    return <OsBadge tone={blocking ? 'bad' : issues.length ? 'warn' : 'ok'}>
        {blocking ? `${blocking} bloqueio(s)` : issues.length ? `${issues.length} aviso(s)` : 'sem pendências'}
    </OsBadge>;
};

const MissingFields: React.FC<{ issues: ManifestReadinessIssue[] }> = ({ issues }) => issues.length ? (
    <ul className="mt-2 space-y-1 text-[13px] leading-snug text-tower-600 dark:text-tower-300">
        {issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}
    </ul>
) : null;

/** O cadastro da viagem sempre parte das assignments, nunca da composição padrão do transportador. */
const TripRegistryEditor: React.FC<{
    manifestId: string;
    onClose: () => void;
    onUpdated?: () => void | Promise<void>;
    /** Abre "Responsável e composição" (motoristas) sem sair da viagem. */
    onOpenResponsible?: () => void;
}> = ({ manifestId, onClose, onUpdated, onOpenResponsible }) => {
    const navigate = useNavigate();
    const [trip, setTrip] = useState<Manifest | null>(null);
    const [registry, setRegistry] = useState<CarrierRegistry | null>(null);
    const [issues, setIssues] = useState<ManifestReadinessIssue[]>([]);
    const [suggestion, setSuggestion] = useState<TripCompositionSuggestion | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<Editing>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            // A sugestão é complementar: se falhar, o cadastro continua utilizável.
            const loadSuggestion = async () => {
                try {
                    return (await manifestsApi.compositionSuggestion(manifestId))?.data ?? null;
                } catch {
                    return null;
                }
            };
            const [manifest, readiness, composition] = await Promise.all([manifestsApi.getById(manifestId), manifestsApi.readiness(manifestId), loadSuggestion()]);
            if (!manifest.data || !readiness.data) throw new Error('Cadastro indisponível');
            setSuggestion(composition);
            const carrier = manifest.data.linkId ? (await linksApi.registry(manifest.data.linkId)).data : null;
            setTrip(manifest.data);
            setIssues(readiness.data.issues);
            setRegistry(carrier);
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível carregar o cadastro desta viagem.'));
        } finally {
            setLoading(false);
        }
    }, [manifestId]);

    useEffect(() => { void load(); }, [load]);

    const afterSave = async () => {
        setEditing(null);
        await load();
        await onUpdated?.();
    };

    if (editing?.kind === 'plates' && trip) return (
        <TripCompositionPicker manifestId={manifestId} mode={editing.mode} plates={manifestPlates(trip.vehicleAssignments)}
            onClose={() => setEditing(null)} onBack={() => setEditing(null)} onSaved={afterSave} />
    );
    if (editing?.kind === 'unit' && registry) return (
        <UnitEditor mode="unit" registry={registry} unit={editing.unit} role={editing.unit.role}
            onClose={() => setEditing(null)} onSaved={() => void afterSave()} />
    );
    if (editing?.kind === 'driver' && registry) return (
        <DriverEditor linkId={registry.link.id} driver={editing.driver}
            onClose={() => setEditing(null)} onSaved={() => void afterSave()} />
    );
    if (editing?.kind === 'carrier' && registry) return (
        <CarrierInfoEditor registry={registry} onClose={() => setEditing(null)} onSaved={() => void afterSave()} />
    );

    const units = trip ? tripRegistryUnits(trip, issues) : [];
    const drivers = trip ? tripRegistryDrivers(trip, issues) : [];
    const mapped = new Set([...units, ...drivers].flatMap((item) => item.readinessIssues));
    const otherIssues = issues.filter((issue) => groupOf(issue) === 'registry' && !mapped.has(issue));
    const canEdit = Boolean(registry?.canEdit) && !busy;
    // Composição só muda enquanto a viagem é rascunho (o servidor recusa depois).
    const draft = trip?.status === 'DRAFT';
    const canChangePlates = draft && !busy;
    const trailerCount = units.filter((unit) => unit.slot > 0).length;
    // O cartão só troca placas: oferece quando as placas sugeridas diferem das da viagem.
    const tripPlates = trip ? manifestPlates(trip.vehicleAssignments) : null;
    const platesDiffer = Boolean(suggestion && tripPlates && carrierDefaultForTrip(
        [{ plate: suggestion.traction.plate, role: 'TRACTION' }, ...suggestion.trailers.map((trailer) => ({ plate: trailer.plate, role: 'TRAILER' as const }))],
        tripPlates,
    ));
    const offered = draft && suggestion && (units.length === 0 || platesDiffer) ? suggestion : null;

    const useSuggestion = async () => {
        if (!offered || busy) return;
        setBusy(true);
        setError(null);
        try {
            await manifestsApi.setVehicles(manifestId, {
                traction: { plate: offered.traction.plate },
                trailers: offered.trailers.map((trailer) => ({ plate: trailer.plate })),
            });
            await afterSave();
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível usar a composição sugerida.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <OsSheet title="Cadastro do veículo e motorista" subtitle="Composição usada nesta viagem" onClose={onClose}>
            {error ? <OsErrorNotice message={error} onRetry={() => void load()} /> : null}
            {loading ? <OsSkeletonRows count={3} /> : trip ? (
                <>
                    <p className="mt-2 text-[13px] text-tower-500 dark:text-tower-300">
                        Toque na placa ou no motorista para completar os dados. Ao salvar, as pendências da viagem são atualizadas.
                    </p>
                    <OsSectionTitle>Veículos desta viagem</OsSectionTitle>
                    <div className="flex flex-col gap-2.5">
                        {units.map((unit) => (
                            <div key={unit.id ?? unit.plate}>
                                <OsRow tone={unit.readinessIssues.some((issue) => issue.severity === 'blocking') ? 'bad' : unit.issues.length ? 'attention' : 'ok'}
                                    onClick={canEdit && unit.id ? () => setEditing({ kind: 'unit', unit }) : undefined}>
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <p className="font-semibold text-tower-900 dark:text-white">{unit.slot === 0 ? 'Cavalo' : 'Reboque'} <span className="font-mono">{unit.plate}</span></p>
                                        <PendingStatus issues={unit.readinessIssues} />
                                    </div>
                                    <MissingFields issues={unit.readinessIssues} />
                                </OsRow>
                                {draft ? (
                                    <button type="button" disabled={!canChangePlates}
                                        onClick={() => setEditing({ kind: 'plates', mode: unit.slot === 0 ? 'traction' : 'trailers' })}
                                        className="mt-1 min-h-[40px] px-2 text-[13px] font-bold text-brand-600 disabled:opacity-40 dark:text-brand-300">
                                        Trocar placa
                                    </button>
                                ) : null}
                            </div>
                        ))}
                        {units.length === 0 ? <OsEmpty title="Nenhum veículo nesta viagem" detail="Use a composição sugerida ou informe o cavalo." /> : null}
                    </div>
                    {offered ? (
                        <div className="mt-4 rounded-xl border-2 border-brand-500 bg-brand-500/8 p-3.5">
                            <p className="text-[14px] font-bold text-tower-900 dark:text-white">{suggestionTitle(offered)}</p>
                            {offered.drivers.length ? (
                                <p className="mt-1 text-[12px] text-tower-600 dark:text-tower-300">Motorista da referência: {offered.drivers.map((driver) => driver.name).join(', ')}</p>
                            ) : null}
                            <OsButton full className="mt-3" disabled={!canChangePlates} onClick={() => void useSuggestion()}>
                                {busy ? 'Aplicando…' : 'Usar esta composição'}
                            </OsButton>
                            {units.length > 0 ? <p className="mt-2 text-[12px] text-tower-500">Substitui o cavalo e os implementos desta viagem.</p> : null}
                        </div>
                    ) : null}
                    {draft && units.length === 0 ? (
                        <OsButton full variant="secondary" className="mt-3" disabled={!canChangePlates} onClick={() => setEditing({ kind: 'plates', mode: 'traction' })}>
                            Informar cavalo
                        </OsButton>
                    ) : null}
                    {draft && units.length > 0 && trailerCount < 3 ? (
                        <OsButton full variant="secondary" className="mt-3" disabled={!canChangePlates} onClick={() => setEditing({ kind: 'plates', mode: 'trailers' })}>
                            Adicionar implemento
                        </OsButton>
                    ) : null}
                    <OsSectionTitle>Motoristas desta viagem</OsSectionTitle>
                    <div className="flex flex-col gap-2.5">
                        {drivers.map((driver) => (
                            <OsRow key={driver.id} tone={driver.readinessIssues.some((issue) => issue.severity === 'blocking') ? 'bad' : driver.issues.length ? 'attention' : 'ok'}
                                onClick={canEdit ? () => setEditing({ kind: 'driver', driver }) : undefined}>
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="font-semibold text-tower-900 dark:text-white">{driver.name}</p>
                                    <PendingStatus issues={driver.readinessIssues} />
                                </div>
                                <MissingFields issues={driver.readinessIssues} />
                            </OsRow>
                        ))}
                        {drivers.length === 0 ? <OsEmpty title="Nenhum motorista nesta viagem" detail="Escolha quem vai dirigir em Transportador e motorista." /> : null}
                    </div>
                    {draft && onOpenResponsible ? (
                        <OsButton full variant="secondary" className="mt-3" disabled={busy} onClick={onOpenResponsible}>
                            Trocar ou adicionar motorista
                        </OsButton>
                    ) : null}
                    {otherIssues.length ? (
                        <div className="mt-4">
                            <MissingFields issues={otherIssues} />
                            {registry ? <OsButton full variant="secondary" className="mt-3" disabled={!canEdit} onClick={() => setEditing({ kind: 'carrier' })}>Completar dados do transportador</OsButton> : null}
                        </div>
                    ) : null}
                    {registry ? (
                        <>
                            <OsSectionTitle>Dados bancários</OsSectionTitle>
                            <CarrierPaymentEditor key={registry.link.id} registry={registry} onSaved={afterSave} />
                            <OsButton full variant="secondary" className="mt-3" disabled={!canEdit} onClick={() => setEditing({ kind: 'carrier' })}>Editar dados do transportador</OsButton>
                        </>
                    ) : null}
                    {registry ? (
                        <OsButton full variant="ghost" className="mt-4" disabled={busy}
                            onClick={() => navigate(`/hubs/transportadores/${registry.link.id}?viagem=${manifestId}`)}>
                            Ver cadastro do transportador (composição padrão)
                        </OsButton>
                    ) : null}
                </>
            ) : null}
        </OsSheet>
    );
};

export default TripRegistryEditor;
