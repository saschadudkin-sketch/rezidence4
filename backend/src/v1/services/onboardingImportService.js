'use strict';

const { parseCsvRows } = require('./structureImport');

const STAFF_ROLES = new Set(['security', 'concierge', 'technician', 'property_admin']);
const SPECIALIZATIONS = new Set(['plumbing', 'electric', 'cleaning', 'general']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?\d{8,15}$/;
const MAX_ROWS = 500;

const ROLE_CAPABILITY_DEFAULTS = Object.freeze({
  security: { can_view_resident_phone: false, can_assign_requests: false },
  concierge: { can_view_resident_phone: true, can_assign_requests: true },
  technician: { can_view_resident_phone: false, can_assign_requests: false },
  property_admin: { can_view_resident_phone: true, can_assign_requests: true },
});

const STAFF_TEMPLATE_HEADERS = Object.freeze([
  'full_name',
  'email',
  'role',
  'phone',
  'specialization',
  'external_uid',
  'can_view_resident_phone',
  'can_assign_requests',
]);

const STAFF_TEMPLATE_SAMPLE = Object.freeze([
  'Иванов Иван',
  'ivanov@example.ru',
  'concierge',
  '+79991234567',
  'general',
  'staff-001',
  '',
  '',
]);

const CONTRACTOR_TEMPLATE_HEADERS = Object.freeze([
  'company_name',
  'company_contact_name',
  'company_contact_phone',
  'company_contact_email',
  'user_full_name',
  'user_phone',
  'user_email',
  'specialization',
  'external_uid',
  'access_expires_at',
]);

const CONTRACTOR_TEMPLATE_SAMPLE = Object.freeze([
  'Сервис Плюс',
  'Петров Петр',
  '+79991234567',
  'service@example.ru',
  'Сидоров Сидор',
  '+79997654321',
  'sidorov@example.ru',
  'plumbing',
  'contractor-001',
  '2030-12-31T21:00:00.000Z',
]);

class OnboardingImportError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = 'OnboardingImportError';
    this.status = status;
    this.details = details;
  }
}

function isOnboardingImportError(err) {
  return err instanceof OnboardingImportError;
}

function importError(status, message, details = null) {
  return new OnboardingImportError(status, message, details);
}

function csvEscape(value) {
  const str = String(value ?? '');
  if (!/[",\n\r]/.test(str)) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

function buildTemplate(filename, headers, sample) {
  return {
    filename,
    content: `${headers.map(csvEscape).join(',')}\n${sample.map(csvEscape).join(',')}\n`,
  };
}

function buildStaffImportTemplate() {
  return buildTemplate('domhub-staff-import.csv', STAFF_TEMPLATE_HEADERS, STAFF_TEMPLATE_SAMPLE);
}

function buildContractorImportTemplate() {
  return buildTemplate(
    'domhub-contractors-import.csv',
    CONTRACTOR_TEMPLATE_HEADERS,
    CONTRACTOR_TEMPLATE_SAMPLE,
  );
}

function rowsFromBody(body) {
  if (typeof body === 'string') return parseCsvRows(body);
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    if (typeof body.csv === 'string') return parseCsvRows(body.csv);
    if (Array.isArray(body.rows)) return body.rows;
  }
  throw importError(400, 'import payload must be CSV text, { csv }, or { rows }');
}

function normalizeString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function optionalString(value, maxLen, field, errors) {
  const v = normalizeString(value);
  if (!v) return null;
  if (v.length > maxLen) errors.push(`${field} must be <= ${maxLen} chars`);
  return v || null;
}

function parseBool(value, field, errors) {
  const v = normalizeString(value).toLowerCase();
  if (!v) return null;
  if (['true', '1', 'yes', 'y', 'да'].includes(v)) return true;
  if (['false', '0', 'no', 'n', 'нет'].includes(v)) return false;
  errors.push(`${field} must be boolean`);
  return null;
}

function normalizeRows(body) {
  const rows = rowsFromBody(body);
  if (rows.length === 0) throw importError(400, 'rows must contain at least one import row');
  if (rows.length > MAX_ROWS) throw importError(400, `rows limit is ${MAX_ROWS}`);
  return rows;
}

function buildChecklist({ validCount, invalidCount, imported = null, skipped = null, resource }) {
  return {
    resource,
    validation_ready: invalidCount === 0,
    launch_ready: invalidCount === 0 && validCount > 0,
    valid_count: validCount,
    invalid_count: invalidCount,
    imported,
    skipped,
  };
}

function normalizeStaffRow(row, rowNumber, seen) {
  const errors = [];
  const fullName = normalizeString(row.full_name || row.name);
  const email = normalizeString(row.email).toLowerCase();
  const role = normalizeString(row.role);
  const phone = optionalString(row.phone, 40, 'phone', errors);
  const specialization = optionalString(row.specialization, 30, 'specialization', errors);
  const externalUid = optionalString(row.external_uid || row.externalUid, 200, 'external_uid', errors);

  if (!fullName || fullName.length > 200) errors.push('full_name required (1-200 chars)');
  if (!EMAIL_RE.test(email)) errors.push('Invalid email');
  if (!STAFF_ROLES.has(role)) errors.push('Invalid role');
  if (phone && !PHONE_RE.test(phone)) errors.push('phone must be E.164-like');
  if (specialization && !SPECIALIZATIONS.has(specialization)) errors.push('Invalid specialization');

  if (email) {
    if (seen.emails.has(email)) errors.push('duplicate email in import payload');
    seen.emails.add(email);
  }
  if (externalUid) {
    if (seen.externalUids.has(externalUid)) errors.push('duplicate external_uid in import payload');
    seen.externalUids.add(externalUid);
  }

  const defaults = ROLE_CAPABILITY_DEFAULTS[role] || {};
  const canViewResidentPhone =
    parseBool(row.can_view_resident_phone ?? row.canViewResidentPhone, 'can_view_resident_phone', errors);
  const canAssignRequests =
    parseBool(row.can_assign_requests ?? row.canAssignRequests, 'can_assign_requests', errors);

  const staff = {
    full_name: fullName,
    email,
    role,
    phone,
    specialization,
    external_uid: externalUid,
    can_view_resident_phone:
      canViewResidentPhone === null ? Boolean(defaults.can_view_resident_phone) : canViewResidentPhone,
    can_assign_requests:
      canAssignRequests === null ? Boolean(defaults.can_assign_requests) : canAssignRequests,
  };

  return {
    row_number: rowNumber,
    action: errors.length ? 'invalid' : 'ready',
    errors,
    staff: errors.length ? null : staff,
  };
}

function previewStaffImport({ body }) {
  const rows = normalizeRows(body);
  const seen = { emails: new Set(), externalUids: new Set() };
  const previewRows = rows.map((row, index) => normalizeStaffRow(row, index + 2, seen));
  const invalidCount = previewRows.filter((row) => row.errors.length > 0).length;
  const validCount = previewRows.length - invalidCount;
  return {
    mode: 'preview',
    resource: 'staff',
    valid_count: validCount,
    invalid_count: invalidCount,
    rows: previewRows,
    checklist: buildChecklist({ validCount, invalidCount, resource: 'staff' }),
  };
}

function normalizeContractorRow(row, rowNumber, seen) {
  const errors = [];
  const companyName = normalizeString(row.company_name || row.company);
  const contactName = optionalString(row.company_contact_name || row.contact_name, 200, 'company_contact_name', errors);
  const contactPhone = optionalString(row.company_contact_phone || row.contact_phone, 40, 'company_contact_phone', errors);
  const contactEmail = optionalString(row.company_contact_email || row.contact_email, 200, 'company_contact_email', errors);
  const userFullName = normalizeString(row.user_full_name || row.full_name);
  const userPhone = optionalString(row.user_phone || row.phone, 40, 'user_phone', errors);
  const userEmail = optionalString(row.user_email || row.email, 200, 'user_email', errors);
  const specialization = optionalString(row.specialization, 30, 'specialization', errors);
  const externalUid = optionalString(row.external_uid || row.externalUid, 200, 'external_uid', errors);
  const accessExpiresAtRaw = normalizeString(row.access_expires_at || row.accessExpiresAt);
  let accessExpiresAt = null;

  if (!companyName || companyName.length > 200) errors.push('company_name required (1-200 chars)');
  if (contactPhone && !PHONE_RE.test(contactPhone)) errors.push('company_contact_phone must be E.164-like');
  if (contactEmail && !EMAIL_RE.test(contactEmail)) errors.push('Invalid company_contact_email');

  const hasUserData = Boolean(userFullName || userPhone || userEmail || specialization || externalUid || accessExpiresAtRaw);
  if (hasUserData && (!userFullName || userFullName.length > 200)) errors.push('user_full_name required when user columns are provided');
  if (userPhone && !PHONE_RE.test(userPhone)) errors.push('user_phone must be E.164-like');
  if (userEmail && !EMAIL_RE.test(userEmail)) errors.push('Invalid user_email');
  if (specialization && !SPECIALIZATIONS.has(specialization)) errors.push('Invalid specialization');
  if (accessExpiresAtRaw) {
    const t = Date.parse(accessExpiresAtRaw);
    if (!Number.isFinite(t)) {
      errors.push('access_expires_at must be ISO 8601');
    } else if (t <= Date.now()) {
      errors.push('access_expires_at must be in the future');
    } else {
      accessExpiresAt = new Date(t).toISOString();
    }
  }

  const companyKey = companyName.toLowerCase();
  const userKey = externalUid || (userEmail ? `${companyKey}:${userEmail.toLowerCase()}` : `${companyKey}:${userFullName.toLowerCase()}`);
  if (hasUserData && userKey) {
    if (seen.users.has(userKey)) errors.push('duplicate contractor user in import payload');
    seen.users.add(userKey);
  }

  return {
    row_number: rowNumber,
    action: errors.length ? 'invalid' : 'ready',
    errors,
    company: errors.length ? null : {
      name: companyName,
      contact_name: contactName,
      contact_phone: contactPhone,
      contact_email: contactEmail,
    },
    contractor_user: errors.length || !hasUserData ? null : {
      full_name: userFullName,
      phone: userPhone,
      email: userEmail,
      specialization,
      external_uid: externalUid,
      access_expires_at: accessExpiresAt,
    },
  };
}

function previewContractorImport({ body }) {
  const rows = normalizeRows(body);
  const seen = { users: new Set() };
  const previewRows = rows.map((row, index) => normalizeContractorRow(row, index + 2, seen));
  const invalidCount = previewRows.filter((row) => row.errors.length > 0).length;
  const validCount = previewRows.length - invalidCount;
  return {
    mode: 'preview',
    resource: 'contractors',
    valid_count: validCount,
    invalid_count: invalidCount,
    rows: previewRows,
    checklist: buildChecklist({ validCount, invalidCount, resource: 'contractors' }),
  };
}

function requireValidPreview(preview) {
  if (preview.invalid_count > 0) {
    throw importError(400, 'import has validation errors', preview.rows);
  }
}

async function findExistingStaff(queryable, propertyId, staff) {
  const { rows } = await queryable.query(
    `SELECT id, property_id, email, external_uid
       FROM staff_users
      WHERE (property_id = $1 AND LOWER(email) = LOWER($2))
         OR ($3::text IS NOT NULL AND external_uid = $3)
      LIMIT 1`,
    [propertyId, staff.email, staff.external_uid],
  );
  return rows[0] || null;
}

async function applyStaffImport({ queryable, propertyId, body }) {
  if (!queryable || typeof queryable.query !== 'function') {
    throw new Error('applyStaffImport: queryable with .query required');
  }
  const preview = previewStaffImport({ body });
  requireValidPreview(preview);

  const imported = { staff: 0 };
  const skipped = { staff: 0 };
  const resultRows = [];

  for (const row of preview.rows) {
    const existing = await findExistingStaff(queryable, propertyId, row.staff);
    if (existing) {
      skipped.staff += 1;
      resultRows.push({ ...row, action: 'skipped_existing', existing_id: existing.id });
      continue;
    }

    const { rows } = await queryable.query(
      `INSERT INTO staff_users(
         property_id, full_name, phone, email, role, specialization,
         can_view_resident_phone, can_assign_requests, external_uid
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        propertyId,
        row.staff.full_name,
        row.staff.phone,
        row.staff.email,
        row.staff.role,
        row.staff.specialization,
        row.staff.can_view_resident_phone,
        row.staff.can_assign_requests,
        row.staff.external_uid,
      ],
    );
    imported.staff += 1;
    resultRows.push({ ...row, action: 'created', staff: rows[0] });
  }

  return {
    mode: 'apply',
    resource: 'staff',
    imported,
    skipped,
    rows: resultRows,
    checklist: buildChecklist({
      validCount: preview.valid_count,
      invalidCount: 0,
      imported,
      skipped,
      resource: 'staff',
    }),
  };
}

async function findOrCreateContractorCompany(queryable, propertyId, company) {
  const { rows } = await queryable.query(
    `SELECT *
       FROM contractor_companies
      WHERE property_id = $1 AND LOWER(name) = LOWER($2)
      LIMIT 1`,
    [propertyId, company.name],
  );
  if (rows[0]) return { company: rows[0], created: false };

  const inserted = await queryable.query(
    `INSERT INTO contractor_companies(property_id, name, contact_name, contact_phone, contact_email)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *`,
    [
      propertyId,
      company.name,
      company.contact_name,
      company.contact_phone,
      company.contact_email,
    ],
  );
  return { company: inserted.rows[0], created: true };
}

async function findExistingContractorUser(queryable, propertyId, companyId, user) {
  const { rows } = await queryable.query(
    `SELECT id, property_id, contractor_company_id, email, external_uid
       FROM contractor_users
      WHERE property_id = $1
        AND (
          ($2::text IS NOT NULL AND external_uid = $2)
          OR ($3::text IS NOT NULL AND contractor_company_id = $4 AND LOWER(email) = LOWER($3))
          OR ($2::text IS NULL AND $3::text IS NULL AND contractor_company_id = $4 AND LOWER(full_name) = LOWER($5))
        )
      LIMIT 1`,
    [propertyId, user.external_uid, user.email, companyId, user.full_name],
  );
  return rows[0] || null;
}

async function applyContractorImport({ queryable, propertyId, body }) {
  if (!queryable || typeof queryable.query !== 'function') {
    throw new Error('applyContractorImport: queryable with .query required');
  }
  const preview = previewContractorImport({ body });
  requireValidPreview(preview);

  const imported = { contractor_companies: 0, contractor_users: 0 };
  const skipped = { contractor_companies: 0, contractor_users: 0 };
  const resultRows = [];

  for (const row of preview.rows) {
    const companyResult = await findOrCreateContractorCompany(queryable, propertyId, row.company);
    if (companyResult.created) imported.contractor_companies += 1;
    else skipped.contractor_companies += 1;

    if (!row.contractor_user) {
      resultRows.push({
        ...row,
        action: companyResult.created ? 'company_created' : 'company_existing',
        company: companyResult.company,
      });
      continue;
    }

    if (companyResult.company.status && companyResult.company.status !== 'active') {
      skipped.contractor_users += 1;
      resultRows.push({
        ...row,
        action: 'skipped_inactive_company',
        company: companyResult.company,
        errors: [`contractor company status is '${companyResult.company.status}'`],
      });
      continue;
    }

    const existing = await findExistingContractorUser(
      queryable,
      propertyId,
      companyResult.company.id,
      row.contractor_user,
    );
    if (existing) {
      skipped.contractor_users += 1;
      resultRows.push({
        ...row,
        action: 'skipped_existing',
        company: companyResult.company,
        existing_id: existing.id,
      });
      continue;
    }

    const inserted = await queryable.query(
      `INSERT INTO contractor_users(
         contractor_company_id, property_id, full_name, phone, email,
         specialization, access_expires_at, external_uid
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        companyResult.company.id,
        propertyId,
        row.contractor_user.full_name,
        row.contractor_user.phone,
        row.contractor_user.email,
        row.contractor_user.specialization,
        row.contractor_user.access_expires_at,
        row.contractor_user.external_uid,
      ],
    );
    imported.contractor_users += 1;
    resultRows.push({
      ...row,
      action: 'created',
      company: companyResult.company,
      contractor_user: inserted.rows[0],
    });
  }

  return {
    mode: 'apply',
    resource: 'contractors',
    imported,
    skipped,
    rows: resultRows,
    checklist: buildChecklist({
      validCount: preview.valid_count,
      invalidCount: 0,
      imported,
      skipped,
      resource: 'contractors',
    }),
  };
}

module.exports = {
  OnboardingImportError,
  applyContractorImport,
  applyStaffImport,
  buildContractorImportTemplate,
  buildStaffImportTemplate,
  isOnboardingImportError,
  previewContractorImport,
  previewStaffImport,
};
