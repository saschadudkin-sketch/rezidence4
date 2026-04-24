'use strict';

/**
 * routes/announcements.js — Phase 2 Announcements API
 *
 * GET  /              — public for ?kiosk=1; auth required for full list
 * GET  /:id           — auth required
 * POST /              — admin only
 * PATCH /:id          — admin only (partial update)
 * DELETE /:id         — admin only (soft delete)
 *
 * Active filter: (expires_at IS NULL OR expires_at > NOW()) AND deleted_at IS NULL
 */

const express = require('express');
const requireAuth = require('../middleware/auth');
const logger = require('../logger');
const { dispatch: notifyDispatch } = require('../services/notificationService');

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(req, res, next) {
  if (!UUID_RE.test(String(req.params.id || ''))) {
    return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid id format' } });
  }
  next();
}

function fmt(r) {
  return {
    id:          r.id,
    title:       r.title,
    body:        r.body,
    type:        r.type,
    pinned:      r.pinned,
    imageUrl:    r.image_url,
    ctaLabel:    r.cta_label,
    ctaUrl:      r.cta_url,
    sortOrder:   r.sort_order,
    publishedAt: r.published_at,
    expiresAt:   r.expires_at,
    authorId:    r.author_id,
    createdAt:   r.created_at,
    updatedAt:   r.updated_at,
  };
}

const ACTIVE_FILTER = `(expires_at IS NULL OR expires_at > NOW()) AND deleted_at IS NULL`;

// ─── GET / ────────────────────────────────────────────────────────────────────
// ?kiosk=1 → public, no auth. Otherwise auth required.
router.get('/', async (req, res, next) => {
  const isKiosk = req.query.kiosk === '1';

  if (!isKiosk) {
    // Require auth for non-kiosk access
    try {
      await new Promise((resolve, reject) => requireAuth(req, res, (err) => (err ? reject(err) : resolve())));
    } catch {
      return; // requireAuth already sent the 401 response
    }
  }

  try {
    const db = req.db;
    let query;
    let params = [];

    if (isKiosk) {
      // Kiosk: active only, pinned first, then sort_order, then published_at DESC
      query = `
        SELECT id, title, body, type, pinned, image_url, cta_label, cta_url,
               sort_order, published_at, expires_at, author_id, created_at, updated_at
        FROM announcements
        WHERE ${ACTIVE_FILTER}
        ORDER BY pinned DESC, sort_order ASC, published_at DESC
      `;
    } else {
      // Authenticated users: active list (staff/admin could get all via separate query,
      // but per spec the default list is active; admin sees same active feed)
      query = `
        SELECT id, title, body, type, pinned, image_url, cta_label, cta_url,
               sort_order, published_at, expires_at, author_id, created_at, updated_at
        FROM announcements
        WHERE ${ACTIVE_FILTER}
        ORDER BY pinned DESC, sort_order ASC, published_at DESC
      `;
    }

    const { rows } = await db.query(query, params);
    res.json(rows.map(fmt));
  } catch (err) { next(err); }
});

// ─── GET /:id ─────────────────────────────────────────────────────────────────
router.get('/:id', requireAuth, validateUuid, async (req, res, next) => {
  try {
    const db = req.db;
    const { rows } = await db.query(
      `SELECT id, title, body, type, pinned, image_url, cta_label, cta_url,
              sort_order, published_at, expires_at, author_id, created_at, updated_at
       FROM announcements
       WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id],
    );
    if (!rows.length) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Announcement not found' } });
    }
    res.json(fmt(rows[0]));
  } catch (err) { next(err); }
});

// ─── POST / ───────────────────────────────────────────────────────────────────
router.post('/', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin only' } });
    }

    const { title, body, type, pinned, expires_at, image_url, cta_label, cta_url, sort_order } = req.body;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION', message: 'title is required' } });
    }
    if (!body || typeof body !== 'string' || body.trim().length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION', message: 'body is required' } });
    }

    const VALID_TYPES = new Set(['info', 'urgent', 'maintenance']);
    const resolvedType = type || 'info';
    if (!VALID_TYPES.has(resolvedType)) {
      return res.status(400).json({ error: { code: 'VALIDATION', message: 'Invalid type. Must be info|urgent|maintenance' } });
    }

    const db = req.db;
    const { rows } = await db.query(
      `INSERT INTO announcements
         (title, body, type, pinned, expires_at, image_url, cta_label, cta_url, sort_order, author_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, title, body, type, pinned, image_url, cta_label, cta_url,
                 sort_order, published_at, expires_at, author_id, created_at, updated_at`,
      [
        title.trim(),
        body.trim(),
        resolvedType,
        pinned === true || pinned === 'true' ? true : false,
        expires_at || null,
        image_url || null,
        cta_label || null,
        cta_url || null,
        sort_order != null ? Number(sort_order) : 0,
        req.user.uid,
      ],
    );
    const created = rows[0];

    // Audit log
    try {
      await db.query(
        `INSERT INTO property_audit_log (actor_uid, actor_role, action, resource_type, resource_id, changes, ip_address)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          req.user.uid, req.user.role, 'announcement.created', 'announcement', created.id,
          JSON.stringify({ title: created.title, type: created.type }),
          req.ip || null,
        ],
      );
    } catch (auditErr) {
      logger.warn({ err: auditErr }, '[announcements] audit log write failed');
    }

    // Dispatch notification for urgent announcements (non-blocking)
    if (resolvedType === 'urgent') {
      notifyDispatch(
        'announcement.published',
        { announcementId: created.id, title: created.title },
        db,
        req.property || null,
      ).catch(() => {});
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
      `SELECT id FROM announcements WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id],
    );
    if (!existing.length) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Announcement not found' } });
    }

    const allowed = ['title', 'body', 'type', 'pinned', 'expires_at', 'image_url', 'cta_label', 'cta_url', 'sort_order'];
    const colMap = {
      title: 'title', body: 'body', type: 'type', pinned: 'pinned',
      expires_at: 'expires_at', image_url: 'image_url', cta_label: 'cta_label',
      cta_url: 'cta_url', sort_order: 'sort_order',
    };

    const setClauses = [];
    const params = [];
    let idx = 1;

    for (const field of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        setClauses.push(`${colMap[field]} = $${idx++}`);
        params.push(req.body[field] !== undefined ? req.body[field] : null);
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION', message: 'No valid fields to update' } });
    }

    setClauses.push(`updated_at = NOW()`);
    params.push(req.params.id);

    const { rows } = await db.query(
      `UPDATE announcements SET ${setClauses.join(', ')}
       WHERE id = $${idx} AND deleted_at IS NULL
       RETURNING id, title, body, type, pinned, image_url, cta_label, cta_url,
                 sort_order, published_at, expires_at, author_id, created_at, updated_at`,
      params,
    );

    if (!rows.length) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Announcement not found' } });
    }

    // Audit log
    try {
      await db.query(
        `INSERT INTO property_audit_log (actor_uid, actor_role, action, resource_type, resource_id, changes, ip_address)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          req.user.uid, req.user.role, 'announcement.updated', 'announcement', req.params.id,
          JSON.stringify(req.body),
          req.ip || null,
        ],
      );
    } catch (auditErr) {
      logger.warn({ err: auditErr }, '[announcements] audit log write failed');
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
      `UPDATE announcements SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id],
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Announcement not found' } });
    }

    // Audit log
    try {
      await db.query(
        `INSERT INTO property_audit_log (actor_uid, actor_role, action, resource_type, resource_id, ip_address)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [req.user.uid, req.user.role, 'announcement.deleted', 'announcement', req.params.id, req.ip || null],
      );
    } catch (auditErr) {
      logger.warn({ err: auditErr }, '[announcements] audit log write failed');
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
