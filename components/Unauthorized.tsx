import React from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

const Unauthorized: React.FC = () => {
  const { user } = useAuthStore();

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <h1 className="mb-2 text-2xl font-bold text-tower-900 dark:text-tower-50">Acesso não autorizado</h1>
        <p className="mb-6 text-tower-600 dark:text-tower-300">
          Você não tem permissão para acessar esta página.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {user?.roles?.includes('CLIENT') && (
            <Link
              to="/client"
              className="rounded-xl bg-brand-600 px-5 py-2.5 font-medium text-white transition-colors hover:bg-brand-500 dark:hover:bg-brand-400"
            >
              Ir ao Dashboard
            </Link>
          )}
          {user?.roles?.includes('ADMIN') && (
            <Link
              to="/gestao"
              className="rounded-xl bg-brand-600 px-5 py-2.5 font-medium text-white transition-colors hover:bg-brand-500 dark:hover:bg-brand-400"
            >
              Ir à Torre de Controle
            </Link>
          )}
          {user?.roles?.includes('HUB') && (
            <Link
              to="/hub"
              className="rounded-xl bg-brand-600 px-5 py-2.5 font-medium text-white transition-colors hover:bg-brand-500 dark:hover:bg-brand-400"
            >
              Ir à Operação Hub
            </Link>
          )}
          <Link
            to="/"
            className="rounded-xl bg-tower-200 px-5 py-2.5 font-medium text-tower-800 transition-colors hover:bg-tower-300 dark:bg-tower-700 dark:text-tower-100 dark:hover:bg-tower-600"
          >
            Voltar
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Unauthorized;
