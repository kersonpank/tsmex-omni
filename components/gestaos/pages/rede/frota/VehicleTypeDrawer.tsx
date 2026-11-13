import React, { useState } from 'react';
import { vehicleTypesApi } from '../../../../../lib/api';
import type { VehicleType } from '../../../../../types/index';
import { emptyVehicleType, vehicleTypeBody, vehicleTypeErrors, vehicleTypeToDraft, type VehicleTypeDraft } from '../../../lib/redeFrota';
import { invalidate } from '../../../lib/resource';
import { Button, Field, TextInput } from '../../../ui/kit';
import { Checkbox, FormFooter, FormSection, MoneyInput, NumberInput, useForm } from '../../../ui/form';
import { Drawer, useAction } from '../../../ui/overlay';

/** Criar ou editar um tipo de veículo (capacidade de peso, volume e valor). Só ADMIN escreve no servidor. */
export const VehicleTypeDrawer: React.FC<{ type: VehicleType | null; onClose: () => void }> = ({ type, onClose }) => {
    const { busy, run } = useAction();
    const form = useForm<VehicleTypeDraft>(type ? vehicleTypeToDraft(type) : emptyVehicleType());
    const [error, setError] = useState<string | null>(null);
    const { values, errors } = form;

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError(null);
        const found = vehicleTypeErrors(values);
        for (const [field, message] of Object.entries(found)) form.setError(field as keyof VehicleTypeDraft, message);
        if (Object.keys(found).length) return;
        const body = vehicleTypeBody(values);
        const ok = await run('vt:save', () => (type ? vehicleTypesApi.update(type.id, body) : vehicleTypesApi.create(body)), {
            success: type ? 'Tipo de veículo atualizado.' : 'Tipo de veículo criado.',
            error: 'Não foi possível salvar o tipo de veículo.',
        });
        if (ok) {
            invalidate('links:', 'vehicle-types');
            onClose();
        } else setError('O que você digitou foi mantido. Confira o código (precisa ser único) e tente de novo.');
    };

    return (
        <Drawer
            open
            onClose={onClose}
            width={720}
            title={type ? `Editar ${type.name}` : 'Novo tipo de veículo'}
            footer={<FormFooter error={error} secondary={<Button onClick={onClose}>Cancelar</Button>} primary={<Button type="submit" form="vt-form" variant="primary" loading={busy === 'vt:save'}>Salvar</Button>} />}
        >
            <form id="vt-form" onSubmit={submit} noValidate>
                <FormSection title="Identificação">
                    <Field label="Nome" error={errors.name}>
                        <TextInput value={values.name} onChange={(e) => form.set('name', e.target.value)} aria-invalid={Boolean(errors.name) || undefined} />
                    </Field>
                    <Field label="Código" error={errors.code} hint="Único na rede.">
                        <TextInput className="gx-mono" value={values.code} onChange={(e) => form.set('code', e.target.value.toUpperCase())} aria-invalid={Boolean(errors.code) || undefined} />
                    </Field>
                </FormSection>
                <FormSection title="Capacidade" cols={3}>
                    <Field label="Peso máximo" error={errors.maxWeight}>
                        <NumberInput decimal suffix="kg" value={values.maxWeight} onChange={(v) => form.set('maxWeight', v)} invalid={Boolean(errors.maxWeight)} aria-label="Peso máximo" />
                    </Field>
                    <Field label="Volume máximo" error={errors.maxVolume}>
                        <NumberInput decimal suffix="m³" value={values.maxVolume} onChange={(v) => form.set('maxVolume', v)} invalid={Boolean(errors.maxVolume)} aria-label="Volume máximo" />
                    </Field>
                    <Field label="Valor máximo da carga" error={errors.maxValue}>
                        <MoneyInput value={values.maxValue} onChange={(v) => form.set('maxValue', v)} invalid={Boolean(errors.maxValue)} aria-label="Valor máximo" />
                    </Field>
                </FormSection>
                <FormSection title="Características" cols={1}>
                    <Checkbox checked={values.enclosed} onChange={(v) => form.set('enclosed', v)} label="Carroceria fechada" />
                    <Checkbox checked={values.refrigerated} onChange={(v) => form.set('refrigerated', v)} label="Refrigerado" />
                </FormSection>
            </form>
        </Drawer>
    );
};
