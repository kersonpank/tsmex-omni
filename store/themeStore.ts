import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark' | 'system';

function getSystemDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(isDark: boolean) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  isDark: () => boolean;
  init: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'system',

      setTheme: (theme: Theme) => {
        set({ theme });
        const isDark = theme === 'dark' || (theme === 'system' && getSystemDark());
        applyTheme(isDark);
      },

      isDark: () => {
        const { theme } = get();
        if (theme === 'dark') return true;
        if (theme === 'light') return false;
        return getSystemDark();
      },

      init: () => {
        const { theme } = get();
        const isDark = theme === 'dark' || (theme === 'system' && getSystemDark());
        applyTheme(isDark);

        if (theme === 'system' && typeof window !== 'undefined') {
          window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
            applyTheme(getSystemDark());
          });
        }
      },
    }),
    { name: 'theme-storage' }
  )
);
