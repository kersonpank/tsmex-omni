import React from 'react';
import { emptyVolumeRow, rowsCubageM3, type VolumeRow } from '../../lib/pedidoForm';
import { NumberInput } from '../../ui/form';
import { Button, TextInput } from '../../ui/kit';

const CUBAGE = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6 });

/** Volumes com medidas em cm: a cubagem em m³ sai da soma (quantidade x altura x largura x comprimento). */
export const VolumeRows: React.FC<{ rows: VolumeRow[]; onChange: (rows: VolumeRow[]) => void; label?: string; error?: string | null }> = ({ rows, onChange, label = 'Volume', error }) => {
    const patch = (index: number, change: Partial<VolumeRow>) => onChange(rows.map((row, i) => (i === index ? { ...row, ...change } : row)));
    const cubage = rowsCubageM3(rows);
    return (
        <div className="flex flex-col gap-2.5">
            {rows.map((row, index) => (
                <div key={index} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[88px_1fr_1fr_1fr_auto]">
                    <NumberInput aria-label={`${label} ${index + 1}: quantidade`} placeholder="Qtd" value={row.qty} min={1} onChange={(qty) => patch(index, { qty })} />
                    {(['alturaCm', 'larguraCm', 'comprimentoCm'] as const).map((field) => (
                        <TextInput
                            key={field}
                            inputMode="decimal"
                            className="gx-num"
                            aria-label={`${label} ${index + 1}: ${field === 'alturaCm' ? 'altura' : field === 'larguraCm' ? 'largura' : 'comprimento'} em cm`}
                            placeholder={field === 'alturaCm' ? 'Alt (cm)' : field === 'larguraCm' ? 'Larg (cm)' : 'Comp (cm)'}
                            value={row[field]}
                            onChange={(event) => patch(index, { [field]: event.target.value })}
                        />
                    ))}
                    {rows.length > 1 ? (
                        <Button size="sm" variant="ghost" aria-label={`Remover ${label.toLowerCase()} ${index + 1}`} onClick={() => onChange(rows.filter((_, i) => i !== index))}>
                            Remover
                        </Button>
                    ) : (
                        <span />
                    )}
                </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Button size="sm" variant="soft" onClick={() => onChange([...rows, emptyVolumeRow()])}>
                    Adicionar volume
                </Button>
                {cubage > 0 ? <span className="gx-muted text-[12.5px]">Cubagem pelas medidas: {CUBAGE.format(cubage)} m³</span> : null}
            </div>
            {error ? (
                <p role="alert" className="gx-red-text text-[12.5px]">
                    {error}
                </p>
            ) : null}
        </div>
    );
};
