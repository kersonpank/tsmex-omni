import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import { vehicleUnitsApi } from '../../../../lib/api';
import type { VehicleUnit } from '../../../../types/index';
import { normalizePlate } from '../../lib/carrier';
import { osFieldClass } from '../../ui/Sheet';

/**
 * Placa da viagem: busca nas unidades já cadastradas (por papel) e aceita placa digitada
 * quando não existe — o backend cria a unidade ao salvar a composição da viagem.
 */
const PlatePicker: React.FC<{
    label: string;
    role: 'TRACTION' | 'TRAILER';
    value: string;
    onChange: (plate: string) => void;
    onClear?: () => void;
}> = ({ label, role, value, onChange, onClear }) => {
    const [results, setResults] = useState<VehicleUnit[]>([]);
    const [focused, setFocused] = useState(false);
    const plate = normalizePlate(value);

    useEffect(() => {
        if (plate.length < 2) {
            setResults([]);
            return;
        }
        let cancelled = false;
        const timer = setTimeout(() => {
            vehicleUnitsApi
                .search(plate, role)
                .then((body) => {
                    if (!cancelled) setResults((Array.isArray(body.data) ? body.data : []).slice(0, 6));
                })
                .catch(() => {
                    if (!cancelled) setResults([]);
                });
        }, 250);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [plate, role]);

    const exact = results.some((u) => normalizePlate(u.plate) === plate);
    const suggestions = results.filter((u) => normalizePlate(u.plate) !== plate);

    return (
        <div className="mt-2.5 first:mt-0">
            <div className="flex items-end gap-2">
                <label className="block flex-1 text-[12px] font-bold text-tower-500 dark:text-tower-400">
                    {label}
                    <input
                        value={value}
                        onChange={(e) => onChange(normalizePlate(e.target.value).slice(0, 7))}
                        onFocus={() => setFocused(true)}
                        onBlur={() => setTimeout(() => setFocused(false), 150)}
                        placeholder="ABC1D23"
                        autoCapitalize="characters"
                        className={clsx(osFieldClass, 'mt-1 font-mono')}
                    />
                </label>
                {onClear && value ? (
                    <button type="button" onClick={onClear} className="mb-3 text-[13px] font-bold text-tower-500 dark:text-tower-400">
                        Remover
                    </button>
                ) : null}
            </div>
            {plate.length === 7 && !exact && results.length === 0 ? (
                <p className="mt-1 text-[12px] text-tower-500 dark:text-tower-400">Placa nova — será cadastrada ao salvar.</p>
            ) : null}
            {focused && suggestions.length > 0 ? (
                <div className="mt-1 flex flex-col overflow-hidden rounded-xl border border-tower-200 dark:border-tower-700">
                    {suggestions.map((u) => (
                        <button
                            key={u.id}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => onChange(normalizePlate(u.plate))}
                            className="flex min-h-[44px] items-center justify-between gap-2 bg-white px-3 text-left active:bg-tower-50 dark:bg-tower-900 dark:active:bg-tower-800"
                        >
                            <span className="font-mono text-[14px] font-semibold text-tower-900 dark:text-white">{u.plate}</span>
                            <span className="truncate text-[12px] text-tower-500 dark:text-tower-400">
                                {[u.axles ? `${u.axles} eixos` : null, u.ownerName ?? u.rntrcHolderPerson?.legalName].filter(Boolean).join(' · ')}
                            </span>
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
};

export default PlatePicker;
