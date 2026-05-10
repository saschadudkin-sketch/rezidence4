'use strict';

const {
  createVideoProviderConfig,
  createVideoEvidenceReference,
  fetchAndAttachProviderEvidence,
  getVideoEvidenceReference,
  linkCameraVideoProvider,
  listAccessPointCameras,
  listVideoProviderConfigs,
} = require('../v1/services/videoEvidenceService');

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const INCIDENT_ID = '22222222-2222-4222-8222-222222222222';
const VISIT_LOG_ID = '33333333-3333-4333-8333-333333333333';
const CAMERA_ID = '44444444-4444-4444-8444-444444444444';
const PROVIDER_ID = '55555555-5555-4555-8555-555555555555';
const STAFF_ID = '66666666-6666-4666-8666-666666666666';
const EVIDENCE_ID = '77777777-7777-4777-8777-777777777777';
const VIDEO_PROVIDER_ID = '99999999-9999-4999-8999-999999999999';

function makeQueryable(handler) {
  return { query: jest.fn(handler) };
}

function evidenceRow(overrides = {}) {
  return {
    id: EVIDENCE_ID,
    property_id: PROPERTY_ID,
    access_incident_id: INCIDENT_ID,
    visit_log_id: VISIT_LOG_ID,
    camera_device_id: CAMERA_ID,
    provider_config_id: PROVIDER_ID,
    video_provider_config_id: VIDEO_PROVIDER_ID,
    evidence_type: 'clip',
    status: 'linked',
    clip_url: 'https://vms.example/clip/1',
    snapshot_url: 'https://vms.example/snapshot/1.jpg',
    sensitivity: 'restricted',
    biometric_identity_matching: false,
    created_by_staff_id: STAFF_ID,
    ...overrides,
  };
}

function videoProviderRow(overrides = {}) {
  return {
    id: VIDEO_PROVIDER_ID,
    property_id: PROPERTY_ID,
    provider: 'trassir',
    display_name: 'TRASSIR main',
    status: 'active',
    base_url: 'https://trassir.example:8080',
    auth_ref: 'vault://video/trassir-main',
    config_json: {},
    capabilities: ['snapshot', 'archive_export'],
    health_status: 'unknown',
    created_by: STAFF_ID,
    ...overrides,
  };
}

describe('VideoEvidenceService', () => {
  test('creates incident video evidence with camera/provider context and audit trail', async () => {
    const row = evidenceRow();
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM access_incidents')) {
        return Promise.resolve({ rows: [{ id: INCIDENT_ID, property_id: PROPERTY_ID, related_visit_log_id: VISIT_LOG_ID }] });
      }
      if (sql.includes('FROM visit_logs_v2')) {
        return Promise.resolve({ rows: [{ id: VISIT_LOG_ID, property_id: PROPERTY_ID, access_point_id: 'ap-1' }] });
      }
      if (sql.includes('FROM skud_hardware_devices')) {
        return Promise.resolve({ rows: [{ id: CAMERA_ID, property_id: PROPERTY_ID, provider_config_id: PROVIDER_ID, device_class: 'camera' }] });
      }
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: STAFF_ID }] });
      if (sql.includes('INSERT INTO video_evidence_references')) return Promise.resolve({ rows: [row] });
      if (sql.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await createVideoEvidenceReference(queryable, {
      propertyId: PROPERTY_ID,
      user: { uid: 'security-1', role: 'security' },
      ipAddress: '127.0.0.1',
      input: {
        access_incident_id: INCIDENT_ID,
        camera_device_id: CAMERA_ID,
        clip_url: 'https://vms.example/clip/1',
        snapshot_url: 'https://vms.example/snapshot/1.jpg',
        video_timestamp_from: '2026-05-10T10:00:00.000Z',
        video_timestamp_to: '2026-05-10T10:02:00.000Z',
        metadata: { provider: 'trassir' },
      },
    });

    expect(result.evidence).toBe(row);
    const insert = queryable.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO video_evidence_references'));
    expect(insert[1][0]).toBe(PROPERTY_ID);
    expect(insert[1][1]).toBe(INCIDENT_ID);
    expect(insert[1][2]).toBe(VISIT_LOG_ID);
    expect(insert[1][4]).toBe(CAMERA_ID);
    expect(insert[1][5]).toBe(PROVIDER_ID);
    expect(insert[1][6]).toBe(null);
    expect(insert[1][7]).toBe('clip');
    expect(insert[1][19]).toBe(STAFF_ID);

    const audit = queryable.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO property_audit_log'));
    expect(audit[1][4]).toBe('video.evidence.linked');
    expect(audit[1][5]).toBe(EVIDENCE_ID);
    expect(JSON.parse(audit[1][6])).toMatchObject({
      access_incident_id: INCIDENT_ID,
      camera_device_id: CAMERA_ID,
      no_biometrics: true,
    });
  });

  test('rejects biometric identity matching metadata before writing evidence', async () => {
    const queryable = makeQueryable(() => Promise.resolve({ rows: [] }));

    await expect(createVideoEvidenceReference(queryable, {
      propertyId: PROPERTY_ID,
      user: { uid: 'security-1', role: 'security' },
      input: {
        access_incident_id: INCIDENT_ID,
        clip_url: 'https://vms.example/clip/1',
        metadata: { face_recognition: true },
      },
    })).rejects.toMatchObject({
      status: 400,
      message: 'Video evidence cannot enable biometric identity matching',
    });
    expect(queryable.query).not.toHaveBeenCalled();
  });

  test('lists active cameras mapped to an access point through hardware devices', async () => {
    const queryable = makeQueryable(() => Promise.resolve({ rows: [{ id: CAMERA_ID, device_class: 'camera' }] }));

    const rows = await listAccessPointCameras(queryable, {
      propertyId: PROPERTY_ID,
      accessPointId: '88888888-8888-4888-8888-888888888888',
    });

    expect(rows).toEqual([{ id: CAMERA_ID, device_class: 'camera' }]);
    const [sql, params] = queryable.query.mock.calls[0];
    expect(sql).toContain("d.device_class = 'camera'");
    expect(sql).toContain('d.access_point_id = $2');
    expect(params[0]).toBe(PROPERTY_ID);
  });

  test('creates and lists video provider configs without inline secrets', async () => {
    const providerRow = videoProviderRow();
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: STAFF_ID }] });
      if (sql.includes('INSERT INTO video_provider_configs')) return Promise.resolve({ rows: [providerRow] });
      if (sql.includes('FROM video_provider_configs')) return Promise.resolve({ rows: [providerRow] });
      if (sql.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const created = await createVideoProviderConfig(queryable, {
      propertyId: PROPERTY_ID,
      user: { uid: 'admin-1', role: 'property_admin' },
      input: {
        provider: 'trassir',
        display_name: 'TRASSIR main',
        base_url: 'https://operator:secret@trassir.example:8080',
        auth_ref: 'vault://video/trassir-main',
      },
    });
    const listed = await listVideoProviderConfigs(queryable, { propertyId: PROPERTY_ID });

    expect(created).toBe(providerRow);
    expect(listed).toEqual([providerRow]);
    const insert = queryable.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO video_provider_configs'));
    expect(insert[1][4]).toBe('https://trassir.example:8080');
    expect(insert[1][7]).toContain('snapshot');
  });

  test('rejects video provider config inline secrets', async () => {
    const queryable = makeQueryable(() => Promise.resolve({ rows: [] }));

    await expect(createVideoProviderConfig(queryable, {
      propertyId: PROPERTY_ID,
      user: { uid: 'admin-1', role: 'property_admin' },
      input: {
        provider: 'generic_link',
        display_name: 'Generic',
        config: { token: 'secret' },
      },
    })).rejects.toMatchObject({
      status: 400,
      message: 'config_json.token must use auth_ref, not inline secrets',
    });
    expect(queryable.query).not.toHaveBeenCalled();
  });

  test('links a camera to a video provider and stores provider camera metadata', async () => {
    const providerRow = videoProviderRow({ provider: 'devline_line' });
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM skud_hardware_devices') && !sql.includes('WITH updated')) {
        return Promise.resolve({
          rows: [{
            id: CAMERA_ID,
            property_id: PROPERTY_ID,
            provider_config_id: PROVIDER_ID,
            device_class: 'camera',
            metadata: {},
          }],
        });
      }
      if (sql.includes('FROM video_provider_configs')) return Promise.resolve({ rows: [providerRow] });
      if (sql.includes('WITH updated')) {
        return Promise.resolve({ rows: [{ id: CAMERA_ID, video_provider_config_id: VIDEO_PROVIDER_ID }] });
      }
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: STAFF_ID }] });
      if (sql.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await linkCameraVideoProvider(queryable, {
      propertyId: PROPERTY_ID,
      cameraDeviceId: CAMERA_ID,
      user: { uid: 'admin-1', role: 'property_admin' },
      input: {
        video_provider_config_id: VIDEO_PROVIDER_ID,
        camera_external_id: '6',
        stream: 'main',
      },
    });

    expect(result.camera.video_provider_config_id).toBe(VIDEO_PROVIDER_ID);
    const update = queryable.query.mock.calls.find(([sql]) => sql.includes('WITH updated'));
    const metadata = JSON.parse(update[1][3]);
    expect(metadata.video).toMatchObject({
      provider: 'devline_line',
      video_provider_config_id: VIDEO_PROVIDER_ID,
      external_camera_id: '6',
      stream: 'main',
    });
  });

  test('fetches provider evidence for an incident through the mapped camera', async () => {
    const row = evidenceRow({
      video_provider_config_id: VIDEO_PROVIDER_ID,
      snapshot_url: 'https://trassir.example:8080/screenshot/HTwUsj8U?timestamp=20260510T100000',
    });
    const providerRow = videoProviderRow();
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM access_incidents')) {
        return Promise.resolve({ rows: [{ id: INCIDENT_ID, property_id: PROPERTY_ID, related_visit_log_id: VISIT_LOG_ID, created_at: '2026-05-10T10:00:00.000Z' }] });
      }
      if (sql.includes('FROM visit_logs_v2')) {
        return Promise.resolve({ rows: [{ id: VISIT_LOG_ID, property_id: PROPERTY_ID, access_point_id: '88888888-8888-4888-8888-888888888888', occurred_at: '2026-05-10T10:00:00.000Z' }] });
      }
      if (sql.includes('FROM skud_hardware_devices')) {
        return Promise.resolve({
          rows: [{
            id: CAMERA_ID,
            property_id: PROPERTY_ID,
            provider_config_id: PROVIDER_ID,
            video_provider_config_id: VIDEO_PROVIDER_ID,
            access_point_id: '88888888-8888-4888-8888-888888888888',
            device_class: 'camera',
            external_device_id: 'HTwUsj8U',
            metadata: {},
          }],
        });
      }
      if (sql.includes('FROM video_provider_configs')) return Promise.resolve({ rows: [providerRow] });
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: STAFF_ID }] });
      if (sql.includes('INSERT INTO video_evidence_references')) return Promise.resolve({ rows: [row] });
      if (sql.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await fetchAndAttachProviderEvidence(queryable, {
      propertyId: PROPERTY_ID,
      incidentId: INCIDENT_ID,
      user: { uid: 'security-1', role: 'security' },
      input: { window_before_seconds: 10, window_after_seconds: 20 },
    });

    expect(result.evidence).toBe(row);
    const insert = queryable.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO video_evidence_references'));
    expect(insert[1][6]).toBe(VIDEO_PROVIDER_ID);
    expect(insert[1][12]).toBe('https://trassir.example:8080/screenshot/HTwUsj8U?timestamp=20260510T100000');
    expect(JSON.parse(insert[1][18])).toMatchObject({
      provider: 'trassir',
      generated_by: 'video_provider_fetch',
      no_biometrics: true,
    });
  });

  test('records sensitive view audit when evidence is opened', async () => {
    const row = evidenceRow();
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM video_evidence_references')) return Promise.resolve({ rows: [row] });
      if (sql.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(getVideoEvidenceReference(queryable, {
      propertyId: PROPERTY_ID,
      evidenceId: EVIDENCE_ID,
      user: { uid: 'admin-1', role: 'property_admin' },
    })).resolves.toBe(row);

    const audit = queryable.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO property_audit_log'));
    expect(audit[1][4]).toBe('video.evidence.viewed');
    expect(audit[1][5]).toBe(EVIDENCE_ID);
  });
});
