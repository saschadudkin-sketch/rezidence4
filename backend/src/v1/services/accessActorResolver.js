'use strict';

// Central bridge between legacy auth claims (`users.uid`) and v1 actor IDs.
// v1 tables use UUID primary keys; req.user.uid is only an external identity.

async function resolveResidentIdByUid(db, uid) {
  if (!uid) return null;
  const { rows } = await db.query(
    `SELECT id
       FROM residents
      WHERE external_uid = $1
        AND is_active = true`,
    [uid],
  );
  if (rows.length > 1) {
    throw new Error(`ambiguous resident mapping for uid '${uid}'`);
  }
  return rows[0]?.id || null;
}

async function resolveStaffIdByUid(db, uid) {
  if (!uid) return null;
  const { rows } = await db.query(
    `SELECT id
       FROM staff_users
      WHERE external_uid = $1
        AND is_active = true`,
    [uid],
  );
  if (rows.length > 1) {
    throw new Error(`ambiguous staff mapping for uid '${uid}'`);
  }
  return rows[0]?.id || null;
}

async function resolveContractorUserIdByUid(db, uid) {
  if (!uid) return null;
  const { rows } = await db.query(
    `SELECT id
       FROM contractor_users
      WHERE external_uid = $1
        AND is_active = true
        AND (access_expires_at IS NULL OR access_expires_at > NOW())`,
    [uid],
  );
  if (rows.length > 1) {
    throw new Error(`ambiguous contractor mapping for uid '${uid}'`);
  }
  return rows[0]?.id || null;
}

module.exports = {
  resolveResidentIdByUid,
  resolveStaffIdByUid,
  resolveContractorUserIdByUid,
};
