import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import ThemeToggle from './ui/ThemeToggle';

const Login: React.FC = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();
    const login = useAuthStore(state => state.login);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const result = await login(email, password);
            // Redirect based on role
            const roles = result?.user?.roles ?? [];
            const role = roles[0];
            if (role === 'CLIENT') {
                navigate('/client');
            } else if (role === 'ADMIN' || role === 'HUB') {
                navigate('/gestao');
            } else if (role === 'LINK') {
                navigate('/link');
            } else {
                navigate('/gestao');
            }
        } catch (err: any) {
            setError(err.message || 'Erro ao fazer login');
        } finally {
            setLoading(false);
        }
    };

    const fillCredentials = (role: 'admin' | 'client' | 'link') => {
        const credentials = {
            admin: { email: 'admin@tsmex.com', password: 'admin123' },
            client: { email: 'cliente@exemplo.com', password: 'cliente123' },
            link: { email: 'motorista@exemplo.com', password: 'link123' },
        };
        setEmail(credentials[role].email);
        setPassword(credentials[role].password);
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50 dark:from-slate-900 dark:to-slate-800 relative">
            <div className="absolute top-4 right-4">
                <ThemeToggle />
            </div>
            <div className="max-w-md w-full mx-4">
                <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl shadow-indigo-100/50 dark:shadow-none border border-slate-200 dark:border-slate-700 p-8 md:p-12">
                    {/* Logo */}
                    <div className="flex items-center justify-center gap-3 mb-8">
                        <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center">
                            <span className="text-white font-bold text-2xl">TSM</span>
                        </div>
                        <div className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-violet-600">
                            EX OMNI
                        </div>
                    </div>

                    <h1 className="text-3xl font-black text-slate-900 dark:text-slate-100 text-center mb-2">
                        Bem-vindo
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400 text-center mb-8">
                        Faça login para acessar a plataforma
                    </p>

                    {error && (
                        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-300 text-sm">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">
                                Email
                            </label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full p-4 bg-slate-50 dark:bg-slate-700/50 border-2 border-slate-100 dark:border-slate-600 rounded-2xl focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-700 outline-none transition-all text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
                                placeholder="seu@email.com"
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">
                                Senha
                            </label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full p-4 bg-slate-50 dark:bg-slate-700/50 border-2 border-slate-100 dark:border-slate-600 rounded-2xl focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-700 outline-none transition-all text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
                                placeholder="••••••••"
                                required
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-4 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 dark:shadow-indigo-900/30 disabled:opacity-50"
                        >
                            {loading ? 'Entrando...' : 'Entrar'}
                        </button>
                    </form>

                    <div className="mt-6 text-center space-y-2">
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">
                            Não tem uma conta?
                        </p>
                        <Link
                            to="/onboarding"
                            className="block text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium text-sm transition-colors"
                        >
                            Criar Conta Empresarial
                        </Link>
                        <Link
                            to="/link/cadastro"
                            className="block text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium text-sm transition-colors"
                        >
                            Cadastre-se como motorista (Link)
                        </Link>
                    </div>

                    {/* Quick login buttons */}
                    <div className="mt-8 pt-8 border-t border-slate-100 dark:border-slate-700">
                        <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wider text-center mb-4">
                            Acesso Rápido (Teste)
                        </p>
                        <div className="grid grid-cols-3 gap-2">
                            <button
                                onClick={() => fillCredentials('admin')}
                                className="py-2 px-3 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 transition-colors"
                            >
                                Admin
                            </button>
                            <button
                                onClick={() => fillCredentials('client')}
                                className="py-2 px-3 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 transition-colors"
                            >
                                Cliente
                            </button>
                            <button
                                onClick={() => fillCredentials('link')}
                                className="py-2 px-3 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 transition-colors"
                            >
                                Link
                            </button>
                        </div>
                    </div>
                </div>

                <p className="text-center text-slate-400 dark:text-slate-500 text-xs uppercase font-bold mt-6 tracking-widest">
                    TSM EX v2.0 • Orquestrador Logístico
                </p>
            </div>
        </div>
    );
};

export default Login;
