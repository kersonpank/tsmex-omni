import React, { useState } from 'react';
import { api } from '../../../../lib/api';
import { API_FORMAT_LABEL, CAPABILITIES, describeTest, type LlmModel, type LlmProvider, type ModelTestResult } from '../../lib/sistemaLlm';
import { invalidate } from '../../lib/resource';
import { ConfirmButton } from '../../ui/form';
import { Button, EmptyState, Loadable, Panel, Pill, Skeleton } from '../../ui/kit';
import { useAction } from '../../ui/overlay';
import { ChatConfigSection } from './llm/ChatConfigSection';
import { KeyDrawer } from './llm/KeyDrawer';
import { ModelDrawer } from './llm/ModelDrawer';
import { ProviderDrawer } from './llm/ProviderDrawer';
import { LLM_KEY, useLlm } from './llm/useLlm';

const capabilityText = (model: LlmModel) => (model.capabilities ?? []).map((value) => CAPABILITIES.find((c) => c.value === value)?.label ?? value).join(', ');

/** Modelos de IA completos: provedores e chaves, modelos (criar, editar, testar, excluir) e como o chat escolhe. A chave nunca é mostrada. */
export const LlmPanel: React.FC = () => {
    const { busy, run } = useAction();
    const { providers, models, chatConfig } = useLlm();
    const [keyFor, setKeyFor] = useState<LlmProvider | null>(null);
    const [newProvider, setNewProvider] = useState(false);
    const [editing, setEditing] = useState<{ model: LlmModel | null } | null>(null);
    const [tests, setTests] = useState<Record<string, { ok: boolean; message: string }>>({});

    const makeDefault = (model: LlmModel) => run(`default:${model.id}`, () => api.post(`/settings/llm/models/${model.id}/set-default`).then(() => invalidate(LLM_KEY)), { success: `${model.name} é o modelo padrão.`, error: 'Não foi possível trocar o modelo.' });
    const toggleActive = (model: LlmModel) => run(`active:${model.id}`, () => api.patch(`/settings/llm/models/${model.id}`, { active: !model.active }).then(() => invalidate(LLM_KEY)), { success: model.active ? 'Modelo desativado.' : 'Modelo ativado.', error: 'Não foi possível mudar o modelo.' });
    const removeModel = async (model: LlmModel) => {
        const ok = await run(`del:${model.id}`, () => api.delete(`/settings/llm/models/${model.id}`).then(() => invalidate(LLM_KEY)), { success: 'Modelo removido.', error: 'Não foi possível remover o modelo.' });
        return ok;
    };
    const removeKey = (provider: LlmProvider) => run(`rm:${provider.id}`, () => api.delete(`/settings/llm/api-keys/${provider.id}`).then(() => invalidate(LLM_KEY)), { success: 'Chave removida.', error: 'Não foi possível remover a chave.' });
    const testModel = async (model: LlmModel) => {
        let result: ModelTestResult | null = null;
        await run(`test:${model.id}`, async () => {
            result = ((await api.post<{ data: ModelTestResult }>(`/settings/llm/models/${model.id}/test`)).data.data ?? null) as ModelTestResult | null;
        }, { success: 'Teste concluído.', error: 'Não foi possível testar o modelo.' });
        if (result) setTests((current) => ({ ...current, [model.id]: describeTest(result) }));
    };

    return (
        <Panel title="Modelos de IA" hint="Provedores, chaves, modelos e o modelo que o chat usa. A chave nunca é mostrada, só o final." mode="manual">
            <div className="flex flex-col gap-8">
                <section className="flex flex-col gap-3" aria-label="Provedores">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <h3 className="gx-h2">Provedores</h3>
                        <Button size="sm" variant="soft" onClick={() => setNewProvider(true)}>
                            Novo provedor
                        </Button>
                    </div>
                    <Loadable state={providers} skeleton={<Skeleton rows={2} height={52} />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="Nenhum provedor cadastrado." />}>
                        {(list) => (
                            <ul>
                                {list.map((provider) => (
                                    <li key={provider.id} className="gx-hair-b flex flex-wrap items-center gap-3 py-3 last:border-b-0">
                                        <div className="min-w-0 flex-1 basis-48">
                                            <p className="truncate font-semibold">{provider.name}</p>
                                            <p className="gx-muted text-[12.5px]">
                                                {provider.apiFormat ? API_FORMAT_LABEL[provider.apiFormat] : 'Formato não informado'} ·{' '}
                                                {provider.apiKey ? (
                                                    <>
                                                        chave terminada em <span className="gx-mono">{provider.apiKey.keyPreview}</span>
                                                    </>
                                                ) : (
                                                    'sem chave'
                                                )}
                                            </p>
                                        </div>
                                        <Pill tone={provider.apiKey ? 'neutral' : 'yellow'} dot>
                                            {provider.apiKey ? 'Chave gravada' : 'Sem chave'}
                                        </Pill>
                                        <Button size="sm" variant="soft" onClick={() => setKeyFor(provider)} aria-label={`${provider.apiKey ? 'Trocar' : 'Adicionar'} chave de ${provider.name}`}>
                                            {provider.apiKey ? 'Trocar chave' : 'Adicionar chave'}
                                        </Button>
                                        {provider.apiKey ? <ConfirmButton label="Remover chave" confirmLabel="Remover?" variant="ghost" disabled={busy != null} onConfirm={() => removeKey(provider)} /> : null}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Loadable>
                </section>

                <section className="flex flex-col gap-3" aria-label="Modelos">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <h3 className="gx-h2">Modelos</h3>
                        <Button size="sm" variant="soft" onClick={() => setEditing({ model: null })} disabled={!providers.data?.length}>
                            Novo modelo
                        </Button>
                    </div>
                    <Loadable state={models} skeleton={<Skeleton rows={2} height={48} />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="Nenhum modelo cadastrado." />}>
                        {(list) => (
                            <ul>
                                {list.map((model) => {
                                    const test = tests[model.id];
                                    return (
                                        <li key={model.id} className="gx-hair-b flex flex-col gap-2 py-3 last:border-b-0">
                                            <div className="flex flex-wrap items-center gap-3">
                                                <div className="min-w-0 flex-1 basis-48">
                                                    <p className="truncate font-semibold">{model.name}</p>
                                                    <p className="gx-muted text-[12.5px]">
                                                        {model.provider?.name ?? 'Provedor desconhecido'} · {capabilityText(model) || 'sem capacidades'}
                                                        {model.totalCalls ? ` · ${model.totalCalls} chamadas` : ''}
                                                    </p>
                                                </div>
                                                {model.isDefault ? <Pill tone="royal" dot>Padrão</Pill> : null}
                                                {!model.active ? <Pill tone="yellow">Desativado</Pill> : null}
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <Button size="sm" variant="soft" loading={busy === `test:${model.id}`} disabled={busy != null && busy !== `test:${model.id}`} onClick={() => void testModel(model)} aria-label={`Testar ${model.name}`}>
                                                    Testar
                                                </Button>
                                                <Button size="sm" onClick={() => setEditing({ model })} disabled={busy != null} aria-label={`Editar ${model.name}`}>
                                                    Editar
                                                </Button>
                                                {!model.isDefault ? (
                                                    <Button size="sm" loading={busy === `default:${model.id}`} disabled={(busy != null && busy !== `default:${model.id}`) || !model.active} onClick={() => void makeDefault(model)} aria-label={`Tornar ${model.name} o padrão`}>
                                                        Tornar padrão
                                                    </Button>
                                                ) : null}
                                                <Button size="sm" loading={busy === `active:${model.id}`} disabled={busy != null && busy !== `active:${model.id}`} onClick={() => void toggleActive(model)} aria-label={`${model.active ? 'Desativar' : 'Ativar'} ${model.name}`}>
                                                    {model.active ? 'Desativar' : 'Ativar'}
                                                </Button>
                                                <ConfirmButton label="Excluir" confirmLabel="Excluir modelo?" variant="ghost" disabled={busy != null} onConfirm={() => removeModel(model)} />
                                            </div>
                                            {test ? <p className={`text-[13px] ${test.ok ? 'gx-soft' : 'gx-red-text'}`}>{test.message}</p> : null}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </Loadable>
                </section>

                <section aria-label="Configuração do chat">
                    <Loadable state={chatConfig} skeleton={<Skeleton rows={2} height={48} />}>
                        {({ config }) => <ChatConfigSection config={config} models={models.data ?? []} providers={providers.data ?? []} />}
                    </Loadable>
                </section>
            </div>
            <KeyDrawer provider={keyFor} onClose={() => setKeyFor(null)} />
            <ProviderDrawer open={newProvider} onClose={() => setNewProvider(false)} />
            <ModelDrawer open={Boolean(editing)} model={editing?.model ?? null} providers={providers.data ?? []} onClose={() => setEditing(null)} />
        </Panel>
    );
};
