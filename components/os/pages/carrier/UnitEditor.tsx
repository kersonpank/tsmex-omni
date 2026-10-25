import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import { linksApi, vehicleUnitsApi, type VehicleUnitInput } from '../../../../lib/api';
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
    type UnitForm,
} from '../../lib/carrier';
import { OsButton } from '../../ui/kit';
import OsSheet, { apiErrorMessage, osFieldClass } from '../../ui/Sheet';

/**
 * Uma placa (cavalo ou reboque) com o que CIOT e MDF-e exigem. Salva a composição inteira
 * do transportador: a placa editada com todos os campos; as demais só pela placa (o backend
 * só altera o que é enviado). O responsável RNTRC padrão é o próprio transportador.
 */

const UnitEditor: React.FC<{
    registry: CarrierRegistry;
    unit: RegistryUnit | null;
    role: 'TRACTION' | 'TRAILER';
    onClose: () => void;
    onSaved: () => void;
}> = ({ registry, unit, role, onClose, onSaved }) => {
    const [form, setForm] = useState<UnitForm>(() => {
        const initial = unitToForm(unit, registry.link.document, registry.link.person?.state);
        // Placa nova: o responsável ANTT padrão é o transportador, então o RNTRC dele já vem preenchido.
        return initial.rntrc ? initial : { ...initial, rntrc: registry.link.person?.rntrc ?? '' };
    });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const set = (k: keyof UnitForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
    const [known, setKnown] = useState(false);

    // Placa já cadastrada (global): reaproveita RENAVAM, eixos, RNTRC, tara e capacidade.
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
                if (match) setForm((f) => ({ ...f, ...unitPrefillFromVehicle(match) }));
            })
            .catch(() => {
                if (!cancelled) setKnown(false);
            });
        return () => {
            cancelled = true;
        };
    }, [form.plate, unit, role]);

    const errors = unitFormErrors(form, role);
    const traction = registry.units.find((u) => u.role === 'TRACTION') ?? null;
    const trailers = registry.units.filter((u) => u.role === 'TRAILER');
    const holderName = unit?.rntrcHolder?.name ?? registry.link.name;

    const saveComposition = async (next: { traction: VehicleUnitInput; trailers: VehicleUnitInput[] }) => {
        setBusy(true);
        setError(null);
        try {
            await linksApi.setComposition(registry.link.id, next);
            onSaved();
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível salvar o veículo.'));
            setBusy(false);
        }
    };

    const save = () => {
        const edited = formToUnitInput(form);
        if (role === 'TRACTION') {
            void saveComposition({ traction: edited, trailers: trailers.map((t) => ({ plate: t.plate })) });
            return;
        }
        if (!traction) {
            setError('Cadastre o cavalo antes dos reboques.');
            return;
        }
        const others = trailers.filter((t) => t.plate !== unit?.plate).map((t) => ({ plate: t.plate }));
        const position = unit ? trailers.findIndex((t) => t.plate === unit.plate) : others.length;
        const list = [...others];
        list.splice(Math.max(0, position), 0, edited);
        void saveComposition({ traction: { plate: traction.plate }, trailers: list });
    };

    const remove = () => {
        if (!traction || !unit) return;
        void saveComposition({
            traction: { plate: traction.plate },
            trailers: trailers.filter((t) => t.plate !== unit.plate).map((t) => ({ plate: t.plate })),
        });
    };

    const label = 'mt-3 block text-[13px] font-bold text-tower-600 dark:text-tower-300';
    const input = (text: string, k: keyof UnitForm, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
        <label className={label}>
            {text}
            <input {...props} value={form[k]} onChange={set(k)} className={clsx(osFieldClass, 'mt-1.5')} />
        </label>
    );
    const select = (text: string, k: keyof UnitForm, options: Array<{ value: string; label: string }>) => (
        <label className={label}>
            {text}
            <select value={form[k]} onChange={set(k)} className={clsx(osFieldClass, 'mt-1.5')}>
                <option value="">Selecione…</option>
                {options.map((o) => (
                    <option key={o.value} value={o.value}>
                        {o.label}
                    </option>
                ))}
            </select>
        </label>
    );

    return (
        <OsSheet
            title={unit ? `${role === 'TRACTION' ? 'Cavalo' : 'Reboque'} ${unit.plate}` : role === 'TRACTION' ? 'Cadastrar cavalo' : 'Adicionar reboque'}
            subtitle="Dados exigidos pelo CIOT e pelo MDF-e"
            onClose={onClose}
            footer={
                <>
                    {error ? (
                        <p className="mb-3 rounded-lg bg-brand-red-500/10 p-3 text-[13px] font-semibold text-brand-red-600 dark:text-brand-red-400">{error}</p>
                    ) : errors.length ? (
                        <p className="mb-2 text-center text-[12px] text-brand-red-600">{errors[0]}</p>
                    ) : null}
                    <OsButton full disabled={errors.length > 0 || busy} onClick={save}>
                        {busy ? 'Salvando…' : 'Salvar placa'}
                    </OsButton>
                    {unit && role === 'TRAILER' ? (
                        <OsButton full variant="ghost" className="mt-1" disabled={busy} onClick={remove}>
                            Tirar este reboque da composição
                        </OsButton>
                    ) : null}
                </>
            }
        >
            {unit ? null : input('Placa', 'plate', { placeholder: 'ABC1D23', autoCapitalize: 'characters', onBlur: () => setForm((f) => ({ ...f, plate: normalizePlate(f.plate) })) })}
            {known ? (
                <p className="mt-2 rounded-lg bg-brand-500/10 p-2.5 text-[13px] font-semibold text-brand-600 dark:text-brand-300">
                    Placa já cadastrada — dados reaproveitados.
                </p>
            ) : null}
            {input('RENAVAM', 'renavam', { inputMode: 'numeric' })}
            {input('Chassi (17 caracteres)', 'chassi', { autoCapitalize: 'characters' })}
            <div className="grid grid-cols-2 gap-2">
                {input('Eixos', 'axles', { inputMode: 'numeric' })}
                {select('UF de licenciamento', 'licensedState', UFS.map((uf) => ({ value: uf, label: uf })))}
            </div>
            <div className="grid grid-cols-3 gap-2">
                {input('Tara (kg)', 'tareKg', { inputMode: 'numeric' })}
                {input('Capac. (kg)', 'capacityKg', { inputMode: 'numeric' })}
                {input('Capac. (m³)', 'capacityM3', { inputMode: 'numeric' })}
            </div>
            {select('Tipo de carroceria', 'bodyType', BODY_TYPES)}
            {role === 'TRACTION' ? select('Tipo de rodado', 'wheelType', TRACTION_WHEEL_TYPES) : null}

            <p className="mb-1 mt-5 font-display text-[15px] font-bold text-tower-900 dark:text-white">Responsável na ANTT</p>
            <p className="text-[13px] text-tower-500 dark:text-tower-400">{holderName}</p>
            {input('RNTRC (8 dígitos)', 'rntrc', { inputMode: 'numeric' })}
            {select('Vínculo no MDF-e', 'mdfeOwnerType', OWNER_TYPES)}
        </OsSheet>
    );
};

export default UnitEditor;
