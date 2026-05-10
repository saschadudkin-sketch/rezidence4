'use strict';

const {
  describe, test, expect, jest: jestApi,
} = require('@jest/globals');

const {
  applyContractorImport,
  applyStaffImport,
  buildContractorImportTemplate,
  buildStaffImportTemplate,
  previewContractorImport,
  previewStaffImport,
} = require('../v1/services/onboardingImportService');

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';

describe('onboarding import service', () => {
  test('builds staff and contractor CSV templates', () => {
    expect(buildStaffImportTemplate().content).toContain('full_name,email,role');
    expect(buildContractorImportTemplate().content).toContain('company_name,company_contact_name');
  });

  test('previews staff import with role defaults and duplicate validation', () => {
    const preview = previewStaffImport({
      body: {
        rows: [
          { full_name: 'Admin One', email: 'admin@example.ru', role: 'property_admin' },
          { full_name: 'Duplicate', email: 'admin@example.ru', role: 'security' },
          { full_name: '', email: 'bad', role: 'unknown' },
        ],
      },
    });

    expect(preview.valid_count).toBe(1);
    expect(preview.invalid_count).toBe(2);
    expect(preview.rows[0].staff).toMatchObject({
      can_view_resident_phone: true,
      can_assign_requests: true,
    });
    expect(preview.rows[1].errors).toContain('duplicate email in import payload');
    expect(preview.checklist.validation_ready).toBe(false);
  });

  test('applies staff import idempotently by existing email/external uid', async () => {
    const db = {
      query: jestApi.fn(async (sql, args) => {
        if (/SELECT id, property_id, email, external_uid\s+FROM staff_users/.test(sql)) {
          if (args[1] === 'existing@example.ru') {
            return { rows: [{ id: 'staff-existing', email: args[1] }] };
          }
          return { rows: [] };
        }
        if (/INSERT INTO staff_users/.test(sql)) {
          return {
            rows: [{
              id: 'staff-created',
              property_id: args[0],
              full_name: args[1],
              email: args[3],
              role: args[4],
            }],
          };
        }
        throw new Error(`unexpected SQL: ${sql}`);
      }),
    };

    const result = await applyStaffImport({
      queryable: db,
      propertyId: PROPERTY_ID,
      body: {
        rows: [
          { full_name: 'New Concierge', email: 'new@example.ru', role: 'concierge' },
          { full_name: 'Existing', email: 'existing@example.ru', role: 'security' },
        ],
      },
    });

    expect(result.imported).toEqual({ staff: 1 });
    expect(result.skipped).toEqual({ staff: 1 });
    expect(result.rows.map((r) => r.action)).toEqual(['created', 'skipped_existing']);
  });

  test('previews contractor import with company-only and user rows', () => {
    const preview = previewContractorImport({
      body: {
        rows: [
          { company_name: 'Сервис Плюс' },
          {
            company_name: 'Сервис Плюс',
            user_full_name: 'Петров Петр',
            user_email: 'petrov@example.ru',
            specialization: 'plumbing',
            access_expires_at: '2030-01-01T00:00:00.000Z',
          },
        ],
      },
    });

    expect(preview.valid_count).toBe(2);
    expect(preview.invalid_count).toBe(0);
    expect(preview.rows[0].contractor_user).toBeNull();
    expect(preview.rows[1].contractor_user).toMatchObject({
      email: 'petrov@example.ru',
      specialization: 'plumbing',
    });
  });

  test('applies contractor import by creating company and user', async () => {
    const db = {
      query: jestApi.fn(async (sql, args) => {
        if (/FROM contractor_companies/.test(sql)) return { rows: [] };
        if (/INSERT INTO contractor_companies/.test(sql)) {
          return { rows: [{ id: 'company-1', property_id: args[0], name: args[1], status: 'active' }] };
        }
        if (/FROM contractor_users/.test(sql)) return { rows: [] };
        if (/INSERT INTO contractor_users/.test(sql)) {
          return {
            rows: [{
              id: 'user-1',
              contractor_company_id: args[0],
              property_id: args[1],
              full_name: args[2],
            }],
          };
        }
        throw new Error(`unexpected SQL: ${sql}`);
      }),
    };

    const result = await applyContractorImport({
      queryable: db,
      propertyId: PROPERTY_ID,
      body: {
        rows: [{
          company_name: 'Сервис Плюс',
          user_full_name: 'Петров Петр',
          user_email: 'petrov@example.ru',
        }],
      },
    });

    expect(result.imported).toEqual({ contractor_companies: 1, contractor_users: 1 });
    expect(result.skipped).toEqual({ contractor_companies: 0, contractor_users: 0 });
    expect(result.rows[0].action).toBe('created');
  });
});
