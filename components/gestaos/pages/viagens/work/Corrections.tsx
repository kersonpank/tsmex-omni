import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { manifestsApi } from '../../../../../lib/api';
import { dateTime } from '../../../lib/format';
import {
    buildCorrectionBody,
    CORRECTION_KIND_LABEL,
    CORRECTION_KINDS,
    CORRECTION_OUTCOMES,
    CORRECTION_STATUS_LABEL,
    correctionError,
    emptyCorrection,
    requestCorrectionPermission,
    resolveCorrectionError,
    type CorrectionDraft,
    type CorrectionKind,
    type CorrectionOutcome,
} from '../../../lib/viagemFiscal';
import { FormSection } from '../../../ui/form';
import { Button, Field, Pill, SelectInput, TextArea } from '../../../ui/kit';
import { useAction } from '../../../ui/overlay';
import { CityPicker } from '../../../ui/pickers';
import { Blocked } from './Blocked';
import { refreshTrip, type StepProps } from './types';

const RequestForm: React.FC<Pick<StepProps, 'trip'> & { onDone: () => void }> = ({ trip, onDone }) => {
    const { busy, run } = useAction();
    const [draft, setDraft] = useState<CorrectionDraft>(emptyCorrection);
    const [error, setError] = useState<string | null>(null);
    const patch = (next: Partial<CorrectionDraft>) => setDraft((current) => ({ ...current, ...next }));
    const needsCity = draft.kind === 'ROUTE' || draft.kind === 'STOP';
    const submit = async () => {
        const problem = correctionError(draft);
        setError(problem);
        if (problem) return;
        const ok = await run('correction-request', () => manifestsApi.requestCorrection(trip.id, buildCorrectionBody(draft)), {
            success: 'Correção registrada para análise fiscal. A viagem e os documentos permanecem preservados.',
            error: 'Não foi possível registrar a correção.',
        });
        if (ok) {
            refreshTrip();
            onDone();
        }
    };
    return (
        <div className="gx-inset flex flex-col gap-3 px-4 py-4">
            <p className="gx-soft text-[13.5px]">A solicitação preserva os dados autorizados. A alteração só é aplicada após avaliação fiscal e, se necessário, regularização no provedor.</p>
            <Field label="Parte da viagem">
                <SelectInput aria-label="Parte da viagem" value={draft.kind} onChange={(event) => patch({ kind: event.target.value as CorrectionKind, stopId: '', city: null })}>
                    {CORRECTION_KINDS.map((item) => (
                        <option key={item.value} value={item.value}>
                            {item.label}
                        </option>
                    ))}
                </SelectInput>
            </Field>
            {draft.kind === 'STOP' ? (
                <Field label="Parada">
                    <SelectInput aria-label="Parada a corrigir" value={draft.stopId} onChange={(event) => patch({ stopId: event.target.value })}>
                        <option value="">Selecione</option>
                        {(trip.tripStops ?? []).map((stop) => (
                            <option key={stop.id} value={stop.id}>
                                {stop.sequence}. {stop.destinationLabel || stop.destCity || stop.destHub?.name}
                            </option>
                        ))}
                    </SelectInput>
                </Field>
            ) : null}
            {needsCity ? (
                <Field label="Cidade proposta">
                    <CityPicker ariaLabel="Cidade proposta" value={draft.city} onChange={(city) => patch({ city })} />
                </Field>
            ) : null}
            <Field label="Mudança proposta">
                <TextArea aria-label="Mudança proposta" rows={2} value={draft.description} onChange={(event) => patch({ description: event.target.value })} />
            </Field>
            <Field label="Motivo (mínimo 8 caracteres)" error={error}>
                <TextArea aria-label="Motivo da correção" rows={2} value={draft.reason} onChange={(event) => patch({ reason: event.target.value })} />
            </Field>
            <div className="flex flex-wrap gap-2">
                <Button variant="primary" loading={busy === 'correction-request'} onClick={() => void submit()}>
                    Registrar para análise
                </Button>
                <Button disabled={busy != null} onClick={onDone}>
                    Voltar
                </Button>
            </div>
        </div>
    );
};

const ResolveForm: React.FC<{ tripId: string; correctionId: string; onDone: () => void }> = ({ tripId, correctionId, onDone }) => {
    const { busy, run } = useAction();
    const [outcome, setOutcome] = useState<CorrectionOutcome>('APPLIED');
    const [note, setNote] = useState('');
    const [error, setError] = useState<string | null>(null);
    const submit = async () => {
        const problem = resolveCorrectionError(note);
        setError(problem);
        if (problem) return;
        const ok = await run('correction-resolve', () => manifestsApi.resolveCorrection(tripId, correctionId, { outcome, note: note.trim() }), {
            success: 'Correção concluída.',
            error: 'Não foi possível concluir a correção.',
        });
        if (ok) {
            refreshTrip();
            onDone();
        }
    };
    return (
        <div className="mt-3 flex flex-col gap-3">
            <Field label="Como foi resolvida">
                <SelectInput aria-label="Como foi resolvida" value={outcome} onChange={(event) => setOutcome(event.target.value as CorrectionOutcome)}>
                    {CORRECTION_OUTCOMES.map((item) => (
                        <option key={item.value} value={item.value}>
                            {item.label}
                        </option>
                    ))}
                </SelectInput>
            </Field>
            <Field label="Registro da conclusão" error={error}>
                <TextArea aria-label="Registro da conclusão" rows={2} placeholder="Ex.: MDF-e 123 encerrado e novo MDF-e 124 autorizado" value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-2">
                <Button variant="primary" loading={busy === 'correction-resolve'} onClick={() => void submit()}>
                    Concluir correção
                </Button>
                <Button disabled={busy != null} onClick={onDone}>
                    Voltar
                </Button>
            </div>
        </div>
    );
};

/** Correções fiscais da viagem na estrada: pedir, acompanhar e concluir depois da resposta do provedor. */
export const Corrections: React.FC<Pick<StepProps, 'trip' | 'readiness'>> = ({ trip, readiness }) => {
    const [requesting, setRequesting] = useState(false);
    const [resolving, setResolving] = useState<string | null>(null);
    const permission = requestCorrectionPermission(trip, readiness);
    const list = trip.corrections ?? [];
    if (trip.status !== 'IN_PROGRESS' && !list.length) return null;
    return (
        <FormSection title="Correções da viagem" hint="Mudança de rota, parada, veículo ou motorista depois da saída passa por avaliação fiscal." cols={1}>
            {trip.status === 'IN_PROGRESS' ? (
                requesting ? (
                    <RequestForm trip={trip} onDone={() => setRequesting(false)} />
                ) : permission.allowed ? (
                    <div>
                        <Button variant="soft" onClick={() => setRequesting(true)}>
                            Solicitar correção da viagem
                        </Button>
                    </div>
                ) : (
                    <Blocked reason={permission.reason} />
                )
            ) : null}
            {list.length ? (
                <ul className="flex flex-col">
                    {list.map((correction) => (
                        <li key={correction.id} className="gx-hair-b py-3 last:border-b-0">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-medium">{CORRECTION_KIND_LABEL[correction.kind] ?? 'Correção'}</span>
                                <Pill tone={correction.status === 'PENDING_FISCAL' ? 'yellow' : 'neutral'}>{CORRECTION_STATUS_LABEL[correction.status] ?? 'Em análise'}</Pill>
                            </div>
                            <p className="gx-soft mt-1 text-[13.5px]">{correction.reason}</p>
                            <p className="gx-muted text-[12.5px]">
                                Pedida em {dateTime(correction.createdAt)}
                                {correction.resolvedAt ? ` · concluída em ${dateTime(correction.resolvedAt)}` : ''}
                            </p>
                            {correction.successorManifestId ? (
                                <Link to={`/gestaos/viagens/${correction.successorManifestId}`} className="gx-royal-text mt-1 inline-block text-[13.5px] font-semibold underline">
                                    Abrir viagem sucessora
                                </Link>
                            ) : null}
                            {correction.status === 'PENDING_FISCAL' ? (
                                resolving === correction.id ? (
                                    <ResolveForm tripId={trip.id} correctionId={correction.id} onDone={() => setResolving(null)} />
                                ) : (
                                    <div className="mt-2">
                                        <Button size="sm" onClick={() => setResolving(correction.id)}>
                                            Concluir após resposta fiscal
                                        </Button>
                                    </div>
                                )
                            ) : null}
                        </li>
                    ))}
                </ul>
            ) : null}
        </FormSection>
    );
};
