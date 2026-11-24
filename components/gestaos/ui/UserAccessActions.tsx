import React, { useState } from 'react';
import { usersApi } from '../../../lib/api';
import { invalidate } from '../lib/resource';
import { Button, Field, TextInput } from './kit';
import { useAction } from './overlay';

/**
 * Acesso de um usuário pela torre: senha provisória (quando a pessoa esqueceu), encerrar as
 * sessões (aparelho perdido, desligamento) e ativar/desativar o login. Tudo fica na trilha de
 * auditoria do servidor. `resourcePrefix` é invalidado para a lista mostrar o estado novo.
 */
export const UserAccessActions: React.FC<{ user: { id: string; email: string; active: boolean }; resourcePrefix: string }> = ({ user, resourcePrefix }) => {
    const { busy, run } = useAction();
    const [resetting, setResetting] = useState(false);
    const [password, setPassword] = useState('');

    const reset = async () => {
        const ok = await run(`reset:${user.id}`, () => usersApi.resetPassword(user.id, password), {
            success: 'Senha provisória definida. Passe para a pessoa e peça para trocar em Conta.',
            error: 'A senha não foi redefinida.',
        });
        if (ok) {
            setPassword('');
            setResetting(false);
        }
    };

    const revoke = () =>
        run(`revoke:${user.id}`, () => usersApi.revokeSessions(user.id), {
            success: 'Sessões encerradas. A pessoa precisa entrar de novo.',
            error: 'As sessões não foram encerradas.',
        });

    const toggleActive = async () => {
        if (user.active && !window.confirm(`Desativar o acesso de ${user.email}? A pessoa sai de todos os aparelhos.`)) return;
        const ok = await run(`active:${user.id}`, () => usersApi.setActive(user.id, !user.active), {
            success: user.active ? 'Acesso desativado.' : 'Acesso reativado.',
            error: 'O acesso não foi alterado.',
        });
        if (ok) invalidate(resourcePrefix);
    };

    if (resetting) {
        return (
            <div className="flex flex-col gap-2">
                <Field label="Senha provisória" hint="10+ caracteres, com letras e números.">
                    <TextInput type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
                </Field>
                <div className="flex gap-2">
                    <Button size="sm" variant="primary" loading={busy === `reset:${user.id}`} disabled={password.length < 10} onClick={() => void reset()}>Definir senha</Button>
                    <Button size="sm" onClick={() => { setPassword(''); setResetting(false); }}>Cancelar</Button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setResetting(true)}>Redefinir senha</Button>
            <Button size="sm" loading={busy === `revoke:${user.id}`} onClick={() => void revoke()}>Encerrar sessões</Button>
            <Button size="sm" loading={busy === `active:${user.id}`} onClick={() => void toggleActive()}>{user.active ? 'Desativar acesso' : 'Reativar acesso'}</Button>
        </div>
    );
};
