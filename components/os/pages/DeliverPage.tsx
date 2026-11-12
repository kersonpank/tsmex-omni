import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { hubCargoApi, manifestsApi } from '../../../lib/api';
import type { DeliveryProgress, Manifest } from '../../../types/index';
import { useOs } from '../OsContext';
import { concludePlan, deliveryTripsForHub, legState, legStatusLine, tripSummary } from '../lib/delivery';
import { OsBadge, OsButton, OsCard, OsEmpty, OsErrorNotice, OsSectionTitle, OsSkeletonRows } from '../ui/kit';
import DeliveryAttemptSheet from './DeliveryAttemptSheet';

/**
 * ENTREGAR — pergunta única: "o que saiu para entrega e falta comprovar?"
 * Fila: viagens de entrega em rota deste hub, com os pedidos de cada uma.
 * Ação primária por pedido: Registrar entrega. Secundária: Não entregue.
 * Quando todos estão resolvidos: Concluir viagem (não entregues voltam ao estoque).
 */

interface TripEntry {
    manifest: Manifest;
    items: DeliveryProgress[];
}

const TripCard: React.FC<{
    entry: TripEntry;
    onAttempt: (manifestId: string, item: DeliveryProgress, mode: 'DELIVERED' | 'FAILED') => void;
    onConclude: (entry: TripEntry) => void;
    concluding: boolean;
}> = ({ entry, onAttempt, onConclude, concluding }) => {
    const { manifest, items } = entry;
    const summary = tripSummary(items);
    return (
        <OsCard className="!p-3.5">
            <div className="flex items-center justify-between gap-2">
                <p className="truncate font-semibold text-tower-900 dark:text-white">
                    {manifest.origin} → {manifest.destination}
                </p>
                <OsBadge tone={summary.readyToConclude ? 'ok' : 'route'}>
                    {summary.delivered + summary.notDelivered}/{summary.total}
                </OsBadge>
            </div>
            <p className="mt-0.5 text-[13px] text-tower-500 dark:text-tower-400">
                {manifest.link?.name ?? 'transportador a confirmar'}
                {summary.pending > 0 ? ` · faltam ${summary.pending} pedido(s)` : ' · tudo registrado'}
            </p>
            <div className="mt-3 flex flex-col gap-2.5">
                {items.map((item) => {
                    const state = legState(item);
                    return (
                        <div key={item.legId} className="rounded-lg border border-tower-200 p-3 dark:border-tower-700">
                            <p className="font-semibold text-tower-900 dark:text-white">
                                {item.recipientName ?? `Pedido ${item.orderNumber}`}
                                {item.nfNumber ? <span className="ml-1.5 font-mono text-[13px] font-medium text-tower-500">NF {item.nfNumber}</span> : null}
                            </p>
                            <p className="text-[13px] text-tower-500 dark:text-tower-400">
                                {item.destinationLabel ?? item.destinationCity ?? 'Destino não informado'} · pedido {item.orderNumber}
                            </p>
                            <p className="mt-1 text-[13px] font-semibold text-tower-700 dark:text-tower-200">{legStatusLine(item)}</p>
                            {state !== 'DELIVERED' ? (
                                <div className="mt-2.5 grid grid-cols-[3fr_2fr] gap-2">
                                    <OsButton onClick={() => onAttempt(manifest.id, item, 'DELIVERED')}>Registrar entrega</OsButton>
                                    <OsButton variant="secondary" onClick={() => onAttempt(manifest.id, item, 'FAILED')}>Não entregue</OsButton>
                                </div>
                            ) : null}
                        </div>
                    );
                })}
            </div>
            {summary.readyToConclude ? (
                <OsButton full className="mt-3" disabled={concluding} onClick={() => onConclude(entry)}>
                    {concluding ? 'Concluindo…' : 'Concluir viagem'}
                </OsButton>
            ) : null}
        </OsCard>
    );
};

const DeliverPage: React.FC = () => {
    const navigate = useNavigate();
    const { hubId, refresh } = useOs();
    const [localWaiting, setLocalWaiting] = useState(0);
    const [entries, setEntries] = useState<TripEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [sheet, setSheet] = useState<{ manifestId: string; item: DeliveryProgress; mode: 'DELIVERED' | 'FAILED' } | null>(null);
    const [concludingId, setConcludingId] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!hubId) return;
        setLoading(true);
        setError(null);
        try {
            const body = await manifestsApi.list({ status: 'IN_PROGRESS' });
            const trips = deliveryTripsForHub(Array.isArray(body.data) ? body.data : [], hubId);
            const loaded = await Promise.all(
                trips.map(async (manifest) => ({ manifest, items: (await manifestsApi.deliveryProgress(manifest.id)).data ?? [] })),
            );
            const withItems = loaded.filter((entry) => entry.items.length > 0);
            setEntries(withItems);
            // Sem viagem de entrega em andamento: avisa se há pedido local parado em estoque (o caminho é montar a entrega).
            setLocalWaiting(0);
            if (withItems.length === 0) {
                try {
                    const queues = await hubCargoApi.queues(hubId);
                    const groups = Array.isArray(queues.data) ? queues.data : [];
                    setLocalWaiting(groups.filter((g) => g.kind === 'LOCAL').reduce((sum, g) => sum + g.orders.length, 0));
                } catch {
                    /* a dica é opcional */
                }
            }
        } catch {
            setError('Não foi possível carregar as entregas. Verifique a conexão e tente de novo.');
        } finally {
            setLoading(false);
        }
    }, [hubId]);

    useEffect(() => {
        void load();
    }, [load]);

    const conclude = async (entry: TripEntry) => {
        setConcludingId(entry.manifest.id);
        setActionError(null);
        try {
            const plan = concludePlan(entry.items);
            if (plan.kind === 'stops') {
                for (const stopId of plan.stopIds) await manifestsApi.completeStop(entry.manifest.id, stopId);
            } else {
                await manifestsApi.complete(entry.manifest.id);
            }
            await Promise.all([load(), refresh()]);
        } catch (e) {
            const message = (e as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
            setActionError(message?.error ?? message?.message ?? 'Não foi possível concluir a viagem. Os registros foram mantidos — tente de novo.');
            await load();
        } finally {
            setConcludingId(null);
        }
    };

    return (
        <div className="pb-6">
            <OsSectionTitle>Saiu para entrega</OsSectionTitle>
            {actionError ? (
                <div className="mb-3">
                    <OsErrorNotice message={actionError} />
                </div>
            ) : null}
            {loading ? (
                <OsSkeletonRows />
            ) : error ? (
                <OsErrorNotice message={error} onRetry={() => void load()} />
            ) : entries.length === 0 ? (
                <div className="flex flex-col gap-3">
                    <OsEmpty
                        title="Nada saiu para entrega"
                        detail="Quando uma viagem de entrega deste hub sair, os pedidos aparecem aqui para você comprovar."
                    />
                    {localWaiting > 0 ? (
                        <OsCard className="!p-4">
                            <p className="font-semibold text-tower-900 dark:text-white">{localWaiting} pedido(s) em estoque são entrega desta unidade</p>
                            <p className="mt-0.5 text-[13px] text-tower-500 dark:text-tower-400">Falta montar a viagem de entrega para eles saírem.</p>
                            <OsButton full className="mt-3" onClick={() => navigate('/hubs/viagens?grupo=local')}>Montar entrega</OsButton>
                        </OsCard>
                    ) : null}
                </div>
            ) : (
                <div className="flex flex-col gap-3">
                    {entries.map((entry) => (
                        <TripCard
                            key={entry.manifest.id}
                            entry={entry}
                            onAttempt={(manifestId, item, mode) => setSheet({ manifestId, item, mode })}
                            onConclude={(e) => void conclude(e)}
                            concluding={concludingId === entry.manifest.id}
                        />
                    ))}
                </div>
            )}
            {sheet ? (
                <DeliveryAttemptSheet
                    manifestId={sheet.manifestId}
                    item={sheet.item}
                    mode={sheet.mode}
                    onClose={() => setSheet(null)}
                    onDone={() => {
                        setSheet(null);
                        void load();
                    }}
                />
            ) : null}
        </div>
    );
};

export default DeliverPage;
