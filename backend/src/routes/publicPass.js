'use strict';

/**
 * routes/publicPass.js - public guest pass lookup.
 *
 * GET /:token is unauthenticated and rate-limited by registerApiRoutes.
 * The route now prefers platform-v1 QR/pass entities and keeps a legacy
 * qr_passes fallback for already shared public links.
 */

const express = require('express');
const { decryptCredentialSecret } = require('../v1/services/passCredentialService');

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
  let pin = null;
  if (row.pin_public_display_allowed && row.pin_credential_ciphertext) {
    try {
      pin = decryptCredentialSecret({
        credential_ciphertext: row.pin_credential_ciphertext,
        credential_iv: row.pin_credential_iv,
        credential_tag: row.pin_credential_tag,
      });
    } catch {
      pin = null;
    }
  }
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
    guestInstructions: row.guest_instructions || null,
    pinCredential: pin ? {
      value: pin,
      publicDisplayAllowed: true,
      renderVersion: row.pin_render_version || null,
      expiresAt: row.pin_expires_at || null,
    } : null,
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
       cred.id AS qr_id,
       cred.token,
       p.id AS pass_id,
       p.pass_type,
       p.subject_type,
       p.valid_from,
       p.valid_until,
       p.status,
       ar.id AS access_request_id,
       ar.request_type,
       ar.visitor_name,
       ar.guest_instructions,
       u.unit_number,
       u.unit_type,
       ap.name AS access_point_name,
       az.name AS access_zone_name,
       pin_cred.credential_ciphertext AS pin_credential_ciphertext,
       pin_cred.credential_iv AS pin_credential_iv,
       pin_cred.credential_tag AS pin_credential_tag,
       pin_cred.render_version AS pin_render_version,
       pin_cred.expires_at AS pin_expires_at,
       pin_cred.public_display_allowed AS pin_public_display_allowed
     FROM (
       SELECT c.id, c.pass_id, c.token, c.revoked_at, c.used_at, c.expires_at
         FROM pass_credentials c
        WHERE c.credential_type = 'qr'
          AND c.token = $1
       UNION ALL
       SELECT q.id, q.pass_id, q.token,
              NULL::timestamptz AS revoked_at,
              NULL::timestamptz AS used_at,
              NULL::timestamptz AS expires_at
         FROM qr_passes_v2 q
        WHERE q.token = $1
          AND NOT EXISTS (
            SELECT 1
              FROM pass_credentials c
             WHERE c.pass_id = q.pass_id
               AND c.credential_type = 'qr'
          )
       LIMIT 1
     ) cred
     JOIN passes p ON p.id = cred.pass_id
     LEFT JOIN access_requests ar ON ar.id = p.access_request_id
     LEFT JOIN units u ON u.id = ar.target_unit_id
     LEFT JOIN access_points ap
       ON ap.id = COALESCE(p.point_id, ar.target_point_id)
      AND ap.property_id = p.property_id
     LEFT JOIN access_zones az
       ON az.id = COALESCE(p.zone_id, ar.target_zone_id, ap.zone_id)
      AND az.property_id = p.property_id
     LEFT JOIN LATERAL (
       SELECT pc.credential_ciphertext,
              pc.credential_iv,
              pc.credential_tag,
              pc.render_version,
              pc.expires_at,
              true AS public_display_allowed
         FROM pass_credentials pc
         JOIN access_policies pol
           ON pol.property_id = p.property_id
          AND pol.is_active = true
          AND pol.access_method = 'pin'
          AND pol.effect = 'allow'
          AND (
            pol.metadata->>'public_pin_display' = 'true'
            OR pol.metadata->>'show_pin_on_public_pass' = 'true'
          )
          AND pol.subject_type = CASE
            WHEN p.pass_type = 'vehicle' OR p.subject_type = 'vehicle' THEN 'vehicle'
            WHEN p.pass_type IN ('contractor','service') THEN 'contractor'
            WHEN p.pass_type = 'courier' THEN 'courier'
            WHEN p.pass_type = 'resident' OR p.subject_type = 'resident' THEN 'resident'
            WHEN p.pass_type IN ('staff','emergency') THEN 'staff'
            ELSE 'guest'
          END
        WHERE pc.pass_id = p.id
          AND pc.credential_type = 'pin'
          AND pc.revoked_at IS NULL
          AND pc.used_at IS NULL
          AND (pc.expires_at IS NULL OR pc.expires_at >= NOW())
        ORDER BY
          CASE WHEN pol.id = p.policy_id THEN 0 ELSE 1 END,
          pol.priority ASC,
          pol.created_at ASC
        LIMIT 1
     ) pin_cred ON true
     WHERE (cred.revoked_at IS NULL OR p.status IN ('revoked','blocked'))
       AND (cred.used_at IS NULL OR p.status = 'used')
       AND (
         cred.expires_at IS NULL
         OR cred.expires_at >= NOW()
         OR p.status = 'expired'
         OR p.valid_until < NOW()
       )
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
