import { useState, useEffect, useCallback } from 'react';

/**
 * useTheme — управление темой оформления (авто / светлая / тёмная).
 * Хранит выбор в localStorage['rz-theme'], применяет CSS-класс к <html>.
 */
export function useTheme() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('rz-theme') || 'auto'; } catch { return 'auto'; }
  });

  useEffect(() => {
    const html = document.documentElement;
    html.classList.remove('theme-light', 'theme-dark');
    if (theme === 'light') html.classList.add('theme-light');
    else if (theme === 'dark') html.classList.add('theme-dark');
    try { localStorage.setItem('rz-theme', theme); } catch { /* quota */ }
  }, [theme]);

  const cycleTheme = useCallback(
    () => setTheme(t => t === 'auto' ? 'light' : t === 'light' ? 'dark' : 'auto'),
    [],
  );

  const themeIcon  = theme === 'light' ? 'alert' : theme === 'dark' ? 'history' : 'chart';
  const themeLabel = theme === 'light' ? 'Светлая' : theme === 'dark' ? 'Тёмная' : 'Авто';

  return { theme, cycleTheme, themeIcon, themeLabel };
}
