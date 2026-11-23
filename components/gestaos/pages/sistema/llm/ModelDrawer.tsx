import React, { useEffect, useState } from 'react';
import { api } from '../../../../../lib/api';
import { buildModelCreate, buildModelUpdate, CAPABILITIES, emptyModelForm, modelToForm, toggleCapability, validateModel, type LlmModel, type LlmProvider, type ModelForm } from '../../../lib/sistemaLlm';
import { invalidate } from '../../../lib/resource';
import { Checkbox } from '../../../ui/form';
import { Button, Field, SelectInput, TextArea, TextInput } from '../../../ui/kit';
import { Drawer, useAction } from '../../../ui/overlay';
import { LLM_KEY } from './useLlm';

interface Props {
    open: boolean;
    /** `null` cria um modelo novo. */
    model: LlmModel | null;
    providers: LlmProvider[];
    onClose: () => void;
}

/** Criar ou editar um modelo. Provedor e identificador só se escolhem na criação (o servidor não deixa trocar). */
export const ModelDrawer: React.FC<Props> = ({ open, model, providers, onClose }) => {
    const { busy, run } = useAction();
    const isNew = !model;
    const [form, setForm] = useState<ModelForm>(emptyModelForm());
    const [errors, setErrors] = useState<Record<string, string>>({});
    const set = <K extends keyof ModelForm>(key: K, value: ModelForm[K]) => setForm((current) => ({ ...current, [key]: value }));

    useEffect(() => {
        if (!open) return;
        setForm(model ? modelToForm(model) : emptyModelForm());
        setErrors({});
    }, [open, model]);

    const save = async () => {
        const found = validateModel(form, isNew);
        setErrors(found);
        if (Object.keys(found).length > 0) return;
        const ok = await run('model', () => (model ? api.patch(`/settings/llm/models/${model.id}`, buildModelUpdate(form)) : api.post('/settings/llm/models', buildModelCreate(form))), {
            success: model ? 'Modelo atualizado.' : 'Modelo criado.',
            error: 'Não foi possível salvar o modelo.',
        });
        if (ok) {
            invalidate(LLM_KEY);
            onClose();
        }
    };

    return (
        <Drawer
            open={open}
            onClose={onClose}
            width={680}
            title={model ? `Editar ${model.name}` : 'Novo modelo'}
            subtitle={model ? model.provider?.name : 'Um modelo de um provedor já cadastrado.'}
            footer={
                <Button variant="primary" loading={busy === 'model'} onClick={() => void save()}>
                    {isNew ? 'Criar modelo' : 'Salvar alterações'}
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
                {isNew ? (
                    <Field label="Provedor" error={errors.providerId}>
                        <SelectInput value={form.providerId} onChange={(event) => set('providerId', event.target.value)} aria-label="Provedor">
                            <option value="">Escolha o provedor</option>
                            {providers.map((provider) => (
                                <option key={provider.id} value={provider.id}>
                                    {provider.name}
                                </option>
                            ))}
                        </SelectInput>
                    </Field>
                ) : null}
                <Field label="Nome de exibição" error={errors.name}>
                    <TextInput value={form.name} onChange={(event) => set('name', event.target.value)} placeholder="Ex.: Modelo rápido" />
                </Field>
                {isNew ? (
                    <Field label="Identificador no provedor" error={errors.modelId} hint="O nome técnico que o provedor usa, como aparece na documentação dele.">
                        <TextInput className="gx-mono" value={form.modelId} onChange={(event) => set('modelId', event.target.value)} />
                    </Field>
                ) : null}
                <Field label="Descrição (opcional)">
                    <TextArea rows={2} value={form.description} onChange={(event) => set('description', event.target.value)} />
                </Field>
                <fieldset className="flex flex-col gap-2">
                    <legend className="gx-label mb-1.5">Capacidades</legend>
                    {CAPABILITIES.map((capability) => (
                        <div key={capability.value}>
                            <Checkbox checked={form.capabilities.includes(capability.value)} onChange={() => set('capabilities', toggleCapability(form.capabilities, capability.value))} label={capability.label} />
                        </div>
                    ))}
                    {errors.capabilities ? <span className="gx-red-text text-[12.5px]">{errors.capabilities}</span> : null}
                </fieldset>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Janela de contexto (tokens)" error={errors.contextWindow}>
                        <TextInput inputMode="numeric" value={form.contextWindow} onChange={(event) => set('contextWindow', event.target.value)} />
                    </Field>
                    <Field label="Saída máxima (tokens)" error={errors.maxOutput}>
                        <TextInput inputMode="numeric" value={form.maxOutput} onChange={(event) => set('maxOutput', event.target.value)} />
                    </Field>
                    <Field label="Preço de entrada por 1M tokens (opcional)" error={errors.inputPrice}>
                        <TextInput inputMode="decimal" value={form.inputPrice} onChange={(event) => set('inputPrice', event.target.value)} />
                    </Field>
                    <Field label="Preço de saída por 1M tokens (opcional)" error={errors.outputPrice}>
                        <TextInput inputMode="decimal" value={form.outputPrice} onChange={(event) => set('outputPrice', event.target.value)} />
                    </Field>
                </div>
            </form>
        </Drawer>
    );
};
