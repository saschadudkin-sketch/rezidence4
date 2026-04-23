/**
 * platform-v1 React Query keys.
 *
 * Centralising keys here means an invalidation targets one place — otherwise
 * tests get flaky as two components race to refetch the same list.
 *
 * Key shape convention: `['v1', <domain>, <op>, <params?>]`
 */

import type { QueryClient } from '@tanstack/react-query';
import type {
  ListAccessRequestsParams,
  ListIncidentsParams,
  ListOverridesParams,
  ListPassesParams,
  ListResidentsParams,
  ListUnitsParams,
  ListVehiclesParams,
  ListVisitsParams,
} from '../api';
import type { UUID } from '../api/types';

type KeyLike = readonly unknown[];

export const qk = {
  session: ['v1', 'session', 'me'] as const,
  accessRequests: {
    all: ['v1', 'access-requests'] as const,
    list: (p?: ListAccessRequestsParams) =>
      ['v1', 'access-requests', 'list', p ?? null] as const,
    byId: (id: UUID) => ['v1', 'access-requests', 'byId', id] as const,
  },
  passes: {
    all: ['v1', 'passes'] as const,
    list: (p?: ListPassesParams) => ['v1', 'passes', 'list', p ?? null] as const,
    byId: (id: UUID) => ['v1', 'passes', 'byId', id] as const,
    qr: (id: UUID) => ['v1', 'passes', 'qr', id] as const,
  },
  vehicles: {
    all: ['v1', 'vehicles'] as const,
    list: (p?: ListVehiclesParams) => ['v1', 'vehicles', 'list', p ?? null] as const,
    byPlate: (plate: string) => ['v1', 'vehicles', 'byPlate', plate] as const,
    byId: (id: UUID) => ['v1', 'vehicles', 'byId', id] as const,
  },
  visits: {
    all: ['v1', 'visits'] as const,
    list: (p?: ListVisitsParams) => ['v1', 'visits', 'list', p ?? null] as const,
  },
  incidents: {
    all: ['v1', 'access-incidents'] as const,
    list: (p?: ListIncidentsParams) =>
      ['v1', 'access-incidents', 'list', p ?? null] as const,
    byId: (id: UUID) => ['v1', 'access-incidents', 'byId', id] as const,
    overrides: (p?: ListOverridesParams) =>
      ['v1', 'access-overrides', 'list', p ?? null] as const,
  },
  units: {
    all: ['v1', 'units'] as const,
    list: (p?: ListUnitsParams) => ['v1', 'units', 'list', p ?? null] as const,
    byId: (id: UUID) => ['v1', 'units', 'byId', id] as const,
  },
  residents: {
    all: ['v1', 'residents'] as const,
    list: (p?: ListResidentsParams) => ['v1', 'residents', 'list', p ?? null] as const,
    byId: (id: UUID) => ['v1', 'residents', 'byId', id] as const,
  },
};

// ─── Invalidators ──────────────────────────────────────────────────────────

/** After mutating an access-request we refetch: its detail, lists, and any
 * pass derived from it (list queries). */
export function invalidateAccessRequest(qc: QueryClient, id: UUID): Promise<void> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: qk.accessRequests.byId(id) }),
    qc.invalidateQueries({ queryKey: qk.accessRequests.all }),
    qc.invalidateQueries({ queryKey: qk.passes.all }),
  ]).then(() => undefined);
}

export function invalidatePass(qc: QueryClient, id: UUID): Promise<void> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: qk.passes.byId(id) }),
    qc.invalidateQueries({ queryKey: qk.passes.all }),
    qc.invalidateQueries({ queryKey: qk.accessRequests.all }),
  ]).then(() => undefined);
}

export function invalidateVehicle(qc: QueryClient, id: UUID, plate?: string): Promise<void> {
  return Promise.all<unknown>([
    qc.invalidateQueries({ queryKey: qk.vehicles.byId(id) }),
    qc.invalidateQueries({ queryKey: qk.vehicles.all }),
    plate
      ? qc.invalidateQueries({ queryKey: qk.vehicles.byPlate(plate) } as { queryKey: KeyLike })
      : Promise.resolve(),
  ]).then(() => undefined);
}
