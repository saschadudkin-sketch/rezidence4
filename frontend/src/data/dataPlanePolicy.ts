import { ENTITY_OWNERSHIP, type AppEntity } from './entityOwnership';

export const DATA_PLANE_POLICY = Object.freeze(
  Object.fromEntries(
    Object.entries(ENTITY_OWNERSHIP).map(([entity, plane]) => [
      entity,
      plane === 'sse' ? 'sse-store' : 'query-cache',
    ]),
  ) as Record<AppEntity, 'sse-store' | 'query-cache'>,
);

export function getDataPlane(entity: keyof typeof DATA_PLANE_POLICY) {
  return DATA_PLANE_POLICY[entity];
}

export function buildDataPlaneContract({
  syncLoading,
  timedOut,
  ssePermanentError,
  sseOnline,
}: {
  syncLoading: boolean;
  timedOut: boolean;
  ssePermanentError: boolean;
  sseOnline: boolean | null;
}) {
  const loading = syncLoading && !timedOut;
  const error = (syncLoading && timedOut) || ssePermanentError;
  const errorKind = ssePermanentError ? 'sse_permanent_error' : ((syncLoading && timedOut) ? 'sse_timeout' : null);
  return { loading, error, errorKind, sseOnline };
}
