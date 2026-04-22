'use strict';

/**
 * routes/documents.js — Phase 2 Documents API
 *
 * GET  /              — unauthenticated+?public=1 or kiosk: is_public=true only
 *                       staff: all active (deleted_at IS NULL)
 * GET  /:id           — non-public requires auth
 * POST /              — admin only
 * PATCH /:id          — admin only, bumps version+1
 * DELETE /:id         — admin only (soft delete)
 *
 * Valid categories: rules | contacts | instructions | contracts | other
 */

const express = require('express');
const requireAuth = require('../middleware/auth');
const logger = require('../logger');
const { isStaff } = require('../constants');

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_CATEGORIES = new Set(['rules', 'contacts', 'instructions', 'contracts', 'other']);

function validateUuid(req, res, next) {
  if (!UUID_RE.test(String(req.params.id || ''))) {
    return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid id format' } });
  }
  next();
}

function fmt(r) {
  return {
    id:        r.id,
    title:     r.title,
    category:  r.category,
    body:      r.body,
    fileUrl:   r.file_url,
    isPublic:  r.is_public,
    sortOrder: r.sort_order,
    version:   r.version,
    authorId:  r.author_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const SELECT_COLS = `id, title, category, body, file_url, is_public, sort_order, version, author_id, created_at, updated_at`;

// ─── GET / ────────────────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  const isPublicRequest = req.query.public === '1' || req.query.kiosk === '1';

  // Attempt to resolve user (optional auth)
  let user = null;
  if (!isPublicRequest) {
    // Try to authenticate; if it fails we fall through to public-only view
    try {
      await new Promise((resolve, reject) => requireAuth(req, res, (err) => (err ? reject(err) : resolve())));
      user = req.user;
    } catch {
      return; // requireAuth already sent the 401
    }
  }

  try {
    const db = req.db;
    let query;

    if (isPublicRequest || !user) {
      // Unauthenticated or explicit public: only public documents
      query = `
        SELECT ${SELECT_COLS}
        FROM documents
        WHERE is_public = true AND deleted_at IS NULL
        ORDER BY category, sort_order ASC, created_at DESC
      `;
    } else if (isStaff(user.role)) {
      // Staff: all active documents
      query = `
        SELECT ${SELECT_COLS}
        FROM documents
        WHERE deleted_at IS NULL
        ORDER BY category, sort_order ASC, created_at DESC
      `;
    } else {
      // Residents: only public documents
      query = `
        SELECT ${SELECT_COLS}
        FROM documents
        WHERE is_public = true AND deleted_at IS NULL
        ORDER BY category, sort_order ASC, created_at DESC
      `;
    }

    const { rows } = await db.query(query);
    res.json(rows.map(fmt));
  } catch (err) { next(err); }
});

// ─── GET /:id ─────────────────────────────────────────────────────────────────
router.get('/:id', validateUuid, async (req, res, next) => {
  try {
    const db = req.db;
    const { rows } = await db.query(
      `SELECT ${SELECT_COLS} FROM documents WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id],
    );

    if (!rows.length) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
    }

    const doc = rows[0];

    // Non-public documents require auth
    if (!doc.is_public) {
      try {
        await new Promise((resolve, reject) => requireAuth(req, res, (err) => (err ? reject(err) : resolve())));
      } catch {
        return; // requireAuth already sent the 401
      }
    }

    res.json(fmt(doc));
  } catch (err) { next(err); }
});

// ─── POST / ───────────────────────────────────────────────────────────────────
router.post('/', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin only' } });
    }

    const { title, category, body, file_url, is_public, sort_order } = req.body;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION', message: 'title is required' } });
    }

    const resolvedCategory = category || 'other';
    if (!VALID_CATEGORIES.has(resolvedCategory)) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'Invalid category. Must be rules|contacts|instructions|contracts|other' },
      });
    }

    const db = req.db;
    const { rows } = await db.query(
      `INSERT INTO documents (title, category, body, file_url, is_public, sort_order, author_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING ${SELECT_COLS}`,
      [
        title.trim(),
        resolvedCategory,
        body || null,
        file_url || null,
        is_public === true || is_public === 'true' ? true : false,
        sort_order != null ? Number(sort_order) : 0,
        req.user.uid,
      ],
    );
    const created = rows[0];

    // Audit log
    try {
      await db.query(
        `INSERT INTO audit_log (actor_uid, actor_role, action, resource_type, resource_id, changes, ip_address)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          req.user.uid, req.user.role, 'document.created', 'document', created.id,
          JSON.stringify({ title: created.title, category: created.category }),
          req.ip || null,
        ],
      );
    } catch (auditErr) {
      logger.warn({ err: auditErr }, '[documents] audit log write failed');
    }

    res.status(201).json(fmt(created));
  } catch (err) { next(err); }
});

// ─── PATCH /:id ───────────────────────────────────────────────────────────────
router.patch('/:id', requireAuth, validateUuid, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin only' } });
    }

    const db = req.db;

    // Check exists
    const { rows: existing } = await db.query(
      `SELECT id, version FROM documents WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id],
    );
    if (!existing.length) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
    }

    const allowed = ['title', 'category', 'body', 'file_url', 'is_public', 'sort_order'];
    const colMap = {
      title: 'title', category: 'category', body: 'body',
      file_url: 'file_url', is_public: 'is_public', sort_order: 'sort_order',
    };

    const setClauses = [];
    const params = [];
    let idx = 1;

    for (const field of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        // Validate category if provided
        if (field === 'category' && !VALID_CATEGORIES.has(req.body[field])) {
          return res.status(400).json({
            error: { code: 'VALIDATION', message: 'Invalid category' },
          });
        }
        setClauses.push(`${colMap[field]} = $${idx++}`);
        params.push(req.body[field] !== undefined ? req.body[field] : null);
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION', message: 'No valid fields to update' } });
    }

    // Bump version
    setClauses.push(`version = version + 1`);
    setClauses.push(`updated_at = NOW()`);
    params.push(req.params.id);

    const { rows } = await db.query(
      `UPDATE documents SET ${setClauses.join(', ')}
       WHERE id = $${idx} AND deleted_at IS NULL
       RETURNING ${SELECT_COLS}`,
      params,
    );

    if (!rows.length) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
    }

    // Audit log
    try {
      await db.query(
        `INSERT INTO audit_log (actor_uid, actor_role, action, resource_type, resource_id, changes, ip_address)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          req.user.uid, req.user.role, 'document.updated', 'document', req.params.id,
          JSON.stringify(req.body),
          req.ip || null,
        ],
      );
    } catch (auditErr) {
      logger.warn({ err: auditErr }, '[documents] audit log write failed');
    }

    res.json(fmt(rows[0]));
  } catch (err) { next(err); }
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────
router.delete('/:id', requireAuth, validateUuid, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin only' } });
    }

    const db = req.db;
    const { rowCount } = await db.query(
      `UPDATE documents SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id],
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
    }

    // Audit log
    try {
      await db.query(
        `INSERT INTO audit_log (actor_uid, actor_role, action, resource_type, resource_id, ip_address)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [req.user.uid, req.user.role, 'document.deleted', 'document', req.params.id, req.ip || null],
      );
    } catch (auditErr) {
      logger.warn({ err: auditErr }, '[documents] audit log write failed');
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
