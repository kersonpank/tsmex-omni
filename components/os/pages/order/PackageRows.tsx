import React, { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { EMPTY_PACKAGE_ROW, cubedWeightKg, initialPackageRow, packagesVolumeM3, parsePackageRows, volumeCountCheck, type PackageRow } from '../../lib/packages';
import { osFieldClass } from '../../ui/Sheet';

const m3 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const kg = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

const numeric = (value: string) => value.replace(/[^\d.,]/g, '').slice(0, 7);

const GRID = 'grid grid-cols-[0.8fr_1fr_1fr_1fr_40px] gap-1.5';

/** Linhas "Qtd × C × L × A (cm)" com total ao vivo em m³ e peso cubado (m³ × 300). */
const PackageRows: React.FC<{ rows: PackageRow[]; onChange: (rows: PackageRow[]) => void; expectedUnits?: number | null }> = ({ rows, onChange, expectedUnits }) => {
    const formRef = useRef<HTMLFormElement>(null);
    const focusNewRow = useRef(false);
    const set = (index: number, patch: Partial<PackageRow>) => onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    const remove = (index: number) => onChange(rows.length > 1 ? rows.filter((_, i) => i !== index) : [{ ...EMPTY_PACKAGE_ROW }]);
    const volume = packagesVolumeM3(parsePackageRows(rows));
    const check = volumeCountCheck(rows, expectedUnits);
    const fieldClass = clsx(osFieldClass, 'h-[44px] px-2 text-center text-[15px]');

    // Primeira linha vazia já vem com os volumes da NF (ou 1): digitar não exige apagar nada.
    useEffect(() => {
        if (rows.length === 1 && Object.values(rows[0]).every((v) => v === '')) onChange([initialPackageRow(expectedUnits)]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [expectedUnits]);

    // Linha nova: o foco vai direto para a Qtd dela.
    useEffect(() => {
        if (!focusNewRow.current) return;
        focusNewRow.current = false;
        const first = formRef.current?.querySelectorAll<HTMLInputElement>('input[data-pkg-field="0"]');
        first?.[first.length - 1]?.focus();
    }, [rows.length]);

    /** Enter caminha Qtd → C → L → A → Qtd da linha seguinte; no último campo, fecha o teclado. */
    const onFieldKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const fields: HTMLInputElement[] = Array.from(formRef.current?.querySelectorAll<HTMLInputElement>('input[data-pkg-field]') ?? []);
        const next = fields[fields.indexOf(event.currentTarget) + 1];
        if (next) next.focus();
        else event.currentTarget.blur();
    };

    const fieldProps = (index: number, col: number) => ({
        'data-pkg-field': col,
        enterKeyHint: (index === rows.length - 1 && col === 3 ? 'done' : 'next') as 'done' | 'next',
        onKeyDown: onFieldKeyDown,
        className: fieldClass,
    });

    return (
        <div>
            <div className={clsx(GRID, 'mb-1 text-center text-[11px] font-semibold text-tower-400')}>
                <span>Qtd</span>
                <span>C (cm)</span>
                <span>L (cm)</span>
                <span>A (cm)</span>
                <span />
            </div>
            <form ref={formRef} onSubmit={(e) => e.preventDefault()}>
                {rows.map((row, index) => (
                    <div key={index} className={clsx(GRID, 'mb-1.5 items-center')}>
                        <input inputMode="numeric" pattern="[0-9]*" aria-label="Quantidade" value={row.quantity} onChange={(e) => set(index, { quantity: e.target.value.replace(/\D/g, '').slice(0, 5) })} placeholder="1" {...fieldProps(index, 0)} />
                        <input inputMode="decimal" aria-label="Comprimento em cm" value={row.lengthCm} onChange={(e) => set(index, { lengthCm: numeric(e.target.value) })} placeholder="0" {...fieldProps(index, 1)} />
                        <input inputMode="decimal" aria-label="Largura em cm" value={row.widthCm} onChange={(e) => set(index, { widthCm: numeric(e.target.value) })} placeholder="0" {...fieldProps(index, 2)} />
                        <input inputMode="decimal" aria-label="Altura em cm" value={row.heightCm} onChange={(e) => set(index, { heightCm: numeric(e.target.value) })} placeholder="0" {...fieldProps(index, 3)} />
                        <button
                            type="button"
                            tabIndex={-1}
                            aria-label="Remover linha"
                            onClick={() => remove(index)}
                            className="grid h-[44px] w-10 place-items-center rounded-xl text-[18px] text-tower-400 active:bg-tower-100 dark:active:bg-tower-800"
                        >
                            ×
                        </button>
                    </div>
                ))}
            </form>
            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={() => {
                        focusNewRow.current = true;
                        onChange([...rows, { ...EMPTY_PACKAGE_ROW }]);
                    }}
                    className="min-h-11 px-1 text-[13px] font-bold text-brand-600 dark:text-brand-300"
                >
                    + Adicionar outra medida
                </button>
            </div>
            <p className="mt-1 rounded-xl bg-tower-100/70 p-3 text-[14px] font-semibold text-tower-800 dark:bg-tower-800 dark:text-tower-100">
                Total: {m3.format(volume)} m³
                <span className="ml-2 text-[12px] font-normal text-tower-500 dark:text-tower-400">peso cubado {kg.format(cubedWeightKg(volume))} kg</span>
            </p>
            {check.message ? (
                <p
                    role={check.status === 'match' ? undefined : 'status'}
                    className={clsx(
                        'mt-2 text-[13px]',
                        check.status === 'match'
                            ? 'font-medium text-emerald-700 dark:text-emerald-400'
                            : 'rounded-xl bg-amber-500/10 p-3 font-semibold text-amber-700 dark:text-amber-300',
                    )}
                >
                    {check.message}
                </p>
            ) : null}
        </div>
    );
};

export default PackageRows;
