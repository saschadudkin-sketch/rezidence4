import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { UserMe } from '../api/types';
import { V1SessionProvider } from '../store';
import { GisOssReadinessPage } from './GisOssReadinessPage';

const {
  createExportPackageMock,
  getBoundaryMock,
  listExportPackagesMock,
} = vi.hoisted(() => ({
  createExportPackageMock: vi.fn(),
  getBoundaryMock: vi.fn(),
  listExportPackagesMock: vi.fn(),
}));

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    api: {
      gisOssReadiness: {
        createExportPackage: createExportPackageMock,
        getBoundary: getBoundaryMock,
        listExportPackages: listExportPackagesMock,
      },
    },
    isV1ApiError: () => false,
  };
});

vi.mock('../../config/apiBaseUrl', () => ({
  API_BASE_URL: 'https://api.example.test',
  apiV1Url: (path: string) => `https://api.example.test/api/v1${path.startsWith('/') ? path : `/${path}`}`,
}));

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const PACKAGE_ID = '22222222-2222-4222-8222-222222222222';
const DOCUMENT_ID = '33333333-3333-4333-8333-333333333333';

function makeUser(overrides: Partial<UserMe> = {}): UserMe {
  return {
    uid: 'admin-1',
    role: 'admin',
    name: 'Admin',
    phone: null,
    apartment: null,
    avatar: null,
    property_slug: 'zamoskvorechie',
    property_id: PROPERTY_ID,
    property_type: 'residential_complex',
    ...overrides,
  };
}

function renderPage(user: UserMe = makeUser()): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={client}>
      <V1SessionProvider initialUser={user}>
        <GisOssReadinessPage />
      </V1SessionProvider>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  getBoundaryMock.mockResolvedValue({
    legally_authoritative: false,
    certified_submission: false,
    notice: 'Readiness only. Not certified filing.',
    out_of_scope: ['certified_gis_zhkh_filing'],
  });
  listExportPackagesMock.mockResolvedValue({
    boundary_notice: 'Readiness only. Not certified filing.',
    export_packages: [],
  });
  createExportPackageMock.mockResolvedValue({
    export_package: {
      id: PACKAGE_ID,
      property_id: PROPERTY_ID,
      package_type: 'oss_readiness',
      title: 'Created package',
      status: 'generated',
      period_start: null,
      period_end: null,
      document_ids: [],
      announcement_ids: [],
      protocol_files: [],
      operational_record_refs: [],
      export_payload: {
        format_version: 'gis_oss_readiness.v1',
        packaging: {
          format_version: 'gis_oss_artifact_manifest.v1',
          artifact_filename: 'gis-oss-oss-readiness-created-package-2026-05-11-11111111.json',
          artifact_content_type: 'application/vnd.domhub.gis-oss-readiness+json',
          manifest: {
            payload_path: 'payload.json',
            package_payload_sha256: 'a'.repeat(64),
            material_counts: {
              documents: 0,
              announcements: 0,
              protocol_files: 0,
              operational_record_refs: 0,
            },
            files: [],
          },
        },
      },
      boundary_notice: 'Readiness only. Not certified filing.',
      legally_authoritative: false,
      certified_submission: false,
      generated_by_uid: 'admin-1',
      generated_at: '2026-05-11T10:00:00.000Z',
      created_at: '2026-05-11T10:00:00.000Z',
      updated_at: '2026-05-11T10:00:00.000Z',
    },
    payload: {},
    boundary_notice: 'Readiness only. Not certified filing.',
  });
});

describe('GisOssReadinessPage', () => {
  test('renders boundary notice and existing packages', async () => {
    listExportPackagesMock.mockResolvedValue({
      boundary_notice: 'Readiness only. Not certified filing.',
      export_packages: [{
        id: PACKAGE_ID,
        property_id: PROPERTY_ID,
        package_type: 'oss_readiness',
        title: 'OSS May package',
        status: 'generated',
        period_start: null,
        period_end: null,
        document_ids: [DOCUMENT_ID],
        announcement_ids: [],
        protocol_files: [],
        operational_record_refs: [],
        export_payload: {
          format_version: 'gis_oss_readiness.v1',
          packaging: {
            format_version: 'gis_oss_artifact_manifest.v1',
            artifact_filename: 'gis-oss-oss-readiness-oss-may-package-2026-05-11-11111111.json',
            artifact_content_type: 'application/vnd.domhub.gis-oss-readiness+json',
            manifest: {
              payload_path: 'payload.json',
              package_payload_sha256: 'b'.repeat(64),
              material_counts: {
                documents: 1,
                announcements: 0,
                protocol_files: 0,
                operational_record_refs: 0,
              },
              files: [],
            },
          },
        },
        boundary_notice: 'Readiness only. Not certified filing.',
        legally_authoritative: false,
        certified_submission: false,
        generated_by_uid: 'admin-1',
        generated_at: '2026-05-11T10:00:00.000Z',
        created_at: '2026-05-11T10:00:00.000Z',
        updated_at: '2026-05-11T10:00:00.000Z',
      }],
    });

    renderPage();

    expect(await screen.findByText('Readiness only. Not certified filing.')).toBeInTheDocument();
    expect(await screen.findByText('OSS May package')).toBeInTheDocument();
    expect(await screen.findByText('gis-oss-oss-readiness-oss-may-package-2026-05-11-11111111.json')).toBeInTheDocument();
    expect(await screen.findByText('sha256 bbbbbbbbbbbb')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Скачать JSON' })).toHaveAttribute(
      'href',
      `https://api.example.test/api/v1/gis-oss/export-packages/${PACKAGE_ID}/artifact?property_id=${PROPERTY_ID}`,
    );
    expect(listExportPackagesMock).toHaveBeenCalledWith(
      { property_id: PROPERTY_ID, limit: 25 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  test('creates package from form values', async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'OSS readiness May' } });
    fireEvent.change(screen.getByLabelText('Document IDs'), { target: { value: DOCUMENT_ID } });
    fireEvent.change(screen.getByLabelText('Файл протокола'), { target: { value: '/uploads/oss/protocol.pdf' } });
    fireEvent.click(screen.getByRole('button', { name: /сформировать пакет/i }));

    await waitFor(() => {
      expect(createExportPackageMock).toHaveBeenCalledWith({
        property_id: PROPERTY_ID,
        package_type: 'oss_readiness',
        title: 'OSS readiness May',
        period_start: null,
        period_end: null,
        document_ids: [DOCUMENT_ID],
        announcement_ids: [],
        protocol_files: [{ label: 'protocol', file_url: '/uploads/oss/protocol.pdf' }],
        operational_record_refs: [],
      });
    });
  });

  test('shows property binding warning before fetching packages', () => {
    renderPage(makeUser({ property_id: null }));

    expect(screen.getByText('Администратор не привязан к объекту.')).toBeInTheDocument();
    expect(listExportPackagesMock).not.toHaveBeenCalled();
  });
});
