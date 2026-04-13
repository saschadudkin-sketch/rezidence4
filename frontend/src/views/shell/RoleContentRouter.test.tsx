import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import RoleContentRouter from './RoleContentRouter';
import { NavigationContext } from './NavigationContext';

vi.mock('../../domain/permissions', () => ({
  ROLES: {
    SECURITY: 'security',
    CONCIERGE: 'concierge',
    ADMIN: 'admin',
  },
  canAccessTab: (_role: string, tab: string) => ['passes', 'templates', 'tech', 'perms', 'history', 'chat'].includes(tab),
  getTabsForRole: () => ['templates', 'passes', 'tech', 'perms', 'history', 'chat'],
}));

vi.mock('../ResidentView', () => ({
  default: ({ activeTab }: { activeTab: string }) => <div>resident:{activeTab}</div>,
}));

vi.mock('../SecurityConciergeViews', () => ({
  ConciergeView: () => <div>concierge-view</div>,
  SecurityView: () => <div>security-view</div>,
}));

vi.mock('../AdminView', () => ({
  default: () => <div>admin-view</div>,
}));

const navContextValue = {
  nav: [],
  navClassMap: {},
  goTab: vi.fn(),
  activeTab: 'passes',
  setActiveTab: vi.fn(),
  highlightReqId: null,
  setHighlightReqId: vi.fn(),
};

describe('RoleContentRouter', () => {
  test('redirects owner dashboard index to manifest defaultTab instead of first allowed tab', async () => {
    render(
      <NavigationContext.Provider value={navContextValue}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route
              path="/dashboard/*"
              element={<RoleContentRouter user={{ uid: 'u1', role: 'owner', name: 'Owner' }} />}
            />
          </Routes>
        </MemoryRouter>
      </NavigationContext.Provider>,
    );

    expect(await screen.findByText('resident:passes')).toBeInTheDocument();
  });

  test('redirects contractor dashboard index to passes by manifest default', async () => {
    render(
      <NavigationContext.Provider value={navContextValue}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route
              path="/dashboard/*"
              element={<RoleContentRouter user={{ uid: 'c1', role: 'contractor', name: 'Contractor' }} />}
            />
          </Routes>
        </MemoryRouter>
      </NavigationContext.Provider>,
    );

    expect(await screen.findByText('resident:passes')).toBeInTheDocument();
  });
});
