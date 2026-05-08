'use strict';

const { ServiceError } = require('./RequestErrors');

const CATEGORY_CODE_RE = /^[a-z0-9_:-]{2,80}$/;
const CATEGORY_DOMAIN_VALUES = ['access', 'service', 'territory', 'emergency', 'security', 'contractor'];
const TARGET_TYPE_VALUES = ['unit', 'home', 'access_zone', 'access_point', 'common_territory', 'road', 'service_area'];
const PRIORITY_VALUES = ['low', 'normal', 'high', 'emergency'];
const SLA_PROFILE_VALUES = ['standard', 'urgent', 'emergency'];

const DEFAULT_CATEGORIES = [
  // Legacy/access categories kept for backward compatibility with existing resident flows.
  { code: 'guest', name: 'Guest access', domain: 'access', targetScope: 'unit', priority: 'normal', slaProfile: 'standard' },
  { code: 'courier', name: 'Courier access', domain: 'access', targetScope: 'unit', priority: 'normal', slaProfile: 'standard' },
  { code: 'taxi', name: 'Taxi access', domain: 'access', targetScope: 'unit', priority: 'normal', slaProfile: 'standard' },
  { code: 'car', name: 'Vehicle access', domain: 'access', targetScope: 'unit', priority: 'normal', slaProfile: 'standard' },
  { code: 'master', name: 'Master access', domain: 'access', targetScope: 'unit', priority: 'normal', slaProfile: 'standard' },
  { code: 'cleaner', name: 'Cleaner access', domain: 'access', targetScope: 'unit', priority: 'normal', slaProfile: 'standard' },
  { code: 'other', name: 'Other access', domain: 'access', targetScope: 'unit', priority: 'normal', slaProfile: 'standard' },
  { code: 'worker', name: 'Worker access', domain: 'access', targetScope: 'unit', priority: 'normal', slaProfile: 'standard' },
  { code: 'team', name: 'Team access', domain: 'access', targetScope: 'unit', priority: 'normal', slaProfile: 'standard' },
  { code: 'delivery', name: 'Delivery access', domain: 'access', targetScope: 'unit', priority: 'normal', slaProfile: 'standard' },
  { code: 'electrician', name: 'Electrician', domain: 'service', targetScope: 'unit', priority: 'normal', slaProfile: 'standard' },
  { code: 'plumber', name: 'Plumber', domain: 'service', targetScope: 'unit', priority: 'normal', slaProfile: 'standard' },

  // Cottage community / territory operations.
  { code: 'checkpoint_access', name: 'КПП / въезд', domain: 'territory', targetScope: 'access_point', priority: 'high', slaProfile: 'urgent', firstResponseMinutes: 60, resolutionMinutes: 480 },
  { code: 'barrier_gate', name: 'Шлагбаум / ворота', domain: 'territory', targetScope: 'access_point', priority: 'high', slaProfile: 'urgent', firstResponseMinutes: 60, resolutionMinutes: 480 },
  { code: 'roads', name: 'Дороги', domain: 'territory', targetScope: 'road', priority: 'normal', slaProfile: 'standard', firstResponseMinutes: 240, resolutionMinutes: 4320 },
  { code: 'lighting', name: 'Освещение', domain: 'territory', targetScope: 'common_territory', priority: 'normal', slaProfile: 'standard', firstResponseMinutes: 240, resolutionMinutes: 1440 },
  { code: 'waste', name: 'Мусор', domain: 'territory', targetScope: 'common_territory', priority: 'normal', slaProfile: 'standard', firstResponseMinutes: 240, resolutionMinutes: 1440 },
  { code: 'water_supply', name: 'Вода', domain: 'territory', targetScope: 'service_area', priority: 'high', slaProfile: 'urgent', firstResponseMinutes: 120, resolutionMinutes: 720 },
  { code: 'landscaping', name: 'Благоустройство', domain: 'territory', targetScope: 'common_territory', priority: 'normal', slaProfile: 'standard', firstResponseMinutes: 480, resolutionMinutes: 10080 },
  { code: 'security', name: 'Охрана', domain: 'security', targetScope: 'common_territory', priority: 'high', slaProfile: 'urgent', firstResponseMinutes: 60, resolutionMinutes: 720 },
  { code: 'contractors', name: 'Подрядчики', domain: 'contractor', targetScope: 'common_territory', priority: 'normal', slaProfile: 'standard', firstResponseMinutes: 240, resolutionMinutes: 4320 },
  { code: 'common_area', name: 'Общая территория', domain: 'territory', targetScope: 'common_territory', priority: 'normal', slaProfile: 'standard', firstResponseMinutes: 240, resolutionMinutes: 4320 },

  // Emergency categories required by Russia readiness.
  { code: 'emergency_water_leak', name: 'Протечка / вода', domain: 'emergency', targetScope: 'unit', priority: 'emergency', slaProfile: 'emergency', firstResponseMinutes: 15, resolutionMinutes: 120, isEmergency: true },
  { code: 'emergency_heating', name: 'Отопление', domain: 'emergency', targetScope: 'unit', priority: 'emergency', slaProfile: 'emergency', firstResponseMinutes: 15, resolutionMinutes: 180, isEmergency: true },
  { code: 'emergency_electricity', name: 'Электричество', domain: 'emergency', targetScope: 'unit', priority: 'emergency', slaProfile: 'emergency', firstResponseMinutes: 15, resolutionMinutes: 180, isEmergency: true },
  { code: 'emergency_fire_smoke', name: 'Пожар / дым', domain: 'emergency', targetScope: 'unit', priority: 'emergency', slaProfile: 'emergency', firstResponseMinutes: 5, resolutionMinutes: 60, isEmergency: true },
  { code: 'emergency_access_barrier', name: 'Доступ / шлагбаум', domain: 'emergency', targetScope: 'access_point', priority: 'emergency', slaProfile: 'emergency', firstResponseMinutes: 10, resolutionMinutes: 120, isEmergency: true },
  { code: 'emergency_security', name: 'Безопасность', domain: 'emergency', targetScope: 'common_territory', priority: 'emergency', slaProfile: 'emergency', firstResponseMinutes: 5, resolutionMinutes: 120, isEmergency: true },
  { code: 'emergency_contractor', name: 'Аварийный подрядчик', domain: 'emergency', targetScope: 'service_area', priority: 'emergency', slaProfile: 'emergency', firstResponseMinutes: 15, resolutionMinutes: 240, isEmergency: true },
];

const DEFAULT_CATEGORY_BY_CODE = new Map(
  DEFAULT_CATEGORIES.map((category) => [category.code, normalizeCategory(category)]),
);

function normalizeCategory(row) {
  return {
    id: row.id || null,
    code: row.code,
    name: row.name,
    domain: row.domain,
    targetScope: row.target_scope || row.targetScope || 'unit',
    priority: row.priority || 'normal',
    slaProfile: row.sla_profile || row.slaProfile || 'standard',
    firstResponseMinutes: row.first_response_minutes ?? row.firstResponseMinutes ?? null,
    resolutionMinutes: row.resolution_minutes ?? row.resolutionMinutes ?? null,
    isEmergency: Boolean(row.is_emergency ?? row.isEmergency ?? row.domain === 'emergency'),
    metadata: row.metadata || {},
  };
}

function assertCategoryCode(code) {
  if (typeof code !== 'string' || !CATEGORY_CODE_RE.test(code)) {
    throw new ServiceError('Invalid category code');
  }
}

function assertEnum(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new ServiceError(`${field} must be one of: ${allowed.join(', ')}`);
  }
}

function getDefaultCategories() {
  return DEFAULT_CATEGORIES.map((category) => normalizeCategory(category));
}

function getDefaultCategory(code) {
  return DEFAULT_CATEGORY_BY_CODE.get(code) || null;
}

async function listRequestCategories(queryDb, { propertyId } = {}) {
  if (!propertyId) return getDefaultCategories();

  try {
    const { rows } = await queryDb.query(
      `SELECT id, code, name, domain, target_scope, priority, sla_profile,
              first_response_minutes, resolution_minutes, is_emergency, metadata
         FROM service_request_categories
        WHERE property_id=$1 AND is_active=true
        ORDER BY is_emergency DESC, domain, name`,
      [propertyId],
    );
    if (rows.length) return rows.map(normalizeCategory);
  } catch (err) {
    if (err?.code !== '42P01' && err?.code !== '42703') throw err;
  }

  return getDefaultCategories();
}

async function resolveRequestCategory(queryDb, code, { propertyId } = {}) {
  assertCategoryCode(code);

  if (propertyId) {
    try {
      const { rows } = await queryDb.query(
        `SELECT id, code, name, domain, target_scope, priority, sla_profile,
                first_response_minutes, resolution_minutes, is_emergency, metadata
           FROM service_request_categories
          WHERE property_id=$1 AND code=$2 AND is_active=true
          LIMIT 1`,
        [propertyId, code],
      );
      if (rows.length) return normalizeCategory(rows[0]);
    } catch (err) {
      if (err?.code !== '42P01' && err?.code !== '42703') throw err;
    }
  }

  const fallback = getDefaultCategory(code);
  if (fallback) return fallback;

  throw new ServiceError(`Invalid category. Allowed: ${[...DEFAULT_CATEGORY_BY_CODE.keys()].join(', ')}`);
}

async function upsertRequestCategory(queryDb, propertyId, code, body) {
  if (!propertyId) throw new ServiceError('property context required', 400);
  assertCategoryCode(code);

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) throw new ServiceError('name required');

  const domain = body.domain || 'service';
  const targetScope = body.targetScope || body.target_scope || 'unit';
  const priority = body.priority || 'normal';
  const slaProfile = body.slaProfile || body.sla_profile || 'standard';
  const firstResponseMinutes = body.firstResponseMinutes ?? body.first_response_minutes ?? null;
  const resolutionMinutes = body.resolutionMinutes ?? body.resolution_minutes ?? null;
  const isEmergency = Boolean(body.isEmergency ?? body.is_emergency ?? domain === 'emergency');
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};

  assertEnum(domain, CATEGORY_DOMAIN_VALUES, 'domain');
  assertEnum(targetScope, TARGET_TYPE_VALUES, 'targetScope');
  assertEnum(priority, PRIORITY_VALUES, 'priority');
  assertEnum(slaProfile, SLA_PROFILE_VALUES, 'slaProfile');

  const { rows } = await queryDb.query(
    `INSERT INTO service_request_categories
       (property_id, code, name, domain, target_scope, priority, sla_profile,
        first_response_minutes, resolution_minutes, is_emergency, metadata, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
     ON CONFLICT (property_id, code)
     DO UPDATE SET
       name=EXCLUDED.name,
       domain=EXCLUDED.domain,
       target_scope=EXCLUDED.target_scope,
       priority=EXCLUDED.priority,
       sla_profile=EXCLUDED.sla_profile,
       first_response_minutes=EXCLUDED.first_response_minutes,
       resolution_minutes=EXCLUDED.resolution_minutes,
       is_emergency=EXCLUDED.is_emergency,
       metadata=EXCLUDED.metadata,
       is_active=true,
       updated_at=NOW()
     RETURNING id, code, name, domain, target_scope, priority, sla_profile,
               first_response_minutes, resolution_minutes, is_emergency, metadata`,
    [
      propertyId, code, name, domain, targetScope, priority, slaProfile,
      firstResponseMinutes, resolutionMinutes, isEmergency, metadata,
    ],
  );

  return normalizeCategory(rows[0]);
}

function computeDueDate(minutes) {
  if (!Number.isFinite(Number(minutes)) || Number(minutes) <= 0) return null;
  return new Date(Date.now() + Number(minutes) * 60_000);
}

function normalizeRequestTarget(body, category) {
  const targetType = body.targetType || body.target_type || category.targetScope || null;
  const targetId = body.targetId || body.target_id || body.unitId || body.homeId
    || body.accessZoneId || body.accessPointId || null;

  if (targetType && !TARGET_TYPE_VALUES.includes(targetType)) {
    throw new ServiceError(`targetType must be one of: ${TARGET_TYPE_VALUES.join(', ')}`);
  }

  return { targetType, targetId };
}

module.exports = {
  CATEGORY_CODE_RE,
  CATEGORY_DOMAIN_VALUES,
  TARGET_TYPE_VALUES,
  PRIORITY_VALUES,
  SLA_PROFILE_VALUES,
  getDefaultCategories,
  getDefaultCategory,
  listRequestCategories,
  resolveRequestCategory,
  upsertRequestCategory,
  computeDueDate,
  normalizeRequestTarget,
};
