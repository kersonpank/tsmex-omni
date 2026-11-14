import React, { useState } from 'react';
import { api } from '../../../../lib/api';
import { invalidate, useResource } from '../../lib/resource';
import { ConfirmButton } from '../../ui/form';
import { Button, EmptyState, Field, Loadable, Panel, Pill, Skeleton, TextInput } from '../../ui/kit';
import { Drawer, useAction } from '../../ui/overlay';

interface Provider {
    id: string;
    name: string;
    code: string;
    active?: boolean;
    apiKey?: { keyPreview: string; label?: string | null; active?: boolean } | null;
}
interface Model {
    id: string;
    name: string;
    isDefault: boolean;
    active: boolean;
    provider?: { name: string; code: string };
}

const wrap = <T,>(path: string) => async () => ((await api.get<{ data: T[] }>(`/settings/llm/${path}`)).data.data ?? []) as T[];

/** A chave digitada só existe nesta gaveta: vai uma vez ao servidor e é apagada da tela, sem log. */
const KeyDrawer: React.FC<{ provider: Provider | null; onClose: () => void }> = ({ provider, onClose }) => {
    const { busy, run } = useAction();
    const [secret, setSecret] = useState('');
    const [label, setLabel] = useState('');
    const [error, setError] = useState<string | null>(null);

    const save = async () => {
        if (!provider) return;
        if (!secret.trim()) {
            setError('Cole a chave de API.');
            return;
        }
        setError(null);
        const ok = await run('key', () => api.post('/settings/llm/api-keys', { providerId: provider.id, apiKey: secret.trim(), ...(label.trim() ? { label: label.trim() } : {}) }), {
            success: 'Chave salva. Só o final dela aparece na tela.',
            error: 'Não foi possível salvar a chave.',
        });
        setSecret('');
        if (ok) {
            setLabel('');
            invalidate('system:llm');
            onClose();
        }
    };

    return (
        <Drawer
            open={Boolean(provider)}
            onClose={() => {
                setSecret('');
                onClose();
            }}
            width={560}
            title={`Chave de ${provider?.name ?? 'provedor'}`}
            subtitle={provider?.apiKey ? `Chave atual termina em ${provider.apiKey.keyPreview}. Salvar troca a chave.` : 'Nenhuma chave gravada.'}
            footer={<Button variant="primary" loading={busy === 'key'} onClick={() => void save()}>Salvar chave</Button>}
        >
            <form className="flex flex-col gap-5" onSubmit={(event) => { event.preventDefault(); void save(); }}>
                <Field label="Chave de API" error={error} hint="A chave é guardada cifrada no servidor e nunca volta para a tela.">
                    <TextInput type="password" autoComplete="off" value={secret} onChange={(event) => setSecret(event.target.value)} aria-label="Chave de API" />
                </Field>
                <Field label="Apelido (opcional)">
                    <TextInput value={label} onChange={(event) => setLabel(event.target.value)} />
                </Field>
            </form>
        </Drawer>
    );
};

export const LlmPanel: React.FC = () => {
    const { busy, run } = useAction();
    const [keyFor, setKeyFor] = useState<Provider | null>(null);
    const providers = useResource<Provider[]>('system:llm:providers', wrap<Provider>('providers'), { staleMs: 30_000 });
    const models = useResource<Model[]>('system:llm:models', wrap<Model>('models'), { staleMs: 30_000 });

    const makeDefault = async (model: Model) => {
        const ok = await run(`default:${model.id}`, () => api.post(`/settings/llm/models/${model.id}/set-default`), { success: `${model.name} é o modelo ativo.`, error: 'Não foi possível trocar o modelo.' });
        if (ok) invalidate('system:llm');
    };
    const removeKey = async (provider: Provider) => {
        const ok = await run(`rm:${provider.id}`, () => api.delete(`/settings/llm/api-keys/${provider.id}`), { success: 'Chave removida.', error: 'Não foi possível remover a chave.' });
        if (ok) invalidate('system:llm');
        return ok;
    };

    return (
        <Panel title="Modelos de IA" hint="Provedores, chaves e o modelo que o chat usa. A chave nunca é mostrada, só o final." mode="manual">
            <div className="flex flex-col gap-6">
                <Loadable state={providers} skeleton={<Skeleton rows={2} height={52} />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="Nenhum provedor cadastrado." />}>
                    {(list) => (
                        <ul>
                            {list.map((provider) => (
                                <li key={provider.id} className="gx-hair-b flex flex-wrap items-center gap-3 py-3 last:border-b-0">
                                    <div className="min-w-0 flex-1 basis-48">
                                        <p className="truncate font-semibold">{provider.name}</p>
                                        <p className="gx-muted text-[12.5px]">{provider.apiKey ? <>Chave terminada em <span className="gx-mono">{provider.apiKey.keyPreview}</span></> : 'Sem chave'}</p>
                                    </div>
                                    <Pill tone={provider.apiKey ? 'neutral' : 'yellow'} dot>{provider.apiKey ? 'Chave gravada' : 'Sem chave'}</Pill>
                                    <Button size="sm" variant="soft" onClick={() => setKeyFor(provider)} aria-label={`${provider.apiKey ? 'Trocar' : 'Adicionar'} chave de ${provider.name}`}>{provider.apiKey ? 'Trocar chave' : 'Adicionar chave'}</Button>
                                    {provider.apiKey ? <ConfirmButton label="Remover chave" confirmLabel="Remover?" variant="ghost" disabled={Boolean(busy)} onConfirm={() => removeKey(provider)} /> : null}
                                </li>
                            ))}
                        </ul>
                    )}
                </Loadable>
                <div>
                    <h3 className="gx-h2 mb-2">Modelo ativo</h3>
                    <Loadable state={models} skeleton={<Skeleton rows={2} height={48} />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="Nenhum modelo cadastrado." />}>
                        {(list) => (
                            <ul>
                                {list.map((model) => (
                                    <li key={model.id} className="gx-hair-b flex flex-wrap items-center gap-3 py-3 last:border-b-0">
                                        <div className="min-w-0 flex-1 basis-48">
                                            <p className="truncate font-semibold">{model.name}</p>
                                            <p className="gx-muted text-[12.5px]">{model.provider?.name ?? 'Provedor desconhecido'}</p>
                                        </div>
                                        {model.isDefault ? <Pill tone="royal" dot>Em uso</Pill> : <Button size="sm" variant="soft" loading={busy === `default:${model.id}`} disabled={Boolean(busy) || !model.active} onClick={() => void makeDefault(model)} aria-label={`Usar o modelo ${model.name}`}>Usar este</Button>}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Loadable>
                </div>
            </div>
            <KeyDrawer provider={keyFor} onClose={() => setKeyFor(null)} />
        </Panel>
    );
};
