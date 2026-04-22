'use strict';

// ФЗ-152 runtime: Sentry initialisation with PII scrubbing.  Mirrors the
// frontend scrubber in frontend/src/services/telemetry/sentryPrivacy.ts so
// events captured on either tier are redacted consistently before leaving
// Russia.

const PHONE_RE = /(?:\+?\d[\d\s\-()]{9,}\d)/g;
const TOKEN_RE = /\b(?:bearer|jwt|token|api[_-]?key|refresh[_-]?token|authorization)\b[=: ]+[^\s,;]+/gi;
const COOKIE_RE = /\bcookie\b[=: ]+[^\n]+/gi;
const URL_TOKEN_RE = /([?&](?:token|access_token|refresh_token|api_key)=)[^&]+/gi;

function scrubString(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(PHONE_RE, '[Filtered Phone]')
    .replace(TOKEN_RE, '[Filtered Token]')
    .replace(COOKIE_RE, '[Filtered Cookie]');
}

function scrubValue(value, seen) {
  if (typeof value === 'string') return scrubString(value);
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) return value.map((entry) => scrubValue(entry, seen));

  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/^authorization$/i.test(key)) { out[key] = '[Filtered Token]'; continue; }
    if (/^cookie$/i.test(key)) { out[key] = '[Filtered Cookie]'; continue; }
    if (/token|phone/i.test(key)) {
      // Always redact identifier keys fully — the value itself may be a short
      // secret that the regex-based string scrubber wouldn't catch.
      out[key] = '[Filtered]';
      continue;
    }
    if (key === 'url' && typeof entry === 'string') {
      out[key] = scrubString(entry).replace(URL_TOKEN_RE, '$1[Filtered]');
      continue;
    }
    out[key] = scrubValue(entry, seen);
  }
  return out;
}

function scrubEvent(event, hint) {
  if (!event || typeof event !== 'object') return event;
  const cleaned = scrubValue(event, new Set());
  const originalException = hint && hint.originalException;
  if (originalException && originalException.message) {
    cleaned.message = scrubString(cleaned.message || originalException.message);
  }
  return cleaned;
}

let sentry = null;
let initialized = false;

function getSentry() {
  if (sentry) return sentry;
  try {
    // Lazy require keeps local/dev boot working when env is not configured.
    // eslint-disable-next-line global-require
    sentry = require('@sentry/node');
  } catch {
    sentry = null;
  }
  return sentry;
}

function initBackendSentry() {
  if (initialized) return getSentry();
  const Sentry = getSentry();
  const dsn = process.env.SENTRY_DSN;
  if (!Sentry || !dsn) return null;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
    beforeSend(event, hint) {
      try { return scrubEvent(event, hint); }
      catch { return null; } // fail closed: drop the event rather than leak PII
    },
  });
  initialized = true;
  return Sentry;
}

function captureException(err, context = {}) {
  const Sentry = getSentry();
  if (!Sentry || !initialized) return;
  Sentry.withScope((scope) => {
    Object.entries(context).forEach(([key, value]) => {
      scope.setExtra(key, value);
    });
    Sentry.captureException(err);
  });
}

module.exports = {
  initBackendSentry,
  captureException,
  // Exported for tests.
  scrubEvent,
  scrubString,
};
