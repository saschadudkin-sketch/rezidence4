'use strict';

const express = require('express');
const supertest = require('supertest');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../logger', () => require('../__mocks__/logger'));

let mockCurrentUser = null;
jest.mock('../middleware/auth', () => (req, res, next) => {
  if (!mockCurrentUser) return res.status(401).json({ error: 'auth not set' });
  req.user = mockCurrentUser;
  next();
});

jest.mock('../v1/services/onboardingImportService', () => ({
  applyContractorImport: jest.fn(),
  applyStaffImport: jest.fn(),
  buildContractorImportTemplate: jest.fn(() => ({
    filename: 'domhub-contractors-import.csv',
    content: 'company_name,user_full_name\n',
  })),
  buildStaffImportTemplate: jest.fn(() => ({
    filename: 'domhub-staff-import.csv',
    content: 'full_name,email,role\n',
  })),
  isOnboardingImportError: jest.fn(() => false),
  previewContractorImport: jest.fn(),
  previewStaffImport: jest.fn(),
}));

const db = require('../db');
const service = require('../v1/services/onboardingImportService');
const staffRouter = require('../v1/routes/staff');
const contractorsRouter = require('../v1/routes/contractors');

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/staff', staffRouter);
  app.use('/api/v1', contractorsRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: String(err && err.message || err) });
  });
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;
  db.query.mockResolvedValue({ rows: [] });
});

describe('v1 onboarding import routes', () => {
  test('property admin can preview staff import', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'property_admin', property_id: PROPERTY_ID };
    service.previewStaffImport.mockReturnValue({
      mode: 'preview',
      resource: 'staff',
      valid_count: 1,
      invalid_count: 0,
      rows: [],
    });

    const res = await supertest(buildApp())
      .post('/api/v1/staff/import/preview')
      .send({ property_id: PROPERTY_ID, rows: [{ full_name: 'One', email: 'one@example.ru', role: 'concierge' }] });

    expect(res.status).toBe(200);
    expect(res.body.resource).toBe('staff');
    expect(service.previewStaffImport).toHaveBeenCalledWith({
      body: expect.objectContaining({ property_id: PROPERTY_ID }),
    });
  });

  test('resident cannot apply staff import', async () => {
    mockCurrentUser = { uid: 'resident-1', role: 'resident', property_id: PROPERTY_ID };

    const res = await supertest(buildApp())
      .post('/api/v1/staff/import/apply')
      .send({ property_id: PROPERTY_ID, rows: [] });

    expect(res.status).toBe(403);
    expect(service.applyStaffImport).not.toHaveBeenCalled();
  });

  test('property admin can apply contractor import and writes audit', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'property_admin', property_id: PROPERTY_ID };
    service.applyContractorImport.mockResolvedValue({
      mode: 'apply',
      resource: 'contractors',
      imported: { contractor_companies: 1, contractor_users: 1 },
      skipped: { contractor_companies: 0, contractor_users: 0 },
      checklist: { launch_ready: true },
      rows: [],
    });

    const res = await supertest(buildApp())
      .post('/api/v1/contractors/import/apply')
      .send({ property_id: PROPERTY_ID, rows: [{ company_name: 'Service', user_full_name: 'User' }] });

    expect(res.status).toBe(201);
    expect(res.body.imported.contractor_users).toBe(1);
    expect(service.applyContractorImport).toHaveBeenCalledWith({
      queryable: db,
      propertyId: PROPERTY_ID,
      body: expect.objectContaining({ property_id: PROPERTY_ID }),
    });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO property_audit_log'), expect.any(Array));
  });

  test('staff template is served as csv', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'property_admin', property_id: PROPERTY_ID };

    const res = await supertest(buildApp())
      .get('/api/v1/staff/import/template');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toContain('domhub-staff-import.csv');
    expect(res.text).toContain('full_name,email,role');
  });
});
