'use strict';
const express  = require('express');
const logger   = require('../logger');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcrypt');
const fetch    = require('node-fetch');
const { v4: uuid } = require('uuid');
const db       = require('../db');
const requireAuth = require('../middleware/auth');
const { normalizePhone } = require('../constants');

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
  const refreshId = CRYPTO.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES);
  await db.query(
    `INSERT INTO refresh_tokens(id, uid, expires_at) VALUES($1, $2, $3)`,
    [refreshId, uid, expiresAt],
  );
  res.cookie('refreshToken', refreshId, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict', // FIX [S2]
    maxAge:   REFRESH_TOKEN_EXPIRES,
    path:     '/api/auth', // только для auth-запросов
  });
  return refreshId;
}

// normalizePhone — imported from '../constants' (единая реализация)

async function sendSms(phone, code) {
  const apiId = process.env.SMSRU_API_ID;
  if (!apiId || apiId === 'STUB') {
    logger.info({ phone }, '[sms] STUB mode — skipping send');
    return;
  }
  const digits = phone.replace(/\D/g, '');

  // FIX [SEC-5]: API ключ передаётся в теле POST-запроса, а не в URL.
  // Ранее ключ попадал в pino-http логи (url-поле каждого запроса к sms.ru).
  // URLSearchParams автоматически кодирует спецсимволы в теле.
  const body = new URLSearchParams({
    api_id: apiId,
    to:     digits,
    msg:    'Код входа Резиденции: ' + code,
    json:   '1',
  });

  const res  = await fetch('https://sms.ru/sms/send', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });
  const data = await res.json();
  if (data.status !== 'OK') {
    logger.error({ data }, '[sms] send failed');
    throw new Error('Не удалось отправить SMS');
  }
  logger.info({ phone }, '[sms] sent');
}

// ─── POST /api/auth/send-otp ──────────────────────────────────────────────────

router.post('/send-otp', async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone || '');
    if (phone.length < 12) return res.status(400).json({ error: 'Неверный номер телефона' });

    const { rows } = await db.query('SELECT uid FROM users WHERE phone=$1', [phone]);
    // SECURITY FIX: не возвращаем 404 при неизвестном номере — это user enumeration.
    // Атакующий мог перебирать номера и выяснять, кто зарегистрирован в системе.
    // Теперь: одинаковый ответ 200 при известном и неизвестном номере.
    // Если номер неизвестен — тихо отвечаем OK и не отправляем SMS.
    if (!rows.length) {
      logger.info({ phone }, '[send-otp] unknown phone — returning 200 to prevent enumeration');
      return res.json({ ok: true });
    }

    await db.query(
      `DELETE FROM otp_codes WHERE phone=$1 AND (expires_at < NOW() OR used=TRUE)`,
      [phone],
    );
    const { rows: active } = await db.query(
      `SELECT COUNT(*) FROM otp_codes WHERE phone=$1 AND expires_at > NOW() AND used=FALSE`,
      [phone],
    );
    if (Number(active[0].count) >= 3) {
      return res.status(429).json({ error: 'Слишком много попыток. Подождите несколько минут.' });
    }

    const code      = makeCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // FIX [PERF + CORRECTNESS]: порядок операций исправлен.
    // БЫЛО: hash (100ms) → sendSms → insert
    //   Если sendSms падает — 100ms потрачены впустую на каждую неудавшуюся отправку.
    // СТАЛО: sendSms → hash → insert
    //   Хешируем только когда точно знаем, что SMS ушёл.
    await sendSms(phone, code); // бросает при ошибке SMS → hash и INSERT не выполняются

    const hash = await bcrypt.hash(code, 10);

    await db.query(
      `INSERT INTO otp_codes(phone, code, expires_at) VALUES($1,$2,$3)`,
      [phone, hash, expiresAt],
    );
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
    //   Берём все активные НЕиспользованные коды, проверяем bcrypt, атомарно помечаем.
    const { rows: candidates } = await db.query(
      `SELECT id, code FROM otp_codes
       WHERE phone=$1 AND expires_at > NOW() AND used=FALSE AND attempts < 5
       ORDER BY id DESC LIMIT 3`,
      [phone],
    );

    let matchedId = null;
    for (const row of candidates) {
      const ok = await bcrypt.compare(code, row.code);
      if (ok) { matchedId = row.id; break; }
    }

    if (!matchedId) {
      // Инкрементируем счётчик попыток для всех активных кодов этого телефона
      await db.query(
        `UPDATE otp_codes SET attempts = attempts + 1
         WHERE phone=$1 AND expires_at > NOW() AND used=FALSE`,
        [phone],
      );
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
      `SELECT uid, phone, name, role, apartment, avatar FROM users WHERE phone=$1`,
      [phone],
    );
    if (!users.length) return res.status(404).json({ error: 'Пользователь не найден' });

    const user = users[0];

    // FIX [S1]: access token + refresh token при логине
    setTokenCookie(res, user);
    await setRefreshTokenCookie(res, user.uid);
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
  const allDevices = req.body?.allDevices === true;
  // req.user установлен requireAuth — uid гарантированно из верифицированного токена
  const uid = req.user.uid;

  if (allDevices) {
    await db.query(`DELETE FROM refresh_tokens WHERE uid=$1`, [uid]).catch(() => {});
  } else if (refreshId) {
    await db.query(`DELETE FROM refresh_tokens WHERE id=$1`, [refreshId]).catch(() => {});
  }
  res.clearCookie('token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
  res.clearCookie('refreshToken', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/auth' });
  res.json({ ok: true });
});

// FIX [S1]: POST /api/auth/refresh — ротация refresh token
// Клиент вызывает при 401 от access token. Refresh token одноразовый —
// при каждом использовании старый удаляется, выдаётся новый (rotation).
router.post('/refresh', async (req, res, next) => {
  try {
    const refreshId = req.cookies?.refreshToken;
    if (!refreshId) return res.status(401).json({ error: 'No refresh token' });

    // Атомарно забираем и удаляем — одноразовый токен
    const { rows } = await db.query(
      `DELETE FROM refresh_tokens WHERE id=$1 AND expires_at > NOW() RETURNING uid`,
      [refreshId],
    );
    if (!rows.length) {
      res.clearCookie('refreshToken', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/auth' });
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const uid = rows[0].uid;
    const { rows: users } = await db.query(
      `SELECT uid, phone, name, role, apartment, avatar FROM users WHERE uid=$1`, [uid],
    );
    if (!users.length) return res.status(404).json({ error: 'User not found' });

    const user = users[0];
    setTokenCookie(res, user);
    await setRefreshTokenCookie(res, user.uid); // ротация — новый refresh token
    res.json({ user });
  } catch (err) { next(err); }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT uid, phone, name, role, apartment, avatar FROM users WHERE uid=$1`,
      [req.user.uid],
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
