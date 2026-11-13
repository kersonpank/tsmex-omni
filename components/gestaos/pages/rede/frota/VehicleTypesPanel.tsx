import React, { useMemo, useState } from 'react';
import { vehicleTypesApi } from '../../../../../lib/api';
import type { VehicleType } from '../../../../../types/index';
import { num } from '../../../lib/format';
import { matchesVehicleType } from '../../../lib/redeFrota';
import { invalidate, useResource } from '../../../lib/resource';
import { Button, Chip, EmptyState, Loadable, Panel, Pill, Skeleton, TextInput } from '../../../ui/kit';
import { useAction } from '../../../ui/overlay';
import { VehicleTypeDrawer } from './VehicleTypeDrawer';

type Show = 'active' | 'inactive' | 'all';

const money = (v: number) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

/** Tipos de veículo: listar, buscar, criar, editar e ativar/inativar. */
export const VehicleTypesPanel: React.FC = () => {
    const types = useResource<VehicleType[]>('links:vehicle-types', async () => (await vehicleTypesApi.list()).data ?? [], { staleMs: 30_000 });
    const { busy, run } = useAction();
    const [show, setShow] = useState<Show>('active');
    const [query, setQuery] = useState('');
    const [editing, setEditing] = useState<VehicleType | 'new' | null>(null);

    const all = types.data ?? [];
    const visible = useMemo(
        () => all.filter((t) => (show === 'all' || (show === 'active') === t.active) && matchesVehicleType(t, query)).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
        [all, show, query],
    );

    const toggle = async (t: VehicleType) => {
        const ok = await run(`vt:${t.id}`, () => vehicleTypesApi.update(t.id, { active: !t.active }), {
            success: t.active ? `${t.name} inativado.` : `${t.name} reativado.`,
            error: 'Não foi possível alterar o tipo.',
        });
        if (ok) invalidate('links:', 'vehicle-types');
    };

    return (
        <>
            <Panel
                title="Tipos de veículo"
                hint="Capacidade usada na aprovação do transportador e na escolha do veículo da viagem."
                padded={false}
                bodyClassName="flex flex-col gap-4"
                actions={<Button variant="primary" size="sm" onClick={() => setEditing('new')}>Novo tipo</Button>}
            >
                <div className="flex flex-col gap-3 px-5">
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Situação do tipo">
                        <Chip active={show === 'active'} count={types.data ? all.filter((t) => t.active).length : null} onClick={() => setShow('active')}>Ativos</Chip>
                        <Chip active={show === 'inactive'} count={types.data ? all.filter((t) => !t.active).length : null} onClick={() => setShow('inactive')}>Inativos</Chip>
                        <Chip active={show === 'all'} onClick={() => setShow('all')}>Todos</Chip>
                    </div>
                    <TextInput type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nome ou código" aria-label="Buscar tipo de veículo" />
                </div>
                <Loadable state={types} skeleton={<div className="px-5"><Skeleton rows={4} /></div>}>
                    {() =>
                        visible.length === 0 ? (
                            <div className="px-5 pb-5"><EmptyState title={query ? 'Nada encontrado' : 'Nenhum tipo nesta situação'} hint={query ? 'Tire a busca ou troque a situação.' : undefined} /></div>
                        ) : (
                            <div className="gx-scroll-x">
                                <table className="gx-table">
                                    <thead>
                                        <tr><th>Nome</th><th>Código</th><th>Peso</th><th>Volume</th><th>Valor</th><th>Características</th><th>Situação</th><th /></tr>
                                    </thead>
                                    <tbody>
                                        {visible.map((t) => (
                                            <tr key={t.id}>
                                                <td className="font-semibold">{t.name}</td>
                                                <td className="gx-mono">{t.code}</td>
                                                <td className="gx-num">{num(t.maxWeight)} kg</td>
                                                <td className="gx-num">{num(t.maxVolume)} m³</td>
                                                <td className="gx-num">{money(t.maxValue)}</td>
                                                <td className="gx-muted">{[t.enclosed ? 'Fechado' : 'Aberto', t.refrigerated ? 'Refrigerado' : null].filter(Boolean).join(' · ')}</td>
                                                <td><Pill tone={t.active ? 'neutral' : 'yellow'}>{t.active ? 'Ativo' : 'Inativo'}</Pill></td>
                                                <td className="text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <Button size="sm" onClick={() => setEditing(t)}>Editar</Button>
                                                        <Button size="sm" onClick={() => toggle(t)} loading={busy === `vt:${t.id}`} disabled={busy != null}>{t.active ? 'Inativar' : 'Reativar'}</Button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )
                    }
                </Loadable>
            </Panel>
            {editing ? <VehicleTypeDrawer type={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
        </>
    );
};
