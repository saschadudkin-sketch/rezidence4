/**
 * routes/clientLogs.js — FIX [AUDIT-6 #4]: endpoint для frontend error reporter.
 *
 * Принимает батчи ошибок от фронта, логирует через pino.
 * Rate-limited: см. clientLogsLimiter в index.js (отдельный лимит для endpoint).
 * Не требует auth — ошибки могут случиться до логина.
 */
'use strict';
const express = require('express');
const logger  = require('../logger');

const router = express.Router();

// Валидация: макс 10 ошибок в батче, макс 2KB на ошибку
const MAX_BATCH = 10;
const MAX_ERROR_SIZE = 2048;
const MAX_CONTEXT_SIZE = 4096;
const REDACT_PATTERNS = [
  /token/i, /password/i, /secret/i, /cookie/i,
  /phone/i, /email/i, /authorization/i, /api[-_]?key/i,
];

function isSensitiveKey(key) {
  return REDACT_PATTERNS.some((rx) => rx.test(key));
}

function redactContext(input, depth = 0) {
  if (depth > 4) return '[depth-limited]';
  if (input == null) return input;
  if (Array.isArray(input)) return input.map((v) => redactContext(v, depth + 1));
  if (typeof input !== 'object') return input;
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = isSensitiveKey(k) ? '[redacted]' : redactContext(v, depth + 1);
  }
  return out;
}

function sanitizeContext(context) {
  if (context == null) return {};
  try {
    const redacted = redactContext(context);
    const serialized = JSON.stringify(redacted);
    if (!serialized) return {};
    if (serialized.length > MAX_CONTEXT_SIZE) {
      return { truncatedContext: serialized.slice(0, MAX_CONTEXT_SIZE) };
    }
    return redacted;
  } catch {
    return { invalidContext: true };
  }
}

router.post('/', (req, res) => {
  const { errors } = req.body || {};

  if (!Array.isArray(errors) || errors.length === 0) {
    return res.status(400).json({ error: 'errors array required' });
  }

  const batch = errors.slice(0, MAX_BATCH);

  for (const entry of batch) {
    // Sanitize: truncate oversized fields
    const safe = {
      message:   String(entry.message || '').slice(0, MAX_ERROR_SIZE),
      error:     entry.error ? String(JSON.stringify(entry.error)).slice(0, MAX_ERROR_SIZE) : null,
      context:   sanitizeContext(entry.context),
      timestamp: entry.timestamp || new Date().toISOString(),
      userAgent: req.headers['user-agent']?.slice(0, 256) || 'unknown',
      ip:        req.ip,
    };

    logger.warn({ clientError: safe }, '[client-error] %s', safe.message);
  }

  res.json({ ok: true, received: batch.length });
});

module.exports = router;
