import React, { useState } from 'react';
import { linksApi } from '../../../../../lib/api';
import { carrierTypeLabel } from '../../../lib/redeCarriers';
import { carrierKindOptions, newCarrierBody, newCarrierErrors, type NewCarrierDraft } from '../../../lib/redeFrota';
import { invalidate } from '../../../lib/resource';
import { Button, Field, SelectInput, TextInput } from '../../../ui/kit';
import { FormFooter, FormSection, formatPlate, useForm } from '../../../ui/form';
import { Drawer, useAction } from '../../../ui/overlay';
import { PersonPicker, VehicleTypeSelect, type PersonSummary } from '../../../ui/pickers';

const INITIAL: NewCarrierDraft = { document: '', name: '', phone: '', vehiclePlate: '', vehicleTypeId: '', homeBase: '', carrierType: '' };

/** Novo transportador: a pessoa vem do cadastro único; o servidor cria o transportador como "aguardando aprovação". */
export const NewCarrierDrawer: React.FC<{ onClose: () => void; onCreated: (linkId: string) => void }> = ({ onClose, onCreated }) => {
    const { busy, run } = useAction();
    const form = useForm<NewCarrierDraft>(INITIAL);
    const [person, setPerson] = useState<PersonSummary | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const { values, errors } = form;
    const kinds = carrierKindOptions(values.document);

    const pick = (next: PersonSummary | null) => {
        setPerson(next);
        const options = next ? carrierKindOptions(next.document) : [];
        form.setMany({ document: next?.document ?? '', name: next?.legalName ?? '', carrierType: options.length === 1 ? options[0] : '' });
    };

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setSubmitError(null);
        const found = newCarrierErrors(values);
        for (const [field, message] of Object.entries(found)) form.setError(field as keyof NewCarrierDraft, message);
        if (Object.keys(found).length) return;
        let createdId: string | null = null;
        const ok = await run(
            'carrier:new',
            async () => {
                const response = await linksApi.create(newCarrierBody(values));
                createdId = response.data.id;
            },
            { success: 'Transportador cadastrado. Falta aprovar.', error: 'O transportador não foi cadastrado.' },
        );
        if (ok) {
            invalidate('links:', 'vehicle-types');
            if (createdId) onCreated(createdId);
            else onClose();
        } else setSubmitError('Confira os dados e tente de novo. O que você digitou foi mantido.');
    };

    return (
        <Drawer
            open
            onClose={onClose}
            width={720}
            title="Novo transportador"
            subtitle="Entra como aguardando aprovação; depois você completa veículos e motoristas na ficha."
            footer={<FormFooter error={submitError} secondary={<Button onClick={onClose}>Cancelar</Button>} primary={<Button type="submit" form="new-carrier-form" variant="primary" loading={busy === 'carrier:new'}>Cadastrar transportador</Button>} />}
        >
            <form id="new-carrier-form" onSubmit={submit} noValidate>
                <FormSection title="Quem é" mode="copilot" hint="Escolha a pessoa já cadastrada ou cadastre pelo CNPJ/CPF; nome e tipo vêm dela.">
                    <Field label="Pessoa (CPF ou CNPJ)" error={errors.document} className="col-span-full">
                        <PersonPicker value={person} onChange={(next) => pick(next)} ariaLabel="Pessoa do transportador" invalid={Boolean(errors.document)} />
                    </Field>
                    <Field label="Nome" error={errors.name}>
                        <TextInput value={values.name} onChange={(e) => form.set('name', e.target.value)} aria-invalid={Boolean(errors.name) || undefined} />
                    </Field>
                    <Field label="Tipo de transportador" error={errors.carrierType} hint={kinds.length === 1 ? 'Pessoa física é sempre autônomo.' : undefined}>
                        <SelectInput value={values.carrierType} disabled={kinds.length <= 1} onChange={(e) => form.set('carrierType', e.target.value as NewCarrierDraft['carrierType'])}>
                            {kinds.length === 0 ? <option value="">Escolha a pessoa</option> : null}
                            {kinds.length > 1 ? <option value="">Escolher…</option> : null}
                            {kinds.map((k) => (
                                <option key={k} value={k}>{carrierTypeLabel(k)}</option>
                            ))}
                        </SelectInput>
                    </Field>
                </FormSection>
                <FormSection title="Contato e base">
                    <Field label="Telefone com DDD" error={errors.phone}>
                        <TextInput inputMode="tel" value={values.phone} onChange={(e) => form.set('phone', e.target.value)} aria-invalid={Boolean(errors.phone) || undefined} />
                    </Field>
                    <Field label="Base (cidade/UF)" hint="Opcional.">
                        <TextInput value={values.homeBase} onChange={(e) => form.set('homeBase', e.target.value)} />
                    </Field>
                </FormSection>
                <FormSection title="Veículo principal (opcional)" hint="Placa e tipo ajudam a aprovar. Chassi, RENAVAM e o resto ficam na ficha.">
                    <Field label="Placa" error={errors.vehiclePlate}>
                        <TextInput className="gx-mono" value={values.vehiclePlate} onChange={(e) => form.set('vehiclePlate', formatPlate(e.target.value))} placeholder="ABC1D23" aria-invalid={Boolean(errors.vehiclePlate) || undefined} />
                    </Field>
                    <Field label="Tipo de veículo">
                        <VehicleTypeSelect value={values.vehicleTypeId || null} onChange={(id) => form.set('vehicleTypeId', id ?? '')} />
                    </Field>
                </FormSection>
            </form>
        </Drawer>
    );
};
