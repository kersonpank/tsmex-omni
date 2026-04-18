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
        <div className="relative flex min-h-screen items-center justify-center bg-gradient-to-br from-tower-50 to-brand-100 dark:from-brand-950 dark:to-tower-900">
            <div className="absolute top-4 right-4">
                <ThemeToggle />
            </div>
            <div className="max-w-md w-full mx-4">
                <div className="rounded-3xl border border-tower-200 bg-white p-8 shadow-2xl shadow-brand-900/10 dark:border-tower-700 dark:bg-tower-900 dark:shadow-none md:p-12">
                    {/* Logo */}
                    <div className="flex items-center justify-center gap-3 mb-8">
                        <div className="w-14 h-14 bg-brand-600 rounded-2xl flex items-center justify-center">
                            <span className="text-white font-bold text-2xl">TSM</span>
                        </div>
                        <div className="bg-gradient-to-r from-brand-600 to-brand-400 bg-clip-text text-2xl font-black text-transparent">
                            EX OMNI
                        </div>
                    </div>

                    <h1 className="text-3xl font-black text-tower-900 dark:text-tower-100 text-center mb-2">
                        Bem-vindo
                    </h1>
                    <p className="text-tower-500 dark:text-tower-400 text-center mb-8">
                        Faça login para acessar a plataforma
                    </p>

                    {error && (
                        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-300 text-sm">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-tower-600 dark:text-tower-400">
                                Email
                            </label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full p-4 bg-tower-50 dark:bg-tower-700/50 border-2 border-tower-100 dark:border-tower-600 rounded-2xl focus:border-brand-500 focus:bg-white dark:focus:bg-tower-700 outline-none transition-all text-tower-900 dark:text-tower-100 placeholder-tower-400 dark:placeholder-tower-500"
                                placeholder="seu@email.com"
                                required
                            />
                        </div>

                        <div>
                            <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-tower-600 dark:text-tower-400">
                                Senha
                            </label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full p-4 bg-tower-50 dark:bg-tower-700/50 border-2 border-tower-100 dark:border-tower-600 rounded-2xl focus:border-brand-500 focus:bg-white dark:focus:bg-tower-700 outline-none transition-all text-tower-900 dark:text-tower-100 placeholder-tower-400 dark:placeholder-tower-500"
                                placeholder="••••••••"
                                required
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full rounded-2xl bg-brand-600 py-4 font-bold text-white shadow-lg shadow-brand-900/15 transition-all hover:bg-brand-500 disabled:opacity-50 dark:shadow-brand-900/30 dark:hover:bg-brand-400"
                        >
                            {loading ? 'Entrando...' : 'Entrar'}
                        </button>
                    </form>

                    <div className="mt-6 text-center space-y-2">
                        <p className="text-sm text-tower-500 dark:text-tower-400 mb-2">
                            Não tem uma conta?
                        </p>
                        <Link
                            to="/onboarding"
                            className="block text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-medium text-sm transition-colors"
                        >
                            Criar Conta Empresarial
                        </Link>
                        <Link
                            to="/link/cadastro"
                            className="block text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-medium text-sm transition-colors"
                        >
                            Cadastre-se como motorista (Link)
                        </Link>
                    </div>

                    {/* Quick login buttons */}
                    <div className="mt-8 pt-8 border-t border-tower-100 dark:border-tower-700">
                        <p className="text-xs text-tower-400 dark:text-tower-500 uppercase tracking-wider text-center mb-4">
                            Acesso Rápido (Teste)
                        </p>
                        <div className="grid grid-cols-3 gap-2">
                            <button
                                onClick={() => fillCredentials('admin')}
                                className="py-2 px-3 bg-tower-100 dark:bg-tower-700 hover:bg-tower-200 dark:hover:bg-tower-600 rounded-xl text-xs font-bold text-tower-700 dark:text-tower-300 transition-colors"
                            >
                                Admin
                            </button>
                            <button
                                onClick={() => fillCredentials('client')}
                                className="py-2 px-3 bg-tower-100 dark:bg-tower-700 hover:bg-tower-200 dark:hover:bg-tower-600 rounded-xl text-xs font-bold text-tower-700 dark:text-tower-300 transition-colors"
                            >
                                Cliente
                            </button>
                            <button
                                onClick={() => fillCredentials('link')}
                                className="py-2 px-3 bg-tower-100 dark:bg-tower-700 hover:bg-tower-200 dark:hover:bg-tower-600 rounded-xl text-xs font-bold text-tower-700 dark:text-tower-300 transition-colors"
                            >
                                Link
                            </button>
                        </div>
                    </div>
                </div>

                <p className="text-center text-tower-400 dark:text-tower-500 text-xs uppercase font-bold mt-6 tracking-widest">
                    TSM EX v2.0 • Orquestrador Logístico
                </p>
            </div>
        </div>
    );
};

export default Login;
