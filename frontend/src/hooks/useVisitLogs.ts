/**
 * useVisitLogs.js — A-10: TanStack Query wrapper for visit log fetching.
 *
 * Visit logs are NOT streamed via SSE — they are a separate audit log endpoint.
 * useQuery provides: automatic caching, stale-while-revalidate, retry on failure,
 * and a stable { data, isLoading, isError, refetch } API without manual useState.
 */

import { useQueryClient } from '@tanstack/react-query';
import { getVisitLogs, clearVisitLogs as apiClearVisitLogs } from '../shared/api/passesApi';
import { useEntityQuery } from '../data/entityOwnership';
import type { VisitLogPage } from '../services/http/visitLogs';

export const VISIT_LOGS_KEY = ['visitLogs'];

export function useVisitLogs() {
  return useEntityQuery<VisitLogPage>({
    entity: 'visitLogs',
    queryKey: VISIT_LOGS_KEY,
    queryFn: getVisitLogs,
    // staleTime inherited from QueryClient default (60s) — logs don't change in real-time
  });
}

/**
 * Returns a stable function that clears the log on the server and then
 * invalidates the cached query so VisitLogView refetches automatically.
 */
export function useClearVisitLogs() {
  const qc = useQueryClient();
  return async function clearVisitLogs() {
    await apiClearVisitLogs();
    await qc.invalidateQueries({ queryKey: VISIT_LOGS_KEY });
  };
}
