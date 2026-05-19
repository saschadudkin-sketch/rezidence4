'use strict';

/**
 * routes/webhooks.js — admin webhook management (Phase 5).
 *
 * All endpoints require admin role (enforced below).
 *
 * GET    /api/v1/webhooks                    — list all webhooks
 * POST   /api/v1/webhooks                    — create webhook
 * PATCH  /api/v1/webhooks/:id               — partial update
 * DELETE /api/v1/webhooks/:id               — soft-deactivate
 * POST   /api/v1/webhooks/:id/test          — trigger test delivery
 * GET    /api/v1/webhooks/:id/deliveries    — last 50 deliveries
 */

const express     = require('express');
const requireAuth = require('../middleware/auth');
const logger      = require('../logger');
const { validateOutboundUrl } = require('../lib/urlSafety');

const router = express.Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTPS_RE = /^https:\/\//i;

// SEC [AUDIT-SSRF]: webhook URL'ы — admin-controlled, но требуют отдельной
// SSRF-валидации.  Без неё malicious admin регистрирует
// https://169.254.169.254/... и backend POST'ит туда HMAC-payload, ответ
// сохраняется в webhooks.last_error (clamp 500 chars) — утечка cloud IAM.
// Возвращает null если URL валиден или объект-ошибку для 400.
function rejectUnsafeWebhookUrl(rawUrl) {
  const r = validateOutboundUrl(rawUrl, { allowedProtocols: ['https:'] });
  if (r.ok) return null;
  return {
    code: 'INVALID_URL',
    message: `webhook url rejected: ${r.reason}`,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin only' } });
  }
  next();
}

function validateUuid(req, res, next) {
  if (!UUID_RE.test(req.params.id || '')) {
    return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid id format' } });
  }
  next();
}

function normalizeRequiredText(value, field, maxLength) {
  if (typeof value !== 'string' || !value.trim()) {
    return { error: { code: 'INVALID_FIELD', message: `${field} is required` } };
  }
  const text = value.trim();
  if (text.length > maxLength) {
    return { error: { code: 'INVALID_FIELD', message: `${field} is too long` } };
  }
  return { value: text };
}

function normalizeEvents(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return { error: { code: 'INVALID_EVENTS', message: 'events must be a non-empty array' } };
  }

  const events = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) {
      return { error: { code: 'INVALID_EVENTS', message: 'events must contain non-empty strings' } };
    }
    const event = item.trim();
    if (event.length > 120) {
      return { error: { code: 'INVALID_EVENTS', message: 'events entries are too long' } };
    }
    if (seen.has(event)) {
      return { error: { code: 'INVALID_EVENTS', message: 'events must not contain duplicates' } };
    }
    seen.add(event);
    events.push(event);
  }
  return { value: events };
}

function normalizeOptionalBoolean(value, field) {
  if (value === undefined) return { value: undefined };
  if (typeof value === 'boolean') return { value };
  if (value === 'true' || value === '1') return { value: true };
  if (value === 'false' || value === '0') return { value: false };
  return { error: { code: 'INVALID_FIELD', message: `${field} must be boolean` } };
}

async function writeAudit(db, actorUid, actorRole, action, resourceId, changes) {
  try {
    await db.query(
      `INSERT INTO property_audit_log (actor_uid, actor_role, action, resource_type, resource_id, changes)
       VALUES ($1, $2, $3, 'webhook', $4, $5)`,
      [actorUid, actorRole, action, resourceId, JSON.stringify(changes)],
    );
  } catch (_err) {
    // Audit failures must never block the main response.
  }
}

// ─── GET /api/v1/webhooks ────────────────────────────────────────────────────
router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT id, name, url, events, is_active, retry_count,
              last_attempt_at, last_success_at, last_error, created_by, created_at, updated_at
       FROM webhooks
       ORDER BY created_at DESC`,
    );
    res.json({ webhooks: rows });
  } catch (err) { next(err); }
});

// ─── POST /api/v1/webhooks ────────────────────────────────────────────────────
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { name, url, secret, events } = req.body;

    if (name === undefined || url === undefined || secret === undefined || events === undefined) {
      return res.status(400).json({
        error: { code: 'MISSING_FIELDS', message: 'name, url, secret, and a non-empty events array are required' },
      });
    }
    const normalizedName = normalizeRequiredText(name, 'name', 100);
    if (normalizedName.error) return res.status(400).json({ error: normalizedName.error });
    const normalizedUrl = normalizeRequiredText(url, 'url', 2048);
    if (normalizedUrl.error) return res.status(400).json({ error: normalizedUrl.error });
    const normalizedSecret = normalizeRequiredText(secret, 'secret', 500);
    if (normalizedSecret.error) return res.status(400).json({ error: normalizedSecret.error });
    const normalizedEvents = normalizeEvents(events);
    if (normalizedEvents.error) return res.status(400).json({ error: normalizedEvents.error });

    if (!HTTPS_RE.test(normalizedUrl.value)) {
      return res.status(400).json({
        error: { code: 'INVALID_URL', message: 'url must start with https://' },
      });
    }
    const ssrfErr = rejectUnsafeWebhookUrl(normalizedUrl.value);
    if (ssrfErr) {
      return res.status(400).json({ error: ssrfErr });
    }

    const { rows } = await req.db.query(
      `INSERT INTO webhooks (name, url, secret, events, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, url, events, is_active, retry_count,
                 last_attempt_at, last_success_at, last_error, created_by, created_at, updated_at`,
      [normalizedName.value, normalizedUrl.value, normalizedSecret.value, normalizedEvents.value, req.user.uid],
    );

    const webhook = rows[0];
    await writeAudit(req.db, req.user.uid, req.user.role, 'webhook.created', webhook.id, {
      name: normalizedName.value,
      url: normalizedUrl.value,
      events: normalizedEvents.value,
    });
    logger.info({ webhookId: webhook.id, name: normalizedName.value }, '[webhooks] created');

    res.status(201).json({ webhook });
  } catch (err) { next(err); }
});

// ─── PATCH /api/v1/webhooks/:id ──────────────────────────────────────────────
router.patch('/:id', requireAdmin, validateUuid, async (req, res, next) => {
  try {
    const { name, url, secret, events, is_active } = req.body;
    const db = req.db;

    const normalizedName = name !== undefined ? normalizeRequiredText(name, 'name', 100) : { value: undefined };
    if (normalizedName.error) return res.status(400).json({ error: normalizedName.error });
    const normalizedUrl = url !== undefined ? normalizeRequiredText(url, 'url', 2048) : { value: undefined };
    if (normalizedUrl.error) return res.status(400).json({ error: normalizedUrl.error });
    const normalizedSecret = secret !== undefined ? normalizeRequiredText(secret, 'secret', 500) : { value: undefined };
    if (normalizedSecret.error) return res.status(400).json({ error: normalizedSecret.error });
    const normalizedEvents = events !== undefined ? normalizeEvents(events) : { value: undefined };
    if (normalizedEvents.error) return res.status(400).json({ error: normalizedEvents.error });
    const normalizedActive = normalizeOptionalBoolean(is_active, 'is_active');
    if (normalizedActive.error) return res.status(400).json({ error: normalizedActive.error });

    if (normalizedUrl.value !== undefined && !HTTPS_RE.test(normalizedUrl.value)) {
      return res.status(400).json({
        error: { code: 'INVALID_URL', message: 'url must start with https://' },
      });
    }
    if (normalizedUrl.value !== undefined) {
      const ssrfErr = rejectUnsafeWebhookUrl(normalizedUrl.value);
      if (ssrfErr) {
        return res.status(400).json({ error: ssrfErr });
      }
    }

    const setClauses = ['updated_at = NOW()'];
    const params     = [];
    let   idx        = 1;

    if (normalizedName.value !== undefined) { setClauses.push(`name = $${idx++}`);      params.push(normalizedName.value); }
    if (normalizedUrl.value !== undefined) { setClauses.push(`url = $${idx++}`);       params.push(normalizedUrl.value); }
    if (normalizedSecret.value !== undefined) { setClauses.push(`secret = $${idx++}`);    params.push(normalizedSecret.value); }
    if (normalizedEvents.value !== undefined) { setClauses.push(`events = $${idx++}`);    params.push(normalizedEvents.value); }
    if (normalizedActive.value !== undefined) { setClauses.push(`is_active = $${idx++}`); params.push(normalizedActive.value); }

    if (setClauses.length === 1) {
      return res.status(400).json({ error: { code: 'NO_FIELDS', message: 'No updatable fields provided' } });
    }

    params.push(req.params.id);
    const { rows } = await db.query(
      `UPDATE webhooks
       SET ${setClauses.join(', ')}
       WHERE id = $${idx}
       RETURNING id, name, url, events, is_active, retry_count,
                 last_attempt_at, last_success_at, last_error, created_by, created_at, updated_at`,
      params,
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Webhook not found' } });
    }

    const webhook = rows[0];
    await writeAudit(db, req.user.uid, req.user.role, 'webhook.updated', webhook.id, {
      ...(normalizedName.value !== undefined ? { name: normalizedName.value } : {}),
      ...(normalizedUrl.value !== undefined ? { url: normalizedUrl.value } : {}),
      ...(normalizedSecret.value !== undefined ? { secret_changed: true } : {}),
      ...(normalizedEvents.value !== undefined ? { events: normalizedEvents.value } : {}),
      ...(normalizedActive.value !== undefined ? { is_active: normalizedActive.value } : {}),
    });

    res.json({ webhook });
  } catch (err) { next(err); }
});

// ─── DELETE /api/v1/webhooks/:id ─────────────────────────────────────────────
router.delete('/:id', requireAdmin, validateUuid, async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `UPDATE webhooks
       SET is_active = false, updated_at = NOW()
       WHERE id = $1
       RETURNING id, name`,
      [req.params.id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Webhook not found' } });
    }

    await writeAudit(req.db, req.user.uid, req.user.role, 'webhook.deleted', rows[0].id, { name: rows[0].name });
    logger.info({ webhookId: rows[0].id }, '[webhooks] deactivated');

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── POST /api/v1/webhooks/:id/test ──────────────────────────────────────────
router.post('/:id/test', requireAdmin, validateUuid, async (req, res, next) => {
  try {
    const db = req.db;

    // Verify the webhook exists (active or not — admins can test inactive ones)
    const { rows: wRows } = await db.query(
      `SELECT id FROM webhooks WHERE id = $1`,
      [req.params.id],
    );
    if (wRows.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Webhook not found' } });
    }

    const { rows } = await db.query(
      `INSERT INTO webhook_deliveries (webhook_id, event_type, payload, next_attempt_at)
       VALUES ($1, 'test', $2, NOW())
       RETURNING id`,
      [req.params.id, JSON.stringify({ test: true })],
    );

    res.status(202).json({ deliveryId: rows[0].id });
  } catch (err) { next(err); }
});

// ─── GET /api/v1/webhooks/:id/deliveries ─────────────────────────────────────
router.get('/:id/deliveries', requireAdmin, validateUuid, async (req, res, next) => {
  try {
    const db = req.db;

    // Verify webhook exists
    const { rows: wRows } = await db.query(
      `SELECT id FROM webhooks WHERE id = $1`,
      [req.params.id],
    );
    if (wRows.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Webhook not found' } });
    }

    const { rows } = await db.query(
      `SELECT id, event_type, status, attempt_count, next_attempt_at,
              response_status, response_body, error_message, created_at, completed_at
       FROM webhook_deliveries
       WHERE webhook_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.params.id],
    );

    res.json({ deliveries: rows });
  } catch (err) { next(err); }
});

module.exports = router;
