'use strict';

const db = require('../db');
const { isStaff } = require('../constants');

function buildUploadUrlVariants(filename) {
  const relative = `/uploads/${filename}`;
  const backendUrl = (process.env.BACKEND_URL || '').replace(/\/+$/, '');
  const absolute = backendUrl ? `${backendUrl}/uploads/${filename}` : null;
  return { relative, absolute };
}

async function canUserAccessUpload(user, filename) {
  if (!user?.uid) return false;
  if (isStaff(user.role)) return true;

  const { relative, absolute } = buildUploadUrlVariants(filename);
  const { rows } = await db.query(
    `SELECT EXISTS (
      SELECT 1
        FROM requests r
       WHERE r.created_by_uid = $1
         AND r.deleted_at IS NULL
         AND ($2 = ANY(r.photos) OR ($3 IS NOT NULL AND $3 = ANY(r.photos)))
      UNION ALL
      SELECT 1
        FROM users u
       WHERE u.uid = $1
         AND u.deleted_at IS NULL
         AND (u.avatar = $2 OR ($3 IS NOT NULL AND u.avatar = $3))
      UNION ALL
      SELECT 1
        FROM chat_messages m
       WHERE m.uid = $1
         AND (m.photo = $2 OR ($3 IS NOT NULL AND m.photo = $3))
    ) AS allowed`,
    [user.uid, relative, absolute],
  );
  return rows?.[0]?.allowed === true;
}

module.exports = { canUserAccessUpload, buildUploadUrlVariants };
