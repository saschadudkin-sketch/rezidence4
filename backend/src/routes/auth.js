'use strict';
const express  = require('express');
const logger   = require('../logger');
const jwt      = require('jsonwebtoken');
const passwordHasher = require('../utils/passwordHasher');
const { randomUUID: uuid } = require('crypto');
const db       = require('../db');
const requireAuth = require('../middleware/auth');
const { normalizePhone } = require('../constants');
const appMetrics = require('../metrics');
const { getRedis } = require('../lib/redisClient');

const { sendSms } = require('../services/smsService');

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const { randomInt } = require('crypto');

function makeCode() {
  return String(randomInt(100000, 1000000)); // CSPRNG вместо Math.random
}

// FIX [S1]: КРИТИЧНО — Access Token 15 мин + Refresh Token 30 дней с ротацией.
// Ранее: один JWT 30 дней без возможности отзыва.
// Теперь: короткий access token + refresh token с ротацией при каждом использовании.
const CRYPTO = require('crypto');
const ACCESS_TOKEN_EXPIRES  = '15m';
const REFRESH_TOKEN_EXPIRES = 30 * 24 * 60 * 60 * 1000; // 30 дней в мс
const REFRESH_COOKIE_PATH   = '/api';
// SEC: default=false — legacy raw-token fallback disabled unless explicitly opted in.
// Опасный default: включённый fallback позволяет использовать raw refresh token
// (если он попал в лог) для аутентификации в обход хэширования.
// Включить только на период миграции: REFRESH_LEGACY_FALLBACK_ENABLED=1
const REFRESH_LEGACY_FALLBACK_ENABLED = process.env.REFRESH_LEGACY_FALLBACK_ENABLED === '1';
// Auto-disable legacy fallback after migration deadline
const REFRESH_LEGACY_DEADLINE = new Date(process.env.REFRESH_LEGACY_DEADLINE || '2026-01-01');
const effectiveLegacyFallback = REFRESH_LEGACY_FALLBACK_ENABLED && Date.now() < REFRESH_LEGACY_DEADLINE.getTime();
if (REFRESH_LEGACY_FALLBACK_ENABLED && !effectiveLegacyFallback) {
  logger.warn('[auth] REFRESH_LEGACY_FALLBACK_ENABLED=1 but deadline passed — legacy fallback disabled automatically');
}

function hashRefreshToken(rawToken) {
  return CRYPTO.createHash('sha256').update(String(rawToken)).digest('hex');
}

function setTokenCookie(res, user) {
  const jti = uuid(); // уникальный ID токена для отзыва
  const token = jwt.sign(
    { uid: user.uid, role: user.role, name: user.name, jti },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES },
  );
  res.cookie('token', token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict', // FIX [S2]: strict вместо lax для CSRF защиты
    maxAge:   15 * 60 * 1000, // 15 минут
  });
  return token;
}

async function setRefreshTokenCookie(res, uid) {
  const refreshTokenRaw = CRYPTO.randomBytes(32).toString('hex');
  const refreshTokenHash = hashRefreshToken(refreshTokenRaw);
  const refreshRowId = uuid();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES);
  await db.query(
    `INSERT INTO refresh_tokens(id, id_hash, uid, expires_at) VALUES($1, $2, $3, $4)`,
    [refreshRowId, refreshTokenHash, uid, expiresAt],
  );
  res.cookie('refreshToken', refreshTokenRaw, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict', // FIX [S2]
    maxAge:   REFRESH_TOKEN_EXPIRES,
    path:     REFRESH_COOKIE_PATH, // единый scope для /api/* (включая /api/v1/auth/refresh)
  });
  return refreshTokenRaw;
}

// normalizePhone — imported from '../constants' (единая реализация)
// sendSms — imported from '../services/smsService' (abstraction with fallback chain)

// ─── POST /api/auth/send-otp ──────────────────────────────────────────────────

router.post('/send-otp', async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone || '');
    if (phone.length < 12) return res.status(400).json({ error: 'Неверный номер телефона' });

    const { rows } = await db.query(
      'SELECT uid FROM users WHERE phone=$1 AND deleted_at IS NULL',
      [phone],
    );
    // SECURITY FIX: не возвращаем 404 при неизвестном номере — это user enumeration.
    // Атакующий мог перебирать номера и выяснять, кто зарегистрирован в системе.
    // Теперь: одинаковый ответ 200 при известном и неизвестном номере.
    // Если номер неизвестен — тихо отвечаем OK и не отправляем SMS.
    if (!rows.length) {
      logger.info({ phone }, '[send-otp] unknown phone — returning 200 to prevent enumeration');
      return res.json({ ok: true });
    }

    // SEC: OTP send rate-limit — Redis atomic counter (multi-instance safe).
    // При нескольких бэкенд-инстансах DB-счётчик имеет race condition:
    // два запроса одновременно видят count=2, оба проходят — итого 4+ OTP.
    // Redis INCR атомарна, счётчик разделяется между всеми инстансами.
    // Fallback на DB-счётчик если Redis недоступен.
    const OTP_SEND_WINDOW_SEC = 300; // 5 минут
    const OTP_SEND_MAX        = 3;
    const redis = getRedis();
    if (redis) {
      try {
        const key   = `otp:send:${phone}`;
        const count = await redis.incr(key);
        if (count === 1) await redis.expire(key, OTP_SEND_WINDOW_SEC);
        if (count > OTP_SEND_MAX) {
          appMetrics.incrementCounter('otpSendRateLimited');
          return res.status(429).json({ error: 'Слишком много попыток. Подождите несколько минут.' });
        }
      } catch (redisErr) {
        logger.warn({ err: redisErr }, '[send-otp] redis rate-limit failed, falling back to DB counter');
        // Fallback: DB-based counter (single-instance safe)
        await db.query(
          `DELETE FROM otp_codes WHERE phone=$1 AND (expires_at < NOW() OR used=TRUE)`,
          [phone],
        );
        const { rows: active } = await db.query(
          `SELECT COUNT(*) FROM otp_codes WHERE phone=$1 AND expires_at > NOW() AND used=FALSE`,
          [phone],
        );
        if (Number(active[0].count) >= OTP_SEND_MAX) {
          appMetrics.incrementCounter('otpSendRateLimited');
          return res.status(429).json({ error: 'Слишком много попыток. Подождите несколько минут.' });
        }
      }
    } else {
      // No Redis — DB-based counter
      await db.query(
        `DELETE FROM otp_codes WHERE phone=$1 AND (expires_at < NOW() OR used=TRUE)`,
        [phone],
      );
      const { rows: active } = await db.query(
        `SELECT COUNT(*) FROM otp_codes WHERE phone=$1 AND expires_at > NOW() AND used=FALSE`,
        [phone],
      );
      if (Number(active[0].count) >= OTP_SEND_MAX) {
        appMetrics.incrementCounter('otpSendRateLimited');
        return res.status(429).json({ error: 'Слишком много попыток. Подождите несколько минут.' });
      }
    }

    const code      = makeCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // FIX [PERF + CORRECTNESS]: порядок операций исправлен.
    // БЫЛО: hash (100ms) → sendSms → insert
    //   Если sendSms падает — 100ms потрачены впустую на каждую неудавшуюся отправку.
    // СТАЛО: sendSms → hash → insert
    //   Хешируем только когда точно знаем, что SMS ушёл.
    try {
      await sendSms(phone, 'Код входа Резиденции: ' + code);
    } catch (smsErr) {
      appMetrics.incrementCounter('otpSendSmsFailed');
      throw smsErr; // propagate — hash and INSERT should not run if SMS failed
    }

    const hash = await passwordHasher.hash(code);

    await db.query(
      `INSERT INTO otp_codes(phone, code, expires_at) VALUES($1,$2,$3)`,
      [phone, hash, expiresAt],
    );
    appMetrics.incrementCounter('otpSendSuccess');
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── POST /api/auth/verify-otp ────────────────────────────────────────────────

router.post('/verify-otp', async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone || '');
    const code  = String(req.body.code || '').trim();

    if (!code || code.length < 4) return res.status(400).json({ error: 'Неверный код' });

    // FIX [КРИТ-4]: счётчик попыток — brute-force защита для /verify-otp
    // FIX [КРИТ-5]: атомарный UPDATE RETURNING — защита от race condition TOCTOU
    //   Берём все активные НЕиспользованные коды, проверяем хэш, атомарно помечаем.
    const { rows: candidates } = await db.query(
      `SELECT id, code FROM otp_codes
       WHERE phone=$1 AND expires_at > NOW() AND used=FALSE AND attempts < 5
       ORDER BY id DESC LIMIT 3`,
      [phone],
    );

    let matchedId = null;
    for (const row of candidates) {
      const ok = await passwordHasher.compare(code, row.code);
      if (ok) { matchedId = row.id; break; }
    }

    if (!matchedId) {
      // FIX [RACE]: добавлен AND attempts < 5 в UPDATE.
      // Без него два параллельных запроса могли оба пройти SELECT (видели attempts=4),
      // оба не совпасть с кодом, и оба инкрементировать — итого attempts=6 вместо 5.
      // С условием в UPDATE: при attempts=5 строка уже не обновляется — безвредно.
      await db.query(
        `UPDATE otp_codes SET attempts = attempts + 1
         WHERE phone=$1 AND expires_at > NOW() AND used=FALSE AND attempts < 5`,
        [phone],
      );
      appMetrics.incrementCounter('otpVerifyFailed');
      return res.status(401).json({ error: 'Неверный или истёкший код' });
    }

    // Атомарная пометка используя CTE + FOR UPDATE — предотвращает двойной вход
    const { rows: marked } = await db.query(
      `WITH target AS (
         SELECT id FROM otp_codes
         WHERE id=$1 AND used=FALSE
         LIMIT 1 FOR UPDATE
       )
       UPDATE otp_codes SET used=TRUE FROM target
       WHERE otp_codes.id = target.id
       RETURNING otp_codes.id`,
      [matchedId],
    );

    if (!marked.length) {
      // Кто-то успел раньше (race condition) — отказываем
      return res.status(401).json({ error: 'Неверный или истёкший код' });
    }

    const { rows: users } = await db.query(
      `SELECT uid, phone, name, role, apartment, avatar
       FROM users
       WHERE phone=$1 AND deleted_at IS NULL`,
      [phone],
    );
    if (!users.length) return res.status(404).json({ error: 'Пользователь не найден' });

    const user = users[0];

    // FIX [S1]: access token + refresh token при логине
    setTokenCookie(res, user);
    await setRefreshTokenCookie(res, user.uid);
    appMetrics.incrementCounter('otpVerifySuccess');
    appMetrics.incrementCounter('authLoginSuccess');
    res.json({ user });
  } catch (err) { next(err); }
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
// SECURITY FIX: requireAuth гарантирует, что uid в токене верифицирован подписью.
// Ранее: jwt.decode() (без верификации подписи) позволял любому атакующему
// передать поддельный токен с чужим uid и через allDevices=true удалить ВСЕ
// refresh tokens этого пользователя — принудительный logout всех устройств.
router.post('/logout', requireAuth, async (req, res) => {
  const { markTokenRevoked } = requireAuth;
  // FIX: req.user уже содержит верифицированный payload из requireAuth.
  // Убираем второй jwt.verify — он был лишним (2x криптографическая операция).
  const { jti, exp } = req.user;
  if (jti && exp) {
    await markTokenRevoked(jti, exp).catch(() => {});
  }

  const refreshId  = req.cookies?.refreshToken;
  const refreshHash = refreshId ? hashRefreshToken(refreshId) : null;
  const allDevices = req.body?.allDevices === true;
  // req.user установлен requireAuth — uid гарантированно из верифицированного токена
  const uid = req.user.uid;

  if (allDevices) {
    await db.query(`DELETE FROM refresh_tokens WHERE uid=$1`, [uid]).catch(() => {});
  } else if (refreshId) {
    await db.query(
      `DELETE FROM refresh_tokens WHERE id=$1 OR id_hash=$2`,
      [refreshId, refreshHash],
    ).catch(() => {});
  }
  res.clearCookie('token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  });
  res.json({ ok: true });
});

// FIX [S1]: POST /api/auth/refresh — ротация refresh token
// Клиент вызывает при 401 от access token. Refresh token одноразовый —
// при каждом использовании старый удаляется, выдаётся новый (rotation).
router.post('/refresh', async (req, res, next) => {
  try {
    appMetrics.incrementCounter('authRefreshRequests');
    const refreshId = req.cookies?.refreshToken;
    if (!refreshId) {
      appMetrics.incrementCounter('authRefreshFailed');
      return res.status(401).json({ error: 'No refresh token' });
    }
    const refreshHash = hashRefreshToken(refreshId);

    // Основной путь: ищем только по hash (безопасно для новых токенов).
    let { rows } = await db.query(
      `DELETE FROM refresh_tokens WHERE id_hash=$1 AND expires_at > NOW() RETURNING uid`,
      [refreshHash],
    );

    // Backward-compat: legacy строки со старым id=rawToken
    if (!rows.length && effectiveLegacyFallback) {
      const legacy = await db.query(
        `DELETE FROM refresh_tokens WHERE id=$1 AND expires_at > NOW() RETURNING uid`,
        [refreshId],
      );
      rows = legacy.rows;
      if (rows.length) {
        appMetrics.incrementCounter('authRefreshLegacyFallbackUsed');
        logger.warn('[auth/refresh] legacy refresh fallback used');
      }
    }

    if (!rows.length) {
      appMetrics.incrementCounter('authRefreshFailed');
      res.clearCookie('refreshToken', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: REFRESH_COOKIE_PATH,
      });
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const uid = rows[0].uid;
    const { rows: users } = await db.query(
      `SELECT uid, phone, name, role, apartment, avatar
       FROM users
       WHERE uid=$1 AND deleted_at IS NULL`, [uid],
    );
    if (!users.length) return res.status(404).json({ error: 'User not found' });

    const user = users[0];
    setTokenCookie(res, user);
    await setRefreshTokenCookie(res, user.uid); // ротация — новый refresh token
    appMetrics.incrementCounter('authRefreshSuccess');
    res.json({ user });
  } catch (err) { next(err); }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT uid, phone, name, role, apartment, avatar
       FROM users
       WHERE uid=$1 AND deleted_at IS NULL`,
      [req.user.uid],
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
