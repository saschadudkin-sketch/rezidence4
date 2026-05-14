'use strict';

const fs = require('node:fs');
const path = require('node:path');

describe('v1 audit tenant isolation', () => {
  test.each([
    ['announcements', '../v1/routes/announcements.js'],
    ['documents', '../v1/routes/documents.js'],
    ['packages', '../v1/routes/packages.js'],
    ['admin outbox', '../v1/routes/adminOutbox.js'],
  ])('%s audit helper writes through req.db when available', (_name, relativePath) => {
    const source = fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
    expect(source).toContain('const auditDb = req.db || db;');
    expect(source).toContain('auditDb.query(');
    expect(source).not.toContain('audit остаётся на singleton db.query');
  });
});
