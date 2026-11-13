import React, { useState } from 'react';
import { personsApi } from '../../../../../lib/api';
import type { PersonContact } from '../../../../../types/index';
import { formatPhone, isEmail } from '../../../lib/redeCadastro';
import { invalidate, useResource } from '../../../lib/resource';
import { FormGrid, FULL_ROW, useForm } from '../../../ui/form';
import { Button, EmptyState, Field, Loadable, Skeleton, TextInput } from '../../../ui/kit';
import { useAction } from '../../../ui/overlay';

const AddContact: React.FC<{ personId: string; onDone: () => void }> = ({ personId, onDone }) => {
    const form = useForm({ name: '', phone: '', email: '', relation: '' });
    const { values, errors, set } = form;
    const { busy, run } = useAction();
    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        form.clearErrors();
        if (!values.name.trim()) return form.setError('name', 'Informe o nome do contato.');
        if (values.email.trim() && !isEmail(values.email)) return form.setError('email', 'E-mail inválido.');
        const ok = await run(
            'contact:add',
            () => personsApi.createContact(personId, { name: values.name.trim(), phone: values.phone.replace(/\D/g, '') || undefined, email: values.email.trim() || undefined, relation: values.relation.trim() || undefined }),
            { success: 'Contato adicionado.', error: 'O contato não foi salvo.' },
        );
        if (ok) {
            invalidate(`persons:contacts:${personId}`, `persons:one:${personId}`);
            onDone();
        }
    };
    return (
        <form onSubmit={submit} noValidate className="gx-inset flex flex-col gap-3 p-4">
            <FormGrid>
                <Field label="Nome" error={errors.name}><TextInput value={values.name} onChange={(e) => set('name', e.target.value)} /></Field>
                <Field label="Função / relação"><TextInput value={values.relation} placeholder="ex.: financeiro" onChange={(e) => set('relation', e.target.value)} /></Field>
                <Field label="Telefone"><TextInput inputMode="tel" value={formatPhone(values.phone)} onChange={(e) => set('phone', e.target.value.replace(/\D/g, '').slice(0, 11))} /></Field>
                <Field label="E-mail" error={errors.email}><TextInput type="email" value={values.email} onChange={(e) => set('email', e.target.value)} /></Field>
            </FormGrid>
            <div className={`${FULL_ROW} flex gap-2`}>
                <Button type="submit" variant="primary" size="sm" loading={busy === 'contact:add'}>Salvar contato</Button>
                <Button size="sm" onClick={onDone} disabled={busy != null}>Cancelar</Button>
            </div>
        </form>
    );
};

/** Contatos da pessoa (nome, telefone, e-mail, relação). O servidor só permite listar e adicionar. */
export const PersonContacts: React.FC<{ personId: string }> = ({ personId }) => {
    const contacts = useResource<PersonContact[]>(`persons:contacts:${personId}`, async () => (await personsApi.getContacts(personId)).data ?? [], { staleMs: 10_000 });
    const [adding, setAdding] = useState(false);
    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
                <h3 className="gx-h2">Contatos</h3>
                {!adding ? <Button size="sm" onClick={() => setAdding(true)}>Adicionar contato</Button> : null}
            </div>
            {adding ? <AddContact personId={personId} onDone={() => setAdding(false)} /> : null}
            <Loadable state={contacts} skeleton={<Skeleton rows={2} height={36} />} empty={<EmptyState title="Nenhum contato" hint="Adicione quem atende esta pessoa." />} isEmpty={(list) => list.length === 0}>
                {(list) => (
                    <ul className="flex flex-col">
                        {list.map((c) => (
                            <li key={c.id} className="gx-hair-b py-2.5 last:border-b-0">
                                <p className="font-semibold">{c.name}{c.relation ? <span className="gx-soft font-normal"> · {c.relation}</span> : null}</p>
                                <p className="gx-muted text-[13px]">{[formatPhone(c.phone), c.email].filter(Boolean).join(' · ') || 'Sem telefone ou e-mail'}</p>
                            </li>
                        ))}
                    </ul>
                )}
            </Loadable>
        </div>
    );
};
