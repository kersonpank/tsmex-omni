import React, { useEffect, useState } from 'react';
import { orderPackagesApi } from '../../../../lib/api';
import {
    EMPTY_PACKAGE_ROW,
    packagesVolumeM3,
    parsePackageRows,
    parseTotalM3,
    rowsFromPackages,
    volumeCountCheck,
    type PackageRow,
} from '../../lib/packages';
import { OsButton } from '../../ui/kit';
import OsSheet, { apiErrorMessage } from '../../ui/Sheet';
import CubageFields from './CubageFields';

/**
 * CUBAGEM — cubagem por volume (qtd × C × L × A em cm) ou, no atalho, só o m³ total.
 * Alimenta o preço (peso cubado), o "cabe no veículo" e a futura simulação 3D da carga.
 */
const PackagesEditor: React.FC<{ orderId: string; expectedUnits?: number | null; onClose: () => void; onSaved: (volumeM3: number) => void }> = ({ orderId, expectedUnits, onClose, onSaved }) => {
    const [rows, setRows] = useState<PackageRow[]>([{ ...EMPTY_PACKAGE_ROW }]);
    const [onlyTotal, setOnlyTotal] = useState(false);
    const [total, setTotal] = useState('');
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        orderPackagesApi
            .get(orderId)
            .then((body) => {
                if (cancelled) return;
                if (body.data.packages.length > 0) setRows(rowsFromPackages(body.data.packages));
                else if (body.data.volumeM3 > 0.001) {
                    setOnlyTotal(true);
                    setTotal(String(body.data.volumeM3).replace('.', ','));
                }
            })
            .catch(() => undefined)
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, [orderId]);

    const parsed = parsePackageRows(rows);
    const volume = onlyTotal ? parseTotalM3(total) : packagesVolumeM3(parsed);

    const check = onlyTotal ? null : volumeCountCheck(rows, expectedUnits);
    const mismatch = check?.status === 'over' || check?.status === 'under';

    const save = async () => {
        if (volume <= 0 || busy) return;
        setBusy(true);
        setError(null);
        try {
            const body = await orderPackagesApi.set(orderId, onlyTotal ? { packages: [], totalM3: volume } : { packages: parsed });
            onSaved(body.data.volumeM3);
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível salvar as medidas. Tente de novo.'));
            setBusy(false);
        }
    };

    return (
        <OsSheet
            title="Cubagem (medidas dos volumes)"
            subtitle="Necessária para o preço (peso cubado) e para saber se cabe no veículo."
            onClose={onClose}
            footer={
                <>
                    {error ? <p className="mb-3 rounded-lg bg-brand-red-500/10 p-3 text-[13px] font-semibold text-brand-red-600 dark:text-brand-red-400">{error}</p> : null}
                    <OsButton full disabled={loading || busy || volume <= 0} onClick={() => void save()}>
                        {busy ? 'Salvando…' : mismatch ? 'Salvar mesmo assim' : 'Salvar medidas'}
                    </OsButton>
                </>
            }
        >
            {loading ? (
                <p className="text-[13px] text-tower-400">Carregando…</p>
            ) : (
                <>
                    <CubageFields
                        rows={rows}
                        onRowsChange={setRows}
                        onlyTotal={onlyTotal}
                        onOnlyTotalChange={setOnlyTotal}
                        total={total}
                        onTotalChange={setTotal}
                        expectedUnits={expectedUnits}
                    />
                </>
            )}
        </OsSheet>
    );
};

export default PackagesEditor;
