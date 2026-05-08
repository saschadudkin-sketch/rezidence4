'use strict';

jest.mock('../db');

const db = require('../db');
const { canUserAccessUpload, buildUploadUrlVariants } = require('../services/uploadAccess');

describe('uploadAccess ACL', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.BACKEND_URL = 'http://backend.test';
  });

  test('buildUploadUrlVariants creates relative + absolute URLs', () => {
    expect(buildUploadUrlVariants('photo_1.jpg')).toEqual({
      relative: '/uploads/photo_1.jpg',
      absolute: 'http://backend.test/uploads/photo_1.jpg',
    });
  });

  test('staff role can access any upload without DB lookup', async () => {
    const allowed = await canUserAccessUpload({ uid: 'sec-1', role: 'security' }, 'photo_1.jpg');
    expect(allowed).toBe(true);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('resident can access own linked upload', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ allowed: true }] });
    const allowed = await canUserAccessUpload({ uid: 'owner-1', role: 'owner' }, 'photo_own.jpg');
    expect(allowed).toBe(true);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][1]).toEqual([
      'owner-1',
      '/uploads/photo_own.jpg',
      'http://backend.test/uploads/photo_own.jpg',
    ]);
    expect(db.query.mock.calls[0][0]).toMatch(/request_attachments/);
  });

  test('resident denied for чужой/несвязанный upload', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ allowed: false }] });
    const allowed = await canUserAccessUpload({ uid: 'owner-1', role: 'owner' }, 'photo_other.jpg');
    expect(allowed).toBe(false);
  });
});
