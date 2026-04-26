/**
 * platform-v1 announcements client.
 * Backend: backend/src/v1/routes/announcements.js
 * Spec:    docs/product/specs/platform-v1/announcements-v2-spec.md
 *
 * Endpoints covered:
 *   GET    /announcements                     — resident feed
 *   GET    /announcements/:id                 — detail (resident-own | staff)
 *   GET    /admin/announcements?property_id   — staff/admin list
 *   GET    /admin/announcements/:id/metrics   — reach metrics (admin)
 *   POST   /announcements                     — create draft
 *   PATCH  /announcements/:id                 — update (drafts only)
 *   POST   /announcements/:id/publish         — publish + outbox fan-out
 *   POST   /announcements/:id/unpublish       — rollback (admin only)
 *   DELETE /announcements/:id                 — soft-delete (admin only)
 *
 * Conflict codes mirrored from the service layer so callers can branch on
 * specific states (not_found / deleted / already_published / ...).  Errors
 * other than 4xx surface as V1ApiError via the client.
 */

import { v1Client, type RequestOpts } from './client';
import type {
  Announcement,
  AnnouncementAudienceType,
  AnnouncementCategory,
  AnnouncementChannel,
  AnnouncementStatus,
  AnnouncementUnitType,
  IsoDateTime,
  UUID,
} from './types';

// ─── Query params ───────────────────────────────────────────────────────────
// NB: announcements использует service-layer pagination (`count` плоско в
// response, без `page` обёртки), поэтому общий PaginationParams здесь не
// применяется.

export interface ListAnnouncementsParams {
  category?: AnnouncementCategory;
  only_active?: boolean;
  limit?: number;
}

export interface ListAdminAnnouncementsParams {
  property_id: UUID;
  /** Omit for "all" (including deleted). */
  status?: AnnouncementStatus | 'all';
  limit?: number;
}

// ─── Mutation bodies ────────────────────────────────────────────────────────

export interface CreateAnnouncementBody {
  property_id: UUID;
  title: string;
  body_md: string;
  is_urgent?: boolean;
  category?: AnnouncementCategory;
  audience_type?: AnnouncementAudienceType;
  audience_building_id?: UUID | null;
  audience_entrance_id?: UUID | null;
  audience_unit_type?: AnnouncementUnitType | null;
  starts_at?: IsoDateTime | null;
  expires_at?: IsoDateTime | null;
  is_pinned?: boolean;
  notify_channels?: AnnouncementChannel[];
}

/**
 * PATCH body — all fields optional.  `property_id` is immutable on the
 * backend, so it's excluded here (vs CreateAnnouncementBody).
 */
export type UpdateAnnouncementBody = Partial<Omit<CreateAnnouncementBody, 'property_id'>>;

// ─── Metrics response shape (admin-only) ────────────────────────────────────

export interface AnnouncementReachMetrics {
  announcement_id: UUID;
  outbox: Record<string, number>;      // status → count
  log: Record<string, number>;         // status → count
  delivered_pct: number | null;
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

/**
 * deriveStatus — client-side mirror of services/announcements.js status
 * classification.  Used by list UI to render status badges without an extra
 * roundtrip.  Keep in sync with listForAdmin WHERE branches.
 *
 * Priority: deleted > expired > active > scheduled > draft.
 */
export function deriveStatus(
  row: Pick<Announcement, 'deleted_at' | 'published_at' | 'starts_at' | 'expires_at'>,
  now: Date = new Date(),
): AnnouncementStatus {
  if (row.deleted_at) return 'deleted';
  if (!row.published_at) return 'draft';
  const nowMs = now.getTime();
  if (row.expires_at && new Date(row.expires_at).getTime() <= nowMs) return 'expired';
  if (new Date(row.starts_at).getTime() > nowMs) return 'scheduled';
  return 'active';
}

// ─── API surface ───────────────────────────────────────────────────────────

export const announcementsApi = {
  /** Resident feed — staff получает hint'ом что идти надо в /admin. */
  list(params?: ListAnnouncementsParams, opts?: RequestOpts) {
    return v1Client.get<{ ok: true; announcements: Announcement[]; count: number }>(
      `/announcements${toQuery(params)}`,
      opts,
    );
  },

  /** Admin/staff list — требует property_id в query. */
  listAdmin(params: ListAdminAnnouncementsParams, opts?: RequestOpts) {
    return v1Client.get<{ ok: true; announcements: Announcement[]; count: number }>(
      `/admin/announcements${toQuery(params)}`,
      opts,
    );
  },

  getById(id: UUID, opts?: RequestOpts) {
    return v1Client.get<{ ok: true; announcement: Announcement }>(
      `/announcements/${id}`,
      opts,
    );
  },

  create(body: CreateAnnouncementBody, opts?: RequestOpts) {
    return v1Client.post<{ ok: true; announcement: Announcement }>(
      '/announcements',
      body,
      opts,
    );
  },

  update(id: UUID, patch: UpdateAnnouncementBody, opts?: RequestOpts) {
    return v1Client.patch<{ ok: true; announcement: Announcement }>(
      `/announcements/${id}`,
      patch,
      opts,
    );
  },

  publish(id: UUID, opts?: RequestOpts) {
    return v1Client.post<{
      ok: true;
      announcement: Announcement;
      outbox_fanout: number;
    }>(`/announcements/${id}/publish`, undefined, opts);
  },

  unpublish(id: UUID, opts?: RequestOpts) {
    return v1Client.post<{ ok: true; announcement: Announcement }>(
      `/announcements/${id}/unpublish`,
      undefined,
      opts,
    );
  },

  remove(id: UUID, opts?: RequestOpts) {
    return v1Client.delete<{ ok: true; announcement: Announcement }>(
      `/announcements/${id}`,
      opts,
    );
  },

  getMetrics(id: UUID, opts?: RequestOpts) {
    return v1Client.get<{ ok: true; metrics: AnnouncementReachMetrics }>(
      `/admin/announcements/${id}/metrics`,
      opts,
    );
  },
};
