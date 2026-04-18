import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import LinkHome from './LinkHome';
import HubHome from './HubHome';
import LinkOnboardingWizard from './LinkOnboardingWizard';

/**
 * App único para operação: Link (motorista) e Hub (operador de depósito).
 * - LINK com onboarding incompleto → wizard de onboarding.
 * - LINK com onboarding completo e PENDING → "Aguardando aprovação".
 * - LINK APPROVED → LinkHome.
 * - HUB → HubHome.
 */
const OperacaoApp: React.FC = () => {
  const { user, logout, setUser } = useAuthStore();
  const [meLoaded, setMeLoaded] = useState(false);
  const isLink = user?.roles?.includes('LINK');
  const profile = isLink ? (user?.profile as { linkId?: string; approvalStatus?: string; onboardingComplete?: boolean } | undefined) : undefined;
  const linkId = profile?.linkId;
  const onboardingComplete = profile?.onboardingComplete === true;
  const approvalStatus = profile?.approvalStatus;
  const linkPending = isLink && approvalStatus === 'PENDING';

  useEffect(() => {
    if (!isLink || profile?.linkId) {
      setMeLoaded(true);
      return;
    }
    api.get<{ success: boolean; data: { id: string; email: string; roles: string[]; link?: { id: string; name: string; approvalStatus: string; onboarding?: { onboardingComplete: boolean } } } }>('/auth/me')
      .then((res) => {
        const me = res.data.data;
        const link = me.link;
        const userWithProfile = {
          id: me.id,
          email: me.email,
          roles: (me.roles ?? []) as ('ADMIN' | 'CLIENT' | 'LINK' | 'HUB')[],
          profile: link ? { linkId: link.id, name: link.name, approvalStatus: link.approvalStatus, onboardingComplete: link.onboarding?.onboardingComplete } : undefined,
        };
        setUser(userWithProfile, localStorage.getItem('token') || '');
      })
      .catch(() => {})
      .finally(() => setMeLoaded(true));
  }, [isLink, user?.id, profile?.linkId, setUser]);

  const handleOnboardingComplete = () => {
    api.get<{ success: boolean; data: { id: string; email: string; roles: string[]; link?: { id: string; name: string; approvalStatus: string; onboarding?: { onboardingComplete: boolean } } } }>('/auth/me')
      .then((res) => {
        const me = res.data.data;
        const link = me.link;
        const userWithProfile = {
          id: me.id,
          email: me.email,
          roles: (me.roles ?? []) as ('ADMIN' | 'CLIENT' | 'LINK' | 'HUB')[],
          profile: link ? { linkId: link.id, name: link.name, approvalStatus: link.approvalStatus, onboardingComplete: link.onboarding?.onboardingComplete } : undefined,
        };
        setUser(userWithProfile, localStorage.getItem('token') || '');
      });
  };

  if (!meLoaded || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-tower-50">
        <p className="text-tower-600">Carregando...</p>
      </div>
    );
  }

  if (isLink) {
    if (linkId && !onboardingComplete) {
      return <LinkOnboardingWizard linkId={linkId} onComplete={handleOnboardingComplete} />;
    }
    if (linkPending) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-tower-50 p-4">
          <div className="max-w-md w-full bg-white dark:bg-tower-800 rounded-2xl shadow-lg p-8 text-center">
            <h1 className="text-xl font-bold text-tower-900 mb-2">Cadastro em análise</h1>
            <p className="text-tower-600 mb-6">
              Seu cadastro foi recebido e está sendo analisado pela nossa equipe. Você receberá um aviso quando for aprovado e poderá acessar ofertas e viagens.
            </p>
            <button
              type="button"
              onClick={() => logout()}
              className="text-tower-500 hover:text-tower-700 text-sm font-medium"
            >
              Sair
            </button>
          </div>
        </div>
      );
    }
    return <LinkHome />;
  }
  if (user?.roles?.includes('HUB')) {
    return <HubHome />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-tower-100 p-4">
      <p className="text-tower-600">Acesso não autorizado.</p>
    </div>
  );
};

export default OperacaoApp;
