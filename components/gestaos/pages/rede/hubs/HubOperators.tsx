import React, { useState } from 'react';
import { hubsApi, usersApi } from '../../../../../lib/api';
import type { Hub } from '../../../../../types/index';
import { hubInviteUrl, HUB_PERMISSIONS, permissionsLabel } from '../../../lib/redeCadastro';
import { useResource, invalidate } from '../../../lib/resource';
import { Checkbox, FormFooter, FormGrid, FULL_ROW, useForm, type Rules } from '../../../ui/form';
import { Button, EmptyState, Field, Loadable, Pill, Skeleton, TextInput } from '../../../ui/kit';
import { useAction } from '../../../ui/overlay';
import { PersonPicker, type PersonSummary } from '../../../ui/pickers';
import { isEmail } from '../../../lib/redeCadastro';

interface HubUser {
    id: string;
    email: string;
    active: boolean;
    permissions: string[] | null;
}

const PermissionBoxes: React.FC<{ value: string[]; onChange: (next: string[]) => void }> = ({ value, onChange }) => (
    <div className="flex flex-wrap gap-x-5 gap-y-2" role="group" aria-label="Permissões">
        {HUB_PERMISSIONS.map((perm) => (
            <React.Fragment key={perm.id}>
                <Checkbox label={perm.label} checked={value.includes(perm.id)} onChange={(checked) => onChange(checked ? [...value, perm.id] : value.filter((id) => id !== perm.id))} />
            </React.Fragment>
        ))}
    </div>
);

const OperatorRow: React.FC<{ user: HubUser }> = ({ user }) => {
    const { busy, run } = useAction();
    const [editing, setEditing] = useState(false);
    const [perms, setPerms] = useState<string[]>(user.permissions ?? []);

    const save = async () => {
        const ok = await run(`perm:${user.id}`, () => usersApi.updatePermissions(user.id, perms), { success: 'Permissões atualizadas.', error: 'As permissões não foram salvas.' });
        if (ok) {
            invalidate('hubs:operators:');
            setEditing(false);
        }
    };

    return (
        <li className="gx-inset flex flex-col gap-3 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 break-all font-semibold">{user.email}</p>
                {!user.active ? <Pill tone="yellow">inativo</Pill> : null}
            </div>
            {editing ? (
                <>
                    <PermissionBoxes value={perms} onChange={setPerms} />
                    <div className="flex gap-2">
                        <Button size="sm" variant="primary" loading={busy === `perm:${user.id}`} onClick={() => void save()}>Salvar permissões</Button>
                        <Button size="sm" onClick={() => { setPerms(user.permissions ?? []); setEditing(false); }}>Cancelar</Button>
                    </div>
                </>
            ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="gx-muted text-[13.5px]">{permissionsLabel(user.permissions)}</p>
                    <Button size="sm" onClick={() => setEditing(true)}>Editar permissões</Button>
                </div>
            )}
        </li>
    );
};

interface OperatorValues {
    person: PersonSummary | null;
    email: string;
    password: string;
    permissions: string[];
}

const rules: Rules<OperatorValues> = {
    person: { required: 'Escolha a pessoa (busque por nome ou CPF/CNPJ).' },
    email: { required: 'Informe o e-mail de login.', check: (v) => (!isEmail(v) ? 'E-mail inválido.' : null) },
    password: { required: 'Informe a senha.', minLength: 6, message: 'A senha precisa de ao menos 6 caracteres.' },
};

const AddOperator: React.FC<{ hub: Hub; onDone: () => void }> = ({ hub, onDone }) => {
    const form = useForm<OperatorValues>({ person: null, email: '', password: '', permissions: [] });
    const { values, errors, set } = form;
    const { busy, run } = useAction();

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!form.validate(rules) || !values.person) return;
        const ok = await run(
            'operator:add',
            () => hubsApi.addUser(hub.id, { document: values.person!.document, legalName: values.person!.legalName, email: values.email.trim(), password: values.password, permissions: values.permissions }),
            { success: 'Operador adicionado.', error: 'O operador não foi adicionado.' },
        );
        if (ok) {
            invalidate('hubs:operators:', 'persons:');
            onDone();
        }
    };

    return (
        <form onSubmit={submit} noValidate className="gx-inset flex flex-col gap-4 p-4">
            <h4 className="gx-h2">Novo operador de {hub.name}</h4>
            <FormGrid>
                <div className={FULL_ROW}>
                    <span className="gx-label mb-1.5 block">Pessoa</span>
                    <PersonPicker ariaLabel="Pessoa do operador" value={values.person} invalid={Boolean(errors.person)} onChange={(person) => set('person', person)} />
                    {errors.person ? <span className="gx-red-text mt-1 block text-[12.5px]">{errors.person}</span> : null}
                </div>
                <Field label="E-mail (login)" error={errors.email}>
                    <TextInput type="email" autoComplete="off" value={values.email} onChange={(e) => set('email', e.target.value)} />
                </Field>
                <Field label="Senha" error={errors.password} hint="Mínimo de 6 caracteres.">
                    <TextInput type="password" autoComplete="new-password" value={values.password} onChange={(e) => set('password', e.target.value)} />
                </Field>
                <div className={FULL_ROW}>
                    <span className="gx-label mb-2 block">Permissões</span>
                    <PermissionBoxes value={values.permissions} onChange={(next) => set('permissions', next)} />
                </div>
            </FormGrid>
            <FormFooter
                secondary={<Button onClick={onDone} disabled={busy != null}>Cancelar</Button>}
                primary={<Button type="submit" variant="primary" loading={busy === 'operator:add'}>Adicionar operador</Button>}
            />
        </form>
    );
};

/** Operadores com login do hub: listar, adicionar, ajustar permissões e copiar o link de convite. */
export const HubOperators: React.FC<{ hub: Hub }> = ({ hub }) => {
    const users = useResource<HubUser[]>(`hubs:operators:${hub.id}`, async () => ((await usersApi.list({ role: 'HUB', hubId: hub.id })).data ?? []) as HubUser[], { staleMs: 10_000 });
    const [adding, setAdding] = useState(false);
    const [link, setLink] = useState<string | null>(null);
    const { busy, run } = useAction();

    const copyInvite = async () => {
        let url = '';
        const ok = await run(
            'invite',
            async () => {
                const token = (await hubsApi.createInvite(hub.id)).data.token;
                url = hubInviteUrl(window.location.origin, window.location.pathname, hub.id, token);
                setLink(url);
                await navigator.clipboard?.writeText(url);
            },
            { success: 'Link copiado. Vale por 7 dias; o operador cria a própria conta.', error: 'O link não foi gerado ou copiado.' },
        );
        if (!ok && url) setLink(url);
    };

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="gx-muted max-w-[52ch] text-[13.5px]">Quem entra no sistema para operar este hub. Cadastre direto aqui ou envie o link para o operador criar a própria conta.</p>
                <div className="flex flex-wrap gap-2">
                    {hub.active ? <Button size="sm" loading={busy === 'invite'} onClick={() => void copyInvite()}>Copiar link de convite</Button> : null}
                    {!adding ? <Button size="sm" variant="primary" onClick={() => setAdding(true)}>Adicionar operador</Button> : null}
                </div>
            </div>
            {link ? (
                <Field label="Link de convite">
                    <TextInput readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="gx-mono" />
                </Field>
            ) : null}
            {adding ? <AddOperator hub={hub} onDone={() => setAdding(false)} /> : null}
            <Loadable state={users} skeleton={<Skeleton rows={2} />} empty={<EmptyState title="Nenhum operador com login" hint="Use Adicionar operador ou copie o link de convite." />} isEmpty={(list) => list.length === 0}>
                {(list) => (
                    <ul className="flex flex-col gap-3">
                        {list.map((user) => (
                            <OperatorRow key={user.id} user={user} />
                        ))}
                    </ul>
                )}
            </Loadable>
        </div>
    );
};
