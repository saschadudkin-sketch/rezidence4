'use strict';

/**
 * routes/pushSubscriptions.js — Web Push subscription management (Phase 1).
 *
 * POST   /api/v1/push-subscriptions              — subscribe (upsert)
 * DELETE /api/v1/push-subscriptions/:id          — unsubscribe
 * GET    /api/v1/push-subscriptions/vapid-public-key — public VAPID key (no auth)
 */

const express = require('express');
const requireAuth = require('../middleware/auth');

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── GET /api/v1/push-subscriptions/vapid-public-key ─────────────────────────
// Public endpoint — returns VAPID public key for the service worker.
// Auth not required so the SW can subscribe before the user logs in.
router.get('/vapid-public-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || null });
});

// All other push-subscription routes require auth
router.use(requireAuth);

// ─── POST /api/v1/push-subscriptions ─────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const { endpoint, keys, deviceName } = req.body;

    if (!endpoint || typeof endpoint !== 'string') {
      return res.status(400).json({ error: 'endpoint is required' });
    }
    if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') {
      return res.status(400).json({ error: 'keys.p256dh and keys.auth are required' });
    }

    const db = req.db;
    if (!db) {
      return res.status(503).json({ error: 'Property database context not available' });
    }

    // Upsert — ON CONFLICT (user_id, endpoint) updates keys in case they rotated
    const { rows } = await db.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device_name, platform, is_active, failure_count)
       VALUES ($1, $2, $3, $4, $5, 'web', true, 0)
       ON CONFLICT (user_id, endpoint)
       DO UPDATE SET
         p256dh       = EXCLUDED.p256dh,
         auth         = EXCLUDED.auth,
         device_name  = COALESCE(EXCLUDED.device_name, push_subscriptions.device_name),
         is_active    = true,
         failure_count = 0
       RETURNING id`,
      [req.user.uid, endpoint, keys.p256dh, keys.auth, deviceName || null],
    );

    res.status(201).json({ subscription: { id: rows[0].id } });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/v1/push-subscriptions/:id ────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id || '');
    if (!UUID_RE.test(id)) {
      return res.status(400).json({ error: 'Invalid subscription id format' });
    }

    const db = req.db;
    if (!db) {
      return res.status(503).json({ error: 'Property database context not available' });
    }

    // Verify ownership before deactivating
    const { rows } = await db.query(
      `SELECT id FROM push_subscriptions WHERE id = $1 AND user_id = $2`,
      [id, req.user.uid],
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    await db.query(
      `UPDATE push_subscriptions SET is_active = false WHERE id = $1`,
      [id],
    );

    res.sendStatus(204);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
