'use strict';

const REQUEST_COLUMNS = `id, type, category, status,
  created_by_uid, created_by_name, created_by_role, created_by_apt,
  visitor_name, visitor_phone, car_plate, comment, pass_duration,
  valid_until, scheduled_for, arrived_at, photos,
  created_at, updated_at`;

function formatRequestRow(row) {
  return {
    id:             row.id,
    type:           row.type,
    category:       row.category,
    status:         row.status,
    priority:       'normal',
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
