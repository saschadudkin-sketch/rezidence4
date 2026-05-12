'use strict';

const {
  buildDataSubjectExport,
  completeDataSubjectRequest,
  createDataSubjectRequest,
  getPrivacyReadinessSummary,
  recordComplianceEvidence,
} = require('../services/privacyComplianceService');

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const RESIDENT_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

describe('privacyComplianceService', () => {
  test('creates auditable DSAR requests with normalized payload', async () => {
    const queryable = {
      query: jest.fn().mockResolvedValue({
        rows: [{
          id: REQUEST_ID,
          property_id: PROPERTY_ID,
          request_type: 'export',
          status: 'pending',
          subject_uid: 'u1',
          subject_resident_id: null,
          submitted_by_uid: 'u1',
          submitted_by_role: 'owner',
          request_payload: { details: 'need copy', source: 'resident_ui' },
          due_at: '2026-06-01T00:00:00.000Z',
          export_payload: {},
          retention_decision: {},
        }],
      }),
    };

    const result = await createDataSubjectRequest({
      queryable,
      user: { uid: 'u1', role: 'owner' },
      propertyId: PROPERTY_ID,
      input: { type: 'export', details: 'need copy' },
    });

    expect(result.request_type).toBe('export');
    expect(result.request_payload.details).toBe('need copy');
    expect(queryable.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO privacy_data_subject_requests'),
      expect.arrayContaining([PROPERTY_ID, 'export', 'u1']),
    );
  });

  test('completes DSAR requests with export and retention decisions', async () => {
    const queryable = {
      query: jest.fn().mockResolvedValue({
        rows: [{
          id: REQUEST_ID,
          property_id: PROPERTY_ID,
          request_type: 'delete',
          status: 'completed',
          subject_uid: 'u1',
          request_payload: {},
          processed_by_uid: 'admin-1',
          processed_at: '2026-05-13T12:00:00.000Z',
          resolution_note: 'anonymized',
          export_payload: { residents: [] },
          retention_decision: { deleted: true },
        }],
      }),
    };

    const result = await completeDataSubjectRequest({
      queryable,
      requestId: REQUEST_ID,
      user: { uid: 'admin-1', role: 'admin' },
      input: {
        status: 'completed',
        resolution_note: 'anonymized',
        retention_decision: { deleted: true },
      },
    });

    expect(result.status).toBe('completed');
    expect(result.retention_decision.deleted).toBe(true);
    expect(queryable.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE privacy_data_subject_requests'),
      expect.arrayContaining([REQUEST_ID, 'completed', 'admin-1']),
    );
  });

  test('builds export snapshots without biometric identity scope', async () => {
    const queryable = {
      query: jest.fn((sql) => {
        if (sql.includes('FROM users')) {
          return Promise.resolve({ rows: [{ uid: 'u1', name: 'Resident', phone: '+7900' }] });
        }
        if (sql.includes('FROM residents')) {
          return Promise.resolve({ rows: [{ id: RESIDENT_ID, external_uid: 'u1', property_id: PROPERTY_ID }] });
        }
        if (sql.includes('FROM resident_consent_history')) {
          return Promise.resolve({ rows: [{ resident_id: RESIDENT_ID, evidence: '{"route":"consent"}' }] });
        }
        if (sql.includes('FROM resident_lifecycle_events')) {
          return Promise.resolve({ rows: [{ resident_id: RESIDENT_ID, metadata: '{"event":"created"}' }] });
        }
        if (sql.includes('FROM privacy_data_subject_requests')) {
          return Promise.resolve({ rows: [{ id: REQUEST_ID, request_payload: '{}', retention_decision: '{}' }] });
        }
        return Promise.resolve({ rows: [] });
      }),
    };

    const result = await buildDataSubjectExport({
      queryable,
      user: { uid: 'u1' },
      propertyId: PROPERTY_ID,
    });

    expect(result.no_biometrics_release_guard).toBe(true);
    expect(result.residents).toHaveLength(1);
    expect(result.consent_history[0].evidence.route).toBe('consent');
  });

  test('records compliance evidence and summarizes DH-56 controls', async () => {
    const evidenceRow = {
      id: 'evidence-1',
      property_id: PROPERTY_ID,
      evidence_type: 'no_biometrics_release_guard',
      status: 'reviewed',
      summary: 'release guard checked',
      evidence: { checked: true },
      recorded_by_uid: 'admin-1',
      reviewed_at: '2026-05-13T12:00:00.000Z',
    };
    const queryable = {
      query: jest.fn((sql) => {
        if (sql.includes('INSERT INTO privacy_compliance_evidence')) {
          return Promise.resolve({ rows: [evidenceRow] });
        }
        if (sql.includes('FROM privacy_data_subject_requests')) {
          return Promise.resolve({ rows: [{ request_type: 'export', status: 'completed', count: 1 }] });
        }
        if (sql.includes('FROM privacy_compliance_evidence')) {
          return Promise.resolve({ rows: [evidenceRow] });
        }
        return Promise.resolve({ rows: [] });
      }),
    };

    const evidence = await recordComplianceEvidence({
      queryable,
      user: { uid: 'admin-1' },
      propertyId: PROPERTY_ID,
      input: {
        evidence_type: 'no_biometrics_release_guard',
        status: 'reviewed',
        summary: 'release guard checked',
        evidence: { checked: true },
      },
    });
    const summary = await getPrivacyReadinessSummary({ queryable, propertyId: PROPERTY_ID });

    expect(evidence.evidence_type).toBe('no_biometrics_release_guard');
    expect(summary.controls.no_biometrics_release_guard).toBe(true);
  });
});
