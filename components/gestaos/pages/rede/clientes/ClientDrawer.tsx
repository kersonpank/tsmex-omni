import React from 'react';
import { clientsApi } from '../../../../../lib/api';
import type { Client } from '../../../../../types/index';
import { clientErrors, formatPhone } from '../../../lib/redeCadastro';
import { invalidate } from '../../../lib/resource';
import { FormFooter, FormGrid, FULL_ROW, formatCnpjCpf, useForm } from '../../../ui/form';
import { Button, Field, Kv, TextInput } from '../../../ui/kit';
import { Drawer, useAction } from '../../../ui/overlay';

export type ClientRow = Client & { user?: { email?: string; active?: boolean } | null; _count?: { demands?: number; pricingTables?: number } };

/** Editar contato, telefone e e-mail de login do cliente (PATCH /clients/:id). */
export const ClientDrawer: React.FC<{ client: ClientRow; onOpenPerson: (personId: string) => void; onClose: () => void }> = ({ client, onOpenPerson, onClose }) => {
    const form = useForm({ contactName: client.contactName ?? '', phone: client.phone ?? '', email: client.user?.email ?? '' });
    const { values, errors, set } = form;
    const { busy, run } = useAction();

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        const found = clientErrors(values);
        form.clearErrors();
        for (const [k, m] of Object.entries(found)) form.setError(k as keyof typeof values, m ?? null);
        if (Object.keys(found).length) return;
        const ok = await run(
            'client:edit',
            () => clientsApi.update(client.id, { contactName: values.contactName.trim(), phone: values.phone.replace(/\D/g, '') || values.phone.trim(), email: values.email.trim() }),
            { success: 'Cliente atualizado.', error: 'O cliente não foi salvo.' },
        );
        if (ok) {
            invalidate('clients:', 'persons:');
            onClose();
        }
    };

    return (
        <Drawer open onClose={onClose} width={640} title={client.companyName} subtitle={formatCnpjCpf(client.document)}>
            <form onSubmit={submit} noValidate className="flex flex-col gap-5">
                <div className="gx-inset flex flex-col gap-2 p-4">
                    <Kv label="Documento" mono value={formatCnpjCpf(client.document)} />
                    <Kv label="Pedidos" value={client._count?.demands ?? '—'} />
                    <Kv label="Tabelas de preço" value={client._count?.pricingTables ?? '—'} />
                    {client.personId ? <div><Button size="sm" onClick={() => onOpenPerson(client.personId!)}>Abrir a pessoa (dados fiscais e endereço)</Button></div> : null}
                </div>
                <FormGrid>
                    <Field label="Nome do contato" error={errors.contactName}><TextInput value={values.contactName} onChange={(e) => set('contactName', e.target.value)} /></Field>
                    <Field label="Telefone" error={errors.phone}><TextInput inputMode="tel" value={formatPhone(values.phone)} onChange={(e) => set('phone', e.target.value.replace(/\D/g, '').slice(0, 11))} /></Field>
                    <Field label="E-mail (login do cliente)" error={errors.email} className={FULL_ROW}><TextInput type="email" value={values.email} onChange={(e) => set('email', e.target.value)} /></Field>
                </FormGrid>
                <FormFooter secondary={<Button onClick={onClose} disabled={busy != null}>Cancelar</Button>} primary={<Button type="submit" variant="primary" loading={busy === 'client:edit'}>Salvar cliente</Button>} />
            </form>
        </Drawer>
    );
};
