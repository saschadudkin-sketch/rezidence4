import { useQuery, type QueryFunction, type UseQueryOptions } from '@tanstack/react-query';

export const ENTITY_OWNERSHIP = {
  requests: 'sse',
  chat: 'sse',
  users: 'sse',
  perms: 'sse',
  templates: 'sse',
  blacklist: 'sse',
  visitLogs: 'query',
  stats: 'query',
  garage: 'query',
} as const;

export type AppEntity = keyof typeof ENTITY_OWNERSHIP;
export type DataPlane = (typeof ENTITY_OWNERSHIP)[AppEntity];

export function assertEntityPlane(entity: AppEntity, expected: DataPlane) {
  const actual = ENTITY_OWNERSHIP[entity];
  if (import.meta.env.DEV && actual !== expected) {
    throw new Error(`[data-plane] ${entity} is owned by ${actual}, but used as ${expected}`);
  }
}

type EntityQueryOptions<TQueryFnData, TError, TData> = Omit<
  UseQueryOptions<TQueryFnData, TError, TData, readonly unknown[]>,
  'queryKey' | 'queryFn'
>;

export function useEntityQuery<TQueryFnData, TError = Error, TData = TQueryFnData>(args: {
  entity: AppEntity;
  queryKey: readonly unknown[];
  queryFn: QueryFunction<TQueryFnData, readonly unknown[]>;
  options?: EntityQueryOptions<TQueryFnData, TError, TData>;
}) {
  assertEntityPlane(args.entity, 'query');
  return useQuery<TQueryFnData, TError, TData, readonly unknown[]>({
    queryKey: args.queryKey,
    queryFn: args.queryFn,
    ...(args.options || {}),
  });
}
