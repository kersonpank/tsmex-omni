import React from 'react';
import { maskPhone } from '../../../../lib/formatters';
import type { ColetaDraft, ColetaErrors } from '../../lib/pedidoForm';
import { Checkbox, FormSection, MoneyInput, NumberInput } from '../../ui/form';
import { Button, Field, TextArea, TextInput } from '../../ui/kit';
import { CepField } from '../../ui/pickers';
import { VolumeRows } from './VolumeRows';

interface Props {
    enabled: boolean;
    onEnable: (enabled: boolean) => void;
    coleta: ColetaDraft;
    errors: ColetaErrors;
    onChange: (coleta: ColetaDraft) => void;
}

/** Coleta no remetente: só quando a carga não chegou direto ao hub. Vai em `collectionData` do pedido. */
export const OrderCollectionSection: React.FC<Props> = ({ enabled, onEnable, coleta, errors, onChange }) => {
    const set = (change: Partial<ColetaDraft>) => onChange({ ...coleta, ...change });
    return (
        <FormSection title="Coleta" hint="Na maioria dos casos a carga chega direto ao hub e não há coleta. Marque se o pedido precisa ser coletado no remetente.">
            <div className="col-span-full">
                <Checkbox checked={enabled} onChange={onEnable} label="Este pedido tem coleta no remetente" />
            </div>
            {enabled ? (
                <>
                    <div className="col-span-full flex flex-col gap-3">
                        <span className="gx-label">Contatos no local</span>
                        {coleta.contacts.map((contact, index) => (
                            <div key={index} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                                <TextInput aria-label={`Contato ${index + 1}: nome`} placeholder="Nome" value={contact.name} onChange={(event) => set({ contacts: coleta.contacts.map((c, i) => (i === index ? { ...c, name: event.target.value } : c)) })} />
                                <TextInput aria-label={`Contato ${index + 1}: telefone`} inputMode="tel" placeholder="Telefone" maxLength={15} value={maskPhone(contact.phone)} onChange={(event) => set({ contacts: coleta.contacts.map((c, i) => (i === index ? { ...c, phone: event.target.value.replace(/\D/g, '') } : c)) })} />
                                <TextInput aria-label={`Contato ${index + 1}: e-mail`} type="email" placeholder="E-mail (opcional)" value={contact.email} onChange={(event) => set({ contacts: coleta.contacts.map((c, i) => (i === index ? { ...c, email: event.target.value } : c)) })} />
                                {coleta.contacts.length > 1 ? (
                                    <Button size="sm" variant="ghost" onClick={() => set({ contacts: coleta.contacts.filter((_, i) => i !== index) })}>
                                        Remover
                                    </Button>
                                ) : (
                                    <span />
                                )}
                            </div>
                        ))}
                        <div>
                            <Button size="sm" variant="soft" onClick={() => set({ contacts: [...coleta.contacts, { name: '', phone: '', email: '' }] })}>
                                Adicionar contato
                            </Button>
                        </div>
                        {errors.contacts ? (
                            <p role="alert" className="gx-red-text text-[12.5px]">
                                {errors.contacts}
                            </p>
                        ) : null}
                    </div>

                    <Field label="CEP" hint="O endereço é preenchido pelo CEP.">
                        <CepField
                            ariaLabel="CEP da coleta"
                            value={coleta.cep}
                            onChange={(cep) => set({ cep })}
                            onResolve={(address) => set({ street: address.street || coleta.street, neighborhood: address.neighborhood || coleta.neighborhood, city: address.city, state: address.state, ibgeCode: address.ibgeCode })}
                        />
                    </Field>
                    <Field label="Rua" error={errors.address}>
                        <TextInput value={coleta.street} aria-invalid={Boolean(errors.address) || undefined} onChange={(event) => set({ street: event.target.value })} />
                    </Field>
                    <Field label="Número">
                        <TextInput value={coleta.number} onChange={(event) => set({ number: event.target.value })} />
                    </Field>
                    <Field label="Complemento">
                        <TextInput value={coleta.complement} onChange={(event) => set({ complement: event.target.value })} />
                    </Field>
                    <Field label="Bairro">
                        <TextInput value={coleta.neighborhood} onChange={(event) => set({ neighborhood: event.target.value })} />
                    </Field>
                    <Field label="Cidade / UF">
                        <TextInput value={[coleta.city, coleta.state].filter(Boolean).join(', ')} readOnly placeholder="Vem do CEP" />
                    </Field>
                    <Field label="Ponto de referência" className="sm:col-span-2">
                        <TextInput value={coleta.referencePoint} onChange={(event) => set({ referencePoint: event.target.value })} />
                    </Field>
                    <Field label="Horário disponível para coleta">
                        <TextInput value={coleta.pickupAvailableTime} placeholder="Ex.: 8h às 17h" onChange={(event) => set({ pickupAvailableTime: event.target.value })} />
                    </Field>
                    <Field label="Mercadoria">
                        <TextInput value={coleta.commodity} onChange={(event) => set({ commodity: event.target.value })} />
                    </Field>
                    <Field label="Peso estimado">
                        <NumberInput decimal suffix="kg" value={coleta.weight} onChange={(weight) => set({ weight })} aria-label="Peso estimado da coleta" />
                    </Field>
                    <Field label="Valor da nota">
                        <MoneyInput value={coleta.nfValue} onChange={(nfValue) => set({ nfValue })} aria-label="Valor da coleta" />
                    </Field>
                    <div className="col-span-full">
                        <span className="gx-label mb-1.5 block">Volumes da coleta</span>
                        <VolumeRows rows={coleta.rows} onChange={(rows) => set({ rows })} label="Volume da coleta" error={errors.rows} />
                    </div>
                    <Field label="Observações da coleta" className="sm:col-span-2">
                        <TextArea value={coleta.pickupNotes} onChange={(event) => set({ pickupNotes: event.target.value })} />
                    </Field>
                    <div className="col-span-full flex flex-wrap gap-x-6">
                        <Checkbox checked={coleta.needsHelper} onChange={(needsHelper) => set({ needsHelper })} label="Precisa de ajudante" />
                        <Checkbox checked={coleta.needsLoading} onChange={(needsLoading) => set({ needsLoading })} label="Precisa de carregamento" />
                    </div>
                </>
            ) : null}
        </FormSection>
    );
};
