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


const isDataPlaneDiagnosticsEnabled = (): boolean => {
  const flag = import.meta.env.VITE_DATA_PLANE_DIAGNOSTICS;
  return flag === '1' || flag === 'true';
};

export function assertEntityPlane(entity: AppEntity, expected: DataPlane) {
  const actual = ENTITY_OWNERSHIP[entity];
  if (actual === expected) return;

  const message = `[data-plane] ${entity} is owned by ${actual}, but used as ${expected}`;
  if (import.meta.env.DEV) {
    throw new Error(message);
  }

  if (isDataPlaneDiagnosticsEnabled()) {
    console.error(message);
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
