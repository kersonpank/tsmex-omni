import React from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

const Unauthorized: React.FC = () => {
  const { user } = useAuthStore();

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">Acesso não autorizado</h1>
        <p className="text-slate-500 dark:text-slate-400 mb-6">
          Você não tem permissão para acessar esta página.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {user?.roles?.includes('CLIENT') && (
            <Link
              to="/client"
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-colors"
            >
              Ir ao Dashboard
            </Link>
          )}
          {user?.roles?.includes('ADMIN') && (
            <Link
              to="/gestao"
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-colors"
            >
              Ir à Torre de Controle
            </Link>
          )}
          <Link
            to="/"
            className="px-5 py-2.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-medium rounded-xl transition-colors"
          >
            Voltar
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Unauthorized;
