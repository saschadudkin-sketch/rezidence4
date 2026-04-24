/**
 * platform-v1 documents client.
 * Backend: backend/src/v1/routes/documents.js
 * Spec:    docs/product/specs/platform-v1/documents-v2-spec.md
 *
 * Endpoints covered (main router under /api/v1):
 *   GET    /documents                    — resident feed / staff list
 *   GET    /documents/:id                — detail (resident: published+own property)
 *   POST   /documents                    — create (staff/admin)
 *   PATCH  /documents/:id                — update + snapshot to document_versions
 *   POST   /documents/:id/publish        — publish (idempotent)
 *   POST   /documents/:id/unpublish      — admin-only rollback
 *   DELETE /documents/:id                — admin-only soft-delete
 *
 * Admin sub-router under /api/v1/admin:
 *   GET /admin/documents/:id/versions            — history list
 *   GET /admin/documents/:id/versions/:version   — single snapshot
 *
 * Public sub-router (no auth) under /api/v1/public/:slug:
 *   GET /public/:slug/documents                  — rules/contacts/safety only
 *
 * Capability matrix (spec §3):
 *   security  — GET only
 *   resident  — GET published in their property
 *   concierge — GET + write contacts/instructions only
 *   admin     — full access including versions
 *
 * Content invariant: every published document must have either body_md OR
 * file_url (enforced by service).  file_url must start with /uploads/.
 */

import { v1Client, type RequestOpts } from './client';
import type {
  DocumentCategory,
  DocumentStatus,
  DocumentVersion,
  IsoDateTime,
  UUID,
  V1Document,
} from './types';

// ─── Query params ───────────────────────────────────────────────────────────

export interface ListDocumentsParams {
  /** Optional category filter.  Applied on backend with explicit column. */
  category?: DocumentCategory;
  tag?: string;
  limit?: number;
  /**
   * Staff query: requires property_id (backend returns 400 otherwise).  For
   * resident callers the field is ignored — backend derives from the session.
   */
  property_id?: UUID;
  /** Staff-only.  Show drafts (unpublished, not deleted). */
  include_draft?: boolean;
  /** Staff-only.  Show soft-deleted rows. */
  include_deleted?: boolean;
}

export interface ListPublicDocumentsParams {
  limit?: number;
}

// ─── Mutation bodies ────────────────────────────────────────────────────────

export interface CreateDocumentBody {
  property_id: UUID;
  title: string;
  category: DocumentCategory;
  tag?: string | null;
  body_md?: string | null;
  /** Must start with /uploads/ — external URLs rejected by service. */
  file_url?: string | null;
  file_mime?: string | null;
  file_size_bytes?: number | null;
  is_public?: boolean;
  sort_order?: number;
  /** If true, publish immediately instead of leaving as draft. */
  publish_now?: boolean;
}

export interface UpdateDocumentBody {
  title?: string;
  category?: DocumentCategory;
  tag?: string | null;
  body_md?: string | null;
  file_url?: string | null;
  file_mime?: string | null;
  file_size_bytes?: number | null;
  is_public?: boolean;
  sort_order?: number;
  /**
   * Free-text reason for the change.  Stored in `document_versions.reason`
   * when a snapshot is created.  Optional but recommended for audit trails.
   */
  reason?: string | null;
}

// ─── Derived client-side status ────────────────────────────────────────────

/**
 * deriveDocumentStatus — mirrors backend classification.
 * Priority: deleted > published > draft.
 */
export function deriveDocumentStatus(
  row: Pick<V1Document, 'deleted_at' | 'published_at'>,
): DocumentStatus {
  if (row.deleted_at) return 'deleted';
  if (row.published_at) return 'published';
  return 'draft';
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function toQuery(params: object | undefined): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  );
  if (!entries.length) return '';
  const qs = new URLSearchParams();
  for (const [k, v] of entries) {
    // Boolean → '1'/'0' так же как backend ожидает '1'|'true'.
    if (typeof v === 'boolean') qs.set(k, v ? '1' : '0');
    else qs.set(k, String(v));
  }
  return `?${qs.toString()}`;
}

// ─── API surface ───────────────────────────────────────────────────────────

export const documentsApi = {
  /**
   * Unified list.  For residents the backend resolves property_id from the
   * session automatically; for staff the caller MUST pass `property_id`.
   */
  list(params?: ListDocumentsParams, opts?: RequestOpts) {
    return v1Client.get<{ ok: true; documents: V1Document[]; count: number }>(
      `/documents${toQuery(params)}`,
      opts,
    );
  },

  getById(id: UUID, opts?: RequestOpts) {
    return v1Client.get<{ ok: true; document: V1Document }>(
      `/documents/${id}`,
      opts,
    );
  },

  create(body: CreateDocumentBody, opts?: RequestOpts) {
    return v1Client.post<{ ok: true; document: V1Document }>(
      '/documents',
      body,
      opts,
    );
  },

  update(id: UUID, patch: UpdateDocumentBody, opts?: RequestOpts) {
    return v1Client.patch<{ ok: true; document: V1Document }>(
      `/documents/${id}`,
      patch,
      opts,
    );
  },

  publish(id: UUID, opts?: RequestOpts) {
    return v1Client.post<{
      ok: true;
      document: V1Document;
      /** True if the document was already published. */
      idempotent?: boolean;
    }>(`/documents/${id}/publish`, undefined, opts);
  },

  unpublish(id: UUID, opts?: RequestOpts) {
    return v1Client.post<{ ok: true; document: V1Document }>(
      `/documents/${id}/unpublish`,
      undefined,
      opts,
    );
  },

  remove(id: UUID, opts?: RequestOpts) {
    return v1Client.delete<{ ok: true; document: V1Document }>(
      `/documents/${id}`,
      opts,
    );
  },

  // ─── Admin sub-router ──────────────────────────────────────────────────
  // The base path differs (`/admin/documents` vs `/documents`) but the
  // client prepends `/api/v1` so both land on the same backend deployment.

  listVersions(id: UUID, opts?: RequestOpts) {
    return v1Client.get<{
      ok: true;
      versions: DocumentVersion[];
      count: number;
    }>(`/admin/documents/${id}/versions`, opts);
  },

  getVersion(id: UUID, version: number, opts?: RequestOpts) {
    return v1Client.get<{ ok: true; version: DocumentVersion }>(
      `/admin/documents/${id}/versions/${version}`,
      opts,
    );
  },

  // ─── Public sub-router (no auth, but CSRF still inapplicable for GET) ──

  listPublic(slug: string, params?: ListPublicDocumentsParams, opts?: RequestOpts) {
    return v1Client.get<{ ok: true; documents: V1Document[]; count: number }>(
      `/public/${encodeURIComponent(slug)}/documents${toQuery(params)}`,
      opts,
    );
  },
};

// Re-export as type-value so consumers can narrow metric shapes if needed.
export type { IsoDateTime };
