'use strict';

const { sanitizeMarkdown, sanitizeTitle } = require('./markdownSanitizer');
const { FINAL_ROLES, normalizeRole } = require('../lib/authz');

// platform-v1 documents_v2 service — Spec: documents-v2-spec.md §2-§5.
//
// Статический контент резидентского портала: правила, контакты УК,
// инструкции, договоры, safety/legal, PDF-файлы.  В отличие от
// announcements_v2 — НЕ триггерит fan-out уведомлений при публикации; это
// справочник, резидент сам ходит смотреть.  Поэтому нет outbox / нет
// correlation_id / нет cron'а.
//
// Ключевые особенности:
//   1. Snapshot-on-PATCH: при изменении body_md/title/file_url мы ПЕРЕД
//      UPDATE'ом documents_v2 делаем INSERT в document_versions с
//      snapshot'ом старых значений (§2.2, §5 AC item 6).  Операция
//      атомарна — весь PATCH в одной транзакции client-based pool.
//   2. Capability gate: concierge может писать только в категории
//      contacts/instructions; property_admin — во всё.  Valid в service.
//   3. Public endpoint: отдаёт только rules/contacts/safety (НЕ legal/
//      contracts — §3, privacy concern).
//   4. file_url валидируется префиксом `/uploads/` — внешние URL запрещены
//      (см. CLAUDE.md Troubleshooting §Uploads).

// ─── Константы спецификации ─────────────────────────────────────────────────
const ALLOWED_CATEGORIES = [
  'rules', 'contacts', 'instructions', 'contracts', 'safety', 'legal', 'other',
];
// Concierge whitelist (§3 capability matrix): можно редактировать только эти.
const CONCIERGE_CATEGORIES = ['contacts', 'instructions'];
// Public API показывает только эти категории (§3 table).  legal/contracts —
// скрыты по privacy-соображениям, даже если is_public=true.
const PUBLIC_CATEGORIES = ['rules', 'contacts', 'safety'];

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(v) { return typeof v === 'string' && UUID_RE.test(v); }

function clampLimit(limit) {
  const n = Number.parseInt(limit, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIST_LIMIT;
  return Math.min(n, MAX_LIST_LIMIT);
}

// Колонки для list/get ответов.  deleted_at не включаем в resident-видимые
// ответы, но для simplicity отдаём один набор колонок — router решает
// видимость.
const DOCUMENT_COLUMNS = `
  id, property_id, title, category, tag,
  body_md, file_url, file_mime, file_size_bytes,
  is_public, sort_order, published_at,
  created_by_staff_id, updated_by_staff_id,
  created_at, updated_at, deleted_at
`.trim();

// ─── Валидация ──────────────────────────────────────────────────────────────

function validateFileUrl(url) {
  if (url === null || url === undefined) return;
  if (typeof url !== 'string') throw new Error('invalid file_url: must be string');
  if (!url.startsWith('/uploads/')) {
    throw new Error('invalid file_url: must start with /uploads/ (external URLs rejected)');
  }
}

function validateCategory(c) {
  if (!ALLOWED_CATEGORIES.includes(c)) {
    throw new Error(`invalid category '${c}' (allowed: ${ALLOWED_CATEGORIES.join(', ')})`);
  }
}

/**
 * assertConciergeCanWriteCategory — enforce §3 capability matrix.
 * role: 'property_admin'|'admin'|'concierge'|...
 * Throws if concierge пытается писать в legal/contracts/safety.
 */
function assertConciergeCanWriteCategory(role, category) {
  const finalRole = normalizeRole(role);
  if (
    finalRole === FINAL_ROLES.PROPERTY_ADMIN ||
    finalRole === FINAL_ROLES.MANAGEMENT_COMPANY_ADMIN ||
    finalRole === FINAL_ROLES.PLATFORM_ADMIN
  ) {
    return;
  }
  if (finalRole === FINAL_ROLES.CONCIERGE) {
    if (!CONCIERGE_CATEGORIES.includes(category)) {
      throw new Error(
        `invalid category for concierge: only ${CONCIERGE_CATEGORIES.join(', ')} allowed`
      );
    }
    return;
  }
  // Прочие роли (security, resident, etc.) не должны доходить до сюда —
  // router отсекает 403.  Но на всякий случай:
  throw new Error(`invalid role '${role}' for write operations`);
}

function validateCreateInput(input) {
  if (!input || typeof input !== 'object') throw new Error('invalid input');
  if (!input.propertyId || !isValidUuid(input.propertyId)) {
    throw new Error('invalid property_id: must be UUID');
  }
  if (!input.title || typeof input.title !== 'string' || input.title.trim() === '') {
    throw new Error('invalid title: required');
  }
  if (!input.category) throw new Error('invalid category: required');
  validateCategory(input.category);

  // bodyMd OR fileUrl (schema invariant).
  const hasBody = input.bodyMd && typeof input.bodyMd === 'string' && input.bodyMd.trim() !== '';
  const hasFile = input.fileUrl && typeof input.fileUrl === 'string';
  if (!hasBody && !hasFile) {
    throw new Error('invalid content: either body_md or file_url required');
  }

  if (input.fileUrl !== undefined && input.fileUrl !== null) {
    validateFileUrl(input.fileUrl);
    if (!input.fileMime || typeof input.fileMime !== 'string') {
      throw new Error('invalid file_mime: required when file_url set');
    }
    if (input.fileSizeBytes === undefined || input.fileSizeBytes === null) {
      throw new Error('invalid file_size_bytes: required when file_url set');
    }
    const size = Number.parseInt(input.fileSizeBytes, 10);
    if (!Number.isFinite(size) || size < 0) {
      throw new Error('invalid file_size_bytes: must be non-negative integer');
    }
  }

  if (input.tag !== undefined && input.tag !== null) {
    if (typeof input.tag !== 'string' || input.tag.length > 40) {
      throw new Error('invalid tag: must be string up to 40 chars');
    }
  }

  if (input.createdByStaffId !== undefined
      && input.createdByStaffId !== null
      && !isValidUuid(input.createdByStaffId)) {
    throw new Error('invalid created_by_staff_id: must be UUID');
  }

  if (input.sortOrder !== undefined && input.sortOrder !== null) {
    const s = Number.parseInt(input.sortOrder, 10);
    if (!Number.isFinite(s)) throw new Error('invalid sort_order: must be integer');
  }
}

// ─── Reads ──────────────────────────────────────────────────────────────────

/**
 * listForResident — GET /api/v1/documents (resident visibility).
 *
 * Резидент видит только:
 *   published_at IS NOT NULL
 *   deleted_at IS NULL
 * (is_public уже подразумевается в «опубликованном», т.к. resident —
 * authenticated резидент этого property).
 */
async function listForResident(db, propertyId, opts = {}) {
  if (!isValidUuid(propertyId)) return { rows: [], count: 0 };
  const limit = clampLimit(opts.limit);
  const params = [propertyId];
  const pieces = ['property_id = $1', 'deleted_at IS NULL', 'published_at IS NOT NULL'];

  if (opts.category) {
    validateCategory(opts.category);
    pieces.push(`category = $${params.length + 1}`);
    params.push(opts.category);
  }
  if (opts.tag) {
    pieces.push(`tag = $${params.length + 1}`);
    params.push(opts.tag);
  }

  const sql = `
    SELECT ${DOCUMENT_COLUMNS}
      FROM documents_v2
     WHERE ${pieces.join(' AND ')}
     ORDER BY category ASC, sort_order ASC, updated_at DESC
     LIMIT $${params.length + 1}
  `;
  params.push(limit);
  const { rows } = await db.query(sql, params);
  return { rows, count: rows.length };
}

/**
 * listForStaff — GET /api/v1/documents (staff visibility).
 *
 * Staff видит drafts, если передан include_draft=true.  Soft-deleted по
 * умолчанию скрыты; opts.includeDeleted=true добавляет их в список.
 */
async function listForStaff(db, propertyId, opts = {}) {
  if (!isValidUuid(propertyId)) return { rows: [], count: 0 };
  const limit = clampLimit(opts.limit);
  const params = [propertyId];
  const pieces = ['property_id = $1'];

  if (!opts.includeDeleted) pieces.push('deleted_at IS NULL');
  if (!opts.includeDraft) pieces.push('published_at IS NOT NULL');

  if (opts.category) {
    validateCategory(opts.category);
    pieces.push(`category = $${params.length + 1}`);
    params.push(opts.category);
  }
  if (opts.tag) {
    pieces.push(`tag = $${params.length + 1}`);
    params.push(opts.tag);
  }

  const sql = `
    SELECT ${DOCUMENT_COLUMNS}
      FROM documents_v2
     WHERE ${pieces.join(' AND ')}
     ORDER BY category ASC, sort_order ASC, updated_at DESC
     LIMIT $${params.length + 1}
  `;
  params.push(limit);
  const { rows } = await db.query(sql, params);
  return { rows, count: rows.length };
}

/**
 * listPublic — GET /api/v1/public/:slug/documents.
 *
 * Без auth.  Категории ограничены PUBLIC_CATEGORIES (§3).  Legal/contracts
 * скрыты даже при is_public=true.
 */
async function listPublic(db, propertyId, opts = {}) {
  const limit = clampLimit(opts.limit);
  const sql = `
    SELECT ${DOCUMENT_COLUMNS}
      FROM documents_v2
     WHERE property_id = $1
       AND deleted_at IS NULL
       AND published_at IS NOT NULL
       AND is_public = true
       AND category = ANY($2::text[])
     ORDER BY category ASC, sort_order ASC, updated_at DESC
     LIMIT $3
  `;
  const { rows } = await db.query(sql, [propertyId, PUBLIC_CATEGORIES, limit]);
  return { rows, count: rows.length };
}

async function getById(db, id, opts = {}) {
  if (!isValidUuid(id)) return null;
  const propertyPredicate = opts.propertyId ? ' AND property_id = $2' : '';
  const params = opts.propertyId ? [id, opts.propertyId] : [id];
  const { rows } = await db.query(
    `SELECT ${DOCUMENT_COLUMNS} FROM documents_v2 WHERE id = $1${propertyPredicate}`,
    params,
  );
  return rows[0] || null;
}

// ─── Writes ─────────────────────────────────────────────────────────────────

/**
 * createDocument — POST /api/v1/documents.
 *
 * Роль передаётся для capability-check (concierge ограничен категориями).
 * Если publishNow=true — сразу ставим published_at=NOW().  Без него — draft.
 */
async function createDocument(db, input, opts = {}) {
  validateCreateInput(input);
  assertConciergeCanWriteCategory(opts.role, input.category);

  const {
    propertyId, title, category, tag = null,
    bodyMd = null, fileUrl = null, fileMime = null, fileSizeBytes = null,
    isPublic = false, sortOrder = 0,
    createdByStaffId = null,
  } = input;

  const publishNow = opts.publishNow === true;

  // XSS-guard: strip raw HTML + валидация scheme'ов в markdown-links.
  // bodyMd может быть NULL (если это file-only документ) — sanitizeMarkdown
  // на non-string возвращает '', что мы превращаем обратно в NULL.
  const cleanTitle = sanitizeTitle(title);
  const cleanBody = bodyMd == null ? null : sanitizeMarkdown(bodyMd).sanitized;

  const { rows } = await db.query(
    `INSERT INTO documents_v2
       (property_id, title, category, tag,
        body_md, file_url, file_mime, file_size_bytes,
        is_public, sort_order, published_at,
        created_by_staff_id, updated_by_staff_id)
     VALUES ($1, $2, $3, $4,
             $5, $6, $7, $8,
             $9, $10,
             ${publishNow ? 'NOW()' : 'NULL'},
             $11, $11)
     RETURNING ${DOCUMENT_COLUMNS}`,
    [
      propertyId, cleanTitle, category, tag,
      cleanBody, fileUrl, fileMime, fileSizeBytes,
      Boolean(isPublic), sortOrder,
      createdByStaffId,
    ],
  );
  return rows[0];
}

/**
 * updateDocument — PATCH /api/v1/documents/:id.
 *
 * Snapshot-on-PATCH: если в patch есть title/bodyMd/fileUrl (или fileMime/
 * fileSizeBytes), перед UPDATE мы INSERT'им в document_versions row со
 * snapshot'ом ТЕКУЩИХ значений (т.е. старой версии, которая вот-вот
 * будет перезаписана).  Это делаем ATOMICALLY в одной транзакции
 * (pool.connect + BEGIN + snapshot + UPDATE + COMMIT).
 *
 * Возврат: { row, conflict: null|'noop'|'not_found'|'deleted' }
 */
async function updateDocument(pool, id, patch, opts = {}) {
  if (!isValidUuid(id)) throw new Error('invalid id: must be UUID');
  if (!patch || typeof patch !== 'object') {
    return { row: null, conflict: 'noop' };
  }

  // Whitelist безопасных полей (staff не должен менять property_id,
  // created_at, created_by_staff_id).
  const whitelist = [
    ['title', 'title'],
    ['category', 'category'],
    ['tag', 'tag'],
    ['bodyMd', 'body_md'],
    ['fileUrl', 'file_url'],
    ['fileMime', 'file_mime'],
    ['fileSizeBytes', 'file_size_bytes'],
    ['isPublic', 'is_public'],
    ['sortOrder', 'sort_order'],
  ];

  // Собираем только whitelisted keys.
  const keysToUpdate = [];
  for (const [jsKey, sqlKey] of whitelist) {
    if (jsKey in patch) keysToUpdate.push([jsKey, sqlKey]);
  }
  if (keysToUpdate.length === 0) return { row: null, conflict: 'noop' };

  // Валидация: категория, file_url.
  if ('category' in patch) {
    validateCategory(patch.category);
    if (opts.role) assertConciergeCanWriteCategory(opts.role, patch.category);
  }
  if ('fileUrl' in patch) validateFileUrl(patch.fileUrl);

  // Нужен ли snapshot?  Да — если меняется body_md / title / file_url.
  const snapshotTriggers = ['title', 'bodyMd', 'fileUrl'];
  const needSnapshot = snapshotTriggers.some((k) => k in patch);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Прочитать текущую row (lock не нужен — snapshot transactional).
    const propertyPredicate = opts.propertyId ? ' AND property_id = $2' : '';
    const readParams = opts.propertyId ? [id, opts.propertyId] : [id];
    const { rows: cur } = await client.query(
      `SELECT ${DOCUMENT_COLUMNS} FROM documents_v2 WHERE id = $1${propertyPredicate}`,
      readParams,
    );
    if (cur.length === 0) {
      await client.query('ROLLBACK');
      return { row: null, conflict: 'not_found' };
    }
    if (cur[0].deleted_at) {
      await client.query('ROLLBACK');
      return { row: null, conflict: 'deleted' };
    }
    const currentRow = cur[0];

    // Capability-check для существующей категории тоже (concierge не может
    // даже если меняет title в документе категории legal).
    if (opts.role) assertConciergeCanWriteCategory(opts.role, currentRow.category);

    // 2. Snapshot (если требуется).
    if (needSnapshot) {
      // Вычисляем next version: max(version)+1 в document_versions, по
      // умолчанию 1 если пусто.
      const { rows: verRows } = await client.query(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
           FROM document_versions WHERE document_id = $1`,
        [id],
      );
      const nextVersion = verRows[0].next_version;

      await client.query(
        `INSERT INTO document_versions
           (document_id, version, title_snapshot, body_md_snapshot, file_url_snapshot,
            archived_by_staff_id, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id, nextVersion,
          currentRow.title, currentRow.body_md, currentRow.file_url,
          opts.updatedByStaffId || null,
          opts.reason || null,
        ],
      );
    }

    // 3. UPDATE documents_v2 с whitelist.
    const pieces = [];
    const params = [];
    let n = 1;
    for (const [jsKey, sqlKey] of keysToUpdate) {
      pieces.push(`${sqlKey} = $${n}`);
      // XSS-guard на patch пути: sanitize title/bodyMd.  bodyMd=null для
      // file-only документа — пропускаем как NULL.
      if (jsKey === 'title') {
        params.push(sanitizeTitle(patch.title));
      } else if (jsKey === 'bodyMd') {
        params.push(patch.bodyMd == null ? null : sanitizeMarkdown(patch.bodyMd).sanitized);
      } else {
        params.push(patch[jsKey]);
      }
      n += 1;
    }
    // updated_by_staff_id audit
    if (opts.updatedByStaffId) {
      pieces.push(`updated_by_staff_id = $${n}`);
      params.push(opts.updatedByStaffId);
      n += 1;
    }
    params.push(id);
    const idIdx = n;
    if (opts.propertyId) {
      params.push(opts.propertyId);
      n += 1;
    }
    const { rows: upd } = await client.query(
      `UPDATE documents_v2
          SET ${pieces.join(', ')}, updated_at = NOW()
        WHERE id = $${idIdx}
          ${opts.propertyId ? `AND property_id = $${n}` : ''}
          AND deleted_at IS NULL
        RETURNING ${DOCUMENT_COLUMNS}`,
      params,
    );

    await client.query('COMMIT');
    return { row: upd[0], conflict: null };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * publishDocument — POST /api/v1/documents/:id/publish.
 *
 * Ставит published_at = NOW().  Идемпотентен: если уже опубликован —
 * возвращаем conflict:'already_published' (router может превратить в 200
 * idempotent или 409 по желанию; по §3 «idempotent если уже опубликован»
 * → router отдаёт 200 с existing row).
 */
async function publishDocument(db, id, opts = {}) {
  if (!isValidUuid(id)) throw new Error('invalid id: must be UUID');

  const propertyPredicate = opts.propertyId ? ' AND property_id = $2' : '';
  const readParams = opts.propertyId ? [id, opts.propertyId] : [id];
  const { rows: cur } = await db.query(
    `SELECT ${DOCUMENT_COLUMNS} FROM documents_v2 WHERE id = $1${propertyPredicate}`,
    readParams,
  );
  if (cur.length === 0) return { row: null, conflict: 'not_found' };
  if (cur[0].deleted_at) return { row: null, conflict: 'deleted' };

  // Capability для concierge
  if (opts.role) assertConciergeCanWriteCategory(opts.role, cur[0].category);

  // Идемпотентность: если уже опубликован — возвращаем текущую row без
  // UPDATE (§3 «idempotent»).
  if (cur[0].published_at) {
    return { row: cur[0], conflict: 'already_published' };
  }

  const { rows: upd } = await db.query(
    `UPDATE documents_v2
        SET published_at = NOW(),
            updated_by_staff_id = $2,
            updated_at = NOW()
      WHERE id = $1
        ${opts.propertyId ? 'AND property_id = $3' : ''}
        AND deleted_at IS NULL
      RETURNING ${DOCUMENT_COLUMNS}`,
    opts.propertyId ? [id, opts.updatedByStaffId || null, opts.propertyId] : [id, opts.updatedByStaffId || null],
  );
  return { row: upd[0], conflict: null };
}

/**
 * unpublishDocument — POST /api/v1/documents/:id/unpublish.  admin only.
 */
async function unpublishDocument(db, id, opts = {}) {
  if (!isValidUuid(id)) throw new Error('invalid id: must be UUID');
  const { rows: upd } = await db.query(
    `UPDATE documents_v2
        SET published_at = NULL,
            updated_by_staff_id = $2,
            updated_at = NOW()
      WHERE id = $1
        ${opts.propertyId ? 'AND property_id = $3' : ''}
        AND deleted_at IS NULL
        AND published_at IS NOT NULL
      RETURNING ${DOCUMENT_COLUMNS}`,
    opts.propertyId ? [id, opts.updatedByStaffId || null, opts.propertyId] : [id, opts.updatedByStaffId || null],
  );
  if (upd.length === 0) {
    const propertyPredicate = opts.propertyId ? ' AND property_id = $2' : '';
    const probeParams = opts.propertyId ? [id, opts.propertyId] : [id];
    const { rows: probe } = await db.query(
      `SELECT id, published_at, deleted_at FROM documents_v2 WHERE id = $1${propertyPredicate}`,
      probeParams,
    );
    if (probe.length === 0) return { row: null, conflict: 'not_found' };
    if (probe[0].deleted_at) return { row: null, conflict: 'deleted' };
    if (!probe[0].published_at) return { row: null, conflict: 'not_published' };
  }
  return { row: upd[0], conflict: null };
}

/**
 * softDeleteDocument — DELETE /api/v1/documents/:id.  admin only.
 * soft — ставит deleted_at=NOW().  document_versions сохраняются.
 */
async function softDeleteDocument(db, id, opts = {}) {
  if (!isValidUuid(id)) throw new Error('invalid id: must be UUID');
  const { rows: upd } = await db.query(
    `UPDATE documents_v2
        SET deleted_at = NOW(),
            updated_at = NOW()
      WHERE id = $1
        ${opts.propertyId ? 'AND property_id = $2' : ''}
        AND deleted_at IS NULL
      RETURNING ${DOCUMENT_COLUMNS}`,
    opts.propertyId ? [id, opts.propertyId] : [id],
  );
  if (upd.length === 0) {
    const propertyPredicate = opts.propertyId ? ' AND property_id = $2' : '';
    const probeParams = opts.propertyId ? [id, opts.propertyId] : [id];
    const { rows: probe } = await db.query(
      `SELECT id, deleted_at FROM documents_v2 WHERE id = $1${propertyPredicate}`,
      probeParams,
    );
    if (probe.length === 0) return { row: null, conflict: 'not_found' };
    return { row: null, conflict: 'already_deleted' };
  }
  return { row: upd[0], conflict: null };
}

// ─── Versions ───────────────────────────────────────────────────────────────

/**
 * listVersions — GET /api/v1/documents/:id/versions.  admin only.
 */
async function listVersions(db, documentId) {
  if (!isValidUuid(documentId)) return { rows: [], count: 0 };
  const { rows } = await db.query(
    `SELECT id, document_id, version, title_snapshot, body_md_snapshot,
            file_url_snapshot, archived_by_staff_id, archived_at, reason
       FROM document_versions
      WHERE document_id = $1
      ORDER BY version DESC`,
    [documentId],
  );
  return { rows, count: rows.length };
}

async function getVersion(db, documentId, version) {
  if (!isValidUuid(documentId)) return null;
  const n = Number.parseInt(version, 10);
  if (!Number.isFinite(n) || n < 1) return null;
  const { rows } = await db.query(
    `SELECT id, document_id, version, title_snapshot, body_md_snapshot,
            file_url_snapshot, archived_by_staff_id, archived_at, reason
       FROM document_versions
      WHERE document_id = $1 AND version = $2`,
    [documentId, n],
  );
  return rows[0] || null;
}

// ─── Resolve helpers ────────────────────────────────────────────────────────

async function resolveStaffIdByUid(db, uid) {
  if (!uid) return null;
  const { rows } = await db.query(
    `SELECT id FROM staff_users WHERE external_uid = $1 LIMIT 1`,
    [uid],
  );
  return rows[0]?.id || null;
}

async function resolvePropertyIdBySlug(db, slug) {
  if (!slug || typeof slug !== 'string') return null;
  const { rows } = await db.query(
    `SELECT id FROM properties WHERE slug = $1 LIMIT 1`,
    [slug],
  );
  return rows[0]?.id || null;
}

async function resolvePropertyIdByResidentUid(db, uid) {
  if (!uid) return null;
  const { rows } = await db.query(
    `SELECT property_id FROM residents WHERE external_uid = $1 AND is_active = true LIMIT 1`,
    [uid],
  );
  return rows[0]?.property_id || null;
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  // constants
  ALLOWED_CATEGORIES,
  CONCIERGE_CATEGORIES,
  PUBLIC_CATEGORIES,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  // helpers
  clampLimit,
  isValidUuid,
  validateFileUrl,
  validateCategory,
  assertConciergeCanWriteCategory,
  // reads
  listForResident,
  listForStaff,
  listPublic,
  getById,
  listVersions,
  getVersion,
  // writes
  createDocument,
  updateDocument,
  publishDocument,
  unpublishDocument,
  softDeleteDocument,
  // resolvers
  resolveStaffIdByUid,
  resolvePropertyIdBySlug,
  resolvePropertyIdByResidentUid,
};
