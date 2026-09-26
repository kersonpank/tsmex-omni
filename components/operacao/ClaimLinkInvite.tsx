import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../../lib/api';

const ClaimLinkInvite: React.FC = () => {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/claim-link', { token, email, password });
      setComplete(true);
    } catch (e: any) { setError(e.response?.data?.error || e.message || 'Não foi possível ativar o acesso.'); }
    finally { setBusy(false); }
  };

  return <main className="mx-auto flex min-h-screen max-w-md items-center px-5 py-10">
    <div className="w-full rounded-2xl border border-tower-200 bg-[var(--app-surface)] p-6 shadow-sm dark:border-tower-700">
      <h1 className="text-2xl font-bold text-tower-950 dark:text-tower-50">Acesso do transportador</h1>
      {complete ? <p className="mt-5 text-sm">Acesso ativado. <Link to="/login" className="font-bold text-brand-700">Entrar no aplicativo</Link>.</p>
        : !token ? <p className="mt-5 text-sm text-red-700">Convite ausente. Peça um novo link à operação.</p>
        : <form onSubmit={submit} className="mt-6 space-y-4">
          <p className="text-sm text-tower-600 dark:text-tower-300">Use seu email e uma senha. Se você já tem conta, informe a senha atual para autorizar o vínculo.</p>
          <label className="block text-sm font-semibold">Email<input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-tower-300 bg-transparent px-3 dark:border-tower-600" /></label>
          <label className="block text-sm font-semibold">Senha<input required minLength={6} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-tower-300 bg-transparent px-3 dark:border-tower-600" /></label>
          {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
          <button disabled={busy} type="submit" className="min-h-12 w-full rounded-xl bg-brand-600 px-4 font-bold text-white disabled:opacity-50">{busy ? 'Ativando…' : 'Ativar acesso'}</button>
        </form>}
    </div>
  </main>;
};

export default ClaimLinkInvite;
