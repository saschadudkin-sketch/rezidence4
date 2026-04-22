'use strict';

/**
 * routes/telegramLink.js — Telegram account linking (Phase 1).
 *
 * POST   /api/v1/telegram/link-token         — generate one-time link token
 * DELETE /api/v1/push-subscriptions/telegram — unlink Telegram
 *
 * Linking flow:
 *   1. Frontend calls POST /api/v1/telegram/link-token → receives { linkToken, botUsername }
 *   2. Frontend shows deep link: https://t.me/<botUsername>?start=<linkToken>
 *   3. User clicks, opens bot, sends /start <linkToken>
 *   4. telegramBot.js handles the /start command, verifies token from Redis,
 *      upserts push_subscriptions row with platform='telegram'
 */

const express = require('express');
const { randomUUID } = require('crypto');
const requireAuth = require('../middleware/auth');
const { getRedis } = require('../lib/redisClient');
const logger = require('../logger');

const router = express.Router();
router.use(requireAuth);

const LINK_TOKEN_TTL_SECONDS = 600; // 10 minutes

// ─── POST /api/v1/telegram/link-token ────────────────────────────────────────
router.post('/link-token', async (req, res, next) => {
  try {
    const redis = getRedis();
    if (!redis) {
      return res.status(503).json({
        error: 'Redis unavailable',
        message: 'Telegram linking requires Redis. Please try again later.',
      });
    }

    const linkToken = randomUUID();
    const redisKey = `tg_link:${linkToken}`;

    await redis.setex(redisKey, LINK_TOKEN_TTL_SECONDS, req.user.uid);

    logger.info({ uid: req.user.uid, linkToken }, '[telegram-link] generated link token');

    res.json({
      linkToken,
      botUsername: process.env.TELEGRAM_BOT_USERNAME || null,
    });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/v1/push-subscriptions/telegram ───────────────────────────────
// Unlinks all Telegram subscriptions for the current user.
// NOTE: This route is mounted on the telegramLink router but the path segment
// is handled by registerApiRoutes.js mounting it correctly (see registration).
router.delete('/telegram', async (req, res, next) => {
  try {
    const db = req.db;
    if (!db) {
      return res.status(503).json({ error: 'Property database context not available' });
    }

    await db.query(
      `UPDATE push_subscriptions SET is_active = false
       WHERE user_id = $1 AND platform = 'telegram'`,
      [req.user.uid],
    );

    logger.info({ uid: req.user.uid }, '[telegram-link] unlinked telegram subscriptions');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
