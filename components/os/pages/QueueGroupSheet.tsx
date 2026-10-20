import React, { useEffect, useMemo, useState } from 'react';
import { hubCargoApi, vehicleTypesApi } from '../../../lib/api';
import type { ConsolidationQueueGroup, VehicleType } from '../../../types/index';
import { OsBadge, OsButton } from '../ui/kit';
import { IconX } from '../ui/icons';

/**
 * Montagem de viagem a partir da fila: escolhe pedidos (todos por padrão) e o tipo de
 * veículo. O servidor recalcula a fila, cria a viagem, adiciona os pedidos pelo motor
 * (capacidade/elegibilidade) e grava o feedback sugerido × final. A viagem abre na
 * estação Preparar e despachar do O.S.
 */

const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

const QueueGroupSheet: React.FC<{
    group: ConsolidationQueueGroup;
    hubId: string;
    canCreateTrip: boolean;
    onClose: () => void;
    onCreated: (manifestId: string) => void;
}> = ({ group, hubId, canCreateTrip, onClose, onCreated }) => {
    const [types, setTypes] = useState<VehicleType[]>([]);
    const [vehicleTypeId, setVehicleTypeId] = useState('');
    const [picked, setPicked] = useState<Set<string>>(() => new Set(group.orders.map((o) => o.orderId)));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

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

    const pickedOrders = useMemo(() => group.orders.filter((o) => picked.has(o.orderId)), [group.orders, picked]);
    const pickedWeight = pickedOrders.reduce((acc, o) => acc + o.weightKg, 0);
    const fits = (t: VehicleType) => pickedWeight <= t.maxWeight;

    const toggle = (orderId: string) =>
        setPicked((prev) => {
            const next = new Set(prev);
            if (next.has(orderId)) next.delete(orderId);
            else next.add(orderId);
            return next;
        });

    const create = async () => {
        if (!canCreateTrip || busy || pickedOrders.length === 0 || !vehicleTypeId) return;
        setBusy(true);
        setError(null);
        try {
            const body = await hubCargoApi.consolidate({
                groupKey: group.key,
                orderIds: pickedOrders.map((o) => o.orderId),
                vehicleTypeId,
                hubId,
            });
            const result = body.data;
            if (result.failed.length > 0) {
                // Viagem criada, mas o motor recusou parte (capacidade/elegibilidade): avisar, nunca silenciar.
                setError(
                    `Viagem criada com ${result.added.length} de ${pickedOrders.length} pedido(s). ${result.failed[0].message}`,
                );
                window.setTimeout(() => onCreated(result.manifestId), 2200);
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

                {group.kind === 'UNROUTED' ? (
                    <p className="mx-4 mb-4 rounded-lg border-l-4 border-brand-red-500 bg-brand-red-500/8 p-3 text-[13px] text-brand-red-700 dark:text-brand-red-400">
                        Estes pedidos não têm próximo salto: falta a cidade destino (IBGE) no pedido ou nenhum hub cobre a
                        cidade. Defina a cobertura do hub destino na gestão — a fila se corrige sozinha.
                    </p>
                ) : null}

                <div className="min-h-0 flex-1 overflow-y-auto px-4">
                    <div className="flex flex-col gap-2">
                        {group.orders.map((o) => (
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
                                        {o.orderNumber ? `Pedido ${o.orderNumber}` : 'Pedido'}
                                        {o.nfNumber ? ` · NF ${o.nfNumber}` : ''}
                                    </span>
                                    <span className="block truncate text-[12px] text-tower-500 dark:text-tower-400">
                                        {o.destination ?? 'destino não informado'} · {nf0.format(o.weightKg)} kg
                                    </span>
                                </span>
                            </label>
                        ))}
                    </div>

                    {group.kind !== 'UNROUTED' ? (
                        <>
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
                                        <OsBadge tone={fits(t) ? 'ok' : 'bad'}>
                                            {fits(t) ? `cabe · ${nf0.format(t.maxWeight)} kg` : 'não cabe'}
                                        </OsBadge>
                                    </label>
                                ))}
                            </div>
                        </>
                    ) : null}
                </div>

                <div className="border-t border-tower-200 p-4 pb-[max(env(safe-area-inset-bottom),16px)] dark:border-tower-800">
                    {error ? (
                        <p className="mb-3 rounded-lg bg-brand-red-500/10 p-3 text-[13px] font-semibold text-brand-red-600 dark:text-brand-red-400">
                            {error}
                        </p>
                    ) : null}
                    {group.kind !== 'UNROUTED' ? (
                        <OsButton
                            full
                            disabled={!canCreateTrip || busy || pickedOrders.length === 0 || !vehicleTypeId}
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
