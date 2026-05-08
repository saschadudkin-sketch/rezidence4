'use strict';

function entry({ canonicalEventType, category, sensitivity = 'sensitive', reviewReason }) {
  return Object.freeze({
    canonical_event_type: canonicalEventType,
    category,
    sensitivity,
    sensitive: true,
    review_required: true,
    review_reason: reviewReason,
  });
}

const AUDIT_ACTION_CATALOG = Object.freeze({
  'access_request.approved': entry({
    canonicalEventType: 'access.request.approved',
    category: 'access_grant',
    reviewReason: 'access request approval grants a time-bounded pass',
  }),
  'access_request.rejected': entry({
    canonicalEventType: 'access.request.rejected',
    category: 'access_decision',
    reviewReason: 'access denial can become a resident/security dispute',
  }),
  'access_request.escalated': entry({
    canonicalEventType: 'access.request.escalated',
    category: 'access_decision',
    reviewReason: 'escalated access requests require admin visibility',
  }),
  'pass.created': entry({
    canonicalEventType: 'access.pass.created',
    category: 'access_grant',
    reviewReason: 'direct pass creation bypasses a resident approval request',
  }),
  'pass.revoked': entry({
    canonicalEventType: 'access.pass.revoked',
    category: 'access_restriction',
    reviewReason: 'pass revocation removes an existing access grant',
  }),
  'pass.blocked': entry({
    canonicalEventType: 'access.pass.blocked',
    category: 'access_restriction',
    reviewReason: 'temporary blocking can deny valid access',
  }),
  'pass.unblocked': entry({
    canonicalEventType: 'access.pass.unblocked',
    category: 'access_grant',
    reviewReason: 'unblocking restores a restricted pass',
  }),
  'override.created': entry({
    canonicalEventType: 'access.manual_override.created',
    category: 'manual_override',
    reviewReason: 'manual guard override bypasses automatic policy',
  }),
  'access.manual_override.created': entry({
    canonicalEventType: 'access.manual_override.created',
    category: 'manual_override',
    reviewReason: 'manual guard override bypasses automatic policy',
  }),
  'incident.resolved': entry({
    canonicalEventType: 'access.incident.resolved',
    category: 'incident_review',
    reviewReason: 'incident resolution closes an access/security case',
  }),
  'incident.dismissed': entry({
    canonicalEventType: 'access.incident.dismissed',
    category: 'incident_review',
    reviewReason: 'incident dismissal marks a security event as false or closed',
  }),
  'incident.patched': entry({
    canonicalEventType: 'access.incident.updated',
    category: 'incident_review',
    reviewReason: 'incident edits can change severity or dispute context',
  }),
  'vehicle.whitelisted': entry({
    canonicalEventType: 'access.vehicle.whitelisted',
    category: 'vehicle_decision',
    reviewReason: 'vehicle whitelist changes affect barrier access',
  }),
  'vehicle.blacklisted': entry({
    canonicalEventType: 'access.vehicle.blacklisted',
    category: 'vehicle_decision',
    reviewReason: 'vehicle blacklist changes affect barrier access',
  }),
  'vehicle.flags_cleared': entry({
    canonicalEventType: 'access.vehicle.flags_cleared',
    category: 'vehicle_decision',
    reviewReason: 'clearing vehicle flags can restore restricted access',
  }),
  'staff.created': entry({
    canonicalEventType: 'identity.staff.created',
    category: 'permission_change',
    reviewReason: 'staff provisioning creates an operational account',
  }),
  'staff.updated': entry({
    canonicalEventType: 'identity.staff.updated',
    category: 'permission_change',
    reviewReason: 'staff role or capability changes can expand permissions',
  }),
  'staff.deactivated': entry({
    canonicalEventType: 'identity.staff.deactivated',
    category: 'permission_change',
    reviewReason: 'staff deactivation changes operational access',
  }),
  'contractor_user.created': entry({
    canonicalEventType: 'identity.contractor_user.created',
    category: 'contractor_access',
    reviewReason: 'contractor account creation grants scoped property access',
  }),
  'contractor_user.updated': entry({
    canonicalEventType: 'identity.contractor_user.updated',
    category: 'contractor_access',
    reviewReason: 'contractor updates can change time-bound access',
  }),
  'contractor_user.deactivated': entry({
    canonicalEventType: 'identity.contractor_user.deactivated',
    category: 'contractor_access',
    reviewReason: 'contractor deactivation changes service access',
  }),
  'contractor_company.updated': entry({
    canonicalEventType: 'identity.contractor_company.updated',
    category: 'contractor_access',
    reviewReason: 'contractor company status affects worker access',
  }),
  'access_zone.created': entry({
    canonicalEventType: 'access.policy_boundary.created',
    category: 'access_boundary',
    reviewReason: 'access zones define where passes and policies apply',
  }),
  'access_zone.updated': entry({
    canonicalEventType: 'access.policy_boundary.updated',
    category: 'access_boundary',
    reviewReason: 'access zone edits can change pass applicability',
  }),
  'access_zone.deactivated': entry({
    canonicalEventType: 'access.policy_boundary.disabled',
    category: 'access_boundary',
    reviewReason: 'deactivating a zone changes access routing',
  }),
  'access_point.created': entry({
    canonicalEventType: 'hardware.device.created',
    category: 'hardware_boundary',
    reviewReason: 'access points bind policy to physical checkpoints',
  }),
  'access_point.updated': entry({
    canonicalEventType: 'hardware.device.updated',
    category: 'hardware_boundary',
    reviewReason: 'access point edits can change physical checkpoint behavior',
  }),
  'access_point.deactivated': entry({
    canonicalEventType: 'hardware.device.disabled',
    category: 'hardware_boundary',
    reviewReason: 'deactivating an access point changes guard/barrier routing',
  }),
  'resident.updated': entry({
    canonicalEventType: 'resident.membership.updated',
    category: 'personal_data',
    sensitivity: 'restricted',
    reviewReason: 'resident profile edits can touch personal data',
  }),
  'resident.deactivated': entry({
    canonicalEventType: 'resident.membership.suspended',
    category: 'personal_data',
    sensitivity: 'restricted',
    reviewReason: 'resident deactivation affects household access and PII lifecycle',
  }),
  'resident.consent_given': entry({
    canonicalEventType: 'identity.consent.accepted',
    category: 'personal_data',
    sensitivity: 'restricted',
    reviewReason: 'consent changes are part of Russia-readiness controls',
  }),
  'integration.provider.configured': entry({
    canonicalEventType: 'integration.provider.configured',
    category: 'provider_settings',
    reviewReason: 'provider settings can affect external access decisions',
  }),
  'integration.provider.disabled': entry({
    canonicalEventType: 'integration.provider.disabled',
    category: 'provider_settings',
    reviewReason: 'provider disablement changes access/integration behavior',
  }),
  'video.evidence.viewed': entry({
    canonicalEventType: 'video.evidence.viewed',
    category: 'video_evidence',
    sensitivity: 'restricted',
    reviewReason: 'video evidence access is privacy-sensitive',
  }),
  'video.evidence.linked': entry({
    canonicalEventType: 'video.evidence.linked',
    category: 'video_evidence',
    sensitivity: 'restricted',
    reviewReason: 'video evidence links affect incident investigation context',
  }),
  'audit.export.created': entry({
    canonicalEventType: 'audit.export.created',
    category: 'export',
    sensitivity: 'restricted',
    reviewReason: 'audit/data exports can expose sensitive operational data',
  }),
});

const SENSITIVE_ACTIONS = Object.freeze(
  Object.keys(AUDIT_ACTION_CATALOG)
    .filter((action) => AUDIT_ACTION_CATALOG[action].sensitive)
    .sort(),
);

const SENSITIVE_CATEGORIES = Object.freeze(
  Array.from(new Set(SENSITIVE_ACTIONS.map((action) => AUDIT_ACTION_CATALOG[action].category))).sort(),
);

function normalizeAuditAction(action) {
  const rawAction = typeof action === 'string' ? action.trim() : '';
  if (rawAction && AUDIT_ACTION_CATALOG[rawAction]) {
    return {
      action: rawAction,
      ...AUDIT_ACTION_CATALOG[rawAction],
    };
  }

  return {
    action: rawAction,
    canonical_event_type: rawAction || 'audit.unknown',
    category: 'general',
    sensitivity: 'internal',
    sensitive: false,
    review_required: false,
    review_reason: null,
  };
}

function classifyAuditRow(row) {
  const normalized = normalizeAuditAction(row?.action);
  return {
    ...row,
    canonical_event_type: normalized.canonical_event_type,
    category: normalized.category,
    sensitivity: normalized.sensitivity,
    sensitive: normalized.sensitive,
    review_required: normalized.review_required,
    review_reason: normalized.review_reason,
  };
}

function listSensitiveCategories() {
  return [...SENSITIVE_CATEGORIES];
}

function listSensitiveAuditActions(options = {}) {
  const { category } = options;
  if (!category) return [...SENSITIVE_ACTIONS];
  return SENSITIVE_ACTIONS.filter((action) => AUDIT_ACTION_CATALOG[action].category === category);
}

function isSensitiveAuditAction(action) {
  return normalizeAuditAction(action).sensitive;
}

function isKnownSensitiveCategory(category) {
  return SENSITIVE_CATEGORIES.includes(category);
}

module.exports = {
  AUDIT_ACTION_CATALOG,
  classifyAuditRow,
  isKnownSensitiveCategory,
  isSensitiveAuditAction,
  listSensitiveAuditActions,
  listSensitiveCategories,
  normalizeAuditAction,
};
