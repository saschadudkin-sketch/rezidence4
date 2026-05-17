import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { UserMe } from '../api';
import { V1SessionProvider } from '../store';

const {
  getReadinessMock,
  getConsentMock,
  acceptConsentMock,
  listDataSubjectRequestsMock,
  createDataSubjectRequestMock,
  completeDataSubjectRequestMock,
  getDataSubjectExportMock,
  listComplianceEvidenceMock,
  createComplianceEvidenceMock,
  deleteAccountMock,
} = vi.hoisted(() => ({
  getReadinessMock: vi.fn(),
  getConsentMock: vi.fn(),
  acceptConsentMock: vi.fn(),
  listDataSubjectRequestsMock: vi.fn(),
  createDataSubjectRequestMock: vi.fn(),
  completeDataSubjectRequestMock: vi.fn(),
  getDataSubjectExportMock: vi.fn(),
  listComplianceEvidenceMock: vi.fn(),
  createComplianceEvidenceMock: vi.fn(),
  deleteAccountMock: vi.fn(),
}));

vi.mock('../api', () => ({
  api: {
    privacyCompliance: {
      getReadiness: getReadinessMock,
      getConsent: getConsentMock,
      acceptConsent: acceptConsentMock,
      listDataSubjectRequests: listDataSubjectRequestsMock,
      createDataSubjectRequest: createDataSubjectRequestMock,
      completeDataSubjectRequest: completeDataSubjectRequestMock,
      getDataSubjectExport: getDataSubjectExportMock,
      listComplianceEvidence: listComplianceEvidenceMock,
      createComplianceEvidence: createComplianceEvidenceMock,
      deleteAccount: deleteAccountMock,
    },
  },
  isV1ApiError: () => false,
}));

import { PrivacyCompliancePage } from './PrivacyCompliancePage';

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';

function makeUser(overrides: Partial<UserMe> = {}): UserMe {
  return {
    uid: 'admin-1',
    role: 'admin',
    name: 'Privacy Admin',
    phone: null,
    apartment: null,
    avatar: null,
    property_slug: 'zamoskvorechye',
    property_id: PROPERTY_ID,
    property_type: 'residential_complex',
    ...overrides,
  };
}

function renderPage(user = makeUser()) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <V1SessionProvider initialUser={user}>
          <PrivacyCompliancePage />
        </V1SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('PrivacyCompliancePage', () => {
  test('renders compliance data and sends privacy workflow payloads', async () => {
    getReadinessMock.mockResolvedValue({ readiness: { status: 'ready' } });
    getConsentMock.mockResolvedValue({
      currentVersion: '2026-05-01',
      acceptedVersion: null,
      acceptedAt: null,
      needsAcceptance: true,
    });
    listDataSubjectRequestsMock.mockResolvedValue({
      requests: [{
        id: 'dsar-1',
        request_type: 'export',
        status: 'pending',
        reason: 'resident request',
        created_at: '2026-05-17T00:00:00.000Z',
      }],
    });
    listComplianceEvidenceMock.mockResolvedValue({
      evidence: [{
        id: 'evidence-1',
        evidence_type: 'dsar_workflow',
        status: 'ready',
        summary: 'DSAR workflow evidence',
        created_at: '2026-05-17T00:00:00.000Z',
      }],
    });
    acceptConsentMock.mockResolvedValue({ ok: true, version: '2026-05-17', acceptedAt: '2026-05-17T00:00:00.000Z' });
    createDataSubjectRequestMock.mockResolvedValue({ request: { id: 'dsar-2' } });
    completeDataSubjectRequestMock.mockResolvedValue({ request: { id: 'dsar-1', status: 'completed' } });
    getDataSubjectExportMock.mockResolvedValue({ export: { resident: { id: 'resident-1' } } });
    createComplianceEvidenceMock.mockResolvedValue({ evidence: { id: 'evidence-2' } });
    deleteAccountMock.mockResolvedValue({ ok: true, auditId: 'audit-1' });

    renderPage();

    expect(await screen.findByRole('heading', { name: /privacy compliance/i })).toBeInTheDocument();
    expect(await screen.findByText('DSAR workflow evidence')).toBeInTheDocument();
    expect(getReadinessMock).toHaveBeenCalledWith(
      { property_id: PROPERTY_ID },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(listDataSubjectRequestsMock).toHaveBeenCalledWith(
      { property_id: PROPERTY_ID, status: undefined, request_type: undefined, limit: 25 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(listComplianceEvidenceMock).toHaveBeenCalledWith(
      { property_id: PROPERTY_ID, status: undefined, evidence_type: undefined, limit: 25 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    fireEvent.change(screen.getByPlaceholderText('2026-05-17'), {
      target: { value: '2026-05-17' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Зафиксировать consent' }));
    await waitFor(() => {
      expect(acceptConsentMock).toHaveBeenCalledWith({ version: '2026-05-17' });
    });

    fireEvent.change(screen.getByPlaceholderText('user-uid'), {
      target: { value: 'user-2' },
    });
    fireEvent.change(screen.getAllByPlaceholderText('resident-uuid')[0], {
      target: { value: 'resident-1' },
    });
    fireEvent.change(screen.getByPlaceholderText('Запрос субъекта данных'), {
      target: { value: 'Нужен экспорт' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Создать DSAR' }));
    await waitFor(() => {
      expect(createDataSubjectRequestMock).toHaveBeenCalledWith({
        property_id: PROPERTY_ID,
        request_type: 'export',
        subject_uid: 'user-2',
        subject_resident_id: 'resident-1',
        reason: 'Нужен экспорт',
        metadata: { source: 'privacy_compliance_ui' },
      });
    });

    fireEvent.change(screen.getByPlaceholderText('request-id'), {
      target: { value: 'dsar-1' },
    });
    fireEvent.change(screen.getByPlaceholderText('completed by operator'), {
      target: { value: 'done' },
    });
    fireEvent.change(screen.getByPlaceholderText('{"ticket":"DSAR-1"}'), {
      target: { value: '{"ticket":"DSAR-1"}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Завершить DSAR' }));
    await waitFor(() => {
      expect(completeDataSubjectRequestMock).toHaveBeenCalledWith('dsar-1', {
        status: 'completed',
        decision: 'done',
        evidence: { ticket: 'DSAR-1' },
      });
    });

    fireEvent.change(screen.getAllByPlaceholderText('resident-uuid')[1], {
      target: { value: 'resident-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Получить export' }));
    await waitFor(() => {
      expect(getDataSubjectExportMock).toHaveBeenCalledWith(
        { property_id: PROPERTY_ID, subject_resident_id: 'resident-1' },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
    expect(await screen.findByText(/"resident"/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Пакет готов к проверке'), {
      target: { value: 'Готово к ревью' },
    });
    fireEvent.change(screen.getByPlaceholderText('s3://bucket/evidence.json'), {
      target: { value: 's3://privacy/evidence.json' },
    });
    fireEvent.change(screen.getByPlaceholderText('{"control":"privacy"}'), {
      target: { value: '{"control":"privacy"}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Создать evidence' }));
    await waitFor(() => {
      expect(createComplianceEvidenceMock).toHaveBeenCalledWith({
        property_id: PROPERTY_ID,
        evidence_type: 'dsar_workflow',
        status: 'ready',
        summary: 'Готово к ревью',
        artifact_uri: 's3://privacy/evidence.json',
        evidence: { control: 'privacy' },
      });
    });

    fireEvent.change(screen.getByPlaceholderText('Запрос пользователя'), {
      target: { value: 'resident requested deletion' },
    });
    expect(screen.getByRole('button', { name: 'Удалить мой аккаунт' })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('DELETE'), {
      target: { value: 'DELETE' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Удалить мой аккаунт' }));
    await waitFor(() => {
      expect(deleteAccountMock).toHaveBeenCalledWith({ reason: 'resident requested deletion' });
    });
  });

  test('property_id=null shows warning and skips property-scoped requests', () => {
    getConsentMock.mockResolvedValue({
      currentVersion: '2026-05-01',
      acceptedVersion: null,
      acceptedAt: null,
      needsAcceptance: true,
    });

    renderPage(makeUser({ property_id: null }));

    expect(screen.getByText(/администратор не привязан к объекту/i)).toBeInTheDocument();
    expect(getReadinessMock).not.toHaveBeenCalled();
    expect(listDataSubjectRequestsMock).not.toHaveBeenCalled();
    expect(listComplianceEvidenceMock).not.toHaveBeenCalled();
  });

  test('blocks DSAR creation without an explicit subject', async () => {
    getReadinessMock.mockResolvedValue({ readiness: { status: 'ready' } });
    getConsentMock.mockResolvedValue({
      currentVersion: '2026-05-01',
      acceptedVersion: null,
      acceptedAt: null,
      needsAcceptance: false,
    });
    listDataSubjectRequestsMock.mockResolvedValue({ requests: [] });
    listComplianceEvidenceMock.mockResolvedValue({ evidence: [] });

    renderPage();

    expect(await screen.findByRole('heading', { name: /privacy compliance/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Создать DSAR' }));

    expect(await screen.findByText('Укажите Subject UID или Resident ID')).toBeInTheDocument();
    expect(createDataSubjectRequestMock).not.toHaveBeenCalled();
  });
});
