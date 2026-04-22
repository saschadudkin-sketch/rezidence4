'use strict';

const { REQUEST_FIELD_MAX } = require('../../constants/validationLimits');
const { ServiceError } = require('./RequestErrors');

const VALID_TYPES = new Set(['pass', 'tech', 'repair', 'cleaning', 'concierge', 'complaint', 'suggestion', 'car', 'move_in', 'move_out']);
const VALID_CATEGORIES = new Set([
  'guest', 'courier', 'taxi', 'car', 'master', 'cleaner', 'other',
  'worker', 'team', 'delivery', 'electrician', 'plumber',
]);
const ALLOWED_INITIAL_STATUSES = new Set(['pending', 'scheduled']);

function isAutoApprovedPass({ type, scheduledFor, requestedStatus }) {
  return type === 'pass'
    && !scheduledFor
    && requestedStatus !== 'scheduled';
}

function validateFieldLengths(data) {
  for (const [field, max] of Object.entries(REQUEST_FIELD_MAX)) {
    if (data[field] != null && typeof data[field] === 'string' && data[field].length > max) {
      throw new ServiceError(`${field} too long (max ${max} chars)`);
    }
  }
}

function validatePhotos(photos, backendUrl = process.env.BACKEND_URL || '') {
  if (photos === undefined) return;
  if (!Array.isArray(photos)) {
    throw new ServiceError('photos must be an array');
  }
  if (photos.length > 10) {
    throw new ServiceError('photos: max 10 items per request');
  }
  for (const url of photos) {
    if (typeof url !== 'string') {
      throw new ServiceError('photos: each item must be a string');
    }
    const isLocal = url.startsWith('/uploads/') || (backendUrl && url.startsWith(backendUrl + '/uploads/'));
    if (!isLocal) {
      throw new ServiceError('photos: only local upload URLs allowed (/uploads/...)');
    }
  }
}

function validateCreatePayload(body) {
  if (!VALID_TYPES.has(body.type)) {
    throw new ServiceError(`Invalid type. Allowed: ${[...VALID_TYPES].join(', ')}`);
  }
  if (!VALID_CATEGORIES.has(body.category)) {
    throw new ServiceError(`Invalid category. Allowed: ${[...VALID_CATEGORIES].join(', ')}`);
  }
  validateFieldLengths(body);
  validatePhotos(body.photos);
}

function validateInitialStatus(role, initialStatus, autoApprovePass, isStaff) {
  if (!isStaff(role) && !ALLOWED_INITIAL_STATUSES.has(initialStatus) && !autoApprovePass) {
    throw new ServiceError('Residents can only create pending, approved pass, or scheduled requests', 403);
  }
}

function validateUpdatePayload(patch) {
  validatePhotos(patch.photos);
  validateFieldLengths(patch);
}

module.exports = {
  VALID_TYPES,
  VALID_CATEGORIES,
  ALLOWED_INITIAL_STATUSES,
  isAutoApprovedPass,
  validateFieldLengths,
  validatePhotos,
  validateCreatePayload,
  validateInitialStatus,
  validateUpdatePayload,
};
