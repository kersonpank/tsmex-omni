import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { manifestsApi, ordersApi } from '../../../lib/api';
import { useOs } from '../OsContext';
import {
    arrivalStopForHub,
    canConclude,
    arrivalSuccessMessage,
    buildArrivals,
    ordersToUnload,
    summarizeConference,
    type ConferenceMark,
    type ManifestWithLegs,
    type UnloadItem,
} from '../lib/arrival';
import {
    arrivedTime,
    clearDraft,
    emptyDraft,
    itemLabel,
    loadDraft,
    matchScanLocal,
    pruneDraft,
    saveDraft,
    scanOutcomeFor,
    type ConferenceDraft,
} from '../lib/conference';
import { OsActionBar, OsButton, OsCard, OsEmpty, OsErrorNotice, OsSkeletonRows } from '../ui/kit';
import { apiErrorMessage } from '../ui/Sheet';
import ConferenceRow from './receive/ConferenceRow';
import ConferenceScan, { type ScanFeedback } from './receive/ConferenceScan';
import { DamageSheet, MissingSheet } from './receive/ConferenceSheets';
import TripFiscalDocuments from './trip/TripFiscalDocuments';
import ReceiveDone from './receive/ReceiveDone';

/**
 * RECEBER VIAGEM — duas etapas.
 * 1) "A carreta chegou": um toque registra quem e quando (rastro em cada pedido), sem mudar o status.
 * 2) Conferência por leitura, pedido a pedido. Regra da estação: divergência nunca encerra em silêncio.
 * As marcações vão na MESMA chamada que conclui a descarga (atômica): avaria entra no estoque com evento
 * de avaria, "não chegou" volta ao estoque do hub de origem; ambos abrem alerta, com ator da sessão.
 * A conferência em andamento fica guardada no aparelho, por viagem.
 */

const buzz = (pattern: number | number[]) => {
    try {
        navigator.vibrate?.(pattern);
    } catch {
        /* sem vibração */
    }
};

const TripReceivePage: React.FC = () => {
    const { manifestId } = useParams<{ manifestId: string }>();
    const navigate = useNavigate();
    const { hubId, refresh } = useOs();
    const [manifest, setManifest] = useState<ManifestWithLegs | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [draft, setDraft] = useState<ConferenceDraft>(emptyDraft);
    const [draftReady, setDraftReady] = useState(false);
    const [arrivedAt, setArrivedAt] = useState<string | null>(null);
    const [arriving, setArriving] = useState(false);
    const [feedback, setFeedback] = useState<ScanFeedback>(null);
    const [sheet, setSheet] = useState<{ kind: 'damage' | 'missing'; item: UnloadItem } | null>(null);
    const [ack, setAck] = useState(false);
    const [saving, setSaving] = useState(false);
    const [done, setDone] = useState<{ message: string; received: string[]; photoFailures: number } | null>(null);

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
    const stop = useMemo(() => (manifest && hubId ? arrivalStopForHub(manifest, hubId) : null), [manifest, hubId]);
    const { marks, notes, photos } = draft;
    const summary = useMemo(() => summarizeConference(items, marks), [items, marks]);
    const concludable = canConclude(summary, ack);

    useEffect(() => {
        if (!manifest) return;
        setArrivedAt((stop ? stop.arrivedAt : manifest.arrivedAt) ?? null);
    }, [manifest, stop]);

    useEffect(() => {
        if (!manifest || !manifestId || draftReady) return;
        setDraft(pruneDraft(loadDraft(manifestId), items));
        setDraftReady(true);
    }, [manifest, manifestId, items, draftReady]);

    useEffect(() => {
        if (manifestId && draftReady && !done) saveDraft(manifestId, draft);
    }, [manifestId, draft, draftReady, done]);

    const setMark = useCallback((orderId: string, mark: ConferenceMark, note?: string, photo?: string) => {
        setDraft((prev) => ({
            marks: { ...prev.marks, [orderId]: mark },
            notes: note !== undefined ? { ...prev.notes, [orderId]: note } : prev.notes,
            photos: photo !== undefined ? { ...prev.photos, [orderId]: photo } : prev.photos,
        }));
    }, []);

    const registerArrival = async () => {
        if (!manifest || arriving) return;
        setArriving(true);
        setError(null);
        try {
            const body = await manifestsApi.arrive(manifest.id, stop?.id);
            setArrivedAt(body.data?.arrivedAt ?? new Date().toISOString());
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível registrar a chegada. Tente de novo.'));
        } finally {
            setArriving(false);
        }
    };

    const handleCode = async (code: string) => {
        let target = matchScanLocal(code, items);
        if (!target) {
            try {
                const res = await ordersApi.resolve(code);
                if (res.match === 'single') {
                    target = items.find((item) => item.orderId === res.order.id) ?? null;
                    if (!target) {
                        buzz([120, 60, 120]);
                        setFeedback({ tone: 'bad', text: `${res.order.orderNumber ? `Pedido ${res.order.orderNumber}` : 'Esse pedido'} não pertence a esta viagem. Separe a carga.` });
                        return;
                    }
                } else if (res.match === 'multiple') {
                    const inTrip = res.candidates.map((c) => items.find((item) => item.orderId === c.id)).filter((x): x is UnloadItem => Boolean(x));
                    if (inTrip.length !== 1) {
                        buzz([120, 60, 120]);
                        setFeedback({ tone: 'warn', text: inTrip.length ? 'Mais de um pedido desta viagem responde por esse código. Use a chave de 44 dígitos.' : 'Nenhum pedido desta viagem tem esse código.' });
                        return;
                    }
                    target = inTrip[0];
                } else {
                    buzz([120, 60, 120]);
                    setFeedback({ tone: 'bad', text: 'Código não encontrado. Confira a etiqueta ou use os botões abaixo.' });
                    return;
                }
            } catch {
                setFeedback({ tone: 'bad', text: 'Não foi possível consultar o código. Confira a conexão ou use os botões abaixo.' });
                return;
            }
        }
        const outcome = scanOutcomeFor(target, marks[target.orderId]);
        if (outcome.kind === 'marked') {
            setMark(target.orderId, 'OK');
            buzz(60);
            setFeedback({ tone: 'ok', text: `${outcome.message} Conferidos ${summary.marked + (marks[target.orderId] ? 0 : 1)}/${summary.total}.` });
        } else {
            buzz([60, 40, 60]);
            setFeedback({ tone: 'warn', text: outcome.message });
        }
    };

    const conclude = async () => {
        if (!manifest || !hubId || !concludable || saving) return;
        setSaving(true);
        setError(null);
        try {
            // Uma chamada só: conclui a descarga (parada deste hub, ou a viagem quando é o destino final)
            // levando a conferência; o servidor aplica o efeito de cada marcação na mesma transação.
            const arrivals = buildArrivals(items, marks, notes);
            const body = stop
                ? await manifestsApi.completeStop(manifest.id, stop.id, { arrivals })
                : await manifestsApi.complete(manifest.id, { arrivals });
            const applied = body.data?.arrivals ?? { stocked: summary.ok + summary.avaria, damaged: summary.avaria, missing: summary.falta };
            if (manifestId) clearDraft(manifestId);
            // Foto da avaria vai ao histórico do pedido (a conclusão em si não carrega anexos).
            let photoFailures = 0;
            for (const item of items) {
                const photo = photos[item.orderId];
                if (marks[item.orderId] !== 'AVARIA' || !photo) continue;
                try {
                    await ordersApi.addHistory(item.orderId, { eventType: 'NOTE', description: 'Foto da avaria na conferência de chegada.', photoUrl: photo });
                } catch {
                    photoFailures += 1;
                }
            }
            await refresh();
            setDone({
                message: arrivalSuccessMessage(applied),
                received: items.filter((item) => marks[item.orderId] === 'OK' || marks[item.orderId] === 'AVARIA').map((item) => item.orderId),
                photoFailures,
            });
        } catch {
            setError('Não foi possível concluir o recebimento. Nada foi perdido — tente de novo.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <OsSkeletonRows count={4} />;
    if (done) return <ReceiveDone hubId={hubId} message={done.message} receivedOrderIds={done.received} photoFailures={done.photoFailures} />;
    if (!manifest) return <OsErrorNotice message={error ?? 'Viagem não encontrada.'} />;

    const header = (
        <div className="mb-4 rounded-xl bg-brand-500 p-4 text-white dark:bg-brand-600">
            <p className="font-display text-[17px] font-bold leading-snug">{manifest.origin} → {manifest.destination}</p>
            <p className="mt-1 text-[13px] text-brand-100">
                {items.length} pedido(s) descem aqui
                {arrivedAt ? <> · carreta chegou às <span className="font-bold text-white">{arrivedTime(arrivedAt)}</span></> : null}
            </p>
        </div>
    );

    if (!arrivedAt) {
        return (
            <div className="pb-40">
                {header}
                <TripFiscalDocuments manifest={manifest} />
                {error ? <div className="mb-3"><OsErrorNotice message={error} /></div> : null}
                <OsCard className="!p-4">
                    <p className="font-display text-[15px] font-bold text-tower-900 dark:text-white">Etapa 1 de 2 · Chegada</p>
                    <p className="mt-1.5 text-[14px] text-tower-600 dark:text-tower-300">
                        Quando o veículo parar no seu pátio, toque abaixo. Fica registrado quem e quando, e a conferência da carga é liberada.
                    </p>
                </OsCard>
                <OsActionBar>
                    <OsButton full disabled={arriving} onClick={() => void registerArrival()}>
                        {arriving ? 'Registrando…' : 'A carreta chegou'}
                    </OsButton>
                </OsActionBar>
            </div>
        );
    }

    return (
        <div className="pb-40">
            {header}
            <TripFiscalDocuments manifest={manifest} />
            {error ? <div className="mb-3"><OsErrorNotice message={error} /></div> : null}
            {items.length === 0 ? (
                <OsEmpty title="Nenhum pedido vinculado a esta descarga" detail="Confira na Torre se as pernas desta viagem foram vinculadas à parada deste hub." />
            ) : (
                <>
                    <ConferenceScan onCode={handleCode} feedback={feedback} conferred={summary.marked} total={summary.total} />
                    <div className="flex flex-col gap-2.5">
                        {items.map((item) => (
                            <ConferenceRow
                                key={item.orderId}
                                item={item}
                                current={marks[item.orderId]}
                                note={notes[item.orderId]}
                                hasPhoto={Boolean(photos[item.orderId])}
                                onPick={(mark) => {
                                    if (mark === 'OK') setMark(item.orderId, 'OK');
                                    else setSheet({ kind: mark === 'AVARIA' ? 'damage' : 'missing', item });
                                }}
                            />
                        ))}
                    </div>
                </>
            )}

            {summary.hasDivergence ? (
                <label className="mt-4 flex items-start gap-3 rounded-xl border-l-4 border-brand-red-500 bg-brand-red-500/8 p-4 text-sm leading-snug text-brand-red-700 dark:bg-brand-red-500/10 dark:text-brand-red-400">
                    <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[#d81e25]" />
                    <span>
                        Registrar <strong>{summary.avaria + summary.falta} divergência(s)</strong> e concluir a descarga.
                        Pedido que não chegou volta ao estoque do hub de origem; avaria entra no estoque daqui. Os dois abrem alerta.
                    </span>
                </label>
            ) : null}

            {items.length > 0 ? (
                <OsActionBar>
                    <OsButton full disabled={!concludable || saving} onClick={() => void conclude()}>
                        {saving ? 'Concluindo…' : summary.hasDivergence ? 'Concluir com divergências' : `Confirmar recebimento (${summary.marked}/${summary.total})`}
                    </OsButton>
                </OsActionBar>
            ) : null}

            {sheet?.kind === 'damage' ? (
                <DamageSheet
                    title={itemLabel(sheet.item)}
                    initialNote={notes[sheet.item.orderId]}
                    initialPhoto={photos[sheet.item.orderId]}
                    onClose={() => setSheet(null)}
                    onConfirm={(note, photo) => {
                        setMark(sheet.item.orderId, 'AVARIA', note, photo ?? '');
                        setSheet(null);
                    }}
                />
            ) : null}
            {sheet?.kind === 'missing' ? (
                <MissingSheet
                    title={itemLabel(sheet.item)}
                    onClose={() => setSheet(null)}
                    onConfirm={() => {
                        setMark(sheet.item.orderId, 'FALTA');
                        setSheet(null);
                    }}
                />
            ) : null}
        </div>
    );
};

export default TripReceivePage;
