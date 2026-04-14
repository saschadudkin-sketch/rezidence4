import type { ErrorEvent as SentryErrorEvent, EventHint } from '@sentry/react';

const PHONE_RE = /(?:\+?\d[\d\s\-()]{9,}\d)/g;

function scrubString(value: string): string {
  return value
    .replace(PHONE_RE, '[Filtered Phone]')
    .replace(/\b(?:bearer|jwt|token|api[_-]?key|refresh[_-]?token|authorization)\b[=: ]+[^\s,;]+/gi, '[Filtered Token]')
    .replace(/\bcookie\b[=: ]+[^\n]+/gi, '[Filtered Cookie]');
}

function scrubUnknown(value: unknown): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.map(scrubUnknown);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    if (/authorization/i.test(key)) return [key, '[Filtered Token]'];
    if (/cookie/i.test(key)) return [key, '[Filtered Cookie]'];
    if (/token|phone/i.test(key)) return [key, typeof entry === 'string' ? scrubString(entry) : '[Filtered]'];
    if (key === 'url' && typeof entry === 'string') {
      return [key, scrubString(entry).replace(/([?&](?:token|access_token|refresh_token|api_key)=)[^&]+/gi, '$1[Filtered]')];
    }
    return [key, scrubUnknown(entry)];
  }));
}

export function scrubSentryEvent(event: SentryErrorEvent, hint?: EventHint): SentryErrorEvent {
  const nextEvent = scrubUnknown(event) as SentryErrorEvent;
  if (hint?.originalException instanceof Error && hint.originalException.message) {
    nextEvent.message = scrubString(nextEvent.message || hint.originalException.message);
  }
  return nextEvent;
}
