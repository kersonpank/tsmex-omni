import React, { useEffect, useState } from 'react';
import { hubCoverageApi } from '../../../../../lib/api';
import type { Hub } from '../../../../../types/index';
import { coveragePayload, validateCoverage, type CoverageRow } from '../../../lib/redeCadastro';
import { invalidate, useResource } from '../../../lib/resource';
import { Checkbox, FormFooter, NumberInput } from '../../../ui/form';
import { IconClose } from '../../../ui/icons';
import { Button, EmptyState, Loadable, Skeleton } from '../../../ui/kit';
import { useAction } from '../../../ui/overlay';
import { CityPicker } from '../../../ui/pickers';

/**
 * Cobertura do hub: a tabela de roteamento da rede. Cada cidade aqui faz os pedidos com esse destino
 * cair na fila deste hub; prioridade menor vence quando dois hubs cobrem a mesma cidade.
 */
export const HubCoverage: React.FC<{ hub: Hub }> = ({ hub }) => {
    const key = `hubs:coverage:${hub.id}`;
    const entries = useResource<CoverageRow[]>(
        key,
        async () =>
            ((await hubCoverageApi.list(hub.id)).data ?? []).map((e) => ({
                cityIbgeCode: e.cityIbgeCode, cityName: e.cityName, state: e.state, leadTimeDays: e.leadTimeDays, priority: e.priority, active: e.active,
            })),
        { staleMs: 10_000 },
    );
    const [rows, setRows] = useState<CoverageRow[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const { busy, run } = useAction();

    // O rascunho nasce do que o servidor devolveu e só é trocado de novo ao salvar.
    useEffect(() => {
        if (entries.data && rows == null) setRows(entries.data);
    }, [entries.data, rows]);

    const dirty = rows != null && entries.data != null && JSON.stringify(rows) !== JSON.stringify(entries.data);
    const patch = (code: string, change: Partial<CoverageRow>) => {
        setError(null);
        setRows((current) => (current ?? []).map((row) => (row.cityIbgeCode === code ? { ...row, ...change } : row)));
    };

    const save = async () => {
        if (!rows) return;
        const problem = validateCoverage(rows);
        setError(problem);
        if (problem) return;
        const ok = await run('coverage:save', () => hubCoverageApi.replace(hub.id, coveragePayload(rows)), { success: 'Cobertura salva.', error: 'A cobertura não foi salva.' });
        if (ok) invalidate(key);
    };

    return (
        <div className="flex flex-col gap-5">
            <p className="gx-muted max-w-[60ch] text-[13.5px]">
                Cidades que este hub atende como próximo salto. A cidade-sede ({hub.city}/{hub.state}) já conta sozinha. Prioridade menor vence quando dois hubs cobrem a mesma cidade; prazo em dias é opcional.
            </p>
            <div>
                <span className="gx-label mb-1.5 block">Adicionar cidade</span>
                <CityPicker
                    ariaLabel="Adicionar cidade à cobertura"
                    value={null}
                    onChange={(city) => {
                        if (!city) return;
                        setError(null);
                        setRows((current) => {
                            const list = current ?? [];
                            if (list.some((row) => row.cityIbgeCode === city.ibgeCode)) return list;
                            return [...list, { cityIbgeCode: city.ibgeCode, cityName: city.city, state: city.state, leadTimeDays: null, priority: 100, active: true }];
                        });
                    }}
                />
            </div>
            <Loadable state={entries} skeleton={<Skeleton rows={3} />}>
                {() =>
                    !rows || rows.length === 0 ? (
                        <EmptyState title="Só a cidade-sede" hint="Adicione as cidades que este hub distribui." />
                    ) : (
                        <div className="gx-scroll-x">
                            <table className="gx-table">
                                <thead>
                                    <tr>
                                        <th>Cidade</th>
                                        <th>Prazo (dias)</th>
                                        <th>Prioridade</th>
                                        <th>Situação</th>
                                        <th />
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((row) => (
                                        <tr key={row.cityIbgeCode}>
                                            <td>
                                                <span className="font-semibold">{row.cityName}/{row.state}</span>
                                                <span className="gx-mono gx-soft block text-[12px]">{row.cityIbgeCode}</span>
                                            </td>
                                            <td className="w-[110px]">
                                                <NumberInput aria-label={`Prazo de ${row.cityName}`} value={row.leadTimeDays} min={0} max={60} onChange={(value) => patch(row.cityIbgeCode, { leadTimeDays: value })} />
                                            </td>
                                            <td className="w-[110px]">
                                                <NumberInput aria-label={`Prioridade de ${row.cityName}`} value={row.priority} min={1} max={9999} onChange={(value) => patch(row.cityIbgeCode, { priority: value })} />
                                            </td>
                                            <td>
                                                <Checkbox label="Ativa" checked={row.active} onChange={(checked) => patch(row.cityIbgeCode, { active: checked })} />
                                            </td>
                                            <td className="text-right">
                                                <button type="button" className="gx-icon-btn" aria-label={`Remover ${row.cityName}`} onClick={() => { setError(null); setRows((current) => (current ?? []).filter((r) => r.cityIbgeCode !== row.cityIbgeCode)); }}>
                                                    <IconClose size={16} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )
                }
            </Loadable>
            <FormFooter
                error={error}
                secondary={dirty ? <Button onClick={() => { setError(null); setRows(entries.data); }} disabled={busy != null}>Descartar mudanças</Button> : undefined}
                primary={
                    <Button variant="primary" disabled={!dirty} loading={busy === 'coverage:save'} onClick={() => void save()}>
                        Salvar cobertura{rows ? ` (${rows.length} cidade${rows.length === 1 ? '' : 's'})` : ''}
                    </Button>
                }
            />
        </div>
    );
};
