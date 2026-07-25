import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UserRole } from '../lib/workspaceRoles';

export type { UserRole };

interface User {
    id: string;
    email: string;
    roles: UserRole[];
    profile?: any;
    hubId?: string;
}

interface AuthState {
    user: User | null;
    token: string | null;
    isAuthenticated: boolean;
    currentRole: UserRole | null; // Papel ativo para navegação
    login: (email: string, password: string) => Promise<{ token: string; user: User }>;
    logout: () => void;
    setUser: (user: User, token: string) => void;
    setCurrentRole: (role: UserRole) => void;
    enterWorkspace: (role: UserRole) => void;
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set) => ({
            user: null,
            token: null,
            isAuthenticated: false,
            currentRole: null,

            setUser: (user, token) => {
                localStorage.setItem('token', token);
                const firstRole = user.roles?.[0] ?? null;
                set({ user, token, isAuthenticated: true, currentRole: firstRole });
            },

            setCurrentRole: (role) => {
                set({ currentRole: role });
            },

            enterWorkspace: (role) => {
                const { user } = useAuthStore.getState();
                if (!user?.roles?.includes(role)) return;
                set({ currentRole: role });
            },

            login: async (email, password) => {
                const apiUrl = import.meta.env.DEV
                    ? 'http://localhost:3002/api/auth/login'
                    : '/api/auth/login';

                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password }),
                });

                const raw = await response.text();
                const trimmed = raw.trim();
                let body: unknown;
                if (!trimmed) {
                    body = {};
                } else if (trimmed.startsWith('<')) {
                    throw new Error(
                        response.status >= 500
                            ? 'Servidor temporariamente indisponível (erro de gateway). Tente novamente em instantes.'
                            : 'Resposta inválida do servidor.'
                    );
                } else {
                    try {
                        body = JSON.parse(trimmed) as unknown;
                    } catch {
                        throw new Error('Resposta inválida do servidor.');
                    }
                }

                if (!response.ok) {
                    const err = body as { error?: string; message?: string };
                    throw new Error(err.error || err.message || 'Falha no login');
                }

                const { data } = body as { data: { token: string; user: User } };
                localStorage.setItem('token', data.token);
                const firstRole = data.user?.roles?.[0] ?? null;
                set({
                    user: data.user,
                    token: data.token,
                    isAuthenticated: true,
                    currentRole: firstRole,
                });
                
                // Return data for navigation
                return data;
            },

            logout: () => {
                localStorage.removeItem('token');
                set({ user: null, token: null, isAuthenticated: false, currentRole: null });
            },
        }),
        {
            name: 'auth-storage',
        }
    )
);
