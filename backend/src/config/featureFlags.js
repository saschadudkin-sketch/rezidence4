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
  manual_access_approval: {
    default: false,
    label: 'Ручное согласование пропусков',
    description: 'Если включено, пропуска требуют решения консьержа перед выпуском QR',
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
  video_evidence: {
    default: false,
    label: 'Видео-доказательства',
    description: 'Привязка камер, клипов и снимков к событиям доступа и инцидентам',
    category: 'integrations',
  },
  erp_exchange: {
    default: false,
    label: 'ERP / 1C обмен',
    description: 'Операционный импорт справочников и экспорт сводок для ERP/1C/ЖКХ-систем',
    category: 'integrations',
  },
  gis_oss_readiness: {
    default: false,
    label: 'GIS ЖКХ / ОСС readiness',
    description: 'Подготовка экспортных пакетов для внешней работы с GIS ЖКХ и ОСС без юридически значимого голосования',
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

const PLAN_ALIASES = {
  standard: 'core_access',
  core: 'core_access',
  premium: 'operations',
  pro: 'operations',
};

const PLAN_FEATURES = {
  core_access: new Set([
    'chat',
    'announcements',
    'documents',
    'kiosk_mode',
    'qr_pass',
    'manual_access_approval',
  ]),
  operations: new Set([
    'chat',
    'announcements',
    'documents',
    'kiosk_mode',
    'qr_pass',
    'manual_access_approval',
    'packages',
    'analytics',
  ]),
  portfolio: new Set([
    'chat',
    'announcements',
    'documents',
    'kiosk_mode',
    'qr_pass',
    'manual_access_approval',
    'packages',
    'analytics',
  ]),
  enterprise: new Set(Object.keys(FEATURE_FLAGS)),
};

const PACKAGE_PLANS = {
  core_access: {
    label: 'Core Access',
    description: 'Access-first пилот: жильцы, пропуска, КПП, объявления и документы.',
  },
  operations: {
    label: 'Operations',
    description: 'Daily operations: заявки, SLA, посылки, исполнители и аналитика объекта.',
  },
  portfolio: {
    label: 'Portfolio',
    description: 'УК и multi-property operations поверх Operations.',
  },
  enterprise: {
    label: 'Enterprise / Integrations',
    description: 'Интеграции, webhooks, СКУД и growth-модули для сложных rollout.',
  },
};

function normalizePlan(plan) {
  if (typeof plan !== 'string' || !plan.trim()) return 'core_access';
  const raw = plan.trim();
  return PLAN_ALIASES[raw] || raw;
}

function getPlanKeys() {
  return Object.keys(PACKAGE_PLANS);
}

function isFlagAllowedForPlan(flagName, plan) {
  if (!(flagName in FEATURE_FLAGS)) return false;
  const normalizedPlan = normalizePlan(plan);
  const allowed = PLAN_FEATURES[normalizedPlan];
  if (!allowed) return false;
  return allowed.has(flagName);
}

/**
 * Merge stored JSONB flags (may be null/undefined/{}) with registry defaults.
 * Always returns a complete map of all known flags as booleans.  Locked flags
 * always resolve to their registry default regardless of stored value, so a
 * stale DB override cannot silently disable a core feature.
 *
 * When `plan` is supplied, package constraints are applied as a second layer:
 * a true JSON override cannot unlock a module that the property's commercial
 * package does not include.  Omitting `plan` preserves the registry-only
 * behaviour for tests and non-property callers.
 *
 * @param {Object} stored - Raw feature_flags JSONB from platform DB row
 * @param {string|null} plan - Optional property package id
 * @returns {Object} - { [flagName]: boolean }
 */
function resolveFlags(stored = {}, plan = null) {
  const safe = stored && typeof stored === 'object' ? stored : {};
  const resolved = {};
  for (const [key, meta] of Object.entries(FEATURE_FLAGS)) {
    if (meta.locked) {
      resolved[key] = meta.default;
      continue;
    }
    resolved[key] = key in safe ? Boolean(safe[key]) : meta.default;
  }
  if (plan) {
    for (const key of Object.keys(resolved)) {
      if (!isFlagAllowedForPlan(key, plan)) {
        resolved[key] = false;
      }
    }
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
 *   plans: Array<{key, label, description, flags}>,
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

  const plans = Object.entries(PACKAGE_PLANS).map(([key, meta]) => ({
    key,
    label: meta.label,
    description: meta.description,
    flags: getFlagKeys().filter((flagName) => isFlagAllowedForPlan(flagName, key)),
  }));

  return { flags, categories, plans };
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
  PACKAGE_PLANS,
  resolveFlags,
  getPublicSchema,
  getFlagKeys,
  getPlanKeys,
  normalizePlan,
  isFlagAllowedForPlan,
};
