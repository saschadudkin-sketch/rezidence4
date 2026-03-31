/**
 * views/Dashboard.test.js
 */
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

/**
 * chat/ChatView.test.js
 */
import { ChatView } from '../chat/ChatView';
vi.mock('../services/providers/serviceContainer', () => ({
  services: { chat: { sendMessage: vi.fn().mockResolvedValue({}), updateMessage: vi.fn(), deleteMessage: vi.fn(), markSeen: vi.fn() } },
}));
vi.mock('../ui/Toasts', () => ({ toast: vi.fn() }));
vi.mock('../ui/PhotoLightbox', () => ({ PhotoLightbox: () => null }));

describe('ChatView', () => {
  test('рендерится без ошибок', () => {
    const user = { uid:'u1', role:'owner', name:'Иван' };
    expect(() => render(<ChatView user={user} />)).not.toThrow();
  });

  test('показывает поле ввода сообщения', () => {
    const user = { uid:'u1', role:'owner', name:'Иван' };
    render(<ChatView user={user} />);
    expect(screen.getByPlaceholderText(/сообщение/i)).toBeInTheDocument();
  });
});

// FIX structural checks for ChatView audit fixes
describe('ChatView audit fixes', () => {
  const getSource = () => {
    const fs = require('fs');
    return fs.readFileSync(
      require.resolve('../chat/ChatView.jsx'),
      'utf8'
    );
  };

  test('FIX BUG-3: prevMsg использует filteredChat[i-1], а не chat[i-1]', () => {
    const src = getSource();
    expect(src).toContain('filteredChat[i - 1]');
    expect(src).not.toMatch(/= chat\[i - 1\]/);
  });

  test('FIX BUG-4: msgTimestamps Map кешируется через useMemo', () => {
    expect(getSource()).toContain('msgTimestamps');
    expect(getSource()).toMatch(/msgTimestamps = useMemo/);
  });

  test('FIX BUG-9: click-listener закрытия меню зарегистрирован', () => {
    const src = getSource();
    expect(src).toContain("document.addEventListener('mousedown', handleOutsideClick)");
    expect(src).toContain("document.addEventListener('touchstart', handleOutsideClick)");
  });

  test('FIX BUG-15: onFileChange обёрнут в useCallback', () => {
    expect(getSource()).toMatch(/onFileChange = useCallback/);
  });

  test('FIX BUG-20: msgRefs Map для навигации к цитатам (не document.querySelector)', () => {
    const src = getSource().replace(/\/\/[^\n]*/g, '');
    expect(src).not.toContain('document.querySelector');
    expect(src).toContain('msgRefs.current');
    expect(src).toContain('scrollToMsg');
  });
});

/**
 * perms/PermsList.test.js
 */
import { PermsList, MyTemplates } from '../perms/PermsList';
vi.mock('../utils', () => ({ genId: () => 'gen-id' }));

describe('PermsList', () => {
  test('рендерится без ошибок', () => {
    const user = { uid:'u1', role:'owner', name:'Иван' };
    expect(() => render(<PermsList user={user} />)).not.toThrow();
  });

  test('показывает кнопку добавления гостя', () => {
    const user = { uid:'u1', role:'owner', name:'Иван' };
    render(<PermsList user={user} />);
    expect(screen.getAllByText(/добавить/i).length).toBeGreaterThan(0);
  });
});

describe('MyTemplates', () => {
  test('рендерится без ошибок', () => {
    const user = { uid:'u1', role:'owner', name:'Иван' };
    expect(() => render(<MyTemplates user={user} onUse={vi.fn()} />)).not.toThrow();
  });
});

/**
 * requests/CreateModal.test.js
 */
import { CreateModal } from '../requests/CreateModal';
vi.mock('../services/providers/serviceContainer', () => ({
  services: { requests: { submit: vi.fn().mockResolvedValue({ id:'srv-1' }), resolvePhotos: vi.fn().mockResolvedValue([]) } },
}));
vi.mock('../ui/Toasts', () => ({ toast: vi.fn() }));
vi.mock('../ui/scrollLock', () => ({ lockScroll: vi.fn(), unlockScroll: vi.fn() }));
vi.mock('../store/slices/blacklistSlice', () => ({ checkBlacklist: () => null }));

describe('CreateModal', () => {
  test('рендерится без ошибок', () => {
    const user = { uid:'u1', role:'owner', name:'Иван', apartment:'12' };
    expect(() => render(<CreateModal user={user} type="pass" category="guest" onClose={vi.fn()} onDone={vi.fn()} />)).not.toThrow();
  });

  test('показывает заголовок формы', () => {
    const user = { uid:'u1', role:'owner', name:'Иван', apartment:'12' };
    render(<CreateModal user={user} type="pass" category="guest" onClose={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getAllByText(/новая заявка|пропуск|создать/i).length).toBeGreaterThan(0);
  });
});

/**
 * requests/ScanQRModal.test.js
 */
import { ScanQRModal } from '../requests/ScanQRModal';
vi.mock('../ui/Toasts',     () => ({ toast: vi.fn() }));
vi.mock('../ui/scrollLock', () => ({ lockScroll: vi.fn(), unlockScroll: vi.fn() }));
vi.mock('../shared/api/passesApi', () => ({ logVisit: vi.fn().mockResolvedValue({}) }));
vi.mock('../services/pushNotification', () => ({ pushNotifyResident: vi.fn() }));
vi.mock('../store/slices/blacklistSlice', () => ({ checkBlacklist: () => null }));
vi.mock('../services/providers/serviceContainer', () => ({
  services: { requests: { updateEverywhere: vi.fn().mockResolvedValue('local') } },
}));

describe('ScanQRModal', () => {
  test('рендерится без ошибок', () => {
    const user = { uid:'g1', role:'security', name:'Охрана' };
    expect(() => render(<ScanQRModal user={user} onClose={vi.fn()} />)).not.toThrow();
  });

  test('показывает заголовок сканирования', () => {
    const user = { uid:'g1', role:'security', name:'Охрана' };
    render(<ScanQRModal user={user} onClose={vi.fn()} />);
    expect(screen.getByText(/сканир|qr/i)).toBeInTheDocument();
  });
});
