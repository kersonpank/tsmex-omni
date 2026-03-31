import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { maskPhone } from '../../lib/formatters';

/** Cadastro Link (motorista): intro + criar conta. Após sucesso → redirect /link. Hub usa link próprio no admin. */
type Step = 'intro' | 'intro2' | 'create_account';

const OperacaoOnboarding: React.FC = () => {
  const navigate = useNavigate();
  const setUser = useAuthStore((s) => s.setUser);
  const [step, setStep] = useState<Step>('intro');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [registerForm, setRegisterForm] = useState({
    email: '',
    password: '',
    whatsappPhone: '',
  });

  const next = () => {
    if (step === 'intro') setStep('intro2');
    else if (step === 'intro2') setStep('create_account');
    setError(null);
  };

  const back = () => {
    if (step === 'intro2') setStep('intro');
    else if (step === 'create_account') setStep('intro2');
    setError(null);
  };

  const handleCreateAccount = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<{ success: boolean; data: { user: { id: string; email: string; role: string }; token: string; linkId?: string } }>('/auth/register', {
        email: registerForm.email,
        password: registerForm.password,
        role: 'LINK' as const,
        whatsappPhone: registerForm.whatsappPhone.replace(/\D/g, '').trim() || registerForm.whatsappPhone.trim(),
      });
      const { data } = res.data;
      if (!data.token || !data.user) throw new Error('Resposta inválida');
      localStorage.setItem('token', data.token);
      setUser(data.user, data.token);

      const meRes = await api.get<{ success: boolean; data: { id: string; email: string; roles: string[]; link?: { id: string; name: string; approvalStatus: string; onboarding?: { onboardingComplete: boolean } } } }>('/auth/me');
      const me = meRes.data.data;
      const link = me.link;
      const userWithProfile = {
        id: me.id,
        email: me.email,
        roles: (me.roles ?? []) as ('ADMIN' | 'CLIENT' | 'LINK' | 'HUB')[],
        profile: link ? { linkId: link.id, name: link.name, approvalStatus: link.approvalStatus, onboardingComplete: link.onboarding?.onboardingComplete } : undefined,
      };
      setUser(userWithProfile, data.token);
      navigate('/link');
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Erro ao criar conta');
    } finally {
      setLoading(false);
    }
  };

  const stepOrder: Step[] = ['intro', 'intro2', 'create_account'];
  const currentIndex = stepOrder.indexOf(step);
  const progress = currentIndex >= 0 ? currentIndex + 1 : 1;
  const totalSteps = stepOrder.length;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-indigo-50/30 py-8 px-4">
      <div className="max-w-lg mx-auto">
        <div className="mb-6">
          <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-600 rounded-full transition-all" style={{ width: `${(progress / totalSteps) * 100}%` }} />
          </div>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>
        )}

        {step === 'intro' && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-8">
            <h1 className="text-2xl font-bold text-slate-900 mb-2">Cadastro de motorista (Link)</h1>
            <p className="text-slate-600 mb-6">
              A TSM EX conecta quem precisa transportar cargas com quem faz o transporte. Como <strong>motorista/entregador (Link)</strong>, você recebe viagens destinadas a você, confirma e acompanha tudo pelo app.
            </p>
            <div className="p-4 bg-indigo-50 rounded-xl border border-indigo-100">
              <h2 className="font-semibold text-indigo-900">O que você vai precisar</h2>
              <p className="text-sm text-indigo-800 mt-1">E-mail, senha e WhatsApp. Após o cadastro, nossa equipe analisa e libera o acesso.</p>
            </div>
            <button type="button" onClick={next} className="mt-8 w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700">
              Continuar
            </button>
          </div>
        )}

        {step === 'intro2' && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-8">
            <h1 className="text-2xl font-bold text-slate-900 mb-2">Documentação e aprovação</h1>
            <p className="text-slate-600 mb-6">
              Para garantir segurança e conformidade, solicitamos documentos do motorista e do veículo. Após o envio, nossa equipe analisa e aprova o cadastro. Quando aprovado, você poderá receber viagens destinadas a você.
            </p>
            <button type="button" onClick={next} className="mt-6 w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700">
              Entendi, quero me cadastrar
            </button>
          </div>
        )}

        {step === 'create_account' && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-8">
            <h1 className="text-2xl font-bold text-slate-900 mb-2">Criar conta</h1>
            <p className="text-slate-600 mb-6">Informe e-mail, senha e WhatsApp. Em seguida você completará seus dados e documentação no app.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">E-mail</label>
                <input type="email" value={registerForm.email} onChange={(e) => setRegisterForm((f) => ({ ...f, email: e.target.value }))} className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-xl" placeholder="seu@email.com" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Senha</label>
                <input type="password" value={registerForm.password} onChange={(e) => setRegisterForm((f) => ({ ...f, password: e.target.value }))} className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-xl" minLength={6} placeholder="Mínimo 6 caracteres" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Número WhatsApp</label>
                <input type="tel" value={maskPhone(registerForm.whatsappPhone)} onChange={(e) => setRegisterForm((f) => ({ ...f, whatsappPhone: e.target.value.replace(/\D/g, '') }))} className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-xl" placeholder="(11) 99999-9999" required maxLength={15} />
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button type="button" onClick={back} className="flex-1 py-3 border border-slate-300 text-slate-700 font-medium rounded-xl">Voltar</button>
              <button type="button" onClick={handleCreateAccount} disabled={loading || !registerForm.email || !registerForm.password || !registerForm.whatsappPhone.trim()} className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50">
                {loading ? 'Criando conta...' : 'Criar conta'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OperacaoOnboarding;
