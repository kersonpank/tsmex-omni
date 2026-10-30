import React from 'react';
import clsx from 'clsx';
import { cubedWeightKg, parseTotalM3, type PackageRow } from '../../lib/packages';
import { osFieldClass } from '../../ui/Sheet';
import PackageRows from './PackageRows';

/** Medidas por volume ou, no atalho, só o m³ total. Compartilhado pela entrada e pelo pedido. */
const CubageFields: React.FC<{
    rows: PackageRow[];
    onRowsChange: (rows: PackageRow[]) => void;
    onlyTotal: boolean;
    onOnlyTotalChange: (value: boolean) => void;
    total: string;
    onTotalChange: (value: string) => void;
    expectedUnits?: number | null;
}> = ({ rows, onRowsChange, onlyTotal, onOnlyTotalChange, total, onTotalChange, expectedUnits }) => (
    <div>
        <button
            type="button"
            onClick={() => onOnlyTotalChange(!onlyTotal)}
            className="mb-2 min-h-[44px] text-[13px] font-bold text-brand-600 dark:text-brand-300"
        >
            {onlyTotal ? 'Informar as medidas de cada volume' : 'Só sei o m³ total'}
        </button>
        {onlyTotal ? (
            <div>
                <label className="block text-[12px] font-semibold text-tower-500 dark:text-tower-400">
                    Cubagem total (m³)
                    <input
                        inputMode="decimal"
                        value={total}
                        onChange={(e) => onTotalChange(e.target.value.replace(/[^\d.,]/g, '').slice(0, 8))}
                        placeholder="0,000"
                        className={clsx(osFieldClass, 'mt-1')}
                    />
                </label>
                <p className="mt-2 text-[12px] text-tower-500 dark:text-tower-400">Peso cubado: {cubedWeightKg(parseTotalM3(total))} kg</p>
            </div>
        ) : (
            <PackageRows rows={rows} onChange={onRowsChange} expectedUnits={expectedUnits} />
        )}
    </div>
);

export default CubageFields;
