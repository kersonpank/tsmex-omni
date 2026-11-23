import React, { useEffect, useState } from 'react';
import { orderPackagesApi } from '../../../../lib/api';
import {
    EMPTY_PACKAGE_ROW,
    cubedWeightKg,
    initialPackageRow,
    packagesVolumeM3,
    parsePackageRows,
    parseTotalM3,
    rowsFromPackages,
    volumeCountCheck,
    type PackageRow,
} from '../../../os/lib/packages';
import { invalidate, useResource } from '../../lib/resource';
import { Button, Loadable, Skeleton, TextInput } from '../../ui/kit';
import { useAction } from '../../ui/overlay';
import { DrawerBlock } from './DrawerBlock';

interface PackagesData {
    packages: Array<{ quantity: number; lengthCm: number; widthCm: number; heightCm: number }>;
    volumeM3: number;
}

const m3 = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const digits = (value: string) => value.replace(/[^\d.,]/g, '').slice(0, 7);

const Editor: React.FC<{ orderId: string; data: PackagesData; expectedUnits?: number | null }> = ({ orderId, data, expectedUnits }) => {
    const { busy, run } = useAction();
    const startsOnlyTotal = data.packages.length === 0 && data.volumeM3 > 0.001;
    const [rows, setRows] = useState<PackageRow[]>(() => (data.packages.length ? rowsFromPackages(data.packages) : [initialPackageRow(expectedUnits)]));
    const [onlyTotal, setOnlyTotal] = useState(startsOnlyTotal);
    const [total, setTotal] = useState(startsOnlyTotal ? String(data.volumeM3).replace('.', ',') : '');

    // Pedido trocado na gaveta: recomeça com as medidas dele.
    useEffect(() => {
        setRows(data.packages.length ? rowsFromPackages(data.packages) : [initialPackageRow(expectedUnits)]);
        setOnlyTotal(startsOnlyTotal);
        setTotal(startsOnlyTotal ? String(data.volumeM3).replace('.', ',') : '');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orderId]);

    const parsed = parsePackageRows(rows);
    const volume = onlyTotal ? parseTotalM3(total) : packagesVolumeM3(parsed);
    const check = onlyTotal ? null : volumeCountCheck(rows, expectedUnits);
    const set = (index: number, patch: Partial<PackageRow>) => setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

    const save = async () => {
        if (volume <= 0) return;
        const ok = await run('packages', () => orderPackagesApi.set(orderId, onlyTotal ? { packages: [], totalM3: volume } : { packages: parsed }), {
            success: 'Medidas salvas. O frete automático foi recalculado.',
            error: 'As medidas não foram salvas.',
        });
        if (ok) invalidate(`orders:packages:${orderId}`, 'orders:list', 'orders:aggregate');
    };

    return (
        <>
            <button type="button" className="gx-royal-text mb-2 min-h-10 text-[13px] font-semibold underline" onClick={() => setOnlyTotal(!onlyTotal)}>
                {onlyTotal ? 'Informar as medidas de cada volume' : 'Só sei o m³ total'}
            </button>
            {onlyTotal ? (
                <TextInput inputMode="decimal" aria-label="Cubagem total em m³" value={total} onChange={(event) => setTotal(digits(event.target.value))} placeholder="Cubagem total (m³)" />
            ) : (
                <div className="flex flex-col gap-2">
                    <div className="gx-label grid grid-cols-[0.8fr_1fr_1fr_1fr_40px] gap-2 text-center">
                        <span>Qtd</span>
                        <span>C (cm)</span>
                        <span>L (cm)</span>
                        <span>A (cm)</span>
                        <span />
                    </div>
                    {rows.map((row, index) => (
                        <div key={index} className="grid grid-cols-[0.8fr_1fr_1fr_1fr_40px] items-center gap-2">
                            <TextInput inputMode="numeric" aria-label={`Quantidade, linha ${index + 1}`} value={row.quantity} onChange={(event) => set(index, { quantity: event.target.value.replace(/\D/g, '').slice(0, 5) })} className="text-center" />
                            <TextInput inputMode="decimal" aria-label={`Comprimento em cm, linha ${index + 1}`} value={row.lengthCm} onChange={(event) => set(index, { lengthCm: digits(event.target.value) })} className="text-center" />
                            <TextInput inputMode="decimal" aria-label={`Largura em cm, linha ${index + 1}`} value={row.widthCm} onChange={(event) => set(index, { widthCm: digits(event.target.value) })} className="text-center" />
                            <TextInput inputMode="decimal" aria-label={`Altura em cm, linha ${index + 1}`} value={row.heightCm} onChange={(event) => set(index, { heightCm: digits(event.target.value) })} className="text-center" />
                            <button
                                type="button"
                                aria-label={`Remover linha ${index + 1}`}
                                className="gx-muted h-10 w-10 text-[18px]"
                                onClick={() => setRows(rows.length > 1 ? rows.filter((_, i) => i !== index) : [{ ...EMPTY_PACKAGE_ROW }])}
                            >
                                ×
                            </button>
                        </div>
                    ))}
                    <div>
                        <Button size="sm" variant="ghost" onClick={() => setRows([...rows, { ...EMPTY_PACKAGE_ROW }])}>
                            Adicionar outra medida
                        </Button>
                    </div>
                </div>
            )}
            <p className="mt-2 text-[14px] font-semibold">
                Total: {m3(volume)} m³ <span className="gx-muted text-[12.5px] font-normal">· peso cubado {m3(cubedWeightKg(volume))} kg</span>
            </p>
            {check?.message ? <p className={check.status === 'match' ? 'gx-muted mt-1 text-[12.5px]' : 'gx-yellow-text mt-1 text-[12.5px] font-semibold'}>{check.message}</p> : null}
            <div className="mt-3">
                <Button size="sm" variant="soft" loading={busy === 'packages'} disabled={volume <= 0} onClick={() => void save()}>
                    {check?.status === 'over' || check?.status === 'under' ? 'Salvar mesmo assim' : 'Salvar medidas'}
                </Button>
            </div>
        </>
    );
};

/** Volumes do pedido (cubagem): as mesmas medidas do O.S., usadas no peso cubado e no "cabe no veículo". */
export const OrderPackages: React.FC<{ orderId: string; expectedUnits?: number | null }> = ({ orderId, expectedUnits }) => {
    const state = useResource<PackagesData>(`orders:packages:${orderId}`, async () => (await orderPackagesApi.get(orderId)).data, { staleMs: 15_000 });
    return (
        <DrawerBlock title="Volumes e cubagem" mode="manual">
            <Loadable state={state} skeleton={<Skeleton rows={2} height={40} />}>
                {(data) => <Editor key={orderId} orderId={orderId} data={data} expectedUnits={expectedUnits} />}
            </Loadable>
        </DrawerBlock>
    );
};
