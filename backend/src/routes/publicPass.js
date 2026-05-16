'use strict';

/**
 * routes/publicPass.js - public guest pass lookup.
 *
 * GET /:token is unauthenticated and rate-limited by registerApiRoutes.
 * The route now prefers platform-v1 QR/pass entities and keeps a legacy
 * qr_passes fallback for already shared public links.
 */

const express = require('express');

const router = express.Router();

const TOKEN_RE = /^[0-9a-f]{32}(?:[0-9a-f]{32})?$/i;

function notFound(res) {
  return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pass not found' } });
}

function validateToken(req, res, next) {
  if (!TOKEN_RE.test(String(req.params.token || ''))) return notFound(res);
  next();
}

function passStatus(row) {
  const now = Date.now();
  if (row.status === 'revoked') return 'revoked';
  if (row.status === 'blocked') return 'blocked';
  if (row.status === 'used') return 'used';
  if (row.valid_until && new Date(row.valid_until).getTime() < now) return 'expired';
  if (row.status === 'expired') return 'expired';
  if (row.valid_from && new Date(row.valid_from).getTime() > now) return 'pending';
  return 'active';
}

function legacyStatus(row) {
  const now = Date.now();
  if (row.invalidated_at) return 'revoked';
  if (row.used_at) return 'used';
  if (row.expires_at && new Date(row.expires_at).getTime() < now) return 'expired';
  return 'active';
}

function requestTypeLabel(type) {
  switch (type) {
    case 'guest_access': return 'Гостевой';
    case 'vehicle_access': return 'Авто';
    case 'contractor_access': return 'Подрядчик';
    case 'courier_access': return 'Доставка';
    case 'service_access': return 'Сервис';
    case 'temporary_resident_access': return 'Временный';
    default: return null;
  }
}

function destinationLabel(row) {
  if (row.unit_number) {
    return row.unit_type === 'house' || row.unit_type === 'plot'
      ? `Дом/участок ${row.unit_number}`
      : `Квартира ${row.unit_number}`;
  }
  if (row.access_point_name) return row.access_point_name;
  if (row.access_zone_name) return row.access_zone_name;
  return null;
}

function publicV1Pass(row, propertyName) {
  const dest = destinationLabel(row);
  const type = requestTypeLabel(row.request_type) || row.pass_type || 'Пропуск';
  return {
    status: passStatus(row),
    visitorName: row.visitor_name || null,
    propertyName,
    apartment: row.unit_number || null,
    destinationLabel: dest,
    validFrom: row.valid_from || null,
    validUntil: row.valid_until || null,
    type,
    passType: row.pass_type,
    accessPointName: row.access_point_name || null,
    accessZoneName: row.access_zone_name || null,
    guestInstructions: null,
  };
}

function publicLegacyPass(row, propertyName) {
  return {
    status: legacyStatus(row),
    visitorName: row.visitor_name || null,
    propertyName,
    apartment: row.apartment || null,
    destinationLabel: row.apartment ? `Квартира ${row.apartment}` : null,
    validFrom: null,
    validUntil: row.expires_at,
    type: row.request_type,
    passType: row.request_type,
    accessPointName: null,
    accessZoneName: null,
    guestInstructions: null,
  };
}

async function lookupV1Pass(db, token) {
  const { rows } = await db.query(
    `SELECT
       q.id AS qr_id,
       q.token,
       p.id AS pass_id,
       p.pass_type,
       p.subject_type,
       p.valid_from,
       p.valid_until,
       p.status,
       ar.id AS access_request_id,
       ar.request_type,
       ar.visitor_name,
       u.unit_number,
       u.unit_type,
       ap.name AS access_point_name,
       az.name AS access_zone_name
     FROM qr_passes_v2 q
     JOIN passes p ON p.id = q.pass_id
     LEFT JOIN access_requests ar ON ar.id = p.access_request_id
     LEFT JOIN units u ON u.id = ar.target_unit_id
     LEFT JOIN access_points ap
       ON ap.id = COALESCE(p.point_id, ar.target_point_id)
      AND ap.property_id = p.property_id
     LEFT JOIN access_zones az
       ON az.id = COALESCE(p.zone_id, ar.target_zone_id, ap.zone_id)
      AND az.property_id = p.property_id
     WHERE q.token = $1
     LIMIT 1`,
    [token],
  );
  return rows[0] || null;
}

async function lookupLegacyPass(db, token) {
  const { rows } = await db.query(
    `SELECT
       qp.id AS pass_id,
       qp.token,
       qp.expires_at,
       qp.used_at,
       qp.invalidated_at,
       r.id AS request_id,
       r.type AS request_type,
       r.visitor_name,
       r.created_by_apt AS apartment,
       r.valid_until
     FROM qr_passes qp
     JOIN requests r ON r.id = qp.request_id
     WHERE qp.token = $1
     LIMIT 1`,
    [token],
  );
  return rows[0] || null;
}

router.get('/:token', validateToken, async (req, res, next) => {
  try {
    const db = req.db;
    const token = String(req.params.token);
    const propertyName = req.property?.name || null;

    const v1Pass = await lookupV1Pass(db, token);
    if (v1Pass) return res.json(publicV1Pass(v1Pass, propertyName));

    const legacyPass = await lookupLegacyPass(db, token);
    if (legacyPass) return res.json(publicLegacyPass(legacyPass, propertyName));

    return notFound(res);
  } catch (err) {
    return next(err);
  }
});

router.publicV1Pass = publicV1Pass;
router.publicLegacyPass = publicLegacyPass;
router.TOKEN_RE = TOKEN_RE;

module.exports = router;
