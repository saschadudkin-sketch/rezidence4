'use strict';

const {
  createVideoAdapter,
  getRegisteredVideoProviders,
} = require('../services/video');

const CAMERA = Object.freeze({
  id: '44444444-4444-4444-8444-444444444444',
  provider_config_id: '55555555-5555-4555-8555-555555555555',
  external_device_id: '101',
  access_point_id: '88888888-8888-4888-8888-888888888888',
});

describe('video provider adapters', () => {
  test('registers common VMS/NVR providers used in Russian deployments', () => {
    expect(getRegisteredVideoProviders()).toEqual([
      'axxon_next',
      'dahua_nvr',
      'devline_line',
      'generic_link',
      'hikvision_nvr',
      'macroscop',
      'trassir',
    ]);
  });

  test('TRASSIR adapter builds a timestamped screenshot reference without credentials', () => {
    const adapter = createVideoAdapter({
      id: '99999999-9999-4999-8999-999999999999',
      provider: 'trassir',
      display_name: 'TRASSIR',
      base_url: 'https://operator:secret@trassir.example:8080',
    });

    const evidence = adapter.buildEvidenceReference({
      camera: { ...CAMERA, external_device_id: 'HTwUsj8U' },
      incident: { id: '22222222-2222-4222-8222-222222222222' },
      occurredAt: '2026-05-10T10:00:00.000Z',
      windowBeforeSeconds: 10,
      windowAfterSeconds: 20,
    });

    expect(evidence.snapshot_url).toBe('https://trassir.example:8080/screenshot/HTwUsj8U?timestamp=20260510T100000');
    expect(evidence.snapshot_url).not.toContain('secret');
    expect(evidence.video_timestamp_from).toBe('2026-05-10T09:59:50.000Z');
    expect(evidence.video_provider_config_id).toBe('99999999-9999-4999-8999-999999999999');
    expect(evidence.metadata).toMatchObject({
      provider: 'trassir',
      camera_external_id: 'HTwUsj8U',
      no_biometrics: true,
    });
  });

  test('Hikvision and Dahua NVR adapters use their native snapshot endpoints', () => {
    const hikvision = createVideoAdapter({
      provider: 'hikvision_nvr',
      base_url: 'http://192.0.2.10',
    }).buildEvidenceReference({ camera: CAMERA, occurredAt: '2026-05-10T10:00:00.000Z' });
    const dahua = createVideoAdapter({
      provider: 'dahua_nvr',
      base_url: 'http://192.0.2.11',
    }).buildEvidenceReference({ camera: CAMERA, occurredAt: '2026-05-10T10:00:00.000Z' });

    expect(hikvision.snapshot_url).toBe('http://192.0.2.10/ISAPI/Streaming/channels/101/picture');
    expect(dahua.snapshot_url).toBe('http://192.0.2.11/cgi-bin/snapshot.cgi?channel=101');
  });

  test('generic adapter renders configured templates and strips secret query params', () => {
    const adapter = createVideoAdapter({
      provider: 'generic_link',
      base_url: 'https://vms.example',
      config_json: {
        snapshotUrlTemplate: '/snapshots/{cameraId}.jpg?token=abc&quality=80',
        clipUrlTemplate: '/archive/{cameraId}?start={startIso}&end={endIso}&authorization=Basic%20abc',
      },
    });

    const evidence = adapter.buildEvidenceReference({
      camera: CAMERA,
      occurredAt: '2026-05-10T10:00:00.000Z',
      windowBeforeSeconds: 30,
      windowAfterSeconds: 30,
    });

    expect(evidence.snapshot_url).toBe('https://vms.example/snapshots/101.jpg?quality=80');
    expect(evidence.clip_url).toBe('https://vms.example/archive/101?start=2026-05-10T09%3A59%3A30Z&end=2026-05-10T10%3A00%3A30Z');
    expect(evidence.clip_url).not.toContain('authorization');
    expect(evidence.evidence_type).toBe('clip');
  });

  test('Axxon, Macroscop and DevLine produce provider references for archive workflows', () => {
    const axxon = createVideoAdapter({ provider: 'axxon_next' })
      .buildEvidenceReference({ camera: CAMERA, occurredAt: '2026-05-10T10:00:00.000Z' });
    const macroscop = createVideoAdapter({ provider: 'macroscop' })
      .buildEvidenceReference({ camera: CAMERA, occurredAt: '2026-05-10T10:00:00.000Z' });
    const devline = createVideoAdapter({ provider: 'devline_line', base_url: 'http://line.example:9786' })
      .buildEvidenceReference({ camera: CAMERA, occurredAt: '2026-05-10T10:00:00.000Z' });

    expect(axxon.external_ref).toContain('axxon_next:export/archive/101/');
    expect(macroscop.external_ref).toContain('macroscop:archive_export:101:');
    expect(devline.clip_url).toContain('/cameras/101/streaming/main.mp4');
  });
});
