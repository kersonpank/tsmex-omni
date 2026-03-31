import { useThemeStore } from '../store/themeStore';

export function useTheme() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const isDark = useThemeStore((s) => s.isDark());

  const toggleTheme = () => {
    const next = isDark ? 'light' : 'dark';
    setTheme(next);
  };

  return { theme, setTheme, isDark, toggleTheme };
}
