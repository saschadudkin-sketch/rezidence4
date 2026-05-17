import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ReactElement } from 'react';
import type { UserMe } from '../api/types';

const {
  listErpProvidersMock,
  createErpProviderMock,
  previewImportMock,
  applyImportMock,
  exportDatasetMock,
  getSyncJobMock,
  listHardwareDevicesMock,
  updateHardwareBoundaryMock,
  manualControlMock,
  listManualControlEventsMock,
  recordFieldRolloutEvidenceMock,
  syncPassMock,
  listWebhooksMock,
  createWebhookMock,
  updateWebhookMock,
  deactivateWebhookMock,
  testDeliveryMock,
  listDeliveriesMock,
  listVideoProvidersMock,
  createVideoProviderMock,
  linkCameraProviderMock,
  listCamerasMock,
  createVideoEvidenceMock,
  getVideoEvidenceByIdMock,
} = vi.hoisted(() => ({
  listErpProvidersMock: vi.fn(),
  createErpProviderMock: vi.fn(),
  previewImportMock: vi.fn(),
  applyImportMock: vi.fn(),
  exportDatasetMock: vi.fn(),
  getSyncJobMock: vi.fn(),
  listHardwareDevicesMock: vi.fn(),
  updateHardwareBoundaryMock: vi.fn(),
  manualControlMock: vi.fn(),
  listManualControlEventsMock: vi.fn(),
  recordFieldRolloutEvidenceMock: vi.fn(),
  syncPassMock: vi.fn(),
  listWebhooksMock: vi.fn(),
  createWebhookMock: vi.fn(),
  updateWebhookMock: vi.fn(),
  deactivateWebhookMock: vi.fn(),
  testDeliveryMock: vi.fn(),
  listDeliveriesMock: vi.fn(),
  listVideoProvidersMock: vi.fn(),
  createVideoProviderMock: vi.fn(),
  linkCameraProviderMock: vi.fn(),
  listCamerasMock: vi.fn(),
  createVideoEvidenceMock: vi.fn(),
  getVideoEvidenceByIdMock: vi.fn(),
}));

vi.mock('../api', () => ({
  api: {
    erpExchange: {
      listProviders: listErpProvidersMock,
      createProvider: createErpProviderMock,
      previewImport: previewImportMock,
      applyImport: applyImportMock,
      exportDataset: exportDatasetMock,
      getSyncJob: getSyncJobMock,
    },
    skudIntegrations: {
      listHardwareDevices: listHardwareDevicesMock,
      updateHardwareBoundary: updateHardwareBoundaryMock,
      manualControl: manualControlMock,
      listManualControlEvents: listManualControlEventsMock,
      recordFieldRolloutEvidence: recordFieldRolloutEvidenceMock,
      syncPass: syncPassMock,
    },
    webhooks: {
      list: listWebhooksMock,
      create: createWebhookMock,
      update: updateWebhookMock,
      deactivate: deactivateWebhookMock,
      testDelivery: testDeliveryMock,
      listDeliveries: listDeliveriesMock,
    },
    videoEvidence: {
      listProviders: listVideoProvidersMock,
      createProvider: createVideoProviderMock,
      linkCameraProvider: linkCameraProviderMock,
      listCameras: listCamerasMock,
      create: createVideoEvidenceMock,
      getById: getVideoEvidenceByIdMock,
    },
  },
  isV1ApiError: () => false,
}));

import { V1SessionProvider } from '../store';
import { IntegrationOperationsPage } from './IntegrationOperationsPage';

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';

function makeUser(overrides: Partial<UserMe> = {}): UserMe {
  return {
    uid: 'admin-1',
    role: 'admin',
    name: 'Integration Admin',
    phone: null,
    apartment: null,
    avatar: null,
    property_slug: 'zamoskvorechye',
    property_id: PROPERTY_ID,
    property_type: 'residential_complex',
    ...overrides,
  };
}

function renderWithProviders(node: ReactElement, user: UserMe = makeUser()) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <V1SessionProvider initialUser={user}>{node}</V1SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function setupMocks() {
  listErpProvidersMock.mockResolvedValue({
    providers: [{
      id: 'erp-1',
      display_name: '1C Main',
      status: 'active',
      provider: 'one_c_zhkh',
    }],
  });
  createErpProviderMock.mockResolvedValue({ provider: { id: 'erp-2' } });
  previewImportMock.mockResolvedValue({ sync_job: { id: 'job-preview' }, summary: {}, records: [] });
  applyImportMock.mockResolvedValue({ sync_job: { id: 'job-apply' }, summary: {}, records: [] });
  exportDatasetMock.mockResolvedValue({ sync_job: { id: 'job-export' }, summary: {}, records: [] });
  getSyncJobMock.mockResolvedValue({ sync_job: { id: 'job-1', status: 'completed' }, records: [] });

  listHardwareDevicesMock.mockResolvedValue({
    hardware_devices: [{ id: 'device-1', name: 'Gate device', status: 'normal' }],
  });
  updateHardwareBoundaryMock.mockResolvedValue({ ok: true });
  manualControlMock.mockResolvedValue({ ok: true });
  listManualControlEventsMock.mockResolvedValue({
    manual_control_events: [{ id: 'manual-1', action: 'manual_open', status: 'applied' }],
  });
  recordFieldRolloutEvidenceMock.mockResolvedValue({ evidence: { id: 'evidence-skud-1' } });
  syncPassMock.mockResolvedValue({ pass_id: 'pass-1', integration_event: { id: 'event-1' } });

  listWebhooksMock.mockResolvedValue({
    webhooks: [{
      id: 'webhook-1',
      name: 'ERP bridge',
      url: 'https://erp.example/webhook',
      events: ['request.created'],
      is_active: true,
    }],
  });
  createWebhookMock.mockResolvedValue({ webhook: { id: 'webhook-2' } });
  updateWebhookMock.mockResolvedValue({ webhook: { id: 'webhook-1' } });
  deactivateWebhookMock.mockResolvedValue({ ok: true });
  testDeliveryMock.mockResolvedValue({ deliveryId: 'delivery-1' });
  listDeliveriesMock.mockResolvedValue({
    deliveries: [{ id: 'delivery-1', event_type: 'request.created', status: 'success' }],
  });

  listVideoProvidersMock.mockResolvedValue({
    providers: [{ id: 'video-1', display_name: 'Gate cameras', status: 'active' }],
  });
  createVideoProviderMock.mockResolvedValue({ provider: { id: 'video-2' } });
  linkCameraProviderMock.mockResolvedValue({ camera: { id: 'camera-1' }, video_provider_config: { id: 'video-1' } });
  listCamerasMock.mockResolvedValue({
    cameras: [{ id: 'camera-1', name: 'Gate camera', status: 'active' }],
  });
  createVideoEvidenceMock.mockResolvedValue({ evidence: { id: 'video-evidence-2' } });
  getVideoEvidenceByIdMock.mockResolvedValue({ evidence: { id: 'video-evidence-1', status: 'linked' } });
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('IntegrationOperationsPage', () => {
  test('sends ERP, SKUD, webhook and video operations with backend v1 payloads', async () => {
    setupMocks();

    renderWithProviders(<IntegrationOperationsPage />);

    expect(await screen.findByRole('heading', { name: /интеграции/i })).toBeInTheDocument();
    expect(await screen.findByText('1C Main')).toBeInTheDocument();
    expect(await screen.findByText('Gate device')).toBeInTheDocument();
    expect(await screen.findByText('ERP bridge')).toBeInTheDocument();
    expect(await screen.findByText('Gate cameras')).toBeInTheDocument();

    expect(listErpProvidersMock).toHaveBeenCalledWith(
      { property_id: PROPERTY_ID, status: undefined },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(listHardwareDevicesMock).toHaveBeenCalledWith(
      { property_id: PROPERTY_ID, provider_config_id: undefined, access_point_id: undefined },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(listWebhooksMock).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(listVideoProvidersMock).toHaveBeenCalledWith(
      { property_id: PROPERTY_ID, status: undefined },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(listCamerasMock).toHaveBeenCalledWith(
      { property_id: PROPERTY_ID, access_point_id: undefined },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    fireEvent.change(screen.getByPlaceholderText('1C ZHKH'), { target: { value: '1C ZHKH' } });
    fireEvent.change(screen.getByLabelText('Provider ID'), { target: { value: 'erp-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать ERP provider' }));
    await waitFor(() => {
      expect(createErpProviderMock).toHaveBeenCalledWith({
        property_id: PROPERTY_ID,
        provider: 'one_c_zhkh',
        display_name: '1C ZHKH',
        status: 'active',
        sync_mode: 'hybrid',
        base_url: null,
        auth_ref: null,
        capabilities: ['import', 'export'],
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply import' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export dataset' }));
    await waitFor(() => {
      expect(previewImportMock).toHaveBeenCalledWith('erp-1', {
        property_id: PROPERTY_ID,
        dataset: 'resident_registry',
        source: 'manual',
        rows: [{ external_id: 'r-1', full_name: 'Ivan Petrov' }],
      });
      expect(applyImportMock).toHaveBeenCalledWith('erp-1', {
        property_id: PROPERTY_ID,
        dataset: 'resident_registry',
        source: 'manual',
        rows: [{ external_id: 'r-1', full_name: 'Ivan Petrov' }],
      });
      expect(exportDatasetMock).toHaveBeenCalledWith('erp-1', {
        property_id: PROPERTY_ID,
        dataset: 'request_summary',
        source: 'manual',
        limit: 100,
      });
    });

    fireEvent.change(screen.getByPlaceholderText('job-uuid'), { target: { value: 'job-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить sync job' }));
    await waitFor(() => {
      expect(getSyncJobMock).toHaveBeenCalledWith(
        'job-1',
        { property_id: PROPERTY_ID },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    fireEvent.change(screen.getByPlaceholderText('skud-provider-uuid'), { target: { value: 'provider-1' } });
    fireEvent.change(screen.getByPlaceholderText('device-uuid'), { target: { value: 'device-1' } });
    fireEvent.change(screen.getByPlaceholderText('Проверка КПП'), { target: { value: 'Проверка КПП' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить boundary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Manual control' }));
    fireEvent.click(screen.getByRole('button', { name: 'История manual' }));
    await waitFor(() => {
      expect(updateHardwareBoundaryMock).toHaveBeenCalledWith('device-1', {
        property_id: PROPERTY_ID,
        manual_control_policy: 'guard_allowed',
        fail_safe_mode: 'manual_guard',
        maintenance_status: 'normal',
        manual_action_requires_reason: true,
      });
      expect(manualControlMock).toHaveBeenCalledWith('device-1', {
        property_id: PROPERTY_ID,
        action: 'manual_open',
        reason: 'Проверка КПП',
        decision_source: 'admin',
        metadata: { source: 'integration_operations_ui' },
      });
      expect(listManualControlEventsMock).toHaveBeenCalledWith(
        'device-1',
        { property_id: PROPERTY_ID, limit: 20 },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    fireEvent.change(screen.getByPlaceholderText('Полевой тест пройден'), { target: { value: 'Полевой тест пройден' } });
    fireEvent.change(screen.getByPlaceholderText('pass-uuid'), { target: { value: 'pass-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Записать evidence' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sync pass' }));
    await waitFor(() => {
      expect(recordFieldRolloutEvidenceMock).toHaveBeenCalledWith({
        property_id: PROPERTY_ID,
        provider_config_id: 'provider-1',
        hardware_device_id: 'device-1',
        rollout_stage: 'pilot',
        evidence_type: 'field_drill',
        status: 'passed',
        summary: 'Полевой тест пройден',
        metrics: { latency_ms: 120 },
      });
      expect(syncPassMock).toHaveBeenCalledWith('provider-1', {
        property_id: PROPERTY_ID,
        pass_id: 'pass-1',
        action: 'provision',
      });
    });

    fireEvent.change(screen.getByPlaceholderText('webhook-uuid'), { target: { value: 'webhook-1' } });
    fireEvent.change(screen.getByPlaceholderText('ERP bridge'), { target: { value: 'ERP bridge updated' } });
    fireEvent.change(screen.getByPlaceholderText('https://erp.example/webhook'), { target: { value: 'https://erp.example/webhook' } });
    fireEvent.change(screen.getByPlaceholderText('secret-ref'), { target: { value: 'secret-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать webhook' }));
    fireEvent.click(screen.getByRole('button', { name: 'Обновить webhook' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test delivery' }));
    fireEvent.click(screen.getByRole('button', { name: 'История delivery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отключить webhook' }));
    await waitFor(() => {
      expect(createWebhookMock).toHaveBeenCalledWith({
        name: 'ERP bridge updated',
        url: 'https://erp.example/webhook',
        secret: 'secret-1',
        events: ['request.created', 'access.incident.created'],
      });
      expect(updateWebhookMock).toHaveBeenCalledWith('webhook-1', {
        name: 'ERP bridge updated',
        url: 'https://erp.example/webhook',
        secret: 'secret-1',
        events: ['request.created', 'access.incident.created'],
        is_active: true,
      });
      expect(testDeliveryMock).toHaveBeenCalledWith('webhook-1');
      expect(listDeliveriesMock).toHaveBeenCalledWith(
        'webhook-1',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(deactivateWebhookMock).toHaveBeenCalledWith('webhook-1');
    });

    fireEvent.change(screen.getByPlaceholderText('Gate cameras'), { target: { value: 'Gate cameras new' } });
    fireEvent.change(screen.getByPlaceholderText('camera-uuid'), { target: { value: 'camera-1' } });
    fireEvent.change(screen.getByPlaceholderText('video-provider-uuid'), { target: { value: 'video-1' } });
    fireEvent.change(screen.getByPlaceholderText('cam-1'), { target: { value: 'cam-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать video provider' }));
    fireEvent.click(screen.getByRole('button', { name: 'Link camera' }));
    await waitFor(() => {
      expect(createVideoProviderMock).toHaveBeenCalledWith({
        property_id: PROPERTY_ID,
        provider: 'rtsp',
        display_name: 'Gate cameras new',
        status: 'active',
        base_url: null,
        auth_ref: null,
        capabilities: ['clips', 'snapshots'],
        config_json: { source: 'integration_operations_ui' },
      });
      expect(linkCameraProviderMock).toHaveBeenCalledWith('camera-1', {
        property_id: PROPERTY_ID,
        video_provider_config_id: 'video-1',
        provider_camera_id: 'cam-1',
      });
    });

    fireEvent.change(screen.getByPlaceholderText('incident-uuid'), { target: { value: 'incident-1' } });
    fireEvent.change(screen.getByPlaceholderText('Gate clip'), { target: { value: 'Gate clip' } });
    fireEvent.change(screen.getByPlaceholderText('https://video.example/clip.mp4'), { target: { value: 'https://video.example/clip.mp4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать evidence' }));
    await waitFor(() => {
      expect(createVideoEvidenceMock).toHaveBeenCalledWith({
        property_id: PROPERTY_ID,
        access_incident_id: 'incident-1',
        camera_device_id: 'camera-1',
        video_provider_config_id: 'video-1',
        evidence_type: 'clip',
        source: 'manual',
        status: 'linked',
        title: 'Gate clip',
        clip_url: 'https://video.example/clip.mp4',
        sensitivity: 'internal',
        metadata: { source: 'integration_operations_ui' },
      });
    });

    fireEvent.change(screen.getByPlaceholderText('evidence-uuid'), { target: { value: 'video-evidence-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить evidence' }));
    await waitFor(() => {
      expect(getVideoEvidenceByIdMock).toHaveBeenCalledWith(
        'video-evidence-1',
        { property_id: PROPERTY_ID },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  }, 10000);

  test('property_id=null shows warning and skips integration requests', () => {
    renderWithProviders(<IntegrationOperationsPage />, makeUser({ property_id: null }));

    expect(screen.getByText(/администратор не привязан к объекту/i)).toBeInTheDocument();
    expect(listErpProvidersMock).not.toHaveBeenCalled();
    expect(listHardwareDevicesMock).not.toHaveBeenCalled();
    expect(listWebhooksMock).not.toHaveBeenCalled();
    expect(listVideoProvidersMock).not.toHaveBeenCalled();
  });

  test('blocks required integration ids before sending mutations', async () => {
    setupMocks();

    renderWithProviders(<IntegrationOperationsPage />);

    expect(await screen.findByRole('heading', { name: /интеграции/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));

    expect(await screen.findByText('Укажите provider ID')).toBeInTheDocument();
    expect(previewImportMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Manual control' }));

    expect(await screen.findByText('Укажите hardware device ID')).toBeInTheDocument();
    expect(manualControlMock).not.toHaveBeenCalled();
  });
});
