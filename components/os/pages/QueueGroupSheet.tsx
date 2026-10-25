import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { hubCargoApi, hubsApi, vehicleTypesApi } from '../../../lib/api';
import type { ConsolidationQueueGroup, Hub, VehicleType } from '../../../types/index';
import { docBadge, isDocumented, vehicleFit } from '../lib/readiness';
import { OsBadge, OsButton } from '../ui/kit';
import { IconX } from '../ui/icons';

/**
 * Montagem de viagem a partir da fila: escolhe pedidos (documentados por padrão) e o tipo de
 * veículo. O servidor recalcula a fila, cria a viagem, adiciona os pedidos pelo motor
 * (capacidade/elegibilidade) e grava o feedback sugerido × final. A viagem abre na
 * estação Preparar e despachar do O.S.
 */

const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

const orderName = (o: { orderNumber: number | null; nfNumber: string | null }) =>
    `${o.orderNumber ? `Pedido ${o.orderNumber}` : 'Pedido'}${o.nfNumber ? ` · NF ${o.nfNumber}` : ''}`;

const QueueGroupSheet: React.FC<{
    group: ConsolidationQueueGroup;
    hubId: string;
    canCreateTrip: boolean;
    onClose: () => void;
    onCreated: (manifestId: string) => void;
}> = ({ group, hubId, canCreateTrip, onClose, onCreated }) => {
    const [types, setTypes] = useState<VehicleType[]>([]);
    const [vehicleTypeId, setVehicleTypeId] = useState('');
    const [hubs, setHubs] = useState<Hub[]>([]);
    const [destinationChoice, setDestinationChoice] = useState('');
    const [hubsLoading, setHubsLoading] = useState(false);
    const [hubsError, setHubsError] = useState(false);
    const [hubsReload, setHubsReload] = useState(0);
    const navigate = useNavigate();
    // Só pedido com documento do frete emitido viaja por padrão; o operador ainda pode marcar os demais.
    const [picked, setPicked] = useState<Set<string>>(
        () => new Set(group.orders.filter((o) => isDocumented(o.freightDocState)).map((o) => o.orderId)),
    );
    const undocumentedCount = group.orders.filter((o) => !isDocumented(o.freightDocState)).length;
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [partial, setPartial] = useState<{
        manifestId: string;
        added: number;
        failures: { label: string; message: string }[];
    } | null>(null);

    useEffect(() => {
        let cancelled = false;
        vehicleTypesApi
            .list()
            .then((body) => {
                if (cancelled) return;
                const rows = (Array.isArray(body.data) ? body.data : []).filter((t) => t.active !== false);
                setTypes(rows);
            })
            .catch(() => {
                if (!cancelled) setError('Não foi possível carregar os tipos de veículo.');
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (group.kind !== 'UNROUTED') return;
        let cancelled = false;
        setHubsLoading(true);
        setHubsError(false);
        hubsApi
            .list()
            .then((body) => {
                if (!cancelled) {
                    setHubs((Array.isArray(body.data) ? body.data : []).filter((h) => h.active && h.id !== hubId));
                }
            })
            .catch(() => {
                if (!cancelled) setHubsError(true);
            })
            .finally(() => {
                if (!cancelled) setHubsLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [group.kind, hubId, hubsReload]);

    const pickedOrders = useMemo(() => group.orders.filter((o) => picked.has(o.orderId)), [group.orders, picked]);
    const pickedWeight = pickedOrders.reduce((acc, o) => acc + o.weightKg, 0);
    const pickedVolume = pickedOrders.reduce((acc, o) => acc + o.volumeM3, 0);
    const fitOf = (t: VehicleType) => vehicleFit(pickedWeight, pickedVolume, t);
    const routeReady = group.kind !== 'UNROUTED' || destinationChoice === 'local' || hubs.some((h) => h.id === destinationChoice);

    const toggle = (orderId: string) =>
        setPicked((prev) => {
            const next = new Set(prev);
            if (next.has(orderId)) next.delete(orderId);
            else next.add(orderId);
            return next;
        });

    const create = async () => {
        if (!canCreateTrip || busy || pickedOrders.length === 0 || !vehicleTypeId || !routeReady) return;
        setBusy(true);
        setError(null);
        try {
            const body = await hubCargoApi.consolidate({
                groupKey: group.key,
                orderIds: pickedOrders.map((o) => o.orderId),
                vehicleTypeId,
                hubId,
                ...(group.kind === 'UNROUTED'
                    ? destinationChoice === 'local'
                        ? { local: true }
                        : { destHubId: destinationChoice }
                    : {}),
            });
            const result = body.data;
            if (result.failed.length > 0) {
                // Viagem criada, mas o motor recusou parte (capacidade/elegibilidade): mostrar TODAS as falhas e
                // deixar o operador decidir quando abrir a viagem — nunca fechar sozinho.
                const labelOf = new Map(group.orders.map((o) => [o.orderId, orderName(o)]));
                setPartial({
                    manifestId: result.manifestId,
                    added: result.added.length,
                    failures: result.failed.map((f) => ({
                        label: labelOf.get(f.orderId) ?? `Pedido ${f.orderId.slice(0, 8)}`,
                        message: f.message,
                    })),
                });
                setBusy(false);
                return;
            }
            onCreated(result.manifestId);
        } catch (cause) {
            const message = (cause as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
            setError(message?.error ?? message?.message ?? 'Não foi possível criar a viagem. Tente de novo.');
            setBusy(false);
        }
    };

    const title =
        group.kind === 'TRANSFER'
            ? `Transferência → ${group.destHubName ?? ''}`
            : group.kind === 'LOCAL'
              ? 'Entrega local'
              : 'Sem rota definida';

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose}>
            <div
                className="flex max-h-[88vh] w-full max-w-xl flex-col rounded-t-2xl bg-white dark:bg-tower-900"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-3 p-4 pb-2">
                    <div>
                        <p className="font-display text-[17px] font-bold text-tower-900 dark:text-white">{title}</p>
                        <p className="text-[13px] text-tower-500 dark:text-tower-300">
                            {pickedOrders.length} de {group.orders.length} pedido(s) · {nf0.format(pickedWeight)} kg
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Fechar"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-tower-100 text-tower-600 active:bg-tower-200 dark:bg-tower-800 dark:text-tower-300"
                    >
                        <IconX size={18} />
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-4">
                    {group.kind === 'UNROUTED' ? (
                        <div className="mb-4">
                            <p className="mb-3 rounded-lg bg-brand-yellow-400/15 p-3 text-[13px] text-tower-700 dark:text-tower-200">
                                Escolha o destino desta viagem. Configure a Cobertura no modo torre para a fila rotear automaticamente nas próximas vezes.
                            </p>
                            <label htmlFor="queue-destination" className="mb-1.5 block text-[13px] font-bold text-tower-600 dark:text-tower-300">
                                Destino da viagem
                            </label>
                            <select
                                id="queue-destination"
                                value={destinationChoice}
                                onChange={(e) => setDestinationChoice(e.target.value)}
                                disabled={busy || !!partial}
                                className="h-[48px] w-full rounded-xl border-2 border-tower-200 bg-white px-3 text-[14px] text-tower-900 focus:border-brand-400 focus:outline-none dark:border-tower-600 dark:bg-tower-900 dark:text-white"
                            >
                                <option value="">Escolha o destino</option>
                                <option value="local">Entrega local (sem hub destino)</option>
                                {hubs.map((h) => (
                                    <option key={h.id} value={h.id}>
                                        {h.name} · {h.code} · {h.city}/{h.state}
                                    </option>
                                ))}
                            </select>
                            {hubsLoading ? <p className="mt-2 text-[13px] text-tower-500 dark:text-tower-400">Carregando hubs…</p> : null}
                            {hubsError ? (
                                <div className="mt-2 text-[13px] text-brand-red-600 dark:text-brand-red-400">
                                    <p>Não foi possível carregar os hubs. Tente de novo ou escolha entrega local.</p>
                                    <button type="button" onClick={() => setHubsReload((n) => n + 1)} className="min-h-[40px] font-bold underline">
                                        Tentar de novo
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                    {undocumentedCount > 0 ? (
                        <p className="mb-2 rounded-lg border-l-4 border-brand-yellow-400 bg-brand-yellow-400/15 p-3 text-[13px] text-tower-700 dark:text-tower-200">
                            {undocumentedCount} pedido(s) sem documento do frete ficaram de fora. Emita o CT-e/minuta no pedido para incluir.
                        </p>
                    ) : null}
                    <div className="flex flex-col gap-2">
                        {group.orders.map((o) => {
                            const doc = docBadge(o.freightDocState);
                            return (
                            <label
                                key={o.orderId}
                                className="flex min-h-[52px] cursor-pointer items-center gap-3 rounded-xl border border-tower-200 bg-white p-3 dark:border-tower-700 dark:bg-tower-900"
                            >
                                <input
                                    type="checkbox"
                                    checked={picked.has(o.orderId)}
                                    onChange={() => toggle(o.orderId)}
                                    className="h-5 w-5 accent-[#2e3192]"
                                />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[14px] font-semibold text-tower-900 dark:text-white">
                                        {orderName(o)}
                                    </span>
                                    <span className="block truncate text-[12px] text-tower-500 dark:text-tower-400">
                                        {o.destination ?? 'destino não informado'} · {nf0.format(o.weightKg)} kg · {nf2.format(o.volumeM3)} m³
                                    </span>
                                    <span className="mt-1 flex items-center gap-2">
                                        <OsBadge tone={doc.tone}>{doc.label}</OsBadge>
                                        {!isDocumented(o.freightDocState) ? (
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    navigate(`/hubs/pedidos/${o.orderId}`);
                                                }}
                                                className="min-h-[32px] text-[12px] font-bold text-brand-600 underline dark:text-brand-300"
                                            >
                                                abrir pedido
                                            </button>
                                        ) : null}
                                    </span>
                                </span>
                            </label>
                            );
                        })}
                    </div>

                    <p className="mb-1.5 mt-4 text-[13px] font-bold text-tower-600 dark:text-tower-300">
                        Tipo de veículo
                    </p>
                    <div className="flex flex-col gap-2 pb-3">
                        {types.map((t) => (
                            <label
                                key={t.id}
                                className={`flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border-2 p-3 ${
                                    vehicleTypeId === t.id
                                        ? 'border-brand-500 bg-brand-500/8 dark:bg-brand-500/15'
                                        : 'border-tower-200 dark:border-tower-700'
                                }`}
                            >
                                <input
                                    type="radio"
                                    name="vt"
                                    checked={vehicleTypeId === t.id}
                                    onChange={() => setVehicleTypeId(t.id)}
                                    className="h-5 w-5 accent-[#2e3192]"
                                />
                                <span className="min-w-0 flex-1 text-[14px] font-semibold text-tower-900 dark:text-white">
                                    {t.name}
                                </span>
                                <OsBadge tone={fitOf(t) === 'ok' ? 'ok' : 'bad'}>
                                    {fitOf(t) === 'ok'
                                        ? `cabe · ${nf0.format(t.maxWeight)} kg`
                                        : fitOf(t) === 'weight'
                                          ? 'não cabe (peso)'
                                          : 'não cabe (m³)'}
                                </OsBadge>
                            </label>
                        ))}
                    </div>
                </div>

                <div className="border-t border-tower-200 p-4 pb-[max(env(safe-area-inset-bottom),16px)] dark:border-tower-800">
                    {partial ? (
                        <div className="mb-3 rounded-lg bg-brand-yellow-400/20 p-3 text-[13px] text-tower-800 dark:text-tower-100">
                            <p className="font-bold">
                                Viagem criada com {partial.added} de {partial.added + partial.failures.length} pedido(s). Ficaram de fora:
                            </p>
                            <ul className="mt-1.5 flex flex-col gap-1">
                                {partial.failures.map((f, i) => (
                                    <li key={`${f.label}-${i}`}>
                                        <span className="font-semibold">{f.label}</span> — {f.message}
                                    </li>
                                ))}
                            </ul>
                            <div className="mt-3">
                                <OsButton full onClick={() => onCreated(partial.manifestId)}>
                                    Abrir viagem
                                </OsButton>
                            </div>
                        </div>
                    ) : null}
                    {error ? (
                        <p className="mb-3 rounded-lg bg-brand-red-500/10 p-3 text-[13px] font-semibold text-brand-red-600 dark:text-brand-red-400">
                            {error}
                        </p>
                    ) : null}
                    {!partial ? (
                        <OsButton
                            full
                            disabled={!canCreateTrip || busy || pickedOrders.length === 0 || !vehicleTypeId || !routeReady}
                            onClick={() => void create()}
                        >
                            {busy ? 'Criando viagem…' : `Criar viagem com ${pickedOrders.length} pedido(s)`}
                        </OsButton>
                    ) : null}
                </div>
            </div>
        </div>
    );
};

export default QueueGroupSheet;
