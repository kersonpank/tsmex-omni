import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { linksApi, manifestsApi } from '../../../../lib/api';
import type { Manifest, ManifestReadinessIssue } from '../../../../types/index';
import type { CarrierRegistry } from '../../lib/carrier';
import { groupOf } from '../../lib/trip';
import { completeTractionSuggestion, tripRegistryDrivers, tripRegistryUnits, type TripRegistryDriver, type TripRegistryUnit } from '../../lib/tripRegistry';
import { OsBadge, OsButton, OsEmpty, OsErrorNotice, OsRow, OsSectionTitle, OsSkeletonRows } from '../../ui/kit';
import OsSheet, { apiErrorMessage } from '../../ui/Sheet';
import CarrierInfoEditor from '../carrier/CarrierInfoEditor';
import DriverEditor from '../carrier/DriverEditor';
import UnitEditor from '../carrier/UnitEditor';
import CarrierPaymentEditor from './CarrierPaymentEditor';

type Editing = { kind: 'unit'; unit: TripRegistryUnit } | { kind: 'driver'; driver: TripRegistryDriver } | { kind: 'carrier' } | null;

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
}> = ({ manifestId, onClose, onUpdated }) => {
    const navigate = useNavigate();
    const [trip, setTrip] = useState<Manifest | null>(null);
    const [registry, setRegistry] = useState<CarrierRegistry | null>(null);
    const [issues, setIssues] = useState<ManifestReadinessIssue[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<Editing>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [manifest, readiness] = await Promise.all([manifestsApi.getById(manifestId), manifestsApi.readiness(manifestId)]);
            if (!manifest.data || !readiness.data) throw new Error('Cadastro indisponível');
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
    const suggestion = trip && registry ? completeTractionSuggestion(trip, registry) : null;
    const canEdit = Boolean(registry?.canEdit) && !busy;

    const useStandardTraction = async () => {
        if (!suggestion || busy) return;
        setBusy(true);
        setError(null);
        try {
            await manifestsApi.setVehicles(manifestId, suggestion);
            await afterSave();
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível trocar o cavalo desta viagem.'));
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
                            <OsRow key={unit.id ?? unit.plate} tone={unit.readinessIssues.some((issue) => issue.severity === 'blocking') ? 'bad' : unit.issues.length ? 'attention' : 'ok'}
                                onClick={canEdit && unit.id ? () => setEditing({ kind: 'unit', unit }) : undefined}>
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="font-semibold text-tower-900 dark:text-white">{unit.slot === 0 ? 'Cavalo' : 'Reboque'} <span className="font-mono">{unit.plate}</span></p>
                                    <PendingStatus issues={unit.readinessIssues} />
                                </div>
                                <MissingFields issues={unit.readinessIssues} />
                            </OsRow>
                        ))}
                        {units.length === 0 ? <OsEmpty title="Nenhum veículo nesta viagem" detail="Escolha a composição em Transportador e motorista." /> : null}
                    </div>
                    {suggestion ? (
                        <div className="mt-4 rounded-xl border border-tower-200 p-3 dark:border-tower-700">
                            <p className="text-[13px] leading-relaxed text-tower-700 dark:text-tower-200">
                                O transportador tem o cavalo {suggestion.traction.plate} com cadastro completo. Usar nesta viagem?
                            </p>
                            <OsButton full className="mt-3" disabled={!canEdit} onClick={() => void useStandardTraction()}>
                                {busy ? 'Trocando cavalo…' : `Usar ${suggestion.traction.plate} nesta viagem`}
                            </OsButton>
                            <p className="mt-2 text-[12px] text-tower-500">Os reboques desta viagem serão mantidos.</p>
                        </div>
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
