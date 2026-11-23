import React, { useEffect, useRef, useState } from 'react';
import { formatApiError, personsApi } from '../../../../../lib/api';
import type { CiotRecipientSuggestion, Hub, Person } from '../../../../../types/index';
import type { ManifestWithLegs } from '../../../../os/lib/arrival';
import { ciotRecipientFromHub, ciotRecipientFromPerson, ciotRecipientFromSuggestion, ciotRecipientMissing, type CiotAddressState, type CiotFormState } from '../../../../os/lib/ciot';
import { FormGrid, useDebouncedValue } from '../../../ui/form';
import { Button, Field, TextInput } from '../../../ui/kit';
import { CepField, CityPicker } from '../../../ui/pickers';

type Recipient = ReturnType<typeof ciotRecipientFromPerson>;

/** De onde veio o destinatário e o que ainda falta (some conforme a pessoa completa). */
const RecipientNotice: React.FC<{ recipient: CiotRecipientSuggestion | null; missing: string[]; touched: boolean }> = ({ recipient, missing, touched }) => {
    const origin = touched || !recipient ? null : recipient.source === 'ORDER' ? 'Destinatário do pedido desta entrega.' : 'Destinatário: a unidade de destino da viagem.';
    return (
        <div className="col-span-full flex flex-col gap-2" aria-live="polite">
            {origin ? <p className="gx-inset px-3.5 py-2.5 text-[13.5px]">{origin} Pode trocar abaixo.</p> : null}
            {!touched && recipient?.note ? <p className="gx-inset gx-yellow-text px-3.5 py-2.5 text-[13.5px] font-semibold">{recipient.note}</p> : null}
            {missing.length > 0 ? (
                <p role="alert" className="gx-inset gx-yellow-text px-3.5 py-2.5 text-[13.5px] font-semibold">
                    Falta completar: {missing.join(', ')}.
                </p>
            ) : null}
        </div>
    );
};

/** Atalhos (sugerido, hubs, destinatários dos pedidos) e busca de pessoa por nome/CPF/CNPJ. */
const RecipientPicker: React.FC<{ trip: ManifestWithLegs; hubs: Hub[]; suggested: CiotRecipientSuggestion | null; onPick: (recipient: Recipient) => void }> = ({ trip, hubs, suggested, onPick }) => {
    const [query, setQuery] = useState('');
    const debounced = useDebouncedValue(query.trim(), 250);
    const [hits, setHits] = useState<Person[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const version = useRef(0);

    useEffect(() => {
        setHits([]);
        if (debounced.length < 2) return;
        let active = true;
        void personsApi
            .search(debounced)
            .then((response) => active && setHits((response.data ?? []).slice(0, 6)))
            .catch((cause) => active && setError(formatApiError(cause)));
        return () => {
            active = false;
        };
    }, [debounced]);

    const pick = (recipient: Recipient) => {
        version.current++;
        setBusy(false);
        setQuery('');
        setHits([]);
        setError(null);
        onPick(recipient);
    };
    const lookup = async () => {
        const mine = ++version.current;
        setBusy(true);
        setError(null);
        try {
            const data = (await personsApi.lookupDocument(query)).data;
            if (mine !== version.current) return;
            const person = data?.person ?? (data?.suggestion ? { ...data.suggestion, document: query.replace(/\D/g, '') } : null);
            if (person) pick(ciotRecipientFromPerson(person));
            else setError('Documento não encontrado. Confira o CPF/CNPJ ou preencha os dados abaixo.');
        } catch (cause) {
            if (mine === version.current) setError(formatApiError(cause));
        } finally {
            if (mine === version.current) setBusy(false);
        }
    };

    const orderPeople = [...(trip.demands ?? []).map((demand) => demand.order?.destinatarioPerson), ...(trip.legs ?? []).map((leg) => leg.order?.destinatarioPerson)].filter(
        (person, index, all) => person?.document && all.findIndex((other) => other?.document === person.document) === index,
    );
    const digits = query.replace(/\D/g, '').length;
    return (
        <div className="col-span-full flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
                {suggested ? (
                    <Button size="sm" onClick={() => pick(ciotRecipientFromSuggestion(suggested))}>
                        Sugerido: {suggested.name}
                    </Button>
                ) : null}
                {trip.destHub && !suggested ? (
                    <Button size="sm" onClick={() => pick(ciotRecipientFromHub(trip.destHub!))}>
                        Hub destino: {trip.destHub.name}
                    </Button>
                ) : null}
                {hubs
                    .filter((hub) => hub.active && hub.id !== trip.destHubId && hub.id !== trip.hubId)
                    .map((hub) => (
                        <Button key={hub.id} size="sm" onClick={() => pick(ciotRecipientFromHub(hub))}>
                            {hub.name}
                        </Button>
                    ))}
                {orderPeople.map((person) =>
                    person ? (
                        <Button key={person.document} size="sm" onClick={() => pick(ciotRecipientFromPerson(person))}>
                            {person.legalName}
                        </Button>
                    ) : null,
                )}
            </div>
            <Field label="Buscar pessoa">
                <TextInput type="search" aria-label="Buscar destinatário" value={query} placeholder="Nome, CPF ou CNPJ" onChange={(event) => { version.current++; setBusy(false); setError(null); setQuery(event.target.value); }} />
            </Field>
            {hits.map((person) => (
                <Button key={person.id} size="sm" onClick={() => pick(ciotRecipientFromPerson(person))}>
                    {person.legalName} · {person.document}
                </Button>
            ))}
            {digits === 11 || digits === 14 ? (
                <div>
                    <Button size="sm" loading={busy} onClick={() => void lookup()}>
                        Consultar CPF/CNPJ
                    </Button>
                </div>
            ) : null}
            {error ? <p role="alert" className="gx-red-text text-[13px]">{error}</p> : null}
        </div>
    );
};

interface Props {
    trip: ManifestWithLegs;
    hubs: Hub[];
    suggested: CiotRecipientSuggestion | null;
    form: CiotFormState;
    address: CiotAddressState;
    touched: boolean;
    disabled?: boolean;
    onForm: (patch: Partial<CiotFormState>) => void;
    onAddress: (next: CiotAddressState) => void;
    onTouched: () => void;
}

/** Destinatário do CIOT: escolher, conferir e completar nome, documento e endereço fiscal. */
export const CiotRecipient: React.FC<Props> = ({ trip, hubs, suggested, form, address, touched, disabled, onForm, onAddress, onTouched }) => {
    const patch = (next: Partial<CiotAddressState>) => {
        onTouched();
        onAddress({ ...address, ...next });
    };
    return (
        <>
            <RecipientNotice recipient={suggested} missing={ciotRecipientMissing(form, address)} touched={touched} />
            <RecipientPicker
                trip={trip}
                hubs={hubs}
                suggested={suggested}
                onPick={(recipient) => {
                    onTouched();
                    onForm(recipient.form);
                    onAddress(recipient.address);
                }}
            />
            <Field label="Nome ou razão social">
                <TextInput aria-label="Nome do destinatário" disabled={disabled} value={form.destNome} onChange={(event) => { onTouched(); onForm({ destNome: event.target.value }); }} />
            </Field>
            <Field label="CPF/CNPJ">
                <TextInput aria-label="CPF ou CNPJ do destinatário" inputMode="numeric" disabled={disabled} value={form.destCpfCnpj} onChange={(event) => { onTouched(); onForm({ destCpfCnpj: event.target.value }); }} />
            </Field>
            <FormGrid cols={2} className="col-span-full">
                <Field label="CEP">
                    <CepField
                        ariaLabel="CEP do destinatário"
                        disabled={disabled}
                        value={address.cep}
                        onChange={(cep) => patch({ cep, city: '', state: '', cityIbgeCode: '' })}
                        onResolve={(found) =>
                            onAddress({
                                ...address,
                                cep: found.cep,
                                address: found.street || address.address,
                                neighborhood: found.neighborhood || address.neighborhood,
                                city: found.city,
                                state: found.state,
                                cityIbgeCode: found.ibgeCode,
                            })
                        }
                    />
                </Field>
                <Field label="Logradouro">
                    <TextInput aria-label="Logradouro do destinatário" disabled={disabled} value={address.address} onChange={(event) => patch({ address: event.target.value })} />
                </Field>
                <Field label="Número">
                    <TextInput aria-label="Número do endereço" disabled={disabled} value={address.number} onChange={(event) => patch({ number: event.target.value })} />
                </Field>
                <Field label="Complemento">
                    <TextInput aria-label="Complemento" disabled={disabled} value={address.complement} onChange={(event) => patch({ complement: event.target.value })} />
                </Field>
                <Field label="Bairro">
                    <TextInput aria-label="Bairro do destinatário" disabled={disabled} value={address.neighborhood} onChange={(event) => patch({ neighborhood: event.target.value })} />
                </Field>
                <Field label="Cidade">
                    <CityPicker
                        ariaLabel="Cidade do destinatário"
                        disabled={disabled}
                        value={address.cityIbgeCode ? { city: address.city, state: address.state, ibgeCode: address.cityIbgeCode } : null}
                        onChange={(city) => patch(city ? { city: city.city, state: city.state, cityIbgeCode: city.ibgeCode } : { city: '', state: '', cityIbgeCode: '' })}
                    />
                </Field>
            </FormGrid>
        </>
    );
};
