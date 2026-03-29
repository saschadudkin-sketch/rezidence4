/**
 * views/Dashboard.test.js
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import Dashboard from './Dashboard';

window.HTMLElement.prototype.scrollIntoView = jest.fn();
Object.defineProperty(global.navigator, 'mediaDevices', {
  value: { getUserMedia: jest.fn().mockResolvedValue({ getTracks: () => [{ stop: jest.fn() }] }) },
  configurable: true,
});

const originalConsoleError = console.error;
beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation((...args) => {
    const [first] = args;
    if (typeof first === 'string' && first.includes('A suspended resource finished loading inside a test')) return;
    originalConsoleError(...args);
  });
});

afterAll(() => {
  console.error.mockRestore();
});

jest.mock('../hooks/useDashboardHooks', () => ({
  useTheme:            () => ({ theme: 'auto', cycleTheme: jest.fn(), themeIcon: '✦', themeLabel: 'Авто' }),
  useNavBadges:        () => ({ pendingT: 0, pendingP: 0, unreadMsgs: 0, residentNewStatuses: 0, blacklistCount: 0, onPassesSeen: jest.fn() }),
  useLiveSync:         () => ({ isLoading: false }),
  usePushNotifications:() => {},
  useArrivalNotifier:  () => {},
  useNavigation:       () => ({ activeTab: 'passes', setActiveTab: jest.fn(), goTab: jest.fn(), highlightReqId: null, setHighlightReqId: jest.fn() }),
}));
jest.mock('../store/AppStore', () => ({
  useRequests:    () => [],
  useActions:     () => ({
    markChatSeen: jest.fn(),
    setAllRequests: jest.fn(),
    setAllMessages: jest.fn(),
    setAllUsers: jest.fn(),
    setPerms: jest.fn(),
    setTemplates: jest.fn(),
    sendChatMessage: jest.fn(),
    updateChatMessage: jest.fn(),
    deleteChatMessage: jest.fn(),
    addTemplate: jest.fn(),
    deleteTemplate: jest.fn(),
    addRequest: jest.fn(),
    approveRequest: jest.fn(),
    arriveRequest: jest.fn(),
    deleteRequest: jest.fn(),
    updateRequest: jest.fn(),
  }),
  useChat:        () => ({ chat: [], chatLastSeen: {} }),
  usePerms:       () => ({ visitors: [], workers: [] }),
  useTemplates:   () => [],
  useUsers:       () => ({ users: {} }),
  useBlacklist:   () => [],
  useAvatar:      () => null,
}));
jest.mock('../domain/permissions', () => ({
  isResident:         () => true,
  isStaff:            () => false,
  canManageRequests:  () => false,
  canAccessTab:       () => true,
  canDeleteMessage:   jest.fn(() => false),
  canEditMessage:     jest.fn(() => false),
  getTabsForRole:     () => ['passes','tech','perms','templates','chat'],
  ROLES:              { SECURITY: 'security', ADMIN: 'admin', CONCIERGE: 'concierge', CONTRACTOR: 'contractor' },
}));
jest.mock('./ResidentView',             () => () => <div data-testid="resident-view" />);
jest.mock('./SecurityConciergeViews',   () => ({ ConciergeView: () => null, SecurityView: () => null }));
jest.mock('./AdminView',                () => () => null);
jest.mock('../ui/AvatarCircle',         () => ({ AvatarCircle: () => null }));
jest.mock('../hooks/useScheduledActivation', () => ({ useScheduledActivation: () => {} }));
jest.mock('../config/runtimeMode', () => ({ isLiveMode: () => false, isDemoMode: () => false }));

const ownerUser = { uid:'u1', role:'owner', name:'Иван', apartment:'12' };

describe('Dashboard', () => {
  test('рендерится без ошибок для owner', () => {
    expect(() => render(<Dashboard user={ownerUser} onLogout={jest.fn()} />)).not.toThrow();
  });

  test('показывает ResidentView для owner', () => {
    render(<Dashboard user={ownerUser} onLogout={jest.fn()} />);
    expect(screen.getByTestId('resident-view')).toBeInTheDocument();
  });

  test('показывает имя пользователя', () => {
    render(<Dashboard user={ownerUser} onLogout={jest.fn()} />);
    expect(screen.getByText('Иван')).toBeInTheDocument();
  });
});

/**
 * chat/ChatView.test.js
 */
import { ChatView } from '../chat/ChatView';
jest.mock('../services/providers/serviceContainer', () => ({
  services: { chat: { sendMessage: jest.fn().mockResolvedValue({}), updateMessage: jest.fn(), deleteMessage: jest.fn(), markSeen: jest.fn() } },
}));
jest.mock('../ui/Toasts', () => ({ toast: jest.fn() }));
jest.mock('../ui/PhotoLightbox', () => ({ PhotoLightbox: () => null }));

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
      require.resolve('../chat/ChatView'),
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
jest.mock('../utils', () => ({ genId: () => 'gen-id' }));

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
    expect(() => render(<MyTemplates user={user} onUse={jest.fn()} />)).not.toThrow();
  });
});

/**
 * requests/CreateModal.test.js
 */
import { CreateModal } from '../requests/CreateModal';
jest.mock('../services/providers/serviceContainer', () => ({
  services: { requests: { submit: jest.fn().mockResolvedValue({ id:'srv-1' }), resolvePhotos: jest.fn().mockResolvedValue([]) } },
}));
jest.mock('../ui/Toasts', () => ({ toast: jest.fn() }));
jest.mock('../ui/scrollLock', () => ({ lockScroll: jest.fn(), unlockScroll: jest.fn() }));
jest.mock('../store/slices/blacklistSlice', () => ({ checkBlacklist: () => null }));

describe('CreateModal', () => {
  test('рендерится без ошибок', () => {
    const user = { uid:'u1', role:'owner', name:'Иван', apartment:'12' };
    expect(() => render(<CreateModal user={user} type="pass" category="guest" onClose={jest.fn()} onDone={jest.fn()} />)).not.toThrow();
  });

  test('показывает заголовок формы', () => {
    const user = { uid:'u1', role:'owner', name:'Иван', apartment:'12' };
    render(<CreateModal user={user} type="pass" category="guest" onClose={jest.fn()} onDone={jest.fn()} />);
    expect(screen.getAllByText(/новая заявка|пропуск|создать/i).length).toBeGreaterThan(0);
  });
});

/**
 * requests/ScanQRModal.test.js
 */
import { ScanQRModal } from '../requests/ScanQRModal';
jest.mock('../ui/Toasts',     () => ({ toast: jest.fn() }));
jest.mock('../ui/scrollLock', () => ({ lockScroll: jest.fn(), unlockScroll: jest.fn() }));
jest.mock('../shared/api/passesApi', () => ({ logVisit: jest.fn().mockResolvedValue({}) }));
jest.mock('../services/pushNotification', () => ({ pushNotifyResident: jest.fn() }));
jest.mock('../store/slices/blacklistSlice', () => ({ checkBlacklist: () => null }));
jest.mock('../services/providers/serviceContainer', () => ({
  services: { requests: { updateEverywhere: jest.fn().mockResolvedValue('local') } },
}));

describe('ScanQRModal', () => {
  test('рендерится без ошибок', () => {
    const user = { uid:'g1', role:'security', name:'Охрана' };
    expect(() => render(<ScanQRModal user={user} onClose={jest.fn()} />)).not.toThrow();
  });

  test('показывает заголовок сканирования', () => {
    const user = { uid:'g1', role:'security', name:'Охрана' };
    render(<ScanQRModal user={user} onClose={jest.fn()} />);
    expect(screen.getByText(/сканир|qr/i)).toBeInTheDocument();
  });
});
