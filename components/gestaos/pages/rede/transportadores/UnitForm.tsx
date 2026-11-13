import React, { useEffect, useState } from 'react';
import { linksApi, vehicleUnitsApi } from '../../../../../lib/api';
import {
    BODY_TYPES,
    OWNER_TYPES,
    TRACTION_WHEEL_TYPES,
    UFS,
    formToUnitInput,
    normalizePlate,
    unitFormErrors,
    unitPrefillFromVehicle,
    unitToForm,
    type CarrierRegistry,
    type RegistryUnit,
    type UnitForm as UnitFormValues,
} from '../../../../os/lib/carrier';
import { invalidate } from '../../../lib/resource';
import { Button, Field, ModeBadge, SelectInput, TextInput } from '../../../ui/kit';
import { FormFooter, FormSection, formatPlate } from '../../../ui/form';
import { useAction } from '../../../ui/overlay';

/**
 * Uma placa (cavalo ou reboque) com o que CIOT e MDF-e exigem. Salva a composição padrão do
 * transportador (PUT /links/:id/composition), como a ficha do hub.
 */
export const UnitForm: React.FC<{
    registry: CarrierRegistry;
    unit: RegistryUnit | null;
    role: 'TRACTION' | 'TRAILER';
    onDone: () => void;
    onCancel: () => void;
}> = ({ registry, unit, role, onDone, onCancel }) => {
    const { busy, run } = useAction();
    const [form, setForm] = useState<UnitFormValues>(() => {
        const initial = unitToForm(unit, registry.link.document, registry.link.person?.state);
        return initial.rntrc ? initial : { ...initial, rntrc: registry.link.person?.rntrc ?? '' };
    });
    const [known, setKnown] = useState(false);
    const [touched, setTouched] = useState(false);
    const set = (key: keyof UnitFormValues, value: string) => setForm((current) => ({ ...current, [key]: value }));

    useEffect(() => {
        const plate = normalizePlate(form.plate);
        if (unit || plate.length !== 7) {
            setKnown(false);
            return;
        }
        let cancelled = false;
        vehicleUnitsApi
            .search(plate, role)
            .then((body) => {
                const match = (Array.isArray(body.data) ? body.data : []).find((u) => normalizePlate(u.plate) === plate);
                if (cancelled) return;
                setKnown(Boolean(match));
                if (match) setForm((current) => ({ ...current, ...unitPrefillFromVehicle(match) }));
            })
            .catch(() => !cancelled && setKnown(false));
        return () => {
            cancelled = true;
        };
    }, [form.plate, unit, role]);

    const errors = unitFormErrors(form, role);
    const traction = registry.units.find((u) => u.role === 'TRACTION') ?? null;
    const trailers = registry.units.filter((u) => u.role === 'TRAILER');
    const plateError = touched ? errors.find((e) => e.startsWith('Placa')) : undefined;
    const fieldError = (prefix: string) => (touched ? errors.find((e) => e.startsWith(prefix)) : undefined);

    const persist = async (next: Parameters<typeof linksApi.setComposition>[1], success: string) => {
        const ok = await run('unit:save', () => linksApi.setComposition(registry.link.id, next), { success, error: 'Não foi possível salvar o veículo.' });
        if (ok) {
            invalidate('links:', 'vehicle-types');
            onDone();
        }
    };

    const save = (event: React.FormEvent) => {
        event.preventDefault();
        setTouched(true);
        if (errors.length) return;
        const edited = formToUnitInput(form);
        if (role === 'TRACTION') return void persist({ traction: edited, trailers: trailers.map((t) => ({ plate: t.plate })) }, 'Veículo salvo.');
        if (!traction) return void persist({ traction: edited, trailers: [] }, 'Veículo salvo.');
        const others = trailers.filter((t) => t.plate !== unit?.plate).map((t) => ({ plate: t.plate }));
        const position = unit ? trailers.findIndex((t) => t.plate === unit.plate) : others.length;
        const list = [...others];
        list.splice(Math.max(0, position), 0, edited);
        void persist({ traction: { plate: traction.plate }, trailers: list }, 'Reboque salvo.');
    };

    const remove = () => {
        if (!traction || !unit) return;
        void persist({ traction: { plate: traction.plate }, trailers: trailers.filter((t) => t.plate !== unit.plate).map((t) => ({ plate: t.plate })) }, 'Reboque retirado da composição.');
    };

    return (
        <form onSubmit={save} noValidate>
            <FormSection title={unit ? `${role === 'TRACTION' ? 'Cavalo' : 'Reboque'} ${unit.plate}` : role === 'TRACTION' ? 'Cavalo ou veículo de carga' : 'Novo reboque'} hint="Dados exigidos pelo CIOT e pelo MDF-e.">
                {unit ? null : (
                    <Field label="Placa" error={plateError} hint={known ? 'Placa já cadastrada: dados reaproveitados.' : undefined}>
                        <TextInput className="gx-mono" value={form.plate} placeholder="ABC1D23" onChange={(e) => set('plate', formatPlate(e.target.value))} aria-invalid={Boolean(plateError) || undefined} />
                    </Field>
                )}
                {known ? <p className="col-span-full flex items-center gap-2 text-[13px]"><ModeBadge mode="copilot" /> Preenchido a partir do cadastro da placa.</p> : null}
                <Field label="RENAVAM" error={fieldError('RENAVAM')}>
                    <TextInput inputMode="numeric" value={form.renavam} onChange={(e) => set('renavam', e.target.value)} />
                </Field>
                <Field label="Chassi (17 caracteres)" error={fieldError('Chassi')}>
                    <TextInput className="gx-mono" value={form.chassi} onChange={(e) => set('chassi', e.target.value.toUpperCase())} />
                </Field>
                <Field label="Eixos">
                    <TextInput inputMode="numeric" value={form.axles} onChange={(e) => set('axles', e.target.value)} />
                </Field>
                <Field label="UF de licenciamento">
                    <SelectInput value={form.licensedState} onChange={(e) => set('licensedState', e.target.value)}>
                        <option value="">Escolher…</option>
                        {UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                    </SelectInput>
                </Field>
                <Field label="Tara (kg)">
                    <TextInput inputMode="numeric" value={form.tareKg} onChange={(e) => set('tareKg', e.target.value)} />
                </Field>
                <Field label="Capacidade (kg)">
                    <TextInput inputMode="numeric" value={form.capacityKg} onChange={(e) => set('capacityKg', e.target.value)} />
                </Field>
                <Field label="Capacidade (m³)">
                    <TextInput inputMode="numeric" value={form.capacityM3} onChange={(e) => set('capacityM3', e.target.value)} />
                </Field>
                <Field label="Carroceria">
                    <SelectInput value={form.bodyType} onChange={(e) => set('bodyType', e.target.value)}>
                        <option value="">Escolher…</option>
                        {BODY_TYPES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                    </SelectInput>
                </Field>
                {role === 'TRACTION' ? (
                    <Field label="Rodado" error={fieldError('Escolha o tipo de rodado')}>
                        <SelectInput value={form.wheelType} onChange={(e) => set('wheelType', e.target.value)}>
                            <option value="">Escolher…</option>
                            {TRACTION_WHEEL_TYPES.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                        </SelectInput>
                    </Field>
                ) : null}
            </FormSection>
            <FormSection title="Responsável na ANTT" mode="copilot" hint={`Por padrão é o próprio transportador (${registry.link.name}); o RNTRC dele já vem preenchido.`}>
                <Field label="RNTRC (8 dígitos)" error={fieldError('RNTRC')}>
                    <TextInput className="gx-mono" inputMode="numeric" value={form.rntrc} onChange={(e) => set('rntrc', e.target.value)} />
                </Field>
                <Field label="Vínculo no MDF-e">
                    <SelectInput value={form.mdfeOwnerType} onChange={(e) => set('mdfeOwnerType', e.target.value)}>
                        <option value="">Escolher…</option>
                        {OWNER_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </SelectInput>
                </Field>
            </FormSection>
            <FormFooter
                secondary={
                    <>
                        <Button onClick={onCancel} disabled={busy != null}>Voltar à ficha</Button>
                        {unit && role === 'TRAILER' ? <Button variant="danger" onClick={remove} disabled={busy != null}>Tirar da composição</Button> : null}
                    </>
                }
                primary={<Button type="submit" variant="primary" loading={busy === 'unit:save'}>Salvar veículo</Button>}
            />
        </form>
    );
};
