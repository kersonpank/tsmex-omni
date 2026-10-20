import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
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
import { OsActionBar, OsButton, OsCard, OsEmpty, OsErrorNotice, OsSkeletonRows } from '../ui/kit';
import { IconAlert, IconCheck, IconX, type OsIconProps } from '../ui/icons';

/**
 * RECEBER VIAGEM — conferência da descarga, pedido a pedido.
 * Regra da estação: divergência nunca encerra em silêncio (gera evento no
 * histórico do pedido, com ator da sessão, antes de concluir a descarga).
 */

const MARKS: Array<{
    mark: ConferenceMark;
    label: string;
    Icon: React.FC<OsIconProps>;
    selected: string;
}> = [
    { mark: 'OK', label: 'Chegou', Icon: IconCheck, selected: 'border-emerald-600 bg-emerald-600 text-white' },
    { mark: 'AVARIA', label: 'Avaria', Icon: IconAlert, selected: 'border-brand-yellow-500 bg-brand-yellow-400 text-brand-950' },
    { mark: 'FALTA', label: 'Não chegou', Icon: IconX, selected: 'border-brand-red-600 bg-brand-red-500 text-white' },
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

    const items = useMemo(() => (manifest && hubId ? ordersToUnload(manifest, hubId) : []), [manifest, hubId]);
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

    if (loading) return <OsSkeletonRows count={4} />;
    if (!manifest) return <OsErrorNotice message={error ?? 'Viagem não encontrada.'} />;

    return (
        <div className="pb-40">
            <div className="mb-4 rounded-xl bg-brand-500 p-4 text-white dark:bg-brand-600">
                <p className="font-display text-[17px] font-bold leading-snug">
                    {manifest.origin} → {manifest.destination}
                </p>
                <p className="mt-1 text-[13px] text-brand-100">
                    {items.length} pedido(s) descem aqui · conferidos{' '}
                    <span className="font-display font-bold text-white">
                        {summary.marked}/{summary.total}
                    </span>
                </p>
            </div>

            {error ? (
                <div className="mb-3">
                    <OsErrorNotice message={error} />
                </div>
            ) : null}

            {items.length === 0 ? (
                <OsEmpty
                    title="Nenhum pedido vinculado a esta descarga"
                    detail="Confira na Torre se as pernas desta viagem foram vinculadas à parada deste hub."
                />
            ) : (
                <div className="flex flex-col gap-2.5">
                    {items.map((item) => {
                        const current = marks[item.orderId];
                        return (
                            <OsCard key={item.orderId} className="!p-3.5">
                                <p className="font-semibold text-tower-900 dark:text-white">
                                    {item.orderNumber ? `Pedido ${item.orderNumber}` : 'Pedido'}
                                    {item.nfNumber ? (
                                        <>
                                            {' · NF '}
                                            <span className="font-mono text-[14px] font-medium">{item.nfNumber}</span>
                                        </>
                                    ) : null}
                                </p>
                                {item.destination ? (
                                    <p className="mt-0.5 text-[13px] text-tower-500 dark:text-tower-400">{item.destination}</p>
                                ) : null}
                                <div className="mt-3 grid grid-cols-3 gap-2">
                                    {MARKS.map(({ mark, label, Icon, selected }) => (
                                        <button
                                            key={mark}
                                            type="button"
                                            aria-pressed={current === mark}
                                            onClick={() => setMarks((prev) => ({ ...prev, [item.orderId]: mark }))}
                                            className={clsx(
                                                'flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-lg border-2 text-[12px] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-brand-500',
                                                current === mark
                                                    ? selected
                                                    : 'border-tower-200 bg-white text-tower-500 active:bg-tower-50 dark:border-tower-600 dark:bg-tower-800 dark:text-tower-300',
                                            )}
                                        >
                                            <Icon size={18} />
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
                                        className="mt-2.5 w-full rounded-lg border-2 border-tower-200 bg-white px-3 py-2.5 text-sm text-tower-900 placeholder:text-tower-400 focus:border-brand-400 focus:outline-none dark:border-tower-600 dark:bg-tower-800 dark:text-white"
                                    />
                                ) : null}
                            </OsCard>
                        );
                    })}
                </div>
            )}

            {summary.hasDivergence ? (
                <label className="mt-4 flex items-start gap-3 rounded-xl border-l-4 border-brand-red-500 bg-brand-red-500/8 p-4 text-sm leading-snug text-brand-red-700 dark:bg-brand-red-500/10 dark:text-brand-red-400">
                    <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[#d81e25]" />
                    <span>
                        Registrar <strong>{summary.avaria + summary.falta} divergência(s)</strong> no histórico dos pedidos
                        e concluir a descarga mesmo assim.
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
