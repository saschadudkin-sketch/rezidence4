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
  ListAdminAnnouncementsParams,
  ListAnnouncementsParams,
  ListDocumentsParams,
  ListIncidentsParams,
  ListStaffWorkspaceInboxParams,
  ListMinePackagesParams,
  ListOverridesParams,
  ListPackagesParams,
  ListPassesParams,
  ListResidentsParams,
  ListUnitsParams,
  ListVehiclesParams,
  ListVisitsParams,
  PackageMetricsParams,
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
  staffWorkspace: {
    all: ['v1', 'staff-workspace'] as const,
    inbox: (p?: ListStaffWorkspaceInboxParams) =>
      ['v1', 'staff-workspace', 'inbox', p ?? null] as const,
    overdue: (p?: Omit<ListStaffWorkspaceInboxParams, 'queue'>) =>
      ['v1', 'staff-workspace', 'overdue', p ?? null] as const,
    request: (id: string) => ['v1', 'staff-workspace', 'request', id] as const,
    residentQuickView: (id: string) =>
      ['v1', 'staff-workspace', 'resident-quick-view', id] as const,
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
  announcements: {
    all: ['v1', 'announcements'] as const,
    list: (p?: ListAnnouncementsParams) =>
      ['v1', 'announcements', 'list', p ?? null] as const,
    adminList: (p?: ListAdminAnnouncementsParams) =>
      ['v1', 'announcements', 'adminList', p ?? null] as const,
    byId: (id: UUID) => ['v1', 'announcements', 'byId', id] as const,
    metrics: (id: UUID) => ['v1', 'announcements', 'metrics', id] as const,
  },
  packages: {
    all: ['v1', 'packages'] as const,
    list: (p?: ListPackagesParams) => ['v1', 'packages', 'list', p ?? null] as const,
    mine: (p?: ListMinePackagesParams) => ['v1', 'packages', 'mine', p ?? null] as const,
    metrics: (p?: PackageMetricsParams) =>
      ['v1', 'packages', 'metrics', p ?? null] as const,
    byId: (id: UUID) => ['v1', 'packages', 'byId', id] as const,
  },
  documents: {
    all: ['v1', 'documents'] as const,
    list: (p?: ListDocumentsParams) => ['v1', 'documents', 'list', p ?? null] as const,
    byId: (id: UUID) => ['v1', 'documents', 'byId', id] as const,
    versions: (id: UUID) => ['v1', 'documents', 'versions', id] as const,
    version: (id: UUID, version: number) =>
      ['v1', 'documents', 'version', id, version] as const,
    public: (slug: string, limit?: number) =>
      ['v1', 'documents', 'public', slug, limit ?? null] as const,
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

export function invalidateStaffWorkspaceRequest(
  qc: QueryClient,
  id: string,
): Promise<void> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: qk.staffWorkspace.request(id) }),
    qc.invalidateQueries({ queryKey: qk.staffWorkspace.all }),
  ]).then(() => undefined);
}

/**
 * Invalidates everything related to one announcement:
 *   - its detail query (byId)
 *   - the whole announcements namespace — both resident feed and admin lists
 *     need to refetch because fields we filter on (published_at, deleted_at,
 *     starts_at) change on publish/unpublish/delete.
 *   - metrics — reach counts only exist after publish and grow as the outbox
 *     worker processes the fan-out.
 */
export function invalidateAnnouncement(qc: QueryClient, id: UUID): Promise<void> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: qk.announcements.byId(id) }),
    qc.invalidateQueries({ queryKey: qk.announcements.all }),
    qc.invalidateQueries({ queryKey: qk.announcements.metrics(id) }),
  ]).then(() => undefined);
}

/**
 * Invalidates the full packages namespace — one row change can flip:
 *   - the detail query (byId)
 *   - every list query (status filter, carrier filter, etc.)
 *   - the resident's /mine list (if recipient matches)
 *   - aggregate metrics (status counts and dwell times)
 * Cheap enough to just nuke `packages.all` plus the per-id detail key.
 */
export function invalidatePackage(qc: QueryClient, id: UUID): Promise<void> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: qk.packages.byId(id) }),
    qc.invalidateQueries({ queryKey: qk.packages.all }),
  ]).then(() => undefined);
}

/**
 * Invalidates everything related to one document:
 *   - detail query
 *   - all list queries (public/staff/resident all share the namespace)
 *   - its version history (a PATCH inserts a new snapshot)
 */
export function invalidateDocument(qc: QueryClient, id: UUID): Promise<void> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: qk.documents.byId(id) }),
    qc.invalidateQueries({ queryKey: qk.documents.all }),
    qc.invalidateQueries({ queryKey: qk.documents.versions(id) }),
  ]).then(() => undefined);
}
