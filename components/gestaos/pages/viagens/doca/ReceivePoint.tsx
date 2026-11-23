import React, { useMemo, useState } from 'react';
import { manifestsApi, ordersApi } from '../../../../../lib/api';
import { arrivalSuccessMessage, buildArrivals, canConclude, summarizeConference, type ConferenceMark, type ManifestWithLegs } from '../../../../os/lib/arrival';
import { damagePhotos, docaErrorMessage, isConflict, type UnloadPoint } from '../../../lib/docaWork';
import { KEYS } from '../../../lib/data';
import { dateTime, plural } from '../../../lib/format';
import { invalidate } from '../../../lib/resource';
import { Checkbox } from '../../../ui/form';
import { Button, EmptyState, ModeBadge, Pill } from '../../../ui/kit';
import { useAction } from '../../../ui/overlay';
import { ConferenceRow } from './ConferenceRow';

interface Props {
    trip: ManifestWithLegs;
    point: UnloadPoint;
    canOperate: boolean;
    onChanged: () => void;
}

const refresh = () => invalidate(KEYS.manifests, 'manifest:', KEYS.exceptions, 'orders:');

/** Uma descarga: "A carreta chegou", conferência pedido a pedido e conclusão com as marcações na mesma chamada. */
export const ReceivePoint: React.FC<Props> = ({ trip, point, canOperate, onChanged }) => {
    const { busy, run } = useAction();
    const [marks, setMarks] = useState<Record<string, ConferenceMark | undefined>>({});
    const [notes, setNotes] = useState<Record<string, string>>({});
    const [photos, setPhotos] = useState<Record<string, string>>({});
    const [ack, setAck] = useState(false);
    const [result, setResult] = useState<string | null>(null);
    const { items, stop } = point;
    const summary = useMemo(() => summarizeConference(items, marks), [items, marks]);
    const arrivedAt = point.arrivedAt;
    const done = Boolean(point.completedAt);

    const afterWrite = () => {
        refresh();
        onChanged();
    };

    /** Roda a escrita; 409 vira "a viagem mudou, atualize" e já renova a tela. */
    const guarded = (action: () => Promise<unknown>, fallback: string) => async () => {
        try {
            return await action();
        } catch (cause) {
            if (isConflict(cause)) afterWrite();
            throw new Error(docaErrorMessage(cause, fallback));
        }
    };

    const arrive = async () => {
        const ok = await run('arrive', guarded(() => manifestsApi.arrive(trip.id, stop?.id), 'Tente de novo.'), { success: 'Chegada registrada pela torre.', error: 'Não foi possível registrar a chegada.' });
        if (ok) afterWrite();
    };

    const setMark = (orderId: string, mark: ConferenceMark | undefined, note?: string, photo?: string) => {
        setMarks((prev) => ({ ...prev, [orderId]: mark }));
        if (note !== undefined) setNotes((prev) => ({ ...prev, [orderId]: note }));
        if (photo !== undefined) setPhotos((prev) => ({ ...prev, [orderId]: photo }));
    };

    const conclude = async () => {
        if (!canConclude(summary, ack)) return;
        const arrivals = buildArrivals(items, marks, notes);
        let message = '';
        const ok = await run(
            'conclude',
            guarded(async () => {
                const body = stop ? await manifestsApi.completeStop(trip.id, stop.id, { arrivals }) : await manifestsApi.complete(trip.id, { arrivals });
                const applied = body.data?.arrivals ?? { stocked: summary.ok + summary.avaria, damaged: summary.avaria, missing: summary.falta };
                message = arrivalSuccessMessage(applied);
                for (const photo of damagePhotos(items, marks, photos)) {
                    try {
                        await ordersApi.addHistory(photo.orderId, { eventType: 'NOTE', description: 'Foto da avaria na conferência de chegada.', photoUrl: photo.photoUrl });
                    } catch {
                        /* a conclusão já valeu; a foto fica sem anexo */
                    }
                }
            }, 'Nada foi perdido, tente de novo.'),
            { success: 'Descarga concluída pela torre.', error: 'Não foi possível concluir o recebimento.' },
        );
        if (ok) {
            setResult(message);
            afterWrite();
        }
    };

    return (
        <section className="flex flex-col gap-4" aria-label={`Descarga em ${point.label}`}>
            <div className="flex flex-wrap items-center gap-2.5">
                <h3 className="gx-h2">Descarga em {point.label}</h3>
                <ModeBadge mode="manual" />
                {done ? <Pill tone="neutral">Concluída</Pill> : arrivedAt ? <Pill tone="royal">Carreta no pátio</Pill> : <Pill tone="yellow">A caminho</Pill>}
            </div>
            <p className="gx-soft text-[13.5px]">
                Registrado pela torre, com a sua conta: chegada e conferência ficam no histórico de cada pedido.
                {arrivedAt ? ` Chegada em ${dateTime(arrivedAt)}.` : ''}
            </p>

            {done ? (
                <div className="gx-inset p-4" role="status">
                    <p className="font-semibold">{result ?? 'Descarga concluída.'}</p>
                    <p className="gx-soft text-[13.5px]">{plural(items.length, 'pedido', 'pedidos')} nesta descarga. Os conferidos entram no estoque do hub; divergências abrem alerta.</p>
                </div>
            ) : !arrivedAt ? (
                <div className="flex flex-col items-start gap-2">
                    <p className="gx-soft text-[14px]">Quando o veículo parar no pátio do hub, registre a chegada. Isso libera a conferência da carga.</p>
                    <Button variant="primary" disabled={!canOperate} loading={busy === 'arrive'} onClick={() => void arrive()}>A carreta chegou</Button>
                </div>
            ) : items.length === 0 ? (
                <EmptyState title="Nenhum pedido vinculado a esta descarga" hint="Confira na montagem se as pernas da viagem estão ligadas a esta parada." />
            ) : (
                <>
                    <p className="gx-soft text-[13.5px]">Conferidos {summary.marked} de {summary.total}. Divergência exige uma nota e nunca fecha em silêncio.</p>
                    <div className="flex flex-col gap-3">
                        {items.map((item) => (
                            <ConferenceRow key={item.orderId} item={item} mark={marks[item.orderId]} note={notes[item.orderId] ?? ''} hasPhoto={Boolean(photos[item.orderId])} disabled={Boolean(busy) || !canOperate} onMark={(mark, note, photo) => setMark(item.orderId, mark, note, photo)} />
                        ))}
                    </div>
                    {summary.hasDivergence ? (
                        <Checkbox
                            checked={ack}
                            onChange={setAck}
                            label={`Registrar ${summary.avaria + summary.falta} divergência(s) e concluir a descarga`}
                            hint="Pedido que não chegou volta ao estoque do hub de origem; avaria entra no estoque daqui. Os dois abrem alerta."
                        />
                    ) : null}
                    <div>
                        <Button variant="primary" disabled={!canOperate || !canConclude(summary, ack)} loading={busy === 'conclude'} onClick={() => void conclude()}>
                            {summary.hasDivergence ? 'Concluir com divergências' : `Confirmar recebimento (${summary.marked}/${summary.total})`}
                        </Button>
                    </div>
                </>
            )}
        </section>
    );
};
