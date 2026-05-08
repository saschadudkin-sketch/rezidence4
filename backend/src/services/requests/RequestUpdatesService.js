'use strict';

const { isStaff } = require('../../constants');
const { RequestsService } = require('../RequestsService');
const { ServiceError } = require('./RequestErrors');

const MAX_UPDATE_BODY_LENGTH = 2000;
const SAFE_FILENAME_RE = /^[A-Za-z0-9_.-]{1,255}$/;
const VALID_FILE_KINDS = new Set(['photo', 'document', 'other']);
const RESIDENT_VISIBILITY = 'resident';

function formatAttachmentRow(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    uploadedByUid: row.uploaded_by_uid,
    fileUrl: row.file_url,
    fileKind: row.file_kind || 'photo',
    visibility: row.visibility,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  };
}

function formatUpdateRow(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    actorUid: row.actor_uid,
    actorName: row.actor_name,
    actorRole: row.actor_role,
    body: row.body,
    visibility: row.visibility,
    attachmentIds: row.attachment_ids || [],
    createdAt: row.created_at,
  };
}

function getAllowedBackendOrigin() {
  const raw = (process.env.BACKEND_URL || '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function normalizeUploadFileUrl(fileUrl) {
  const raw = String(fileUrl || '').trim();
  if (!raw) throw new ServiceError('fileUrl is required', 400);

  let pathname;
  if (raw.startsWith('/')) {
    pathname = raw.split('?')[0];
  } else {
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw new ServiceError('fileUrl must reference a local upload', 400);
    }

    const allowedOrigin = getAllowedBackendOrigin();
    const localHost = parsed.hostname === 'localhost'
      || parsed.hostname === '127.0.0.1'
      || parsed.hostname === '::1';
    if ((allowedOrigin && parsed.origin !== allowedOrigin) || (!allowedOrigin && !localHost)) {
      throw new ServiceError('External upload URLs are not allowed', 400);
    }
    pathname = parsed.pathname;
  }

  if (!pathname.startsWith('/uploads/')) {
    throw new ServiceError('fileUrl must reference a local upload', 400);
  }

  let filename;
  try {
    filename = decodeURIComponent(pathname.slice('/uploads/'.length));
  } catch {
    throw new ServiceError('Invalid upload filename', 400);
  }

  if (
    !filename
    || filename.includes('/')
    || filename.includes('\\')
    || filename.includes('..')
    || !SAFE_FILENAME_RE.test(filename)
  ) {
    throw new ServiceError('Invalid upload filename', 400);
  }

  return { filename, fileUrl: `/uploads/${filename}` };
}

function normalizeResidentVisibility(visibility) {
  const normalized = String(visibility || RESIDENT_VISIBILITY).trim().toLowerCase();
  if (normalized !== RESIDENT_VISIBILITY) {
    throw new ServiceError('Only resident-visible request communication is supported', 400);
  }
  return normalized;
}

function normalizeFileKind(value) {
  const kind = String(value || 'photo').trim().toLowerCase();
  if (!VALID_FILE_KINDS.has(kind)) {
    throw new ServiceError('Invalid attachment fileKind', 400);
  }
  return kind;
}

function normalizeMetadata(metadata) {
  if (metadata === undefined || metadata === null) return {};
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new ServiceError('metadata must be an object', 400);
  }
  return metadata;
}

function normalizeUpdateBody(value) {
  const body = String(value || '').trim();
  if (!body) throw new ServiceError('body is required', 400);
  if (body.length > MAX_UPDATE_BODY_LENGTH) {
    throw new ServiceError(`body must be ${MAX_UPDATE_BODY_LENGTH} characters or less`, 400);
  }
  return body;
}

function normalizeAttachmentIds(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ServiceError('attachmentIds must be an array', 400);
  const ids = value.map((id) => String(id || '').trim()).filter(Boolean);
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (ids.length !== value.length || ids.some((id) => !uuidRe.test(id))) {
    throw new ServiceError('attachmentIds must contain valid UUIDs', 400);
  }
  return ids;
}

async function assertRequestAccess(user, requestId, queryDb) {
  return RequestsService.getOne(user, requestId, queryDb);
}

async function assertUploadReferenceAllowed(user, filename, queryDb) {
  const { rows } = await queryDb.query(
    `SELECT owner_uid FROM upload_objects WHERE filename=$1 LIMIT 1`,
    [filename],
  );
  if (!rows.length) throw new ServiceError('Upload not found', 404);
  if (!isStaff(user.role) && rows[0].owner_uid !== user.uid) {
    throw new ServiceError('Upload does not belong to current user', 403);
  }
}

class RequestUpdatesService {
  static async listAttachments(user, requestId, queryDb) {
    await assertRequestAccess(user, requestId, queryDb);
    const staff = isStaff(user.role);
    const params = staff ? [requestId] : [requestId, RESIDENT_VISIBILITY];
    const { rows } = await queryDb.query(
      `SELECT id, request_id, uploaded_by_uid, file_url, file_kind, visibility, metadata, created_at
         FROM request_attachments
        WHERE request_id=$1
          ${staff ? '' : 'AND visibility=$2'}
        ORDER BY created_at ASC, id ASC`,
      params,
    );
    return rows.map(formatAttachmentRow);
  }

  static async createAttachment(user, requestId, body, queryDb) {
    await assertRequestAccess(user, requestId, queryDb);
    const visibility = normalizeResidentVisibility(body?.visibility);
    const fileKind = normalizeFileKind(body?.fileKind || body?.file_kind);
    const metadata = normalizeMetadata(body?.metadata);
    const { filename, fileUrl } = normalizeUploadFileUrl(body?.fileUrl || body?.url);

    await assertUploadReferenceAllowed(user, filename, queryDb);

    const { rows } = await queryDb.query(
      `INSERT INTO request_attachments
         (request_id, uploaded_by_uid, file_url, file_kind, visibility, metadata)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, request_id, uploaded_by_uid, file_url, file_kind, visibility, metadata, created_at`,
      [requestId, user.uid, fileUrl, fileKind, visibility, metadata],
    );
    return formatAttachmentRow(rows[0]);
  }

  static async listUpdates(user, requestId, queryDb) {
    await assertRequestAccess(user, requestId, queryDb);
    const staff = isStaff(user.role);
    const params = staff ? [requestId] : [requestId, RESIDENT_VISIBILITY];
    const { rows } = await queryDb.query(
      `SELECT id, request_id, actor_uid, actor_name, actor_role, body, visibility,
              attachment_ids, created_at
         FROM request_updates
        WHERE request_id=$1
          ${staff ? '' : 'AND visibility=$2'}
        ORDER BY created_at ASC, id ASC`,
      params,
    );
    return rows.map(formatUpdateRow);
  }

  static async createUpdate(user, requestId, body, queryDb) {
    await assertRequestAccess(user, requestId, queryDb);
    const visibility = normalizeResidentVisibility(body?.visibility);
    const updateBody = normalizeUpdateBody(body?.body || body?.comment);
    const attachmentIds = normalizeAttachmentIds(body?.attachmentIds || body?.attachment_ids);

    const { rows } = await queryDb.query(
      `INSERT INTO request_updates
         (request_id, actor_uid, actor_name, actor_role, body, visibility, attachment_ids)
       VALUES ($1,$2,$3,$4,$5,$6,$7::uuid[])
       RETURNING id, request_id, actor_uid, actor_name, actor_role, body, visibility,
                 attachment_ids, created_at`,
      [requestId, user.uid, user.name || null, user.role || null, updateBody, visibility, attachmentIds],
    );
    return formatUpdateRow(rows[0]);
  }
}

module.exports = {
  RequestUpdatesService,
  normalizeUploadFileUrl,
};
