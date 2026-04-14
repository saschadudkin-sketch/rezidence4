import { useState, useEffect, useCallback } from 'react';

export type ThemeMode = 'dark' | 'auto' | 'light';

const isThemeMode = (value: string): value is ThemeMode =>
  value === 'dark' || value === 'auto' || value === 'light';

/**
 * useTheme — управление темой оформления (тёмная / авто / светлая).
 * Хранит выбор в localStorage['rz-theme'], применяет CSS-класс к <html>.
 */
export function useTheme(defaultTheme: ThemeMode = 'dark') {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      const storedTheme = localStorage.getItem('rz-theme');
      return storedTheme && isThemeMode(storedTheme) ? storedTheme : defaultTheme;
    } catch {
      return defaultTheme;
    }
  });

  useEffect(() => {
    const html = document.documentElement;
    html.classList.remove('theme-light', 'theme-dark');
    if (theme === 'light') html.classList.add('theme-light');
    else if (theme === 'dark') html.classList.add('theme-dark');
    try { localStorage.setItem('rz-theme', theme); } catch { /* quota */ }
  }, [theme]);

  const cycleTheme = useCallback(
    () => setTheme((currentTheme) => currentTheme === 'dark' ? 'auto' : currentTheme === 'auto' ? 'light' : 'dark'),
    [],
  );

  const themeIcon  = theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'monitor';
  const themeLabel = theme === 'light' ? 'Светлая' : theme === 'dark' ? 'Тёмная' : 'Авто';

  return { theme, cycleTheme, themeIcon, themeLabel };
}
