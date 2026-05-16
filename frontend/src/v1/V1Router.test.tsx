/**
 * V1Router smoke tests — prove that role-based redirects land the right user
 * on the right page.
 *
 * Scope intentionally narrow:
 *   - mount <V1Router> inside a <MemoryRouter initialEntries={['/v1']}>
 *   - stub `api.session.me()` with a fake user per role
 *   - assert that after session resolves, we end up with the expected
 *     page's heading text in the DOM.
 *
 * We do NOT mock react-router here — the whole point is to verify the real
 * Navigate → Route chain.  We DO mock the v1 api barrel so pages don't
 * issue real HTTP on mount (ResidentAccessPage fetches the resident row
 * immediately, GuardConsolePage does not fetch at the outer level).
 *
 * The test uses `findBy*` (async) because V1SessionProvider's /auth/me is
 * an effect — the first render is <Spinner>.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { UserMe } from './api/types';

// ─── Module mocks ───────────────────────────────────────────────────────────
//
// We mock the full api barrel.  Each page pulls different resources from it,
// so we provide enough of a surface that the page at least hits its first
// paint without throwing.  For redirect-focused tests we actually only need
// `api.session.me`; the nested pages render their own loading state while
// their fetches are pending and we assert on the header that renders before
// the fetch resolves.
//
// vi.mock is hoisted to the top of the file by Vitest's transform, so the
// factory cannot close over module-level `let` bindings.  `vi.hoisted()` is
// the escape hatch: it returns values that are themselves hoisted to the
// same position as vi.mock, keeping the reference stable.
const { sessionMeMock } = vi.hoisted(() => ({
  sessionMeMock: vi.fn<() => Promise<UserMe>>(),
}));

vi.mock('./api', () => {
  // The real client exports are irrelevant in these tests.  We shim just the
  // bits that pages touch on mount.
  const neverResolves = () => new Promise(() => {});
  return {
    api: {
      session: { me: sessionMeMock },
      accessRequests: { list: neverResolves, getById: neverResolves },
      passes: { list: neverResolves, getById: neverResolves },
      vehicles: { getByPlate: neverResolves },
      visits: { list: neverResolves },
      incidents: { list: neverResolves },
      staffWorkspace: {
        listInbox: neverResolves,
        getRequestDetail: neverResolves,
        getResidentQuickView: neverResolves,
      },
      technicianWorkspace: {
        listQueue: neverResolves,
        getRequestDetail: neverResolves,
      },
      contractorWorkspace: {
        listQueue: neverResolves,
        getRequestDetail: neverResolves,
      },
      packages: { list: neverResolves },
      gisOssReadiness: {
        getBoundary: neverResolves,
        listExportPackages: neverResolves,
        createExportPackage: neverResolves,
      },
      skudIntegrations: { getProviderFailures: neverResolves },
      auditReviews: {
        meta: neverResolves,
        summary: neverResolves,
        antiAbuse: neverResolves,
        list: neverResolves,
      },
      emergencyDispatch: {
        readiness: neverResolves,
        createDrill: neverResolves,
      },
      operationsDashboard: { get: neverResolves },
      managementCompanyPortfolio: { get: neverResolves },
      residents: { getById: neverResolves, offboardingReport: neverResolves },
      units: { list: neverResolves, importRows: neverResolves },
    },
    isV1ApiError: () => false,
    normalizePlate: (s: string) => s.toUpperCase().replace(/[\s-]+/g, ''),
  };
});

vi.mock('./api/accessTopology', () => ({
  accessTopologyApi: {
    listZones: vi.fn(() => Promise.resolve({ zones: [] })),
    listPoints: vi.fn(() => Promise.resolve({ points: [] })),
    createZone: vi.fn(() => Promise.resolve({ zone: null })),
    createPoint: vi.fn(() => Promise.resolve({ point: null })),
    deactivatePoint: vi.fn(() => Promise.resolve(undefined)),
  },
}));

vi.mock('./api/accessPolicies', () => ({
  accessPoliciesApi: {
    list: vi.fn(() => Promise.resolve({ policies: [] })),
    create: vi.fn(() => Promise.resolve({ policy: null })),
    deactivate: vi.fn(() => Promise.resolve(undefined)),
  },
}));

vi.mock('./api/accessIncidents', () => ({
  accessIncidentsApi: {
    list: vi.fn(() => Promise.resolve({ incidents: [] })),
  },
}));

vi.mock('./api/vehicles', () => ({
  vehiclesApi: {
    getByPlate: vi.fn(() => Promise.resolve({ vehicle: null })),
  },
  normalizePlate: (s: string) => s.toUpperCase().replace(/[\s-]+/g, ''),
}));

import { V1Router } from './V1Router';

const baseUser = (role: UserMe['role'], extras: Partial<UserMe> = {}): UserMe => ({
  uid: 'user-1',
  role,
  name: 'Test',
  phone: null,
  apartment: '12',
  avatar: null,
  property_slug: 'zamoskvorechie',
  property_id: 'prop-1',
  property_type: 'residential_complex',
  ...extras,
});

/**
 * Render harness — mirrors the App.tsx mount: `<Route path="/v1/*" element={<V1Router/>}>`.
 *
 * Why this matters: V1Router has internal `<Routes>` with *relative* paths
 * (`index`, `access`, `guard`, `requests/:id`). Those paths are resolved
 * against the parent Route's path. If you drop V1Router directly under
 * MemoryRouter without a parent Route, the internal paths are rooted at `/`
 * — so a MemoryRouter entry of `/v1` matches none of them and the DOM stays
 * empty. Wrapping here reproduces the production route tree exactly.
 */
function renderAt(initial: string): ReactNode {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/v1/*" element={<V1Router />} />
          <Route path="/" element={<div data-testid="legacy-home" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  ) as unknown as ReactNode;
}

describe('V1Router role redirects (from /v1 index)', () => {
  beforeEach(() => {
    sessionMeMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('owner → resident page', async () => {
    sessionMeMock.mockResolvedValue(baseUser('owner'));
    renderAt('/v1');
    // The resident page's header is the first DOM signal that the redirect
    // landed correctly.  We don't wait for the request list — that's still
    // pending via the shim, and the page shows its own loading state.
    expect(await screen.findByRole('heading', { name: /мои заявки/i })).toBeInTheDocument();
  });

  test('tenant → resident page', async () => {
    sessionMeMock.mockResolvedValue(baseUser('tenant'));
    renderAt('/v1');
    expect(await screen.findByRole('heading', { name: /мои заявки/i })).toBeInTheDocument();
  });

  test('cottage-community resident sees house/plot label, not apartment label', async () => {
    sessionMeMock.mockResolvedValue(baseUser('owner', { property_type: 'cottage_community' }));
    renderAt('/v1');

    expect(await screen.findByText(/Дом\/участок 12/)).toBeInTheDocument();
    expect(screen.queryByText(/Квартира 12/)).toBeNull();
  });

  test('security → guard console', async () => {
    sessionMeMock.mockResolvedValue(baseUser('security'));
    renderAt('/v1');
    expect(await screen.findByRole('heading', { name: /пост охраны/i })).toBeInTheDocument();
  });

  test('cottage-community security opens vehicle-first checkpoint console', async () => {
    sessionMeMock.mockResolvedValue(baseUser('security', { property_type: 'cottage_community' }));
    renderAt('/v1');

    expect(await screen.findByRole('heading', { name: /пост кпп/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /въезд авто/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/Vehicle-first режим/i)).toBeInTheDocument();
  });

  test('admin → operations dashboard', async () => {
    sessionMeMock.mockResolvedValue(baseUser('admin'));
    renderAt('/v1');
    expect(await screen.findByRole('heading', { name: /операционный обзор/i })).toBeInTheDocument();
  });

  test('management company admin → portfolio dashboard', async () => {
    sessionMeMock.mockResolvedValue(baseUser('management_company_admin'));
    renderAt('/v1');
    expect(await screen.findByRole('heading', { name: /портфель ук/i })).toBeInTheDocument();
  });

  test('concierge → staff workspace', async () => {
    sessionMeMock.mockResolvedValue(baseUser('concierge'));
    renderAt('/v1');
    expect(
      await screen.findByRole('heading', { name: /рабочее место staff/i }),
    ).toBeInTheDocument();
  });

  test('technician → technician workspace', async () => {
    sessionMeMock.mockResolvedValue(baseUser('technician'));
    renderAt('/v1');
    expect(
      await screen.findByRole('heading', { name: /рабочее место техника/i }),
    ).toBeInTheDocument();
  });

  test('contractor → contractor workspace', async () => {
    sessionMeMock.mockResolvedValue(baseUser('contractor'));
    renderAt('/v1');
    expect(
      await screen.findByRole('heading', { name: /портал подрядчика/i }),
    ).toBeInTheDocument();
  });
});

describe('V1Router direct deep-links gate by role', () => {
  beforeEach(() => {
    sessionMeMock.mockReset();
  });

  test('resident deep-linked to /v1/guard gets kicked home (RoleGate → /)', async () => {
    sessionMeMock.mockResolvedValue(baseUser('owner'));
    renderAt('/v1/guard');
    // A resident must not see the guard header.  After the session resolves
    // the RoleGate emits <Navigate to="/" replace>, which lands on the
    // harness' legacy-home route.
    expect(await screen.findByTestId('legacy-home')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /пост охраны/i })).toBeNull();
  });

  test('admin deep-linked to /v1/requests/:id reaches the concierge detail page', async () => {
    sessionMeMock.mockResolvedValue(baseUser('admin'));
    renderAt('/v1/requests/abc-123-def');
    // The detail page renders its header even while data is loading.
    expect(
      await screen.findByRole('heading', { name: /заявка на доступ/i }),
    ).toBeInTheDocument();
  });

  test('admin deep-linked to /v1/onboarding reaches onboarding import page', async () => {
    sessionMeMock.mockResolvedValue(baseUser('admin', { property_type: 'cottage_community' }));
    renderAt('/v1/onboarding');
    expect(
      await screen.findByRole('heading', { name: /онбординг объекта/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Импорт домов\/участков/)).toBeInTheDocument();
  });

  test('admin deep-linked to /v1/admin/access reaches access admin page', async () => {
    sessionMeMock.mockResolvedValue(baseUser('admin', { property_type: 'cottage_community' }));
    renderAt('/v1/admin/access');
    expect(
      await screen.findByRole('heading', { name: /настройки доступа/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /кпп и зоны/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('admin deep-linked to /v1/admin/operations reaches operations dashboard', async () => {
    sessionMeMock.mockResolvedValue(baseUser('admin'));
    renderAt('/v1/admin/operations');
    expect(
      await screen.findByRole('heading', { name: /операционный обзор/i }),
    ).toBeInTheDocument();
  });

  test('admin deep-linked to /v1/admin/gis-oss reaches GIS/OSS readiness page', async () => {
    sessionMeMock.mockResolvedValue(baseUser('admin'));
    renderAt('/v1/admin/gis-oss');
    expect(
      await screen.findByRole('heading', { name: /gis жкх \/ осс/i }),
    ).toBeInTheDocument();
  });

  test('admin deep-linked to /v1/admin/skud-provider-failures reaches SKUD dashboard', async () => {
    sessionMeMock.mockResolvedValue(baseUser('admin'));
    renderAt('/v1/admin/skud-provider-failures');
    expect(
      await screen.findByRole('heading', { name: /скуд: отказы провайдеров/i }),
    ).toBeInTheDocument();
  });

  test('admin deep-linked to /v1/admin/sensitive-actions reaches sensitive review report', async () => {
    sessionMeMock.mockResolvedValue(baseUser('admin'));
    renderAt('/v1/admin/sensitive-actions');
    expect(
      await screen.findByRole('heading', { name: /sensitive action review/i }),
    ).toBeInTheDocument();
  });

  test('admin deep-linked to /v1/admin/offboarding reaches resident offboarding report', async () => {
    sessionMeMock.mockResolvedValue(baseUser('admin'));
    renderAt('/v1/admin/offboarding');
    expect(
      await screen.findByRole('heading', { name: /вывод резидентов/i }),
    ).toBeInTheDocument();
  });

  test('admin deep-linked to /v1/admin/emergency-dispatch reaches emergency dispatch', async () => {
    sessionMeMock.mockResolvedValue(baseUser('admin'));
    renderAt('/v1/admin/emergency-dispatch');
    expect(
      await screen.findByRole('heading', { name: /emergency dispatch/i }),
    ).toBeInTheDocument();
  });

  test('management company admin deep-linked to /v1/portfolio reaches portfolio dashboard', async () => {
    sessionMeMock.mockResolvedValue(baseUser('management_company_admin'));
    renderAt('/v1/portfolio');
    expect(
      await screen.findByRole('heading', { name: /портфель ук/i }),
    ).toBeInTheDocument();
  });

  test('resident deep-linked to /v1/portfolio gets kicked home', async () => {
    sessionMeMock.mockResolvedValue(baseUser('owner'));
    renderAt('/v1/portfolio');
    expect(await screen.findByTestId('legacy-home')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /портфель ук/i })).toBeNull();
  });

  test('security deep-linked to /v1/staff-workspace reaches staff workspace', async () => {
    sessionMeMock.mockResolvedValue(baseUser('security'));
    renderAt('/v1/staff-workspace');
    expect(
      await screen.findByRole('heading', { name: /рабочее место staff/i }),
    ).toBeInTheDocument();
  });

  test('security deep-linked to /v1/packages reaches package intake page', async () => {
    sessionMeMock.mockResolvedValue(baseUser('security'));
    renderAt('/v1/packages');
    expect(
      await screen.findByRole('heading', { name: /посылки/i }),
    ).toBeInTheDocument();
  });

  test('technician deep-linked to /v1/technician-workspace reaches technician workspace', async () => {
    sessionMeMock.mockResolvedValue(baseUser('technician'));
    renderAt('/v1/technician-workspace');
    expect(
      await screen.findByRole('heading', { name: /рабочее место техника/i }),
    ).toBeInTheDocument();
  });

  test('contractor deep-linked to /v1/contractor-workspace reaches contractor workspace', async () => {
    sessionMeMock.mockResolvedValue(baseUser('contractor'));
    renderAt('/v1/contractor-workspace');
    expect(
      await screen.findByRole('heading', { name: /портал подрядчика/i }),
    ).toBeInTheDocument();
  });

  test('resident deep-linked to /v1/admin/access gets kicked home', async () => {
    sessionMeMock.mockResolvedValue(baseUser('owner'));
    renderAt('/v1/admin/access');
    expect(await screen.findByTestId('legacy-home')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /настройки доступа/i })).toBeNull();
  });
});
