/**
 * middleware/csrf.js — CSRF protection via double-submit cookie.
 *
 * Pattern: сервер выдаёт случайный CSRF-токен в non-HttpOnly cookie.
 * JS на фронте читает cookie и отправляет значение в заголовке X-CSRF-Token.
 * Middleware проверяет: cookie === header.
 *
 * Почему не csurf: csurf deprecated (2022), требует session/cookieParser,
 * и не нужен при SameSite=Strict + double-submit.
 *
 * Почему нужен несмотря на SameSite=Strict:
 * - SameSite=Strict не защищает от атак с того же site (subdomain takeover)
 * - Safari < 16.4 не полностью поддерживает SameSite=Strict
 */

'use strict';
const crypto = require('crypto');

const COOKIE_NAME = 'rz-csrf';
const HEADER_NAME = 'x-csrf-token';

// Выдаём CSRF-токен при каждом GET-запросе (cookie)
function setCsrfCookie(req, res, next) {
  if (!req.cookies[COOKIE_NAME]) {
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie(COOKIE_NAME, token, {
      httpOnly: false,          // JS должен прочитать
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge:   24 * 60 * 60 * 1000, // 24h
      path:     '/',
    });
  }
  next();
}

// Пути, освобождённые от CSRF:
// - client-logs: sendBeacon не может установить заголовки
// - send-otp/verify-otp: pre-auth (пользователь ещё не имеет CSRF cookie),
//   защищены OTP + rate limiting + brute force
//
// SECURITY FIX: Заменяем endsWith() на точное соответствие через Set.
// endsWith('/send-otp') совпадало бы с любым путём кончающимся на '/send-otp'
// (например, гипотетический '/api/evil/send-otp'). Set O(1) + точно.
// req.path здесь относительно mount-point '/api/', поэтому без '/api/' префикса.
const CSRF_EXEMPT_EXACT = new Set([
  '/client-logs',
  '/v1/client-logs',
  '/auth/send-otp',
  '/auth/verify-otp',
  '/v1/auth/send-otp',
  '/v1/auth/verify-otp',
]);

// Проверяем CSRF-токен на мутирующих запросах
function verifyCsrf(req, res, next) {
  // Пропускаем safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // Пропускаем exempt paths (точное соответствие — см. CSRF_EXEMPT_EXACT выше)
  if (CSRF_EXEMPT_EXACT.has(req.path)) return next();

  const cookieToken = req.cookies[COOKIE_NAME];
  const headerToken = req.headers[HEADER_NAME];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'CSRF token mismatch' });
  }
  next();
}

module.exports = { setCsrfCookie, verifyCsrf, COOKIE_NAME, HEADER_NAME };
