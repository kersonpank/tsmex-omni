import React, { useEffect, useState } from 'react';
import { operationSettingsApi } from '../../../../lib/api';
import type { UserRole } from '../../../../types/index';
import { MANUAL_STATUS_ROLES, sameRoles, toggleManualRole } from '../../lib/sistema';
import { invalidate, useResource } from '../../lib/resource';
import { Button, Loadable, Panel } from '../../ui/kit';
import { useAction } from '../../ui/overlay';

const KEY = 'system:operation-settings';

/** Quem pode trocar o status do pedido à mão. Administrador sempre pode e não sai. */
export const OperationRules: React.FC = () => {
    const state = useResource(KEY, async () => (await operationSettingsApi.get()).data, { staleMs: 60_000 });
    const { busy, run } = useAction();
    const [roles, setRoles] = useState<UserRole[]>(['ADMIN']);
    const saved = state.data?.manualOrderStatusRoles;

    useEffect(() => {
        if (saved) setRoles(saved);
    }, [saved]);

    const dirty = saved ? !sameRoles(roles, saved) : false;

    const save = async () => {
        const ok = await run('roles', () => operationSettingsApi.update(roles), {
            success: 'Permissão de troca manual do status atualizada.',
            error: 'Não foi possível salvar.',
        });
        if (ok) invalidate(KEY);
    };

    return (
        <Panel title="Regras da operação" hint="Quem pode alterar o status do pedido manualmente." mode="manual">
            <Loadable state={state}>
                {() => (
                    <form
                        onSubmit={(event) => {
                            event.preventDefault();
                            void save();
                        }}
                    >
                        <p className="gx-soft text-[13.5px]">Vale para a troca manual de status do pedido. O Administrador sempre pode.</p>
                        <fieldset className="mt-4 flex flex-wrap gap-x-8 gap-y-3 border-0 p-0">
                            <legend className="sr-only">Papéis que podem alterar o status</legend>
                            {MANUAL_STATUS_ROLES.map(({ role, label }) => (
                                <label key={role} className="flex min-h-10 items-center gap-2.5 text-[14.5px]">
                                    <input
                                        type="checkbox"
                                        className="h-[18px] w-[18px]"
                                        checked={role === 'ADMIN' || roles.includes(role)}
                                        disabled={role === 'ADMIN'}
                                        onChange={(event) => setRoles((current) => toggleManualRole(current, role, event.target.checked))}
                                    />
                                    <span>
                                        {label}
                                        {role === 'ADMIN' ? <span className="gx-muted"> (sempre)</span> : null}
                                    </span>
                                </label>
                            ))}
                        </fieldset>
                        <div className="mt-5">
                            <Button type="submit" variant="primary" loading={busy === 'roles'} disabled={!dirty}>
                                Salvar
                            </Button>
                        </div>
                    </form>
                )}
            </Loadable>
        </Panel>
    );
};
