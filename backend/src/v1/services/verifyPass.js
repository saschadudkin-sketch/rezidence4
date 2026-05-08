'use strict';

// platform-v1 verify-pass service — Spec: qr-verification-spec.md §3.
// Phase: 3 (Access-core).
//
// Один сервис, через который идут все проверки пропуска на посту:
//   - QR-скан          (mode='qr',   token)
//   - Ввод госномера   (mode='plate', plate)
//   - Webhook СКУД     (mode='provider', provider_event_id) — пост-релиз
//
// Вся последовательность (steps 5–8 в spec) — одна БД-транзакция.
// При fail любого шага — ROLLBACK, guard получает 500 retry-friendly.
//
// ВАЖНО об идемпотентности:
//   - provider_event_id уникален per event_source (partial UNIQUE в БД)
//   - guard 30s idempotency применяется ТОЛЬКО к allowed=true
//     (deny guard может повторять — это и есть suspicious_repeat сигнал)

const defaultDb = require('../../db');
const logger = require('../../logger');
const { normalizePlate } = require('../lib/normalizePlate');
const { assertPassAction } = require('./accessStateMachine');
const { evaluateAccessPolicy } = require('./accessPolicyService');

const ONE_SHOT_PASS_TYPES = new Set(['guest', 'courier', 'service']);
const GUARD_IDEMPOTENCY_WINDOW_MS = 30_000;
const SUSPICIOUS_REPEAT_WINDOW_MS = 10 * 60_000;
const SUSPICIOUS_REPEAT_THRESHOLD = 2; // текущий = 3-й

/**
 * Internal: вычисляет verdict-каскад (шаги 3–4 spec'а).
 * Возвращает { allowed, reason, event_type, incident_type, severity }.
 * Не пишет в БД — pure logic.
 */
function eventTypeFor(direction, allowed) {
  return `${direction}_${allowed ? 'allowed' : 'denied'}`;
}

function computeVerdict({ mode, pass, vehicle, now, direction = 'entry' }) {
  // Шаг 3: каскад причин отказа (первое совпадение побеждает).
  if (mode === 'qr' && !pass) {
    return { allowed: false, reason: 'invalid_qr', event_type: eventTypeFor(direction, false),
             incident_type: 'invalid_qr', severity: 'medium' };
  }
  if (vehicle && vehicle.is_blacklisted) {
    return { allowed: false, reason: 'vehicle_blacklisted', event_type: eventTypeFor(direction, false),
             incident_type: 'blacklist_hit', severity: 'high' };
  }
  if (pass && (pass.status === 'revoked' || pass.status === 'blocked')) {
    return { allowed: false, reason: `pass_${pass.status}`, event_type: eventTypeFor(direction, false),
             incident_type: 'blacklist_hit', severity: 'high' };
  }
  if (pass && pass.status === 'used') {
    return { allowed: false, reason: 'pass_used', event_type: eventTypeFor(direction, false),
             incident_type: 'expired_pass_attempt', severity: 'low' };
  }
  if (pass && (pass.status === 'expired' || now > new Date(pass.valid_until))) {
    return { allowed: false, reason: 'expired', event_type: eventTypeFor(direction, false),
             incident_type: 'expired_pass_attempt', severity: 'low' };
  }
  if (pass && now < new Date(pass.valid_from)) {
    return { allowed: false, reason: 'outside_time_window', event_type: eventTypeFor(direction, false),
             incident_type: 'outside_time_window', severity: 'low' };
  }
  if (mode === 'plate' && vehicle && !pass && !vehicle.is_whitelisted) {
    return { allowed: false, reason: 'unauthorized_vehicle', event_type: eventTypeFor(direction, false),
             incident_type: 'unauthorized_vehicle', severity: 'medium' };
  }
  if (mode === 'plate' && !vehicle) {
    // Unknown plate — не в базе vehicles, не в whitelist.  Deny + incident.
    return { allowed: false, reason: 'unauthorized_vehicle', event_type: eventTypeFor(direction, false),
             incident_type: 'unauthorized_vehicle', severity: 'medium' };
  }
  return { allowed: true, reason: null, event_type: eventTypeFor(direction, true),
           incident_type: null, severity: null };
}

/**
 * Собирает person_label на момент scan'а — immutable snapshot в visit_log.
 */
function resolvePersonLabel(pass, vehicle) {
  if (!pass && !vehicle) return null;
  if (pass?.subject_type === 'guest' && pass.visitor_name_snapshot) return pass.visitor_name_snapshot;
  if (vehicle?.plate_number) return `Plate ${vehicle.plate_number}`;
  return null;
}

/**
 * Main entry point.  Возвращает { verdict, visit_log_id, pass_id, incident_id }.
 * Throws только на инфраструктурные ошибки; business deny — не throw.
 *
 * SEC [AUDIT #1]: опциональный `db` в options bag — per-tenant pg.Pool, который
 * propertyDbMiddleware прикрепляет в req.db.  Когда передан — все
 * queries/транзакции идут в per-tenant БД.  Fallback — legacy singleton из
 * '../../db' (DATABASE_URL), чтобы сохранить backward-compat для интеграций
 * / providerов, которые ещё не носят tenant context.
 */
async function verifyPass({
  property_id,
  mode,                   // 'qr' | 'plate' | 'provider'
  token = null,
  plate = null,
  access_point_id = null,
  direction = 'entry',
  performed_by_staff_id = null,
  provider_event_id = null,
  occurred_at = null,
  db: dbArg = null,
}) {
  // SEC [AUDIT #1]: per-tenant dispatch.
  //   dbArg — pg.Pool, приходит из req.db (propertyDbMiddleware).  У Pool есть
  //     .query() и .connect() напрямую.
  //   defaultDb — модуль из '../../db', экспортирует { query, pool }.
  //     .pool.connect() для транзакций.
  const db = dbArg || defaultDb;
  const txPool = typeof dbArg?.connect === 'function' ? dbArg : defaultDb.pool;
  if (!property_id) throw new Error('property_id required');
  if (!['qr', 'plate', 'provider'].includes(mode)) throw new Error(`Invalid mode '${mode}'`);
  if (!['entry', 'exit'].includes(direction)) throw new Error(`Invalid direction '${direction}'`);
  const now = occurred_at ? new Date(occurred_at) : new Date();

  // ─── Step 1: idempotency ────────────────────────────────────────────────
  if (provider_event_id) {
    const { rows } = await db.query(
      `SELECT id, pass_id, event_type FROM visit_logs_v2
         WHERE event_source = 'skud' AND provider_event_id = $1`,
      [provider_event_id],
    );
    if (rows[0]) {
      return {
        verdict: { allowed: rows[0].event_type === eventTypeFor(direction, true), reason: 'idempotent_replay',
                   event_type: rows[0].event_type },
        visit_log_id: rows[0].id,
        pass_id: rows[0].pass_id,
        incident_id: null,
      };
    }
  }

  // ─── Step 2: resolve subject ────────────────────────────────────────────
  let pass = null;
  let vehicle = null;
  let normalizedPlate = null;

  if (mode === 'qr') {
    if (!token) throw new Error('token required for mode=qr');
    const { rows } = await db.query(
      `SELECT p.id, p.property_id, p.pass_type, p.subject_type, p.status,
              p.valid_from, p.valid_until, p.subject_resident_id,
              p.subject_vehicle_id, p.access_request_id,
              p.zone_id, p.point_id, p.policy_id
         FROM qr_passes_v2 q
         JOIN passes p ON p.id = q.pass_id
        WHERE q.token = $1 AND p.property_id = $2`,
      [token, property_id],
    );
    pass = rows[0] || null;
    if (pass?.subject_vehicle_id) {
      const { rows: vRows } = await db.query(
        `SELECT id, plate_number, is_whitelisted, is_blacklisted
           FROM vehicles WHERE id = $1`,
        [pass.subject_vehicle_id],
      );
      vehicle = vRows[0] || null;
    }
  } else if (mode === 'plate') {
    normalizedPlate = normalizePlate(plate);
    if (!normalizedPlate) {
      // invalid input up front
      return {
        verdict: { allowed: false, reason: 'invalid_plate', event_type: 'entry_denied',
                   incident_type: 'invalid_plate', severity: 'low' },
        visit_log_id: null, pass_id: null, incident_id: null,
        _inputInvalid: true,
      };
    }
    const { rows: vRows } = await db.query(
      `SELECT id, plate_number, is_whitelisted, is_blacklisted
         FROM vehicles
        WHERE property_id = $1 AND plate_number = $2`,
      [property_id, normalizedPlate],
    );
    vehicle = vRows[0] || null;
    if (vehicle) {
      const { rows: pRows } = await db.query(
        `SELECT p.id, p.property_id, p.pass_type, p.subject_type, p.status,
                p.valid_from, p.valid_until, p.access_request_id,
                p.zone_id, p.point_id, p.policy_id
           FROM passes p
          WHERE p.subject_vehicle_id = $1
            AND p.property_id = $2
            AND p.status IN ('active','used')
          ORDER BY p.valid_until DESC LIMIT 1`,
        [vehicle.id, property_id],
      );
      pass = pRows[0] || null;
    }
  }

  // ─── Step 1b: guard-console 30s idempotency for allowed scans ─────────────
  if (mode === 'qr' && pass && performed_by_staff_id) {
    const cutoff = new Date(now.getTime() - GUARD_IDEMPOTENCY_WINDOW_MS).toISOString();
    const { rows } = await db.query(
      `SELECT id, event_type
         FROM visit_logs_v2
        WHERE pass_id = $1 AND performed_by_staff_id = $2
          AND event_type = $5
          AND occurred_at > $3
          AND ($4::uuid IS NULL OR access_point_id IS NOT DISTINCT FROM $4)
        ORDER BY occurred_at DESC LIMIT 1`,
      [pass.id, performed_by_staff_id, cutoff, access_point_id || null, eventTypeFor(direction, true)],
    );
    if (rows[0]) {
      return {
        verdict: { allowed: true, reason: 'idempotent_replay', event_type: eventTypeFor(direction, true) },
        visit_log_id: rows[0].id,
        pass_id: pass.id,
        incident_id: null,
      };
    }
  }

  // ─── Step 3: verdict cascade ────────────────────────────────────────────
  const baseVerdict = computeVerdict({ mode, pass, vehicle, now, direction });
  const verdict = { ...baseVerdict };

  // ─── Step 3b: configurable access policy evaluation ─────────────────────
  // Hard denials above keep precedence. Policies add object-specific
  // subject/method/scope/schedule decisions only when base verification allows.
  let policyDecision = null;
  if (verdict.allowed && ['qr', 'plate'].includes(mode)) {
    policyDecision = await evaluateAccessPolicy({
      queryable: db,
      propertyId: property_id,
      subjectType: pass?.subject_type || (vehicle ? 'vehicle' : null),
      passType: pass?.pass_type || (vehicle ? 'vehicle' : null),
      accessMethod: mode,
      pointId: access_point_id || null,
      pass,
      vehicle,
      now,
    });
    verdict.policy_decision = policyDecision;
    if (!policyDecision.allowed) {
      verdict.allowed = false;
      verdict.reason = policyDecision.reason;
      verdict.event_type = eventTypeFor(direction, false);
      verdict.incident_type = policyDecision.incident_type || 'policy_denied';
      verdict.severity = policyDecision.severity || 'medium';
    }
  }

  // ─── Step 4: suspicious-repeat escalation (3rd deny in 10min) ───────────
  if (!verdict.allowed && (pass || normalizedPlate)) {
    const cutoff = new Date(now.getTime() - SUSPICIOUS_REPEAT_WINDOW_MS).toISOString();
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM visit_logs_v2
        WHERE event_type = $4
          AND occurred_at > $1
          AND ((pass_id = $2 AND $2 IS NOT NULL)
             OR (vehicle_plate = $3 AND $3 IS NOT NULL))`,
      [cutoff, pass?.id || null, normalizedPlate || null, eventTypeFor(direction, false)],
    );
    if (rows[0].n >= SUSPICIOUS_REPEAT_THRESHOLD) {
      verdict.incident_type = 'suspicious_repeat_attempt';
      verdict.severity = 'high';
    }
  }

  // ─── Steps 5–8: write, incident, pass.status, audit — все в транзакции ─
  const client = await txPool.connect();
  try {
    await client.query('BEGIN');

    // Step 5: visit_log INSERT
    const personLabel = resolvePersonLabel(pass, vehicle);
    const eventSource = mode === 'provider' ? 'skud' : 'guard_console';
    const { rows: vlRows } = await client.query(
      `INSERT INTO visit_logs_v2
         (property_id, pass_id, access_point_id, event_type, event_source,
          person_label, vehicle_plate, performed_by_staff_id,
          provider_event_id, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [property_id, pass?.id || null, access_point_id || null, verdict.event_type, eventSource,
       personLabel, normalizedPlate, performed_by_staff_id,
       provider_event_id, now.toISOString()],
    );
    const visitLogId = vlRows[0].id;

    // Step 6: auto-create incident if deny + incident_type
    let incidentId = null;
    if (!verdict.allowed && verdict.incident_type) {
      const incidentTitle = `${verdict.incident_type.replace(/_/g, ' ')}` +
        (personLabel ? ` — ${personLabel}` : '');
      try {
        const { rows: incRows } = await client.query(
          `INSERT INTO access_incidents
             (property_id, related_pass_id, related_visit_log_id, related_vehicle_id,
              incident_type, severity, status, title, created_by_staff_id)
           VALUES ($1,$2,$3,$4,$5,$6,'open',$7,NULL)
           RETURNING id`,
          [property_id, pass?.id || null, visitLogId, vehicle?.id || null,
           verdict.incident_type, verdict.severity || 'medium', incidentTitle],
        );
        incidentId = incRows[0].id;
      } catch (err) {
        // partial UNIQUE (related_visit_log_id, incident_type) WHERE system-created
        // — если повторно попали в тот же incident (из-за race), не падаем
        if (err && err.code === '23505') {
          logger.info({ visitLogId, incident_type: verdict.incident_type },
            '[verifyPass] incident already exists for this visit_log');
        } else {
          throw err;
        }
      }
    }

    // Step 7: pass.status='used' для one-shot passes при allowed
    if (verdict.allowed && pass && ONE_SHOT_PASS_TYPES.has(pass.pass_type)) {
      assertPassAction(pass.status, 'use');
      await client.query(
        `UPDATE passes SET status = 'used' WHERE id = $1 AND status = 'active'`,
        [pass.id],
      );
    }

    // Step 8: audit_log fire-and-forget (внутри транзакции, чтобы rollback был единым)
    await client.query(
      `INSERT INTO property_audit_log
         (property_id, actor_uid, actor_role, actor_type, entity_type, entity_id,
          action, resource_type, resource_id, changes, ip_address)
       VALUES ($1, NULL, 'security', 'staff', 'staff', $2, $3, 'visit_log', $4, $5, NULL)`,
      [property_id, performed_by_staff_id || null, `visit.${verdict.event_type}`, visitLogId,
       JSON.stringify({
         verdict: verdict.reason,
         mode,
         plate: normalizedPlate,
         access_point_id: access_point_id || null,
         direction,
         policy_decision: policyDecision,
       })],
    );

    await client.query('COMMIT');

    return {
      verdict,
      visit_log_id: visitLogId,
      pass_id: pass?.id || null,
      incident_id: incidentId,
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  verifyPass,
  // exposed for unit-tests:
  computeVerdict,
  eventTypeFor,
  ONE_SHOT_PASS_TYPES,
};
