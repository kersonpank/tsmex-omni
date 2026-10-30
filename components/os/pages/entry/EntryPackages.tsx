import React from 'react';
import type { PackageRow } from '../../lib/packages';
import CubageFields from '../order/CubageFields';

export const CUBAGE_HINT = 'Necessária para o preço (peso cubado) e para saber se cabe no veículo.';

/** Cubagem na entrada: seção sempre visível. Necessária, mas confirmar a entrada sem ela é decisão do operador. */
const EntryPackages = React.forwardRef<
    HTMLElement,
    {
        rows: PackageRow[];
        onChange: (rows: PackageRow[]) => void;
        onlyTotal: boolean;
        onOnlyTotalChange: (value: boolean) => void;
        total: string;
        onTotalChange: (value: string) => void;
        expectedUnits?: number | null;
    }
>(({ rows, onChange, onlyTotal, onOnlyTotalChange, total, onTotalChange, expectedUnits }, ref) => (
    <section ref={ref} aria-label="Cubagem" className="mt-4">
        <p className="text-[13px] font-bold text-tower-600 dark:text-tower-300">Cubagem (medidas dos volumes)</p>
        <p className="mb-1 text-[12px] text-tower-500 dark:text-tower-400">{CUBAGE_HINT}</p>
        <CubageFields
            rows={rows}
            onRowsChange={onChange}
            onlyTotal={onlyTotal}
            onOnlyTotalChange={onOnlyTotalChange}
            total={total}
            onTotalChange={onTotalChange}
            expectedUnits={expectedUnits}
        />
    </section>
));
EntryPackages.displayName = 'EntryPackages';

export default EntryPackages;
