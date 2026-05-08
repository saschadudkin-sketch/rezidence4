/**
 * platform-v1 pagination hook.
 *
 * Тонкая обёртка вокруг TanStack `useInfiniteQuery` под унифицированный
 * pagination contract из backend (см. backend/src/v1/lib/pagination.js):
 *
 *   { resource: T[], page?: { limit, offset, hasMore } }
 *
 * Caller передаёт `fetchPage({ limit, offset })` и получает обратно:
 *   - `pages` — массив page-ответов (каждый со своим resource[])
 *   - `loadMore()` — подгрузить next page (если `hasMore=true`)
 *   - `hasMore` — из последней page meta
 *   - flag'ы загрузки
 *
 * Для извлечения плоского списка items используй `extractItems(pages, key)`
 * helper.
 *
 * Пример:
 *
 *   const { pages, hasMore, loadMore, isFetchingNextPage } = usePaginatedList({
 *     queryKey: qk.passes.list(filters),
 *     fetchPage: ({ limit, offset }) =>
 *       passesApi.list({ ...filters, limit, offset }).then(r => r.data),
 *     limit: 50,
 *   });
 *   const passes = extractItems(pages, 'passes');
 */

import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { PageMeta } from '../api/types';

export interface PaginatedResponse {
  page?: PageMeta;
  /** Resource arrays live here under their domain key (passes, vehicles, …). */
  [key: string]: unknown;
}

export interface UsePaginatedListOptions<TResponse extends PaginatedResponse> {
  queryKey: QueryKey;
  fetchPage: (params: { limit: number; offset: number }) => Promise<TResponse>;
  /** Default 50 — same as backend `DEFAULT_LIMIT`. */
  limit?: number;
  /** Disable refetch / network — пригодится для conditional rendering. */
  enabled?: boolean;
  /** Pass-through stale-time (ms).  Default 30s. */
  staleTime?: number;
}

export function usePaginatedList<TResponse extends PaginatedResponse>(
  opts: UsePaginatedListOptions<TResponse>,
) {
  const { queryKey, fetchPage, limit = 50, enabled = true, staleTime = 30_000 } = opts;

  const result = useInfiniteQuery<TResponse>({
    queryKey,
    enabled,
    staleTime,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      fetchPage({ limit, offset: pageParam as number }),
    getNextPageParam: (lastPage) => {
      const meta = lastPage.page;
      if (!meta?.hasMore) return undefined;
      return meta.offset + meta.limit;
    },
  });

  return {
    /** Все страницы — каждая со своим resource[] под доменным ключом. */
    pages: result.data?.pages ?? [],
    /** True пока загружается первая страница. */
    isLoading: result.isLoading,
    /** True во время любого refetch'а (включая loadMore). */
    isFetching: result.isFetching,
    /** True специфично во время `loadMore()`. */
    isFetchingNextPage: result.isFetchingNextPage,
    /** Latest error, если был. */
    error: result.error,
    /** Имеет ли смысл вызывать `loadMore()`. */
    hasMore: result.hasNextPage ?? false,
    /** Запросить следующую страницу.  Игнорируется если `hasMore=false`. */
    loadMore: () => {
      if (result.hasNextPage && !result.isFetchingNextPage) {
        void result.fetchNextPage();
      }
    },
    /** Жёсткий refetch с первой страницы. */
    refetch: () => result.refetch(),
  };
}

/**
 * Достаёт плоский список items из массива страниц, склеивая по доменному
 * ключу (`passes`, `vehicles` и т.д.).  Использует `useMemo`-друженственный
 * stable identity — два вызова с теми же `pages` дают тот же массив.
 *
 * Вызывать ВНУТРИ useMemo в компоненте, либо использовать
 * `extractItemsMemo` ниже.
 */
export function extractItems<TItem, TKey extends string>(
  pages: ReadonlyArray<PaginatedResponse>,
  key: TKey,
): TItem[] {
  if (!pages.length) return [];
  const out: TItem[] = [];
  for (const page of pages) {
    const arr = page[key];
    if (Array.isArray(arr)) {
      for (const item of arr) out.push(item as TItem);
    }
  }
  return out;
}

/**
 * useMemo-обёртка над extractItems.  Identity стабильна пока pages не
 * перерендерятся.
 */
export function useFlatItems<TItem, TKey extends string>(
  pages: ReadonlyArray<PaginatedResponse>,
  key: TKey,
): TItem[] {
  return useMemo(() => extractItems<TItem, TKey>(pages, key), [pages, key]);
}
