import React from 'react';
import clsx from 'clsx';
import type { CargoForm } from '../../lib/entry';
import { osFieldClass } from '../../ui/Sheet';

/**
 * Carga conferida na DANFE impressa — só quando o XML da NF-e ainda não está no sistema.
 * Volumes viram as etiquetas; peso e valor vão para a viagem, o CT-e e o MDF-e.
 */
const CargoFields: React.FC<{ value: CargoForm; onChange: (next: CargoForm) => void }> = ({ value, onChange }) => {
    const units = Number(value.units.replace(/\D/g, '')) || 0;
    const setUnits = (n: number) => onChange({ ...value, units: n > 0 ? String(n) : '' });

    return (
        <div className="mt-4">
            <p className="text-[13px] font-bold text-tower-600 dark:text-tower-300">Carga</p>
            <p className="mb-2 text-[12px] text-tower-400">Copie da DANFE: quantidade de volumes, peso bruto e valor total da nota.</p>
            {/* div, não label: o rótulo encaminharia o toque ao botão "−". */}
            <div className="text-[12px] font-semibold text-tower-500 dark:text-tower-400">
                Volumes
                <div className="mt-1 flex items-center gap-2">
                    <StepButton label="Menos um volume" onClick={() => setUnits(units - 1)} disabled={units <= 1}>
                        −
                    </StepButton>
                    <div className="w-28">
                        <input
                            inputMode="numeric"
                            value={value.units}
                            onChange={(e) => onChange({ ...value, units: e.target.value.replace(/\D/g, '').slice(0, 5) })}
                            placeholder="0"
                            aria-label="Volumes"
                            className={clsx(osFieldClass, 'text-center text-[18px] font-bold')}
                        />
                    </div>
                    <StepButton label="Mais um volume" onClick={() => setUnits(units + 1)}>
                        +
                    </StepButton>
                </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
                <label className="block text-[12px] font-semibold text-tower-500 dark:text-tower-400">
                    Peso bruto (kg)
                    <input
                        inputMode="decimal"
                        value={value.weight}
                        onChange={(e) => onChange({ ...value, weight: e.target.value })}
                        placeholder="0,00"
                        className={clsx(osFieldClass, 'mt-1')}
                    />
                </label>
                <label className="block text-[12px] font-semibold text-tower-500 dark:text-tower-400">
                    Valor da nota (R$)
                    <input
                        inputMode="decimal"
                        value={value.value}
                        onChange={(e) => onChange({ ...value, value: e.target.value })}
                        placeholder="0,00"
                        className={clsx(osFieldClass, 'mt-1')}
                    />
                </label>
            </div>
        </div>
    );
};

const StepButton: React.FC<{ label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }> = ({
    label,
    onClick,
    disabled,
    children,
}) => (
    <button
        type="button"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        className="grid h-[48px] w-[48px] shrink-0 place-items-center rounded-xl border-2 border-tower-200 text-[22px] font-bold text-tower-700 active:bg-tower-100 disabled:opacity-40 dark:border-tower-600 dark:text-tower-200 dark:active:bg-tower-800"
    >
        {children}
    </button>
);

export default CargoFields;
