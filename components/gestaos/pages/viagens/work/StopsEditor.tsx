import React, { useState } from 'react';
import { manifestsApi } from '../../../../../lib/api';
import type { Manifest, ManifestStop, ManifestStopPurpose } from '../../../../../types/index';
import { dateTime } from '../../../lib/format';
import { STOP_PURPOSE_LABEL } from '../../../lib/viagens';
import { ConfirmButton, DateTimeInput, FormSection } from '../../../ui/form';
import { Button, Field, SelectInput } from '../../../ui/kit';
import { useAction } from '../../../ui/overlay';
import { CityPicker, HubSelect, type CityValue } from '../../../ui/pickers';
import { refreshTrip } from './types';

interface StopDraft {
    kind: 'hub' | 'city';
    hubId: string | null;
    city: CityValue | null;
    purpose: ManifestStopPurpose;
    plannedArrivalAt: string | null;
}

const EMPTY: StopDraft = { kind: 'hub', hubId: null, city: null, purpose: 'PASSAGE', plannedArrivalAt: null };
const PURPOSES = Object.keys(STOP_PURPOSE_LABEL) as ManifestStopPurpose[];

export const stopPlace = (stop: ManifestStop) => stop.destinationLabel || stop.destHub?.name || [stop.destCity, stop.destState].filter(Boolean).join('/') || 'Parada';

const draftOf = (stop: ManifestStop): StopDraft => ({
    kind: stop.destHubId ? 'hub' : 'city',
    hubId: stop.destHubId ?? null,
    city: stop.destCity && stop.destState && stop.destCityIbgeCode ? { city: stop.destCity, state: stop.destState, ibgeCode: stop.destCityIbgeCode } : null,
    purpose: stop.purpose ?? 'PASSAGE',
    plannedArrivalAt: stop.plannedArrivalAt ?? null,
});

type StopBody = Record<string, string | null | undefined>;

/** Corpo do POST/PATCH de parada a partir do formulário; devolve o erro quando falta escolher o ponto. */
export function stopBody(draft: StopDraft, editing: boolean): { body: StopBody | null; error: string | null } {
    if (draft.kind === 'hub' && !draft.hubId) return { body: null, error: 'Escolha o hub da parada.' };
    if (draft.kind === 'city' && !draft.city) return { body: null, error: 'Escolha a cidade na lista para confirmar o código IBGE.' };
    const body: StopBody = { purpose: draft.purpose };
    if (draft.kind === 'hub') {
        body.destHubId = draft.hubId;
        if (editing) Object.assign(body, { destinationLabel: null, destCity: null, destState: null, destCityIbgeCode: null });
    } else if (draft.city) {
        Object.assign(body, { destinationLabel: `${draft.city.city}, ${draft.city.state}`, destCity: draft.city.city, destState: draft.city.state, destCityIbgeCode: draft.city.ibgeCode });
        if (editing) body.destHubId = null;
    }
    if (draft.plannedArrivalAt) body.plannedArrivalAt = draft.plannedArrivalAt;
    else if (editing) body.plannedArrivalAt = null;
    return { body, error: null };
}

const StopForm: React.FC<{ initial: StopDraft; editing: boolean; busy: boolean; onSubmit: (draft: StopDraft) => void; onCancel?: () => void }> = ({ initial, editing, busy, onSubmit, onCancel }) => {
    const [draft, setDraft] = useState(initial);
    const [error, setError] = useState<string | null>(null);
    const submit = () => {
        const built = stopBody(draft, editing);
        setError(built.error);
        if (!built.error) onSubmit(draft);
    };
    return (
        <div className="gx-inset flex flex-col gap-3 px-4 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Ponto">
                    <SelectInput aria-label="Tipo de ponto" value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as 'hub' | 'city' })}>
                        <option value="hub">Hub / filial</option>
                        <option value="city">Cidade</option>
                    </SelectInput>
                </Field>
                <Field label="Finalidade">
                    <SelectInput aria-label="Finalidade da parada" value={draft.purpose} onChange={(event) => setDraft({ ...draft, purpose: event.target.value as ManifestStopPurpose })}>
                        {PURPOSES.map((purpose) => (
                            <option key={purpose} value={purpose}>
                                {STOP_PURPOSE_LABEL[purpose]}
                            </option>
                        ))}
                    </SelectInput>
                </Field>
                <Field label={draft.kind === 'hub' ? 'Hub da parada' : 'Cidade da parada'}>
                    {draft.kind === 'hub' ? (
                        <HubSelect value={draft.hubId} ariaLabel="Hub da parada" onChange={(id) => setDraft({ ...draft, hubId: id })} />
                    ) : (
                        <CityPicker value={draft.city} ariaLabel="Cidade da parada" onChange={(city) => setDraft({ ...draft, city })} />
                    )}
                </Field>
                <Field label="Chegada prevista (opcional)">
                    <DateTimeInput aria-label="Chegada prevista da parada" value={draft.plannedArrivalAt} onChange={(value) => setDraft({ ...draft, plannedArrivalAt: value })} />
                </Field>
            </div>
            {error ? (
                <p role="alert" className="gx-red-text text-[13px] font-semibold">
                    {error}
                </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
                <Button variant="primary" size="sm" loading={busy} onClick={submit}>
                    {editing ? 'Salvar parada' : 'Adicionar parada'}
                </Button>
                {onCancel ? (
                    <Button size="sm" onClick={onCancel}>
                        Cancelar
                    </Button>
                ) : null}
            </div>
        </div>
    );
};

/** Paradas do percurso: criar, editar, remover e reordenar (só em montagem). */
export const StopsEditor: React.FC<{ trip: Manifest; editable: boolean }> = ({ trip, editable }) => {
    const { busy, run } = useAction();
    const stops = (trip.tripStops ?? []).slice().sort((a, b) => a.sequence - b.sequence);
    const [editingId, setEditingId] = useState<string | null>(null);

    const submit = async (draft: StopDraft, stopId?: string) => {
        const built = stopBody(draft, Boolean(stopId));
        if (!built.body) return;
        const body = built.body as never;
        const ok = await run(stopId ? `stop:${stopId}` : 'stop:new', () => (stopId ? manifestsApi.updateStop(trip.id, stopId, body) : manifestsApi.createStop(trip.id, body)), {
            success: stopId ? 'Parada atualizada.' : 'Parada adicionada.',
            error: 'Não foi possível salvar a parada.',
        });
        if (ok) {
            setEditingId(null);
            refreshTrip();
        }
    };
    const move = async (index: number, delta: -1 | 1) => {
        const ids = stops.map((stop) => stop.id);
        const target = index + delta;
        if (target < 0 || target >= ids.length) return;
        [ids[index], ids[target]] = [ids[target], ids[index]];
        const ok = await run('stop:order', () => manifestsApi.reorderStops(trip.id, ids), { success: 'Ordem das paradas atualizada.', error: 'Não foi possível reordenar.' });
        if (ok) refreshTrip();
    };
    const remove = async (stopId: string) => {
        const ok = await run(`stop:del:${stopId}`, () => manifestsApi.deleteStop(trip.id, stopId), { success: 'Parada removida.', error: 'Não foi possível remover a parada.' });
        if (ok) refreshTrip();
        return ok;
    };

    return (
        <FormSection title="Paradas do percurso" hint="Pontos de passagem, coleta ou entrega entre a origem e o destino." cols={1}>
            {stops.length === 0 ? <p className="gx-muted text-[13.5px]">Nenhuma parada. A viagem vai direto da origem ao destino.</p> : null}
            <ol className="flex flex-col">
                {stops.map((stop, index) =>
                    editingId === stop.id ? (
                        <li key={stop.id} className="py-2">
                            <StopForm initial={draftOf(stop)} editing busy={busy === `stop:${stop.id}`} onSubmit={(draft) => void submit(draft, stop.id)} onCancel={() => setEditingId(null)} />
                        </li>
                    ) : (
                        <li key={stop.id} className="gx-hair-b flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 last:border-b-0">
                            <span className="min-w-0">
                                <span className="gx-num mr-2 text-[13px]">{index + 1}</span>
                                <span className="font-medium">{stopPlace(stop)}</span>
                                <span className="gx-muted text-[12.5px]">
                                    {' '}
                                    · {STOP_PURPOSE_LABEL[stop.purpose ?? 'PASSAGE']}
                                    {stop.plannedArrivalAt ? ` · prevista ${dateTime(stop.plannedArrivalAt)}` : ''}
                                    {stop.completedAt ? ' · concluída' : ''}
                                </span>
                            </span>
                            {editable && !stop.completedAt ? (
                                <span className="flex flex-wrap items-center gap-1.5">
                                    <Button size="sm" aria-label={`Subir parada ${index + 1}`} disabled={index === 0 || Boolean(busy)} onClick={() => void move(index, -1)}>
                                        Subir
                                    </Button>
                                    <Button size="sm" aria-label={`Descer parada ${index + 1}`} disabled={index === stops.length - 1 || Boolean(busy)} onClick={() => void move(index, 1)}>
                                        Descer
                                    </Button>
                                    <Button size="sm" onClick={() => setEditingId(stop.id)}>
                                        Editar
                                    </Button>
                                    <ConfirmButton label="Remover" confirmLabel="Remover?" onConfirm={() => remove(stop.id)} />
                                </span>
                            ) : null}
                        </li>
                    ),
                )}
            </ol>
            {editable ? <StopForm key={stops.length} initial={EMPTY} editing={false} busy={busy === 'stop:new'} onSubmit={(draft) => void submit(draft)} /> : null}
        </FormSection>
    );
};
