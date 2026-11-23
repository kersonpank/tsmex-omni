import React, { useEffect, useState } from 'react';
import { pipelineApi } from '../../../../lib/api';
import { deleteConsequence, DEFAULT_COLUMN_COLOR, isHexColor, reorderedIds, validateColumn, type FunnelColumn } from '../../lib/comercialFunnel';
import { stageLabel } from '../../lib/comercial';
import { invalidate, useResource } from '../../lib/resource';
import { Button, Field, Loadable, ModeBadge, TextInput } from '../../ui/kit';
import { Drawer, useAction } from '../../ui/overlay';

const KEY = 'demands:pipeline-columns';

const ColorField: React.FC<{ value: string; onChange: (v: string) => void; label: string }> = ({ value, onChange, label }) => (
    <div className="flex items-center gap-2">
        <input
            type="color"
            aria-label={`${label} (seletor)`}
            className="h-10 w-12 flex-none cursor-pointer rounded border-0 bg-transparent p-0"
            value={isHexColor(value) ? value : DEFAULT_COLUMN_COLOR}
            onChange={(event) => onChange(event.target.value.toUpperCase())}
        />
        <TextInput aria-label={label} value={value} maxLength={7} onChange={(event) => onChange(event.target.value)} className="gx-mono w-[110px]" />
    </div>
);

interface RowProps {
    column: FunnelColumn;
    index: number;
    total: number;
    busy: string | null;
    run: ReturnType<typeof useAction>['run'];
    onMove: (index: number, dir: -1 | 1) => void;
}

const ColumnRow: React.FC<RowProps> = ({ column, index, total, busy, run, onMove }) => {
    const [name, setName] = useState(column.name);
    const [color, setColor] = useState(column.color);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const errors = validateColumn(name, color);
    const changed = name.trim() !== column.name || color.toUpperCase() !== column.color.toUpperCase();
    const count = column._count?.opportunities ?? 0;
    const lock = busy != null;
    const saveKey = `col:save:${column.id}`;
    const delKey = `col:del:${column.id}`;

    useEffect(() => {
        setName(column.name);
        setColor(column.color);
    }, [column.name, column.color]);

    const save = () => run(saveKey, () => pipelineApi.updateColumn(column.id, { name: name.trim(), color }).then(() => invalidate(KEY)), { success: 'Coluna atualizada.', error: 'A coluna não foi atualizada.' });
    const remove = async () => {
        const done = await run(delKey, () => pipelineApi.deleteColumn(column.id).then(() => invalidate(KEY, 'demands:')), {
            success: column.stage ? 'Coluna desativada.' : 'Coluna apagada.',
            error: 'A coluna não foi removida.',
        });
        if (done) setConfirmDelete(false);
    };

    return (
        <li className="gx-inset flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-end gap-3">
                <Field label="Nome" error={errors.name} className="min-w-[200px] flex-1">
                    <TextInput value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
                </Field>
                <Field label="Cor" error={errors.color}>
                    <ColorField label={`Cor de ${column.name}`} value={color} onChange={setColor} />
                </Field>
            </div>
            <p className="gx-muted text-[13px]">
                {column.stage ? `Estágio: ${stageLabel(column.stage)}` : 'Coluna livre'} · {count === 1 ? '1 oportunidade' : `${count} oportunidades`}
            </p>
            <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="soft" loading={busy === saveKey} disabled={!changed || Boolean(errors.name || errors.color) || (lock && busy !== saveKey)} onClick={() => void save()}>
                    Salvar
                </Button>
                <Button size="sm" aria-label={`Subir ${column.name}`} disabled={index === 0 || lock} onClick={() => onMove(index, -1)}>
                    Subir
                </Button>
                <Button size="sm" aria-label={`Descer ${column.name}`} disabled={index === total - 1 || lock} onClick={() => onMove(index, 1)}>
                    Descer
                </Button>
                {confirmDelete ? null : (
                    <Button size="sm" variant="danger" aria-label={`Excluir ${column.name}`} disabled={lock} onClick={() => setConfirmDelete(true)}>
                        Excluir
                    </Button>
                )}
            </div>
            {confirmDelete ? (
                <div className="flex flex-wrap items-center gap-3">
                    <p className="gx-soft min-w-0 flex-1 basis-60 text-[13.5px]">{deleteConsequence(column)}</p>
                    <Button size="sm" variant="danger" loading={busy === delKey} disabled={lock && busy !== delKey} onClick={() => void remove()}>
                        Confirmar
                    </Button>
                    <Button size="sm" disabled={lock} onClick={() => setConfirmDelete(false)}>
                        Voltar
                    </Button>
                </div>
            ) : null}
        </li>
    );
};

/** Colunas do funil: criar, renomear, trocar a cor, reordenar e excluir (as ligadas a um estágio só desativam). */
export const ColumnsDrawer: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const { busy, run } = useAction();
    const columns = useResource<FunnelColumn[]>(KEY, async () => ((await pipelineApi.getColumns()).data ?? []) as FunnelColumn[], { staleMs: 30_000 });
    const [name, setName] = useState('');
    const [color, setColor] = useState(DEFAULT_COLUMN_COLOR);
    const [touched, setTouched] = useState(false);
    const errors = validateColumn(name, color);

    const create = async () => {
        setTouched(true);
        if (errors.name || errors.color) return;
        const done = await run('col:create', () => pipelineApi.createColumn({ name: name.trim(), color }).then(() => invalidate(KEY)), { success: 'Coluna criada.', error: 'A coluna não foi criada.' });
        if (done) {
            setName('');
            setColor(DEFAULT_COLUMN_COLOR);
            setTouched(false);
        }
    };

    const move = (index: number, direction: -1 | 1) => {
        const ids = reorderedIds(columns.data ?? [], index, direction);
        if (!ids) return;
        void run('col:reorder', () => pipelineApi.reorderColumns(ids).then(() => invalidate(KEY)), { success: 'Ordem atualizada.', error: 'A ordem não foi alterada.' });
    };

    if (!open) return null;

    return (
        <Drawer open onClose={onClose} width={640} title="Colunas do funil" subtitle="Como as oportunidades se organizam no pipeline." badge={<ModeBadge mode="manual" />}>
            <div className="flex flex-col gap-6">
                <form
                    className="gx-inset flex flex-col gap-3.5 p-4"
                    noValidate
                    onSubmit={(event) => {
                        event.preventDefault();
                        void create();
                    }}
                >
                    <h3 className="gx-h2">Nova coluna</h3>
                    <div className="flex flex-wrap items-end gap-3">
                        <Field label="Nome da coluna" error={touched ? errors.name : null} className="min-w-[200px] flex-1">
                            <TextInput value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
                        </Field>
                        <Field label="Cor da coluna" error={touched ? errors.color : null}>
                            <ColorField label="Cor da nova coluna" value={color} onChange={setColor} />
                        </Field>
                    </div>
                    <div>
                        <Button type="submit" variant="primary" loading={busy === 'col:create'} disabled={busy != null && busy !== 'col:create'}>
                            Criar coluna
                        </Button>
                    </div>
                </form>
                <Loadable state={columns}>
                    {(list) => (
                        <ul className="flex flex-col gap-3">
                            {list.map((column, index) => (
                                <ColumnRow key={column.id} column={column} index={index} total={list.length} busy={busy} run={run} onMove={move} />
                            ))}
                        </ul>
                    )}
                </Loadable>
            </div>
        </Drawer>
    );
};
