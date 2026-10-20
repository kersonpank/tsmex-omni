import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { manifestsApi, ordersApi } from '../../../lib/api';
import { useOs } from '../OsContext';
import {
    arrivalStopForHub,
    canConclude,
    divergenceDescription,
    ordersToUnload,
    summarizeConference,
    type ConferenceMark,
    type ManifestWithLegs,
} from '../lib/arrival';
import { OsActionBar, OsBadge, OsButton, OsCard, OsEmpty, OsErrorNotice, OsSpinner } from '../ui/kit';

/**
 * RECEBER VIAGEM — conferência da descarga, pedido a pedido.
 * Regra da estação: divergência nunca encerra em silêncio (gera evento no
 * histórico do pedido, com ator da sessão, antes de concluir a descarga).
 */

const MARKS: Array<{ mark: ConferenceMark; label: string; tone: 'ok' | 'warn' | 'bad' }> = [
    { mark: 'OK', label: 'Chegou', tone: 'ok' },
    { mark: 'AVARIA', label: 'Avaria', tone: 'warn' },
    { mark: 'FALTA', label: 'Não chegou', tone: 'bad' },
];

const TripReceivePage: React.FC = () => {
    const { manifestId } = useParams<{ manifestId: string }>();
    const navigate = useNavigate();
    const { hubId, refresh } = useOs();
    const [manifest, setManifest] = useState<ManifestWithLegs | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [marks, setMarks] = useState<Record<string, ConferenceMark | undefined>>({});
    const [notes, setNotes] = useState<Record<string, string>>({});
    const [ack, setAck] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!manifestId) return;
        let cancelled = false;
        manifestsApi
            .getById(manifestId)
            .then((body) => {
                if (!cancelled) setManifest((body.data as ManifestWithLegs) ?? null);
            })
            .catch(() => {
                if (!cancelled) setError('Não foi possível carregar a viagem.');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [manifestId]);

    const items = useMemo(
        () => (manifest && hubId ? ordersToUnload(manifest, hubId) : []),
        [manifest, hubId],
    );
    const summary = useMemo(() => summarizeConference(items, marks), [items, marks]);
    const concludable = canConclude(summary, ack);

    const conclude = async () => {
        if (!manifest || !hubId || !concludable || saving) return;
        setSaving(true);
        setError(null);
        try {
            // 1) Divergências viram eventos auditáveis no histórico de cada pedido.
            for (const item of items) {
                const mark = marks[item.orderId];
                if (mark === 'AVARIA' || mark === 'FALTA') {
                    await ordersApi.addHistory(item.orderId, {
                        eventType: 'NOTE',
                        description: divergenceDescription(mark, manifest, notes[item.orderId]),
                        location: manifest.destination,
                    });
                }
            }
            // 2) Conclui a descarga: a parada deste hub, ou a viagem quando é o destino final.
            const stop = arrivalStopForHub(manifest, hubId);
            if (stop) await manifestsApi.completeStop(manifest.id, stop.id);
            else await manifestsApi.complete(manifest.id);
            await refresh();
            navigate('/hubs/receber', { replace: true });
        } catch {
            setError('Não foi possível concluir o recebimento. Nada foi perdido — tente de novo.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <OsSpinner label="Carregando a viagem…" />;
    if (!manifest) return <OsErrorNotice message={error ?? 'Viagem não encontrada.'} />;

    return (
        <div className="pb-36">
            <OsCard className="mb-4">
                <p className="font-semibold text-tower-900 dark:text-white">
                    {manifest.origin} → {manifest.destination}
                </p>
                <p className="mt-1 text-sm text-tower-500 dark:text-tower-300">
                    {items.length} pedido(s) descem aqui · conferidos {summary.marked}/{summary.total}
                </p>
            </OsCard>

            {error ? <div className="mb-3"><OsErrorNotice message={error} /></div> : null}

            {items.length === 0 ? (
                <OsEmpty
                    title="Nenhum pedido vinculado a esta descarga"
                    detail="Confira na Torre se as pernas desta viagem foram vinculadas à parada deste hub."
                />
            ) : (
                <div className="flex flex-col gap-3">
                    {items.map((item) => {
                        const current = marks[item.orderId];
                        return (
                            <OsCard key={item.orderId}>
                                <div className="flex items-center justify-between gap-2">
                                    <p className="font-semibold text-tower-900 dark:text-white">
                                        {item.orderNumber ? `Pedido ${item.orderNumber}` : 'Pedido'}
                                        {item.nfNumber ? ` · NF ${item.nfNumber}` : ''}
                                    </p>
                                    {current ? (
                                        <OsBadge tone={current === 'OK' ? 'ok' : current === 'AVARIA' ? 'warn' : 'bad'}>
                                            {MARKS.find((m) => m.mark === current)?.label}
                                        </OsBadge>
                                    ) : null}
                                </div>
                                {item.destination ? (
                                    <p className="mt-0.5 text-sm text-tower-500 dark:text-tower-300">{item.destination}</p>
                                ) : null}
                                <div className="mt-3 grid grid-cols-3 gap-2">
                                    {MARKS.map(({ mark, label }) => (
                                        <button
                                            key={mark}
                                            type="button"
                                            onClick={() => setMarks((prev) => ({ ...prev, [item.orderId]: mark }))}
                                            className={`min-h-[44px] rounded-xl border text-sm font-semibold transition-colors ${
                                                current === mark
                                                    ? mark === 'OK'
                                                        ? 'border-emerald-600 bg-emerald-600 text-white'
                                                        : mark === 'AVARIA'
                                                          ? 'border-amber-500 bg-amber-500 text-white'
                                                          : 'border-red-600 bg-red-600 text-white'
                                                    : 'border-tower-300 bg-white text-tower-700 dark:border-tower-600 dark:bg-tower-800 dark:text-tower-200'
                                            }`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                                {current === 'AVARIA' || current === 'FALTA' ? (
                                    <input
                                        type="text"
                                        value={notes[item.orderId] ?? ''}
                                        onChange={(e) => setNotes((prev) => ({ ...prev, [item.orderId]: e.target.value }))}
                                        placeholder="O que aconteceu? (opcional)"
                                        className="mt-2 w-full rounded-xl border border-tower-300 bg-white px-3 py-2.5 text-sm text-tower-900 placeholder:text-tower-400 dark:border-tower-600 dark:bg-tower-800 dark:text-white"
                                    />
                                ) : null}
                            </OsCard>
                        );
                    })}
                </div>
            )}

            {summary.hasDivergence ? (
                <label className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    <input
                        type="checkbox"
                        checked={ack}
                        onChange={(e) => setAck(e.target.checked)}
                        className="mt-0.5 h-5 w-5"
                    />
                    <span>
                        Registrar {summary.avaria + summary.falta} divergência(s) no histórico dos pedidos e concluir a
                        descarga mesmo assim.
                    </span>
                </label>
            ) : null}

            {items.length > 0 ? (
                <OsActionBar>
                    <OsButton full disabled={!concludable || saving} onClick={() => void conclude()}>
                        {saving
                            ? 'Concluindo…'
                            : summary.hasDivergence
                              ? 'Concluir com divergências'
                              : `Confirmar recebimento (${summary.marked}/${summary.total})`}
                    </OsButton>
                </OsActionBar>
            ) : null}
        </div>
    );
};

export default TripReceivePage;
