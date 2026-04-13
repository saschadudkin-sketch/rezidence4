import { useState, useEffect } from 'react';

/**
 * useDebounce — задерживает обновление значения на delay мс.
 * Используется для поисковых инпутов, чтобы не фильтровать
 * огромные списки на каждое нажатие клавиши.
 *
 * Пример:
 *   const [query, setQuery] = useState('');
 *   const debouncedQuery = useDebounce(query, 300);
 *   // фильтруем по debouncedQuery, не по query
 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
