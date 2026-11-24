import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { accountSecurityApi } from '../../../lib/api';
import { useAuthStore } from '../../../store/authStore';
import { OsButton, OsCard, OsSectionTitle } from '../ui/kit';
import { apiErrorMessage, osFieldClass } from '../ui/Sheet';

/**
 * Conta (/hubs/conta) — a pessoa cuida do próprio acesso: troca a senha, encerra as sessões de
 * outros aparelhos (celular perdido, senha vazada) e sai.
 */
const AccountPage: React.FC = () => {
    const user = useAuthStore((s) => s.user);
    const logout = useAuthStore((s) => s.logout);
    const navigate = useNavigate();
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirm, setConfirm] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

    const leave = () => {
        logout();
        navigate('/');
    };

    const changePassword = async (event: React.FormEvent) => {
        event.preventDefault();
        if (next !== confirm) {
            setMessage({ tone: 'bad', text: 'A confirmação não bate com a nova senha.' });
            return;
        }
        setBusy(true);
        setMessage(null);
        try {
            const res = await accountSecurityApi.changePassword(current, next);
            const token = res.data?.token;
            if (token) {
                localStorage.setItem('token', token);
                useAuthStore.setState({ token });
            }
            setCurrent('');
            setNext('');
            setConfirm('');
            setMessage({ tone: 'ok', text: 'Senha alterada. Os outros aparelhos precisam entrar de novo.' });
        } catch (cause) {
            setMessage({ tone: 'bad', text: apiErrorMessage(cause, 'Não foi possível trocar a senha.') });
        } finally {
            setBusy(false);
        }
    };

    const logoutEverywhere = async () => {
        if (!window.confirm('Encerrar a sessão em todos os aparelhos, inclusive neste?')) return;
        setBusy(true);
        try {
            await accountSecurityApi.logoutAll();
        } catch {
            // Mesmo com falha de rede, sai deste aparelho.
        }
        leave();
    };

    return (
        <div className="flex flex-col gap-4 pt-2">
            <OsSectionTitle>Conta</OsSectionTitle>
            <OsCard>
                <p className="text-[13px] text-tower-500 dark:text-tower-400">Entrou como</p>
                <p className="truncate font-semibold">{user?.email}</p>
            </OsCard>

            <OsCard>
                <form className="flex flex-col gap-3" onSubmit={changePassword}>
                    <p className="font-semibold">Trocar senha</p>
                    <input className={osFieldClass} type="password" autoComplete="current-password" placeholder="Senha atual" value={current} onChange={(e) => setCurrent(e.target.value)} required />
                    <input className={osFieldClass} type="password" autoComplete="new-password" placeholder="Nova senha (10+ caracteres, letras e números)" value={next} onChange={(e) => setNext(e.target.value)} minLength={10} required />
                    <input className={osFieldClass} type="password" autoComplete="new-password" placeholder="Repita a nova senha" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={10} required />
                    {message ? (
                        <p role="status" className={message.tone === 'ok' ? 'text-[14px] text-emerald-600 dark:text-emerald-400' : 'text-[14px] text-brand-red-500'}>
                            {message.text}
                        </p>
                    ) : null}
                    <OsButton type="submit" full disabled={busy || !current || !next || !confirm}>
                        Trocar senha
                    </OsButton>
                </form>
            </OsCard>

            <OsCard>
                <p className="font-semibold">Aparelho perdido ou senha vazada?</p>
                <p className="mb-3 text-[13px] text-tower-500 dark:text-tower-400">Encerra o acesso em todos os aparelhos. Depois, entre de novo e troque a senha.</p>
                <OsButton type="button" variant="danger" full disabled={busy} onClick={logoutEverywhere}>
                    Sair de todos os aparelhos
                </OsButton>
            </OsCard>

            <OsButton type="button" variant="ghost" full onClick={leave}>
                Sair deste aparelho
            </OsButton>
        </div>
    );
};

export default AccountPage;
