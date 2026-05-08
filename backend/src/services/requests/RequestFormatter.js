'use strict';

const REQUEST_COLUMNS = `id, type, category, status,
  created_by_uid, created_by_name, created_by_role, created_by_apt,
  visitor_name, visitor_phone, car_plate, comment, pass_duration,
  valid_until, scheduled_for, arrived_at, photos,
  request_category_id, target_type, target_id, priority, sla_profile,
  first_response_due_at, resolution_due_at, emergency_metadata,
  assigned_to_uid, assigned_to_name, assigned_to_role, assigned_at,
  assigned_contractor_user_id, assigned_contractor_company_id,
  started_at, first_response_at, resolved_at, completed_at, sla_state,
  resolution_note, requires_follow_up,
  escalation_level, escalated_at, escalation_reason, last_sla_check_at,
  created_at, updated_at`;

function formatRequestRow(row) {
  return {
    id:             row.id,
    type:           row.type,
    category:       row.category,
    status:         row.status,
    priority:       row.priority || 'normal',
    slaProfile:     row.sla_profile || 'standard',
    requestCategoryId: row.request_category_id || null,
    targetType:     row.target_type || null,
    targetId:       row.target_id || null,
    firstResponseDueAt: row.first_response_due_at || null,
    resolutionDueAt: row.resolution_due_at || null,
    emergencyMetadata: row.emergency_metadata || {},
    assignedToUid:  row.assigned_to_uid || null,
    assignedToName: row.assigned_to_name || null,
    assignedToRole: row.assigned_to_role || null,
    assignedAt:     row.assigned_at || null,
    assignedContractorUserId: row.assigned_contractor_user_id || null,
    assignedContractorCompanyId: row.assigned_contractor_company_id || null,
    startedAt:      row.started_at || null,
    firstResponseAt: row.first_response_at || null,
    resolvedAt:     row.resolved_at || null,
    completedAt:    row.completed_at || null,
    resolutionNote: row.resolution_note || null,
    requiresFollowUp: Boolean(row.requires_follow_up),
    slaState:       row.sla_state || 'on_track',
    escalationLevel: row.escalation_level || 0,
    escalatedAt:    row.escalated_at || null,
    escalationReason: row.escalation_reason || null,
    lastSlaCheckAt: row.last_sla_check_at || null,
    createdByUid:   row.created_by_uid,
    createdByName:  row.created_by_name,
    createdByRole:  row.created_by_role,
    createdByApt:   row.created_by_apt,
    visitorName:    row.visitor_name,
    visitorPhone:   row.visitor_phone,
    carPlate:       row.car_plate,
    comment:        row.comment,
    passDuration:   row.pass_duration,
    validUntil:     row.valid_until,
    scheduledFor:   row.scheduled_for,
    arrivedAt:      row.arrived_at,
    photos:         row.photos || [],
    photo:          (row.photos && row.photos[0]) || null,
    createdAt:      row.created_at,
    updatedAt:      row.updated_at,
  };
}

function formatRequestHistoryRow(row) {
  return {
    byName: row.by_name,
    byRole: row.by_role,
    action: row.label,
    at: row.at,
  };
}

module.exports = {
  REQUEST_COLUMNS,
  formatRequestRow,
  formatRequestHistoryRow,
};
