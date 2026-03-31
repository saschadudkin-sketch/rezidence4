import React from 'react';
import { render, screen } from '@testing-library/react';
import Dashboard from './Dashboard';

window.HTMLElement.prototype.scrollIntoView = vi.fn();
Object.defineProperty(global.navigator, 'mediaDevices', {
  value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
  configurable: true,
});

const originalConsoleError = console.error;
beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation((...args) => {
    const [first] = args;
    if (typeof first === 'string' && first.includes('A suspended resource finished loading inside a test')) return;
    originalConsoleError(...args);
  });
});

afterAll(() => {
  console.error.mockRestore();
});

vi.mock('../hooks/useDashboardHooks', () => ({
  useTheme:            () => ({ theme: 'auto', cycleTheme: vi.fn(), themeIcon: 'chart', themeLabel: 'Авто' }),
  useNavBadges:        () => ({ pendingT: 0, pendingP: 0, unreadMsgs: 0, residentNewStatuses: 0, blacklistCount: 0, onPassesSeen: vi.fn() }),
  useLiveSync:         () => ({ isLoading: false }),
  usePushNotifications:() => {},
  useArrivalNotifier:  () => {},
  useNavigation:       () => ({ activeTab: 'passes', setActiveTab: vi.fn(), goTab: vi.fn(), highlightReqId: null, setHighlightReqId: vi.fn() }),
}));
vi.mock('../store/AppStore', () => ({
  useRequests:    () => [],
  useActions:     () => ({
    markChatSeen: vi.fn(),
    setAllRequests: vi.fn(),
    setAllMessages: vi.fn(),
    setAllUsers: vi.fn(),
    setPerms: vi.fn(),
    setTemplates: vi.fn(),
    sendChatMessage: vi.fn(),
    updateChatMessage: vi.fn(),
    deleteChatMessage: vi.fn(),
    addTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    addRequest: vi.fn(),
    approveRequest: vi.fn(),
    arriveRequest: vi.fn(),
    deleteRequest: vi.fn(),
    updateRequest: vi.fn(),
  }),
  useChat:        () => ({ chat: [], chatLastSeen: {} }),
  usePerms:       () => ({ visitors: [], workers: [] }),
  useTemplates:   () => [],
  useUsers:       () => ({ users: {} }),
  useBlacklist:   () => [],
  useAvatar:      () => null,
}));
vi.mock('../domain/permissions', () => ({
  isResident:         () => true,
  isStaff:            () => false,
  canManageRequests:  () => false,
  canAccessTab:       () => true,
  canDeleteMessage:   vi.fn(() => false),
  canEditMessage:     vi.fn(() => false),
  getTabsForRole:     () => ['passes','tech','perms','templates','chat'],
  ROLES:              { SECURITY: 'security', ADMIN: 'admin', CONCIERGE: 'concierge', CONTRACTOR: 'contractor' },
}));
vi.mock('./ResidentView',             () => ({ default: () => <div data-testid="resident-view" /> }));
vi.mock('./SecurityConciergeViews',   () => ({ ConciergeView: () => null, SecurityView: () => null }));
vi.mock('./AdminView',                () => () => null);
vi.mock('../ui/AvatarCircle',         () => ({ AvatarCircle: () => null }));
vi.mock('../hooks/useScheduledActivation', () => ({ useScheduledActivation: () => {} }));
vi.mock('../config/runtimeMode', () => ({ isLiveMode: () => false, isDemoMode: () => false }));

const ownerUser = { uid:'u1', role:'owner', name:'Иван', apartment:'12' };

describe('Dashboard', () => {
  test('рендерится без ошибок для owner', () => {
    expect(() => render(<Dashboard user={ownerUser} onLogout={vi.fn()} />)).not.toThrow();
  });

  test('показывает ResidentView для owner', () => {
    render(<Dashboard user={ownerUser} onLogout={vi.fn()} />);
    expect(screen.getByTestId('resident-view')).toBeInTheDocument();
  });

  test('показывает имя пользователя', () => {
    render(<Dashboard user={ownerUser} onLogout={vi.fn()} />);
    expect(screen.getByText('Иван')).toBeInTheDocument();
  });
});
