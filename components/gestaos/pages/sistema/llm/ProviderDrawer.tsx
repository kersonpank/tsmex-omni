import React, { useEffect, useState } from 'react';
import { api } from '../../../../../lib/api';
import { API_FORMAT_LABEL, buildProviderBody, emptyProviderForm, validateProvider, type ApiFormat, type ProviderForm } from '../../../lib/sistemaLlm';
import { invalidate } from '../../../lib/resource';
import { Checkbox } from '../../../ui/form';
import { Button, Field, SelectInput, TextInput } from '../../../ui/kit';
import { Drawer, useAction } from '../../../ui/overlay';
import { LLM_KEY } from './useLlm';

/** Novo provedor próprio (OpenAI, Gemini, Anthropic ou compatível). A chave entra depois, em Adicionar chave. */
export const ProviderDrawer: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const { busy, run } = useAction();
    const [form, setForm] = useState<ProviderForm>(emptyProviderForm());
    const [errors, setErrors] = useState<Record<string, string>>({});
    const set = <K extends keyof ProviderForm>(key: K, value: ProviderForm[K]) => setForm((current) => ({ ...current, [key]: value }));

    useEffect(() => {
        if (open) {
            setForm(emptyProviderForm());
            setErrors({});
        }
    }, [open]);

    const save = async () => {
        const found = validateProvider(form);
        setErrors(found);
        if (Object.keys(found).length > 0) return;
        const ok = await run('provider', () => api.post('/settings/llm/providers', buildProviderBody(form)), { success: 'Provedor criado. Adicione a chave dele em seguida.', error: 'Não foi possível criar o provedor.' });
        if (ok) {
            invalidate(LLM_KEY);
            onClose();
        }
    };

    return (
        <Drawer
            open={open}
            onClose={onClose}
            width={600}
            title="Novo provedor de IA"
            subtitle="Para usar um serviço que não veio cadastrado."
            footer={
                <Button variant="primary" loading={busy === 'provider'} onClick={() => void save()}>
                    Criar provedor
                </Button>
            }
        >
            <form
                className="flex flex-col gap-5"
                noValidate
                onSubmit={(event) => {
                    event.preventDefault();
                    void save();
                }}
            >
                <Field label="Nome" error={errors.name}>
                    <TextInput value={form.name} onChange={(event) => set('name', event.target.value)} placeholder="Ex.: Meu provedor" />
                </Field>
                <Field label="Código" error={errors.code} hint="Letras minúsculas, números, hífen ou sublinhado.">
                    <TextInput value={form.code} onChange={(event) => set('code', event.target.value)} placeholder="meu-provedor" />
                </Field>
                <Field label="Formato da API">
                    <SelectInput value={form.apiFormat} onChange={(event) => set('apiFormat', event.target.value as ApiFormat)} aria-label="Formato da API">
                        {(Object.keys(API_FORMAT_LABEL) as ApiFormat[]).map((format) => (
                            <option key={format} value={format}>
                                {API_FORMAT_LABEL[format]}
                            </option>
                        ))}
                    </SelectInput>
                </Field>
                <Field label="Endereço da API" error={errors.baseUrl}>
                    <TextInput value={form.baseUrl} onChange={(event) => set('baseUrl', event.target.value)} placeholder="https://api.exemplo.com/v1" />
                </Field>
                <Checkbox checked={form.supportsTools} onChange={(value) => set('supportsTools', value)} label="Aceita chamada de funções" />
            </form>
        </Drawer>
    );
};
