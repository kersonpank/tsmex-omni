import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { hubsApi } from '../lib/api';
import { DocumentInput } from './ui/DocumentInput';

/** Cadastro de usuário Hub via link compartilhado. Requer hubId na URL. */
const HubCadastro: React.FC = () => {
  const [searchParams] = useSearchParams();
  const hubId = searchParams.get('hubId');
  const navigate = useNavigate();

  const [hubInfo, setHubInfo] = useState<{ name: string; code: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [formSaving, setFormSaving] = useState(false);

  const [form, setForm] = useState({
    document: '',
    legalName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  useEffect(() => {
    if (!hubId) {
      setError('Link inválido. O link de cadastro deve conter o identificador do depósito.');
      setLoading(false);
      return;
    }
    hubsApi.getCadastroInfo(hubId)
      .then((res: any) => {
        const data = (res as any)?.data ?? res;
        setHubInfo({ name: data.name, code: data.code });
        setError(null);
      })
      .catch((e: any) => {
        setError(e.response?.data?.error || e.message || 'Depósito não encontrado ou inativo.');
        setHubInfo(null);
      })
      .finally(() => setLoading(false));
  }, [hubId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hubId) return;
    if (form.password !== form.confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }
    if (form.password.length < 6) {
      setError('A senha deve ter no mínimo 6 caracteres.');
      return;
    }
    setFormSaving(true);
    setError(null);
    try {
      await hubsApi.register(hubId, {
        document: form.document,
        legalName: form.legalName,
        email: form.email,
        password: form.password,
      });
      setSuccess(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao criar conta.');
    } finally {
      setFormSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50/30">
        <div className="text-slate-500">Carregando...</div>
      </div>
    );
  }

  if (!hubId || !hubInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50/30 p-4">
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">⚠️</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">Link inválido</h1>
          <p className="text-slate-600 mb-6">{error || 'Este link de cadastro não é válido ou o depósito está inativo.'}</p>
          <Link to="/login" className="inline-block px-6 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700">
            Ir para o login
          </Link>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50/30 p-4">
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">✓</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">Conta criada!</h1>
          <p className="text-slate-600 mb-6">Redirecionando para o login...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50/30 py-8 px-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-8 max-w-md w-full">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center">
            <span className="text-white font-bold text-lg">TSM</span>
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Cadastro - {hubInfo.name}</h1>
            <p className="text-sm text-slate-500">Depósito {hubInfo.code}</p>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <DocumentInput
            label="CPF ou CNPJ *"
            value={form.document}
            onChange={(v) => setForm((f) => ({ ...f, document: v }))}
            onImport={(data) => setForm((f) => ({ ...f, legalName: data.legalName || f.legalName }))}
            placeholder="Somente números"
            required
            className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-xl"
          />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Nome ou Razão Social *</label>
            <input
              type="text"
              value={form.legalName}
              onChange={(e) => setForm((f) => ({ ...f, legalName: e.target.value }))}
              className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-xl"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">E-mail *</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-xl"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Senha *</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-xl"
              minLength={6}
              placeholder="Mínimo 6 caracteres"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Confirmar senha *</label>
            <input
              type="password"
              value={form.confirmPassword}
              onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
              className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-xl"
              minLength={6}
              required
            />
          </div>
          <button
            type="submit"
            disabled={formSaving}
            className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50"
          >
            {formSaving ? 'Criando conta...' : 'Criar conta'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          Já tem conta? <Link to="/login" className="text-indigo-600 hover:text-indigo-700 font-medium">Fazer login</Link>
        </p>
      </div>
    </div>
  );
};

export default HubCadastro;
