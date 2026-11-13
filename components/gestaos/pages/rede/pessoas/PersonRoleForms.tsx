import React, { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { hubsApi, personsApi } from '../../../../../lib/api';
import type { Person } from '../../../../../types/index';
import { useHubs } from '../../../lib/data';
import { accountErrors, formatPhone, HUB_PERMISSIONS } from '../../../lib/redeCadastro';
import { invalidate } from '../../../lib/resource';
import { Checkbox, FormFooter, FormGrid, FULL_ROW, formatPlate, useForm } from '../../../ui/form';
import { Button, Field, SelectInput, TextInput } from '../../../ui/kit';
import { useAction } from '../../../ui/overlay';
import { VehicleTypeSelect } from '../../../ui/pickers';

interface RoleProps {
    person: Person;
    onDone: () => void;
}

const afterWrite = () => invalidate('persons:', 'clients:', 'links:', 'hubs');

const Actions: React.FC<{ busyKey: string; busy: string | null; label: string; onCancel: () => void }> = ({ busyKey, busy, label, onCancel }) => (
    <FormFooter secondary={<Button onClick={onCancel} disabled={busy != null}>Cancelar</Button>} primary={<Button type="submit" variant="primary" loading={busy === busyKey}>{label}</Button>} />
);

const Err: React.FC<{ message?: string }> = ({ message }) => (message ? <span className="gx-red-text mt-1 block text-[12.5px]">{message}</span> : null);

/** Conta de cliente: login + contato. Só CNPJ; é o caminho único para criar cliente. */
export const ClientAccountForm: React.FC<RoleProps> = ({ person, onDone }) => {
    const form = useForm({ email: '', password: '', contactName: '', phone: '' });
    const { values, errors, set } = form;
    const { busy, run } = useAction();
    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        const found = accountErrors(values);
        form.clearErrors();
        for (const [k, m] of Object.entries(found)) form.setError(k as keyof typeof values, m ?? null);
        if (Object.keys(found).length) return;
        const ok = await run('role:client', () => personsApi.addClient(person.id, { ...values, email: values.email.trim(), contactName: values.contactName.trim(), phone: values.phone.replace(/\D/g, '') }), { success: 'Conta de cliente criada.', error: 'A conta de cliente não foi criada.' });
        if (ok) {
            afterWrite();
            onDone();
        }
    };
    return (
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <p className="gx-muted text-[13.5px]">{person.legalName} passa a ter conta de cliente e login próprio para pedir cotação e acompanhar carga.</p>
            <FormGrid>
                <Field label="Nome do contato" error={errors.contactName}><TextInput value={values.contactName} onChange={(e) => set('contactName', e.target.value)} /></Field>
                <Field label="Telefone" error={errors.phone}><TextInput inputMode="tel" placeholder="(11) 99999-9999" value={formatPhone(values.phone)} onChange={(e) => set('phone', e.target.value.replace(/\D/g, '').slice(0, 11))} /></Field>
                <Field label="E-mail (login)" error={errors.email}><TextInput type="email" autoComplete="off" value={values.email} onChange={(e) => set('email', e.target.value)} /></Field>
                <Field label="Senha" error={errors.password} hint="Mínimo de 6 caracteres."><TextInput type="password" autoComplete="new-password" value={values.password} onChange={(e) => set('password', e.target.value)} /></Field>
            </FormGrid>
            <Actions busyKey="role:client" busy={busy} label="Criar conta de cliente" onCancel={onDone} />
        </form>
    );
};

/** Motorista / transportador: login, veículo e base. */
export const LinkRoleForm: React.FC<RoleProps> = ({ person, onDone }) => {
    const form = useForm({ email: '', password: '', name: person.legalName, phone: '', vehicleTypeId: '', vehiclePlate: '', homeBase: person.city ?? '' });
    const { values, errors, set } = form;
    const { busy, run } = useAction();
    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        const found: Record<string, string> = {};
        if (!values.name.trim()) found.name = 'Informe o nome.';
        if (!values.phone.trim()) found.phone = 'Informe o telefone.';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) found.email = 'Informe um e-mail válido.';
        if (values.password.length < 6) found.password = 'A senha precisa de ao menos 6 caracteres.';
        if (!values.vehicleTypeId) found.vehicleTypeId = 'Escolha o tipo de veículo.';
        if (!values.vehiclePlate) found.vehiclePlate = 'Informe a placa.';
        if (!values.homeBase.trim()) found.homeBase = 'Informe a cidade base.';
        form.clearErrors();
        for (const [k, m] of Object.entries(found)) form.setError(k as keyof typeof values, m);
        if (Object.keys(found).length) return;
        const ok = await run('role:link', () => personsApi.addLink(person.id, { ...values, email: values.email.trim(), name: values.name.trim(), homeBase: values.homeBase.trim(), phone: values.phone.replace(/\D/g, '') }), { success: 'Motorista cadastrado; fica aguardando aprovação em Transportadores.', error: 'O motorista não foi cadastrado.' });
        if (ok) {
            afterWrite();
            onDone();
        }
    };
    return (
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <p className="gx-muted text-[13.5px]">Entra como pendente: aprovar ou recusar é decisão sua, na aba Transportadores.</p>
            <FormGrid>
                <Field label="Nome" error={errors.name}><TextInput value={values.name} onChange={(e) => set('name', e.target.value)} /></Field>
                <Field label="Telefone" error={errors.phone}><TextInput inputMode="tel" placeholder="(11) 99999-9999" value={formatPhone(values.phone)} onChange={(e) => set('phone', e.target.value.replace(/\D/g, '').slice(0, 11))} /></Field>
                <Field label="E-mail (login)" error={errors.email}><TextInput type="email" autoComplete="off" value={values.email} onChange={(e) => set('email', e.target.value)} /></Field>
                <Field label="Senha" error={errors.password} hint="Mínimo de 6 caracteres."><TextInput type="password" autoComplete="new-password" value={values.password} onChange={(e) => set('password', e.target.value)} /></Field>
                <div>
                    <span className="gx-label mb-1.5 block">Tipo de veículo</span>
                    <VehicleTypeSelect value={values.vehicleTypeId || null} invalid={Boolean(errors.vehicleTypeId)} onChange={(id) => set('vehicleTypeId', id ?? '')} />
                    <Err message={errors.vehicleTypeId} />
                </div>
                <Field label="Placa" error={errors.vehiclePlate}><TextInput className="gx-mono" value={values.vehiclePlate} onChange={(e) => set('vehiclePlate', formatPlate(e.target.value))} /></Field>
                <Field label="Cidade base" error={errors.homeBase} className={FULL_ROW}><TextInput value={values.homeBase} onChange={(e) => set('homeBase', e.target.value)} /></Field>
            </FormGrid>
            <Actions busyKey="role:link" busy={busy} label="Cadastrar motorista" onCancel={onDone} />
        </form>
    );
};

/** Login de operador de hub para uma pessoa já cadastrada. */
export const HubOperatorRoleForm: React.FC<RoleProps> = ({ person, onDone }) => {
    const hubs = useHubs();
    const form = useForm({ hubId: '', email: '', password: '', permissions: [] as string[] });
    const { values, errors, set } = form;
    const { busy, run } = useAction();
    const active = (hubs.data ?? []).filter((h) => h.active);
    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        const found: Record<string, string> = {};
        if (!values.hubId) found.hubId = 'Escolha o hub.';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) found.email = 'Informe um e-mail válido.';
        if (values.password.length < 6) found.password = 'A senha precisa de ao menos 6 caracteres.';
        form.clearErrors();
        for (const [k, m] of Object.entries(found)) form.setError(k as keyof typeof values, m);
        if (Object.keys(found).length) return;
        const ok = await run('role:operator', () => personsApi.addHub(person.id, { ...values, email: values.email.trim() }), { success: 'Login de operador criado.', error: 'O login não foi criado.' });
        if (ok) {
            afterWrite();
            onDone();
        }
    };
    if (hubs.data && active.length === 0) {
        return (
            <div className="flex flex-col gap-3">
                <p className="gx-muted text-[13.5px]">Nenhum hub ativo. Crie o hub antes de cadastrar o operador.</p>
                <RouterLink to="/gestaos/rede?aba=hubs&h=novo" className="gx-btn gx-btn-primary self-start">Criar hub</RouterLink>
            </div>
        );
    }
    return (
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <p className="gx-muted text-[13.5px]">Acesso ao sistema para operar um hub. É diferente do CNPJ emissor de CT-e e Minuta.</p>
            <FormGrid>
                <Field label="Hub" error={errors.hubId} className={FULL_ROW}>
                    <SelectInput value={values.hubId} onChange={(e) => set('hubId', e.target.value)} aria-label="Hub do operador">
                        <option value="">Selecione o hub</option>
                        {active.map((h) => <option key={h.id} value={h.id}>{h.name} ({h.code})</option>)}
                    </SelectInput>
                </Field>
                <Field label="E-mail (login)" error={errors.email}><TextInput type="email" autoComplete="off" value={values.email} onChange={(e) => set('email', e.target.value)} /></Field>
                <Field label="Senha" error={errors.password} hint="Mínimo de 6 caracteres."><TextInput type="password" autoComplete="new-password" value={values.password} onChange={(e) => set('password', e.target.value)} /></Field>
                <div className={`${FULL_ROW} flex flex-wrap gap-x-5 gap-y-2`} role="group" aria-label="Permissões">
                    {HUB_PERMISSIONS.map((perm) => (
                        <React.Fragment key={perm.id}><Checkbox label={perm.label} checked={values.permissions.includes(perm.id)} onChange={(c) => set('permissions', c ? [...values.permissions, perm.id] : values.permissions.filter((id) => id !== perm.id))} /></React.Fragment>
                    ))}
                </div>
            </FormGrid>
            <Actions busyKey="role:operator" busy={busy} label="Criar login" onCancel={onDone} />
        </form>
    );
};

/** Vincula o CNPJ da pessoa como emissor de CT-e/Minuta de um hub existente. */
export const EmitterRoleForm: React.FC<RoleProps> = ({ person, onDone }) => {
    const hubs = useHubs();
    const [hubId, setHubId] = useState('');
    const [error, setError] = useState<string | null>(null);
    const { busy, run } = useAction();
    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!hubId) return setError('Escolha o hub.');
        const ok = await run('role:emitter', () => hubsApi.update(hubId, { personId: person.id }), { success: 'CNPJ vinculado como emissor do hub.', error: 'O vínculo não foi salvo.' });
        if (ok) {
            afterWrite();
            onDone();
        }
    };
    return (
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <p className="gx-muted text-[13.5px]">Define a razão social que emite CT-e e Minuta no hub escolhido. Não cria login. A IE passa a ser obrigatória nesta pessoa.</p>
            <Field label="Hub" error={error}>
                <SelectInput value={hubId} onChange={(e) => { setHubId(e.target.value); setError(null); }} aria-label="Hub emissor">
                    <option value="">Selecione o hub</option>
                    {(hubs.data ?? []).map((h) => <option key={h.id} value={h.id}>{h.name} ({h.code}){h.personId === person.id ? ' · já vinculado' : ''}</option>)}
                </SelectInput>
            </Field>
            <Actions busyKey="role:emitter" busy={busy} label="Vincular emissor" onCancel={onDone} />
        </form>
    );
};
