'use strict';

async function recordResidentLifecycleEvent({
  queryable,
  propertyId,
  residentId,
  eventType,
  actorUid = null,
  actorRole = null,
  metadata = {},
}) {
  await queryable.query(
    `INSERT INTO resident_lifecycle_events
       (property_id, resident_id, event_type, actor_uid, actor_role, metadata)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [
      propertyId,
      residentId,
      eventType,
      actorUid,
      actorRole,
      JSON.stringify(metadata || {}),
    ],
  );
}

async function recordResidentConsentHistory({
  queryable,
  propertyId,
  residentId,
  consentVersion,
  decision,
  source = 'resident_ui',
  actorUid = null,
  ipAddress = null,
  userAgent = null,
  evidence = {},
}) {
  await queryable.query(
    `INSERT INTO resident_consent_history
       (property_id, resident_id, consent_version, decision, source,
        actor_uid, ip_address, user_agent, evidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [
      propertyId,
      residentId,
      consentVersion,
      decision,
      source,
      actorUid,
      ipAddress,
      userAgent,
      JSON.stringify(evidence || {}),
    ],
  );
}

module.exports = {
  recordResidentConsentHistory,
  recordResidentLifecycleEvent,
};
