import { useState, useEffect, useCallback } from 'react';

/**
 * useTheme — управление темой оформления (тёмная / авто / светлая).
 * Хранит выбор в localStorage['rz-theme'], применяет CSS-класс к <html>.
 */
export function useTheme(defaultTheme = 'dark') {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('rz-theme') || defaultTheme; } catch { return defaultTheme; }
  });

  useEffect(() => {
    const html = document.documentElement;
    html.classList.remove('theme-light', 'theme-dark');
    if (theme === 'light') html.classList.add('theme-light');
    else if (theme === 'dark') html.classList.add('theme-dark');
    try { localStorage.setItem('rz-theme', theme); } catch { /* quota */ }
  }, [theme]);

  const cycleTheme = useCallback(
    () => setTheme(t => t === 'dark' ? 'auto' : t === 'auto' ? 'light' : 'dark'),
    [],
  );

  const themeIcon  = theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'monitor';
  const themeLabel = theme === 'light' ? 'Светлая' : theme === 'dark' ? 'Тёмная' : 'Авто';

  return { theme, cycleTheme, themeIcon, themeLabel };
}
