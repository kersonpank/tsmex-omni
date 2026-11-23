import React, { useEffect, useState } from 'react';
import { api } from '../../../../../lib/api';
import { chatConfigBody, chatReady, SELECTION_LABEL, validWeight, type ChatLlmConfig, type LlmModel, type LlmProvider } from '../../../lib/sistemaLlm';
import { invalidate } from '../../../lib/resource';
import { ConfirmButton } from '../../../ui/form';
import { Button, Chip, Field, SelectInput } from '../../../ui/kit';
import { useAction } from '../../../ui/overlay';
import { LLM_KEY } from './useLlm';

interface Props {
    config: ChatLlmConfig | null;
    models: LlmModel[];
    providers: LlmProvider[];
}

const modelLabel = (model: LlmModel) => `${model.name}${model.provider ? ` · ${model.provider.name}` : ''}`;

/** Qual modelo o chat usa: um fixo ou rodízio com pesos. Só entram modelos ativos, com chat e chave no provedor. */
export const ChatConfigSection: React.FC<Props> = ({ config, models, providers }) => {
    const { busy, run } = useAction();
    const ready = models.filter((model) => chatReady(model, providers));
    const mode: 'FIXED' | 'ROTATION' = config?.selectionMode === 'ROTATION' ? 'ROTATION' : 'FIXED';
    const [fixedId, setFixedId] = useState(config?.fixedModelId ?? '');
    const [addId, setAddId] = useState('');
    const [weight, setWeight] = useState('1');

    useEffect(() => {
        setFixedId(config?.fixedModelId ?? '');
    }, [config?.fixedModelId]);

    const rotation = (config?.rotationModels ?? []).filter((item) => item.active);
    const candidates = ready.filter((model) => !rotation.some((item) => item.modelId === model.id));
    const weightNumber = Number(weight);

    const apply = (next: 'FIXED' | 'ROTATION', modelId?: string) =>
        run(`chat:${next}`, () => api.post('/settings/llm/chat-config', chatConfigBody(next, modelId)).then(() => invalidate(LLM_KEY)), {
            success: next === 'FIXED' ? 'O chat usa o modelo escolhido.' : 'O chat passou a usar rodízio.',
            error: 'Não foi possível mudar a configuração do chat.',
        });

    const addRotation = async () => {
        if (!addId || !validWeight(weightNumber)) return;
        const done = await run('chat:add', () => api.post('/settings/llm/chat-config/rotation-models', { modelId: addId, weight: weightNumber }).then(() => invalidate(LLM_KEY)), {
            success: 'Modelo incluído no rodízio.',
            error: 'Não foi possível incluir o modelo.',
        });
        if (done) {
            setAddId('');
            setWeight('1');
        }
    };

    const removeRotation = (id: string) => run(`chat:rm:${id}`, () => api.delete(`/settings/llm/chat-config/rotation-models/${id}`).then(() => invalidate(LLM_KEY)), { success: 'Modelo retirado do rodízio.', error: 'Não foi possível retirar o modelo.' });

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h3 className="gx-h2">Modelo do chat</h3>
                <p className="gx-muted text-[13px]">Atual: {config ? SELECTION_LABEL[config.selectionMode] : 'não configurado'}{config?.fixedModel && config.selectionMode === 'FIXED' ? ` · ${modelLabel(config.fixedModel)}` : ''}.</p>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Como o chat escolhe o modelo">
                <Chip active={mode === 'FIXED'} onClick={() => (mode === 'FIXED' ? undefined : fixedId ? void apply('FIXED', fixedId) : undefined)}>
                    {SELECTION_LABEL.FIXED}
                </Chip>
                <Chip active={mode === 'ROTATION'} onClick={() => (mode === 'ROTATION' ? undefined : void apply('ROTATION'))}>
                    {SELECTION_LABEL.ROTATION}
                </Chip>
            </div>
            {ready.length === 0 ? <p className="gx-yellow-text text-[13.5px]">Nenhum modelo está pronto para o chat: precisa estar ativo, ter chat e a chave do provedor gravada.</p> : null}

            {mode === 'FIXED' ? (
                <div className="flex flex-wrap items-end gap-3">
                    <Field label="Modelo fixo" className="min-w-[240px] flex-1">
                        <SelectInput value={fixedId} onChange={(event) => setFixedId(event.target.value)} aria-label="Modelo fixo do chat">
                            <option value="">Escolha o modelo</option>
                            {ready.map((model) => (
                                <option key={model.id} value={model.id}>
                                    {modelLabel(model)}
                                </option>
                            ))}
                        </SelectInput>
                    </Field>
                    <Button variant="soft" loading={busy === 'chat:FIXED'} disabled={!fixedId || fixedId === config?.fixedModelId || (busy != null && busy !== 'chat:FIXED')} onClick={() => void apply('FIXED', fixedId)}>
                        Usar este no chat
                    </Button>
                </div>
            ) : (
                <div className="flex flex-col gap-3">
                    {rotation.length === 0 ? <p className="gx-muted text-[13.5px]">O rodízio está vazio. Inclua pelo menos um modelo.</p> : null}
                    <ul>
                        {rotation.map((item) => (
                            <li key={item.id} className="gx-hair-b flex flex-wrap items-center gap-3 py-2.5 last:border-b-0">
                                <span className="min-w-0 flex-1 basis-48 truncate font-semibold">{modelLabel(item.model)}</span>
                                <span className="gx-muted text-[13px]">Peso {item.weight}</span>
                                <ConfirmButton label="Retirar" confirmLabel="Retirar do rodízio?" variant="ghost" disabled={busy != null} onConfirm={() => removeRotation(item.id)} />
                            </li>
                        ))}
                    </ul>
                    <div className="flex flex-wrap items-end gap-3">
                        <Field label="Incluir modelo" className="min-w-[240px] flex-1">
                            <SelectInput value={addId} onChange={(event) => setAddId(event.target.value)} aria-label="Modelo para o rodízio">
                                <option value="">Escolha o modelo</option>
                                {candidates.map((model) => (
                                    <option key={model.id} value={model.id}>
                                        {modelLabel(model)}
                                    </option>
                                ))}
                            </SelectInput>
                        </Field>
                        <Field label="Peso (1 a 10)" error={validWeight(weightNumber) ? null : 'Use de 1 a 10.'} className="w-[120px]">
                            <SelectInput value={weight} onChange={(event) => setWeight(event.target.value)} aria-label="Peso no rodízio">
                                {Array.from({ length: 10 }, (_, index) => String(index + 1)).map((value) => (
                                    <option key={value} value={value}>
                                        {value}
                                    </option>
                                ))}
                            </SelectInput>
                        </Field>
                        <Button variant="soft" loading={busy === 'chat:add'} disabled={!addId || (busy != null && busy !== 'chat:add')} onClick={() => void addRotation()}>
                            Incluir
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
};
