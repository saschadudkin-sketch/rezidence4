'use strict';

/**
 * config/featureFlags.js — Platform feature flag registry for DomHub v2.
 *
 * Each flag entry has:
 *   default  — resolved value when not explicitly set on a property
 *   label    — human-readable name (Russian) for admin UI
 *   category — grouping key for display
 *
 * resolveFlags() merges stored JSONB values over these defaults so new flags
 * added here are automatically "off" (or on, if default: true) for existing
 * properties without any DB update.
 */

const FEATURE_FLAGS = {
  chat:             { default: true,  label: 'Чат',                  category: 'core' },
  announcements:    { default: false, label: 'Объявления',            category: 'communication' },
  documents:        { default: false, label: 'Документы и правила',   category: 'communication' },
  kiosk_mode:       { default: false, label: 'Киоск-режим (холл)',     category: 'communication' },
  qr_pass:          { default: false, label: 'QR-пропуска',           category: 'access' },
  meter_readings:   { default: false, label: 'Показания счётчиков',   category: 'resident' },
  billing:          { default: false, label: 'Финансы и начисления',  category: 'resident' },
  space_booking:    { default: false, label: 'Бронирование зон',      category: 'resident' },
  packages:         { default: false, label: 'Посылки и доставки',    category: 'concierge' },
  telegram_bot:     { default: false, label: 'Telegram-уведомления',  category: 'notifications' },
  webhooks:         { default: false, label: 'Webhook-интеграции',    category: 'integrations' },
  skud_integration: { default: false, label: 'СКУД-интеграция',       category: 'integrations' },
  analytics:        { default: false, label: 'Аналитика',             category: 'admin' },
};

/**
 * Merge stored JSONB flags (may be null/undefined/{}) with registry defaults.
 * Always returns a complete map of all known flags as booleans.
 *
 * @param {Object} stored - Raw feature_flags JSONB from platform DB row
 * @returns {Object} - { [flagName]: boolean }
 */
function resolveFlags(stored = {}) {
  const safe = stored && typeof stored === 'object' ? stored : {};
  const resolved = {};
  for (const [key, meta] of Object.entries(FEATURE_FLAGS)) {
    resolved[key] = key in safe ? Boolean(safe[key]) : meta.default;
  }
  return resolved;
}

module.exports = {
  FEATURE_FLAGS,
  resolveFlags,
};
