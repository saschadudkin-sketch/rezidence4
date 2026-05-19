'use strict';

jest.mock('../logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../middleware/propertyDb', () => {
  const actual = jest.requireActual('../middleware/propertyDb');
  return {
    ...actual,
    getProperty: jest.fn(),
    resolveProperty: jest.fn(),
  };
});

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

const { registerProtectedUploads } = require('../app/registerProtectedUploads');
const { createSignedUploadUrl } = require('../services/uploadSecurity');
const propertyDb = require('../middleware/propertyDb');

describe('protected uploads tenant database resolution', () => {
  let tmpDir;
  let app;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rz-upload-tenant-'));
    fs.writeFileSync(path.join(tmpDir, 'photo_1.webp'), 'fake-image-data');

    app = express();
    registerProtectedUploads(app, { uploadDir: path.resolve(tmpDir) });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  test('signed tenant upload fails closed when property database is not configured', async () => {
    propertyDb.getProperty.mockResolvedValueOnce({
      id: 'prop-1',
      slug: 'alpha',
      hostname: null,
      is_active: true,
      db_connection_url: null,
      feature_flags: {},
      plan: 'operations',
    });

    const signedUrl = createSignedUploadUrl('photo_1.webp', 'http://localhost:3001', {
      propertySlug: 'alpha',
    });
    const { pathname, search } = new URL(signedUrl);

    const res = await request(app).get(`${pathname}${search}`);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'Property database unavailable' });
    expect(propertyDb.getProperty).toHaveBeenCalledWith('alpha');
    expect(propertyDb.resolveProperty).not.toHaveBeenCalled();
  });
});
