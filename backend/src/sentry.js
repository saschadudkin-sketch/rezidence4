'use strict';

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
};
