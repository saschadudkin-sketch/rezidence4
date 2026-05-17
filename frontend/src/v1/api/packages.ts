/**
 * platform-v1 packages client.
 * Backend: backend/src/v1/routes/packages.js
 * Spec:    docs/product/specs/platform-v1/packages-v2-spec.md
 *
 * Endpoints covered:
 *   GET    /packages                     — staff/admin list (filters)
 *   GET    /packages/mine                — resident's own packages
 *   GET    /packages/metrics             — admin aggregates (24h|7d|30d)
 *   GET    /packages/:id                 — detail (resident-own | staff)
 *   POST   /packages                     — receive new package
 *   PATCH  /packages/:id                 — update metadata (staff/admin)
 *   POST   /packages/:id/pickup          — awaiting_pickup → picked_up
 *   POST   /packages/:id/return          — awaiting_pickup → returned
 *   POST   /packages/:id/mark-lost       — awaiting_pickup → lost (admin only)
 *   POST   /packages/:id/remind          — manual reminder (1/hour/pkg limit)
 *
 * State machine (spec §3):
 *   awaiting_pickup ─pickup─▶ picked_up (terminal)
 *                   ─return─▶ returned  (terminal)
 *                   ─mark-lost▶ lost     (terminal, admin only, confirm+reason)
 * Attempting a transition out of a terminal state returns 409.  remind
 * works only while awaiting_pickup.
 *
 * Pickup identity (spec §3 CHECK constraints):
 *   - Exactly ONE of {picked_up_by_resident_id, picked_up_by_name}.
 *   - NEITHER empty — the route returns 400 if both or neither.
 */

import { v1Client, type RequestOpts } from './client';
import type {
  Package,
  PackageMetrics,
  PackageSize,
  PackageStatus,
  UUID,
} from './types';

// ─── Query params ───────────────────────────────────────────────────────────
// NB: packages routes используют свой service-layer pagination contract
// (`{limit, offset, count}` плоско в response, без `page` обёртки), поэтому
// shared PaginationParams / PageMeta из types.ts не подходят.

export interface ListPackagesParams {
  status?: PackageStatus;
  unit_id?: UUID;
  recipient_resident_id?: UUID;
  carrier?: string;
  /** ISO-8601 lower bound on received_at, inclusive. */
  since?: string;
  /** ISO-8601 upper bound on received_at, exclusive. */
  until?: string;
  limit?: number;
  offset?: number;
}

export interface ListMinePackagesParams {
  limit?: number;
}

export type PackageMetricsPeriod = '24h' | '7d' | '30d';

export interface PackageMetricsParams {
  period?: PackageMetricsPeriod;
}

// ─── Mutation bodies ────────────────────────────────────────────────────────

export interface CreatePackageBody {
  property_id: UUID;
  unit_id: UUID;
  recipient_resident_id?: UUID | null;
  recipient_name_snapshot?: string | null;
  sender_name?: string | null;
  carrier?: string | null;
  tracking_number?: string | null;
  /** Must start with /uploads/ — external URLs rejected by service. */
  photo_url?: string | null;
  size_category?: PackageSize | null;
  storage_location?: string | null;
  notes?: string | null;
}

export interface UpdatePackageBody {
  recipient_resident_id?: UUID | null;
  recipient_name_snapshot?: string | null;
  sender_name?: string | null;
  carrier?: string | null;
  tracking_number?: string | null;
  photo_url?: string | null;
  size_category?: PackageSize | null;
  storage_location?: string | null;
  notes?: string | null;
}

/**
 * Pickup body — EXACTLY one of {picked_up_by_resident_id, picked_up_by_name}
 * must be set.  The backend rejects both or neither with 400.
 */
export interface PickupPackageBody {
  picked_up_by_resident_id?: UUID | null;
  picked_up_by_name?: string | null;
}

export interface ReturnPackageBody {
  reason?: string | null;
}

export interface MarkLostPackageBody {
  /** Must be `true` — extra safety so we don't mark a row lost by accident. */
  confirm: true;
  reason: string;
}

// ─── Client-side status derivation ─────────────────────────────────────────
// Backend returns `status` explicitly (it's a column), but a tiny helper
// centralises human labels so list/detail pages stay consistent.

export function packageStatusTone(
  status: PackageStatus,
): 'neutral' | 'success' | 'warning' | 'error' {
  switch (status) {
    case 'awaiting_pickup': return 'warning';
    case 'picked_up':       return 'success';
    case 'returned':        return 'neutral';
    case 'lost':            return 'error';
    default:                return 'neutral';
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function toQuery(params: object | undefined): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  );
  if (!entries.length) return '';
  const qs = new URLSearchParams();
  for (const [k, v] of entries) qs.set(k, String(v));
  return `?${qs.toString()}`;
}

// ─── API surface ───────────────────────────────────────────────────────────

export const packagesApi = {
  /** Staff/admin list.  Все фильтры optional, default sort received_at DESC. */
  list(params?: ListPackagesParams, opts?: RequestOpts) {
    return v1Client.get<{
      ok: true;
      packages: Package[];
      limit: number;
      offset: number;
      count: number;
    }>(`/packages${toQuery(params)}`, opts);
  },

  /** Resident own list (role='resident' required by backend). */
  listMine(params?: ListMinePackagesParams, opts?: RequestOpts) {
    return v1Client.get<{ ok: true; packages: Package[]; count: number }>(
      `/packages/mine${toQuery(params)}`,
      opts,
    );
  },

  /** Admin-only aggregated metrics.  Default period 7d. */
  getMetrics(params?: PackageMetricsParams, opts?: RequestOpts) {
    return v1Client.get<{ ok: true } & PackageMetrics>(
      `/packages/metrics${toQuery(params)}`,
      opts,
    );
  },

  getById(id: UUID, opts?: RequestOpts) {
    return v1Client.get<{ ok: true; package: Package }>(
      `/packages/${encodeURIComponent(id)}`,
      opts,
    );
  },

  /**
   * Receive a new package.  received_by_staff_id is resolved on the backend
   * from the JWT uid → staff_users mapping; the call fails with 400 if the
   * user is not registered as staff.
   */
  create(body: CreatePackageBody, opts?: RequestOpts) {
    return v1Client.post<{
      ok: true;
      package: Package;
      outbox_fanout: number;
    }>('/packages', body, opts);
  },

  update(id: UUID, patch: UpdatePackageBody, opts?: RequestOpts) {
    return v1Client.patch<{ ok: true; package: Package }>(
      `/packages/${encodeURIComponent(id)}`,
      patch,
      opts,
    );
  },

  pickup(id: UUID, body: PickupPackageBody, opts?: RequestOpts) {
    return v1Client.post<{
      ok: true;
      package: Package;
      outbox_fanout: number;
    }>(`/packages/${encodeURIComponent(id)}/pickup`, body, opts);
  },

  return(id: UUID, body?: ReturnPackageBody, opts?: RequestOpts) {
    return v1Client.post<{ ok: true; package: Package }>(
      `/packages/${encodeURIComponent(id)}/return`,
      body ?? {},
      opts,
    );
  },

  markLost(id: UUID, body: MarkLostPackageBody, opts?: RequestOpts) {
    return v1Client.post<{ ok: true; package: Package }>(
      `/packages/${encodeURIComponent(id)}/mark-lost`,
      body,
      opts,
    );
  },

  /**
   * Manual pickup reminder.  Rate-limited to 1/hour per (user,package) combo
   * on the backend — caller should expect 429 with a friendly message.
   */
  remind(id: UUID, opts?: RequestOpts) {
    return v1Client.post<{
      ok: true;
      package: Package;
      outbox_fanout: number;
    }>(`/packages/${encodeURIComponent(id)}/remind`, undefined, opts);
  },
};
