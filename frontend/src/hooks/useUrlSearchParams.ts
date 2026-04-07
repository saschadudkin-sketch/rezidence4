import { useCallback, useEffect, useMemo, useState } from 'react';

type SearchParamsInput =
  | string
  | URLSearchParams
  | Record<string, string | number | boolean | null | undefined>;

function readSearch() {
  if (typeof window === 'undefined') return '';
  return window.location.search || '';
}

function normalizeSearch(input: SearchParamsInput) {
  if (typeof input === 'string') {
    return input.startsWith('?') ? input : `?${input}`;
  }

  if (input instanceof URLSearchParams) {
    const serialized = input.toString();
    return serialized ? `?${serialized}` : '';
  }

  const params = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    params.set(key, String(value));
  });
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

export function useUrlSearchParams() {
  const [search, setSearch] = useState(readSearch);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const syncSearch = () => setSearch(readSearch());
    window.addEventListener('popstate', syncSearch);
    window.addEventListener('hashchange', syncSearch);

    return () => {
      window.removeEventListener('popstate', syncSearch);
      window.removeEventListener('hashchange', syncSearch);
    };
  }, []);

  const searchParams = useMemo(() => new URLSearchParams(search), [search]);

  const updateSearchParams = useCallback((nextValue: SearchParamsInput, options?: { replace?: boolean }) => {
    const nextSearch = normalizeSearch(nextValue);
    setSearch(nextSearch);

    if (typeof window === 'undefined') return;

    const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
    const method = options?.replace === false ? 'pushState' : 'replaceState';
    window.history[method](window.history.state, '', nextUrl);
  }, []);

  return [searchParams, updateSearchParams] as const;
}
