'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

jest.mock('../logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  fatal: jest.fn(),
}));

describe('photoRetentionSweep (ФЗ-152)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'domhub-retention-'));
  const oldEnv = process.env.UPLOAD_DIR;

  beforeAll(() => { process.env.UPLOAD_DIR = tmpDir; });
  afterAll(() => {
    process.env.UPLOAD_DIR = oldEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('unlinks expired files and deletes upload_objects rows', async () => {
    // Fresh require so the updated UPLOAD_DIR is picked up inside the module.
    jest.isolateModules(async () => {
      const { photoRetentionSweep } = require('../server/runtimeJobs');

      const expiredName = 'photo_expired.webp';
      const expiredPath = path.join(tmpDir, expiredName);
      fs.writeFileSync(expiredPath, Buffer.from([0x01, 0x02, 0x03]));

      const db = {
        query: jest.fn(async (sql, params) => {
          if (/SELECT filename/i.test(sql)) {
            return { rows: [{ filename: expiredName }], rowCount: 1 };
          }
          if (/^\s*DELETE FROM upload_objects/i.test(sql)) {
            expect(params).toEqual([expiredName]);
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }),
      };

      await photoRetentionSweep(db, { slug: 'test' });

      expect(fs.existsSync(expiredPath)).toBe(false);
      // Both the SELECT and the DELETE must have run.
      const sqlCalls = db.query.mock.calls.map(([sql]) => sql);
      expect(sqlCalls.some((s) => /SELECT filename/i.test(s))).toBe(true);
      expect(sqlCalls.some((s) => /DELETE FROM upload_objects/i.test(s))).toBe(true);
    });
  });

  test('handles missing files gracefully (ENOENT)', async () => {
    jest.isolateModules(async () => {
      const { photoRetentionSweep } = require('../server/runtimeJobs');

      const db = {
        query: jest.fn(async (sql) => {
          if (/SELECT filename/i.test(sql)) {
            return { rows: [{ filename: 'never_existed.webp' }], rowCount: 1 };
          }
          return { rows: [], rowCount: 1 };
        }),
      };

      // Must not throw even though the file is missing on disk.
      await expect(photoRetentionSweep(db, null)).resolves.toBeUndefined();
    });
  });
});
