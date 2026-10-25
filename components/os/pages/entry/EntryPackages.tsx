import React, { useState } from 'react';
import type { PackageRow } from '../../lib/packages';
import PackageRows from '../order/PackageRows';

/** Medidas dos volumes na entrada — opcional e recolhido: não bloqueia confirmar a entrada. */
const EntryPackages: React.FC<{ rows: PackageRow[]; onChange: (rows: PackageRow[]) => void; expectedUnits?: number | null }> = ({ rows, onChange, expectedUnits }) => {
    const [open, setOpen] = useState(false);
    return (
        <div className="mt-4">
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className="flex min-h-[44px] w-full items-center justify-between text-left text-[13px] font-bold text-tower-600 dark:text-tower-300"
            >
                <span>Medidas dos volumes (opcional)</span>
                <span aria-hidden="true">{open ? '−' : '+'}</span>
            </button>
            {open ? (
                <>
                    <p className="mb-2 text-[12px] text-tower-400">Quantidade × comprimento × largura × altura em cm. Dá o peso cubado do preço e o encaixe no veículo.</p>
                    <PackageRows rows={rows} onChange={onChange} expectedUnits={expectedUnits} />
                </>
            ) : null}
        </div>
    );
};

export default EntryPackages;
