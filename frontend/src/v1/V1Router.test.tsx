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
      residents: { getById: neverResolves },
      units: { list: neverResolves },
    },
    isV1ApiError: () => false,
    normalizePlate: (s: string) => s.toUpperCase().replace(/[\s-]+/g, ''),
  };
});

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
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/v1/*" element={<V1Router />} />
      </Routes>
    </MemoryRouter>,
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

  test('security → guard console', async () => {
    sessionMeMock.mockResolvedValue(baseUser('security'));
    renderAt('/v1');
    expect(await screen.findByRole('heading', { name: /пост охраны/i })).toBeInTheDocument();
  });

  test('admin → guard console (guard priority over concierge)', async () => {
    sessionMeMock.mockResolvedValue(baseUser('admin'));
    renderAt('/v1');
    expect(await screen.findByRole('heading', { name: /пост охраны/i })).toBeInTheDocument();
  });

  test('concierge (not guard) → landing card with navigation hints', async () => {
    sessionMeMock.mockResolvedValue(baseUser('concierge'));
    renderAt('/v1');
    expect(
      await screen.findByRole('heading', { name: /платформа доступа/i }),
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
    // the RoleGate emits <Navigate to="/" replace>, which has no matching
    // route in this harness — MemoryRouter simply stops rendering children.
    // Give React two ticks so the useEffect → setState chain completes, then
    // assert the heading is absent.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
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
});
