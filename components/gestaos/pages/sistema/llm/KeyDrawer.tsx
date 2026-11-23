import React, { useState } from 'react';
import { api } from '../../../../../lib/api';
import type { LlmProvider } from '../../../lib/sistemaLlm';
import { invalidate } from '../../../lib/resource';
import { Button, Field, TextInput } from '../../../ui/kit';
import { Drawer, useAction } from '../../../ui/overlay';
import { LLM_KEY } from './useLlm';

/** A chave digitada só existe nesta gaveta: vai uma vez ao servidor e é apagada da tela, sem log. */
export const KeyDrawer: React.FC<{ provider: LlmProvider | null; onClose: () => void }> = ({ provider, onClose }) => {
    const { busy, run } = useAction();
    const [secret, setSecret] = useState('');
    const [label, setLabel] = useState('');
    const [error, setError] = useState<string | null>(null);

    const close = () => {
        setSecret('');
        onClose();
    };

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
            invalidate(LLM_KEY);
            onClose();
        }
    };

    return (
        <Drawer
            open={Boolean(provider)}
            onClose={close}
            width={560}
            title={`Chave de ${provider?.name ?? 'provedor'}`}
            subtitle={provider?.apiKey ? `Chave atual termina em ${provider.apiKey.keyPreview}. Salvar troca a chave.` : 'Nenhuma chave gravada.'}
            footer={
                <Button variant="primary" loading={busy === 'key'} onClick={() => void save()}>
                    Salvar chave
                </Button>
            }
        >
            <form
                className="flex flex-col gap-5"
                onSubmit={(event) => {
                    event.preventDefault();
                    void save();
                }}
            >
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
