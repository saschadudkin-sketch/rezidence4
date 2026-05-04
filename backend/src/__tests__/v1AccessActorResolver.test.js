'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  resolveResidentIdByUid,
  resolveStaffIdByUid,
  resolveContractorUserIdByUid,
} = require('../v1/services/accessActorResolver');

describe('AccessActorResolver', () => {
  const UUID_A = '11111111-1111-4111-8111-111111111111';
  const UUID_B = '22222222-2222-4222-8222-222222222222';

  function mockDb(rows) {
    return { query: jest.fn().mockResolvedValue({ rows }) };
  }

  test('resolves legacy uid to resident UUID', async () => {
    const db = mockDb([{ id: UUID_A }]);
    await expect(resolveResidentIdByUid(db, 'legacy-resident-1')).resolves.toBe(UUID_A);
    expect(db.query.mock.calls[0][0]).toContain('FROM residents');
    expect(db.query.mock.calls[0][1]).toEqual(['legacy-resident-1']);
  });

  test('resolves legacy uid to staff UUID', async () => {
    const db = mockDb([{ id: UUID_A }]);
    await expect(resolveStaffIdByUid(db, 'legacy-staff-1')).resolves.toBe(UUID_A);
    expect(db.query.mock.calls[0][0]).toContain('FROM staff_users');
  });

  test('returns null for missing resident mapping', async () => {
    await expect(resolveResidentIdByUid(mockDb([]), 'missing')).resolves.toBeNull();
  });

  test('returns null for missing staff mapping', async () => {
    await expect(resolveStaffIdByUid(mockDb([]), 'missing')).resolves.toBeNull();
  });

  test('returns null for missing contractor mapping', async () => {
    await expect(resolveContractorUserIdByUid(mockDb([]), 'missing')).resolves.toBeNull();
  });

  test('detects resident ambiguity defensively', async () => {
    const db = mockDb([{ id: UUID_A }, { id: UUID_B }]);
    await expect(resolveResidentIdByUid(db, 'legacy-resident-1'))
      .rejects.toThrow(/ambiguous resident mapping/);
  });

  test('detects staff ambiguity defensively', async () => {
    const db = mockDb([{ id: UUID_A }, { id: UUID_B }]);
    await expect(resolveStaffIdByUid(db, 'legacy-staff-1'))
      .rejects.toThrow(/ambiguous staff mapping/);
  });

  test('detects contractor ambiguity defensively', async () => {
    const db = mockDb([{ id: UUID_A }, { id: UUID_B }]);
    await expect(resolveContractorUserIdByUid(db, 'legacy-contractor-1'))
      .rejects.toThrow(/ambiguous contractor mapping/);
  });

  test('contractor mapping ignores inactive and expired contractor users in SQL', async () => {
    const db = mockDb([{ id: UUID_A }]);
    await resolveContractorUserIdByUid(db, 'legacy-contractor-1');
    expect(db.query.mock.calls[0][0]).toContain('FROM contractor_users');
    expect(db.query.mock.calls[0][0]).toContain('is_active = true');
    expect(db.query.mock.calls[0][0]).toContain('access_expires_at');
  });
});

describe('AccessActorResolver route adoption', () => {
  const routeFiles = [
    'accessRequests.js',
    'passes.js',
    'vehicles.js',
    'visits.js',
    'accessIncidents.js',
  ];

  test.each(routeFiles)('%s uses AccessActorResolver for v1 actor IDs', (file) => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'v1', 'routes', file),
      'utf8',
    );
    expect(source).toContain("require('../services/accessActorResolver')");
  });

  test('accessRequests supports contractor creator mapping explicitly', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'v1', 'routes', 'accessRequests.js'),
      'utf8',
    );
    expect(source).toContain('resolveContractorUserIdByUid');
    expect(source).toContain("created_by_type = 'contractor'");
    expect(source).toContain('created_by_contractor_user_id = contractorUserId');
  });
});
