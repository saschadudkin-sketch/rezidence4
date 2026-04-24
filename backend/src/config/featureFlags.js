'use strict';

/**
 * config/featureFlags.js — Platform feature flag registry for DomHub v2.
 *
 * Single source of truth consumed by:
 *   - backend middleware (requireFeature, resolveFlags) for gating
 *   - backend admin API (routes/adminSettings.js) for reads/writes
 *   - backend public schema API (GET /api/v1/admin/feature-flags/schema)
 *     which the frontend FeatureFlagsContext calls to hydrate labels,
 *     categories, descriptions and default values at runtime
 *
 * Flag fields:
 *   default      — resolved value when a property has no explicit override
 *   label        — short human name (Russian) for the admin toggle row
 *   description  — one-line context (Russian) shown under the label
 *   category     — groups flags on the admin screen; must exist in CATEGORIES
 *   locked       — `true` means the flag cannot be turned off (core feature).
 *                  PATCH /feature-flags refuses to write these, the UI disables
 *                  the toggle, and the admin audit log ignores them.
 *
 * Add a new flag here and it automatically appears in:
 *   - Admin UI (via /feature-flags/schema + /feature-flags values endpoints)
 *   - PATCH validation (unknown keys are rejected)
 *   - resolveFlags() so every property gets a sensible default
 *
 * DO NOT duplicate these entries in the frontend — FeatureFlagsContext pulls
 * the registry over HTTP on load.  The frontend only hardcodes the list of
 * flag KEYS as a TypeScript literal (frontend/src/contexts/FeatureFlagsContext.tsx
 * FEATURE_KEYS) to preserve a narrow `FeatureFlags` type for call sites.  A
 * backend unit test (__tests__/featureFlagsRegistry.test.js) fails if those
 * two lists drift.
 */

const FEATURE_FLAGS = {
  chat: {
    default: true,
    locked: true,
    label: 'Чат',
    description: 'Чат жильцов с управляющей компанией и охраной',
    category: 'core',
  },
  announcements: {
    default: false,
    label: 'Объявления',
    description: 'Новости и объявления от управляющей компании',
    category: 'communication',
  },
  documents: {
    default: false,
    label: 'Документы и правила',
    description: 'Правила, инструкции, документы в открытом доступе',
    category: 'communication',
  },
  kiosk_mode: {
    default: false,
    label: 'Киоск-режим (холл)',
    description: 'Публичный экран в холле для гостей (/info)',
    category: 'communication',
  },
  qr_pass: {
    default: false,
    label: 'QR-пропуска',
    description: 'Автоматические QR-коды для гостевых пропусков',
    category: 'access',
  },
  meter_readings: {
    default: false,
    label: 'Показания счётчиков',
    description: 'Подача показаний счётчиков воды и электричества',
    category: 'resident',
  },
  billing: {
    default: false,
    label: 'Финансы и начисления',
    description: 'Начисления и оплата коммунальных услуг',
    category: 'resident',
  },
  space_booking: {
    default: false,
    label: 'Бронирование зон',
    description: 'Бронирование переговорных, барбекю, спортзала',
    category: 'resident',
  },
  packages: {
    default: false,
    label: 'Посылки и доставки',
    description: 'Учёт посылок и уведомление о доставке',
    category: 'concierge',
  },
  telegram_bot: {
    default: false,
    label: 'Telegram-уведомления',
    description: 'Уведомления жильцам и охране в Telegram',
    category: 'notifications',
  },
  webhooks: {
    default: false,
    label: 'Webhook-интеграции',
    description: 'Интеграция с внешними системами через webhook',
    category: 'integrations',
  },
  skud_integration: {
    default: false,
    label: 'СКУД-интеграция',
    description: 'Автоматическое управление СКУД при пропусках',
    category: 'integrations',
  },
  analytics: {
    default: false,
    label: 'Аналитика',
    description: 'Статистика посещений, заявок и работы объекта',
    category: 'admin',
  },
  legacy_utilities_enabled: {
    // Platform-v1 roadmap §Фаза 6: `meter_readings`, `billing_records`, `spaces`,
    // `space_bookings`, `chat_messages` заморожены до пост-релиза.  Этот флаг
    // работает ВТОРЫМ слоем защиты поверх per-module requireFeature: даже если
    // admin выставит meter_readings=true, /api/v1/meter-readings вернёт 404 пока
    // legacy_utilities_enabled остаётся false.  Для Замоскворечья — false
    // на старте (см. RECONCILIATION.md §12 Вариант B).
    default: false,
    label: 'Устаревшие модули (legacy)',
    description: 'Разморозить показания, биллинг, бронирования и чат (временно, до пост-релиза)',
    category: 'admin',
  },
};

/**
 * Category registry — controls grouping and display order on the admin screen.
 * `order` is ascending; lower = higher up in the UI.
 *
 * Any flag that references a category missing from this map will still be
 * displayed (the UI falls back to the category key as a label), but kept at
 * the bottom of the list.  Keep this in sync with the categories used above.
 */
const CATEGORIES = {
  core:           { label: 'Основные',         order: 1 },
  communication:  { label: 'Коммуникация',     order: 2 },
  access:         { label: 'Доступ',           order: 3 },
  resident:       { label: 'Для жильцов',      order: 4 },
  concierge:      { label: 'Консьерж',         order: 5 },
  notifications: { label: 'Уведомления',       order: 6 },
  integrations:  { label: 'Интеграции',        order: 7 },
  admin:         { label: 'Администрирование', order: 8 },
};

/**
 * Merge stored JSONB flags (may be null/undefined/{}) with registry defaults.
 * Always returns a complete map of all known flags as booleans.  Locked flags
 * always resolve to their registry default regardless of stored value, so a
 * stale DB override cannot silently disable a core feature.
 *
 * @param {Object} stored - Raw feature_flags JSONB from platform DB row
 * @returns {Object} - { [flagName]: boolean }
 */
function resolveFlags(stored = {}) {
  const safe = stored && typeof stored === 'object' ? stored : {};
  const resolved = {};
  for (const [key, meta] of Object.entries(FEATURE_FLAGS)) {
    if (meta.locked) {
      resolved[key] = meta.default;
      continue;
    }
    resolved[key] = key in safe ? Boolean(safe[key]) : meta.default;
  }
  return resolved;
}

/**
 * Public registry schema — shape consumed by /feature-flags/schema endpoint
 * (and therefore by the frontend FeatureFlagsContext).  Stable JSON shape,
 * safe to cache.
 *
 * @returns {{
 *   flags: Array<{key, label, description, category, default, locked}>,
 *   categories: Array<{key, label, order}>,
 * }}
 */
function getPublicSchema() {
  const flags = Object.entries(FEATURE_FLAGS).map(([key, meta]) => ({
    key,
    label: meta.label,
    description: meta.description || '',
    category: meta.category,
    default: Boolean(meta.default),
    locked: Boolean(meta.locked),
  }));

  const categories = Object.entries(CATEGORIES)
    .map(([key, meta]) => ({ key, label: meta.label, order: meta.order }))
    .sort((a, b) => a.order - b.order);

  return { flags, categories };
}

/**
 * Ordered list of flag keys (registry insertion order), used by tests to
 * guarantee the backend and the frontend TypeScript `FeatureFlags` type agree.
 */
function getFlagKeys() {
  return Object.keys(FEATURE_FLAGS);
}

module.exports = {
  FEATURE_FLAGS,
  CATEGORIES,
  resolveFlags,
  getPublicSchema,
  getFlagKeys,
};
