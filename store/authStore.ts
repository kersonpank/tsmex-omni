import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type UserRole = 'ADMIN' | 'CLIENT' | 'LINK' | 'HUB';

interface User {
    id: string;
    email: string;
    roles: UserRole[];
    profile?: any;
}

interface AuthState {
    user: User | null;
    token: string | null;
    isAuthenticated: boolean;
    currentRole: UserRole | null; // Papel ativo para navegação
    login: (email: string, password: string) => Promise<void>;
    logout: () => void;
    setUser: (user: User, token: string) => void;
    setCurrentRole: (role: UserRole) => void;
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

            login: async (email, password) => {
                const apiUrl = import.meta.env.DEV
                    ? 'http://localhost:3002/api/auth/login'
                    : '/api/auth/login';

                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password }),
                });

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Login failed');
                }

                const { data } = await response.json();
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
