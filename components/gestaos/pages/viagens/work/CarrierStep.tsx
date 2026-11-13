import React, { useEffect, useState } from 'react';
import { linksApi, manifestsApi } from '../../../../../lib/api';
import type { Driver, TripCompositionSuggestion } from '../../../../../types/index';
import { buildTripComposition, manifestPlates } from '../../../../os/lib/carrier';
import { useResource } from '../../../lib/resource';
import { Checkbox, formatPlate, FormSection } from '../../../ui/form';
import { Button, Field, Loadable, Pill, Skeleton, TextInput } from '../../../ui/kit';
import { useAction } from '../../../ui/overlay';
import { CarrierSelect } from '../../../ui/pickers';
import { Blocked } from './Blocked';
import { refreshTrip, type StepProps } from './types';

const SOURCE_LABEL: Record<TripCompositionSuggestion['source'], string> = { LAST_TRIP: 'da última viagem deste transportador', CARRIER_DEFAULT: 'do cadastro do transportador' };

const Suggestion: React.FC<{ tripId: string; linkId: string; editable: boolean }> = ({ tripId, linkId, editable }) => {
    const { busy, run } = useAction();
    const state = useResource<TripCompositionSuggestion | null>(`manifest:suggestion:${tripId}:${linkId}`, async () => (await manifestsApi.compositionSuggestion(tripId)).data ?? null, { staleMs: 10_000 });
    const suggestion = state.data;
    if (!suggestion) return null;
    const plates = [suggestion.traction.plate, ...suggestion.trailers.map((trailer) => trailer.plate)].join(' + ');
    const accept = async () => {
        const ok = await run(
            'suggestion',
            async () => {
                await manifestsApi.setVehicles(tripId, { traction: { plate: suggestion.traction.plate }, trailers: suggestion.trailers.map((trailer) => ({ plate: trailer.plate })) });
                if (suggestion.drivers.length) await manifestsApi.setDrivers(tripId, suggestion.drivers.map((driver) => driver.id));
            },
            { success: 'Composição sugerida aplicada.', error: 'Não foi possível aplicar a composição.' },
        );
        if (ok) refreshTrip();
    };
    return (
        <div className="gx-inset flex flex-col gap-2 px-4 py-3.5" aria-label="Composição sugerida">
            <p className="gx-label gx-royal-text">Copilot sugere a composição {SOURCE_LABEL[suggestion.source]}</p>
            <p className="gx-mono text-[14px]">{plates}</p>
            {suggestion.drivers.length ? <p className="gx-soft text-[13.5px]">Motoristas: {suggestion.drivers.map((driver) => driver.name).join(', ')}</p> : null}
            {suggestion.differsFromTrip ? (
                editable ? (
                    <div>
                        <Button size="sm" variant="primary" loading={busy === 'suggestion'} onClick={() => void accept()}>
                            Aceitar composição
                        </Button>
                    </div>
                ) : null
            ) : (
                <p className="gx-muted text-[13px]">Já é a composição desta viagem.</p>
            )}
        </div>
    );
};

function setPlateAt(list: string[], index: number, plate: string): string[] {
    const next = [...list];
    if (plate) next[index] = plate;
    else next.splice(index, 1);
    return next;
}

const Vehicles: React.FC<StepProps & { editable: boolean }> = ({ trip, editable }) => {
    const { busy, run } = useAction();
    const current = manifestPlates(trip.vehicleAssignments);
    const [traction, setTraction] = useState(current.traction ?? '');
    const [trailers, setTrailers] = useState<string[]>(current.trailers.slice(0, 3));
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        setTraction(current.traction ?? '');
        setTrailers(current.trailers.slice(0, 3));
    }, [trip.vehicleAssignments]);
    const save = async () => {
        const composition = buildTripComposition(traction, trailers);
        if (!composition) {
            setError('Informe a placa do cavalo com 7 letras ou números.');
            return;
        }
        setError(null);
        const ok = await run('vehicles', () => manifestsApi.setVehicles(trip.id, composition), { success: 'Veículos da viagem salvos.', error: 'Não foi possível salvar os veículos.' });
        if (ok) refreshTrip();
    };
    return (
        <FormSection title="Veículos da viagem" hint="Cavalo e até 3 implementos, por placa. Vale só para esta viagem.">
            <Field label="Cavalo / veículo" error={error}>
                <TextInput aria-label="Placa do cavalo" className="gx-mono" disabled={!editable} value={traction} onChange={(event) => setTraction(formatPlate(event.target.value))} placeholder="ABC1D23" />
            </Field>
            {[0, 1, 2].map((index) => (
                <Field key={index} label={`Implemento ${index + 1}`}>
                    <TextInput
                        aria-label={`Placa do implemento ${index + 1}`}
                        className="gx-mono"
                        disabled={!editable || (index > 0 && !trailers[index - 1])}
                        value={trailers[index] ?? ''}
                        onChange={(event) => setTrailers((list) => setPlateAt(list, index, formatPlate(event.target.value)))}
                        placeholder="Opcional"
                    />
                </Field>
            ))}
            {editable ? (
                <div className="col-span-full">
                    <Button variant="soft" loading={busy === 'vehicles'} onClick={() => void save()}>
                        Salvar veículos
                    </Button>
                </div>
            ) : null}
        </FormSection>
    );
};

const Drivers: React.FC<{ tripId: string; linkId: string; selected: string[]; editable: boolean }> = ({ tripId, linkId, selected, editable }) => {
    const { busy, run } = useAction();
    const drivers = useResource<Driver[]>(`manifest:drivers:${linkId}`, async () => (await linksApi.getDrivers(linkId)).data ?? [], { staleMs: 30_000 });
    const [chosen, setChosen] = useState<string[]>(selected);
    useEffect(() => setChosen(selected), [selected.join(',')]);
    const save = async () => {
        if (!chosen.length) return;
        const ok = await run('drivers', () => manifestsApi.setDrivers(tripId, chosen), { success: 'Motoristas da viagem salvos.', error: 'Não foi possível salvar os motoristas.' });
        if (ok) refreshTrip();
    };
    return (
        <FormSection title="Motoristas" hint="O primeiro marcado é o principal." cols={1}>
            <Loadable state={drivers} skeleton={<Skeleton rows={2} />}>
                {(list) => {
                    const active = list.filter((driver) => driver.active !== false);
                    if (!active.length) return <p className="gx-muted text-[13.5px]">Este transportador não tem motorista ativo. Cadastre em Rede, aba Transportadores.</p>;
                    return (
                        <div className="flex flex-col gap-2">
                            {active.map((driver) => (
                                <div key={driver.id}>
                                <Checkbox
                                    disabled={!editable}
                                    checked={chosen.includes(driver.id)}
                                    onChange={(checked) => setChosen((list2) => (checked ? [...list2, driver.id] : list2.filter((id) => id !== driver.id)))}
                                    label={driver.name}
                                    hint={chosen[0] === driver.id ? 'Motorista principal' : undefined}
                                />
                                </div>
                            ))}
                            {editable ? (
                                <div>
                                    <Button variant="soft" disabled={!chosen.length} loading={busy === 'drivers'} onClick={() => void save()}>
                                        Salvar motoristas
                                    </Button>
                                </div>
                            ) : null}
                        </div>
                    );
                }}
            </Loadable>
        </FormSection>
    );
};

/** Etapa 3: transportador, composição sugerida, veículos e motoristas. Só com a viagem em montagem. */
export const CarrierStep: React.FC<StepProps> = (props) => {
    const { trip, perms } = props;
    const { busy, run } = useAction();
    const editable = perms.editPlanning.allowed;
    const driverIds = (trip.driverAssignments ?? []).slice().sort((a, b) => a.sequence - b.sequence).map((assignment) => assignment.driverId);

    const choose = async (linkId: string | null) => {
        if (linkId === (trip.linkId ?? null)) return;
        const ok = await run(
            'carrier',
            async () => {
                // O servidor só mantém motoristas ligados ao novo transportador; regrava a lista anterior depois.
                await manifestsApi.setResponsible(trip.id, linkId, linkId ? driverIds[0] : undefined);
                if (linkId && driverIds.length > 1) await manifestsApi.setDrivers(trip.id, driverIds);
            },
            { success: linkId ? 'Transportador definido.' : 'Transportador removido.', error: 'Não foi possível trocar o transportador.' },
        );
        if (ok) refreshTrip();
    };

    return (
        <div className="flex flex-col gap-2">
            <Blocked reason={perms.editPlanning.reason} className="mb-3" />
            <FormSection title="Transportador" hint="Aprovado e ativo. Ao trocar, o sistema reaproveita a composição da última viagem dele." cols={1}>
                <Field label="Transportador">
                    <CarrierSelect value={trip.linkId ?? null} emptyOption="Sem transportador" disabled={!editable || busy === 'carrier'} onChange={(id) => void choose(id)} />
                </Field>
                {trip.link ? (
                    <p className="gx-soft text-[13.5px]">
                        {trip.link.name} {trip.link.approvalStatus && trip.link.approvalStatus !== 'APPROVED' ? <Pill tone="yellow">Cadastro não aprovado</Pill> : null}
                    </p>
                ) : null}
            </FormSection>
            {trip.linkId ? (
                <>
                    <Suggestion tripId={trip.id} linkId={trip.linkId} editable={editable} />
                    <Vehicles {...props} editable={editable} />
                    <Drivers tripId={trip.id} linkId={trip.linkId} selected={driverIds} editable={editable} />
                </>
            ) : (
                <p className="gx-muted text-[13.5px]">Escolha o transportador para definir veículos e motoristas.</p>
            )}
        </div>
    );
};
