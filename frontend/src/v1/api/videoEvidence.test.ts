import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  getMock,
  patchMock,
  postMock,
} = vi.hoisted(() => ({
  getMock: vi.fn(),
  patchMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock('./client', () => ({
  v1Client: {
    get: getMock,
    patch: patchMock,
    post: postMock,
  },
}));

import { videoEvidenceApi } from './videoEvidence';

describe('videoEvidenceApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes video provider reads and writes through canonical v1 endpoints', async () => {
    getMock.mockResolvedValue({});
    postMock.mockResolvedValue({});
    patchMock.mockResolvedValue({});

    await videoEvidenceApi.listProviders({ property_id: 'property-1', status: 'active' });
    await videoEvidenceApi.createProvider({
      property_id: 'property-1',
      provider: 'rtsp',
      display_name: 'Gate cameras',
      auth_ref: 'vault://video/gate',
      config_json: { retention_days: 7 },
    });
    await videoEvidenceApi.linkCameraProvider('camera/1', {
      property_id: 'property-1',
      video_provider_config_id: 'provider-1',
      provider_camera_id: 'cam-external-1',
    });

    expect(getMock).toHaveBeenCalledWith(
      '/video/providers?property_id=property-1&status=active',
      undefined,
    );
    expect(postMock).toHaveBeenCalledWith(
      '/video/providers',
      {
        property_id: 'property-1',
        provider: 'rtsp',
        display_name: 'Gate cameras',
        auth_ref: 'vault://video/gate',
        config_json: { retention_days: 7 },
      },
      undefined,
    );
    expect(patchMock).toHaveBeenCalledWith(
      '/video/cameras/camera%2F1/provider',
      {
        property_id: 'property-1',
        video_provider_config_id: 'provider-1',
        provider_camera_id: 'cam-external-1',
      },
      undefined,
    );
  });

  test('routes video evidence reads and writes through canonical v1 endpoints', async () => {
    getMock.mockResolvedValue({});
    postMock.mockResolvedValue({});

    await videoEvidenceApi.listCameras({
      property_id: 'property-1',
      access_point_id: 'point-1',
    });
    await videoEvidenceApi.create({
      property_id: 'property-1',
      access_incident_id: 'incident-1',
      camera_device_id: 'camera-1',
      title: 'Gate clip',
      clip_url: 'https://video.example.test/clip.mp4',
    });
    await videoEvidenceApi.getById('evidence/1', { property_id: 'property-1' });

    expect(getMock).toHaveBeenNthCalledWith(
      1,
      '/video-evidence/cameras?property_id=property-1&access_point_id=point-1',
      undefined,
    );
    expect(postMock).toHaveBeenCalledWith(
      '/video-evidence',
      {
        property_id: 'property-1',
        access_incident_id: 'incident-1',
        camera_device_id: 'camera-1',
        title: 'Gate clip',
        clip_url: 'https://video.example.test/clip.mp4',
      },
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      2,
      '/video-evidence/evidence%2F1?property_id=property-1',
      undefined,
    );
  });
});
