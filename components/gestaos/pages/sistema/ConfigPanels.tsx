import React, { useEffect, useState } from 'react';
import { nfSpeciesApi, orderSequenceApi } from '../../../../lib/api';
import type { NfSpecies } from '../../../../types/index';
import { num } from '../../lib/format';
import { invalidate, useResource } from '../../lib/resource';
import { Checkbox, ConfirmButton, FormFooter, NumberInput } from '../../ui/form';
import { Button, EmptyState, Field, Loadable, Panel, Pill, Skeleton, TextInput } from '../../ui/kit';
import { Drawer, useAction } from '../../ui/overlay';

/* ---------- Espécies de NF ---------- */

const SpeciesDrawer: React.FC<{ open: boolean; species: NfSpecies | null; onClose: () => void }> = ({ open, species, onClose }) => {
    const { busy, run } = useAction();
    const [name, setName] = useState('');
    const [active, setActive] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setName(species?.name ?? '');
        setActive(species?.active ?? true);
        setError(null);
    }, [open, species]);

    const save = async () => {
        if (!name.trim()) {
            setError('Nome é obrigatório.');
            return;
        }
        setError(null);
        const body = { name: name.trim(), active };
        const ok = await run('save', () => (species ? nfSpeciesApi.update(species.id, body) : nfSpeciesApi.create(body)), { success: species ? 'Espécie atualizada.' : 'Espécie criada.', error: 'Não foi possível salvar a espécie.' });
        if (ok) {
            invalidate('system:species');
            onClose();
        }
    };

    return (
        <Drawer
            open={open}
            onClose={onClose}
            width={560}
            title={species ? 'Editar espécie' : 'Nova espécie'}
            footer={
                <FormFooter
                    error={error}
                    secondary={<Button variant="ghost" onClick={onClose}>Cancelar</Button>}
                    primary={<Button variant="primary" loading={busy === 'save'} onClick={() => void save()}>{species ? 'Salvar' : 'Criar espécie'}</Button>}
                />
            }
        >
            <form className="flex flex-col gap-5" onSubmit={(event) => { event.preventDefault(); void save(); }}>
                <Field label="Nome" error={error}>
                    <TextInput value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Volumes" autoFocus />
                </Field>
                <Checkbox checked={active} onChange={setActive} label="Espécie ativa" hint="Espécie inativa não aparece nas notas novas." />
            </form>
        </Drawer>
    );
};

export const SpeciesPanel: React.FC = () => {
    const [editing, setEditing] = useState<NfSpecies | null>(null);
    const [creating, setCreating] = useState(false);
    const { run } = useAction();
    const state = useResource<NfSpecies[]>('system:species', async () => {
        const res = (await nfSpeciesApi.list()) as unknown as { data?: NfSpecies[] };
        return Array.isArray(res.data) ? res.data : [];
    });
    const deactivate = async (item: NfSpecies) => {
        const ok = await run(`off:${item.id}`, () => nfSpeciesApi.delete(item.id), { success: 'Espécie desativada.', error: 'Não foi possível desativar.' });
        if (ok) invalidate('system:species');
        return ok;
    };
    return (
        <Panel title="Espécies de NF" hint="Tipos de volume usados nas notas: volumes, peças, caixas." mode="manual" actions={<Button variant="primary" size="sm" onClick={() => setCreating(true)}>Nova espécie</Button>}>
            <Loadable state={state} skeleton={<Skeleton rows={3} height={48} />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="Nenhuma espécie cadastrada." />}>
                {(items) => (
                    <ul>
                        {items.map((item) => (
                            <li key={item.id} className="gx-hair-b flex flex-wrap items-center gap-3 py-3 last:border-b-0">
                                <span className="min-w-0 flex-1 truncate font-semibold">{item.name}</span>
                                <Pill tone={item.active ? 'neutral' : 'yellow'}>{item.active ? 'Ativa' : 'Inativa'}</Pill>
                                <Button size="sm" variant="soft" onClick={() => setEditing(item)} aria-label={`Editar espécie ${item.name}`}>Editar</Button>
                                {item.active ? <ConfirmButton label="Desativar" confirmLabel="Desativar?" variant="ghost" onConfirm={() => deactivate(item)} /> : null}
                            </li>
                        ))}
                    </ul>
                )}
            </Loadable>
            <SpeciesDrawer open={creating || Boolean(editing)} species={creating ? null : editing} onClose={() => (creating ? setCreating(false) : setEditing(null))} />
        </Panel>
    );
};

/* ---------- Numeração de pedidos ---------- */

export const OrderNumberPanel: React.FC = () => {
    const { busy, run } = useAction();
    const state = useResource('system:order-sequence', async () => (await orderSequenceApi.get()).data ?? null, { staleMs: 30_000 });
    const [value, setValue] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const saved = state.data?.lastNumber;
    useEffect(() => {
        if (saved != null) setValue(saved);
    }, [saved]);

    const save = async () => {
        if (value == null || value < 0) {
            setError('Informe um número igual ou maior que zero.');
            return;
        }
        setError(null);
        const ok = await run('seq', () => orderSequenceApi.update(Math.max(0, Math.round(value))), { success: 'Contador atualizado. O próximo pedido sai com o número seguinte.', error: 'Não foi possível salvar a numeração.' });
        if (ok) invalidate('system:order-sequence');
    };

    return (
        <Panel title="Numeração de pedidos" hint="Último número emitido. O próximo pedido sai com o seguinte." mode="manual">
            <Loadable state={state} skeleton={<Skeleton rows={1} height={48} />}>
                {() => (
                    <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
                        <Field label="Último número emitido" error={error} className="min-w-[220px] flex-1" hint={value != null ? `O próximo será ${num(value + 1)}.` : undefined}>
                            <NumberInput value={value} onChange={setValue} min={0} aria-label="Último número emitido" invalid={Boolean(error)} />
                        </Field>
                        <Button variant="primary" type="submit" loading={busy === 'seq'} disabled={value === saved}>Salvar numeração</Button>
                    </form>
                )}
            </Loadable>
        </Panel>
    );
};
