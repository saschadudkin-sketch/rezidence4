import { renderHook, act } from '@testing-library/react';
import {
  toLocalDateInputValue,
  toLocalDateTimeInputValue,
  parseLocalDateInputValue,
  useCreateRequest,
} from './useCreateRequest';

// ─── Mocks required by useCreateRequest ──────────────────────────────────────

vi.mock('../store/AppStore', () => ({
  useActions: () => ({
    addRequest: vi.fn(),
    deleteRequest: vi.fn(),
    updateRequest: vi.fn(),
    addTemplate: vi.fn(),
  }),
  usePerms: () => ({ visitors: [], workers: [] }),
}));

vi.mock('../services/providers/serviceContainer', () => ({
  services: {
    requests: { submit: vi.fn().mockResolvedValue('local'), resolvePhotos: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock('../ui/Toasts', () => ({ toast: vi.fn() }));
vi.mock('../ui/syncFeedback', () => ({ toastBySyncResult: vi.fn() }));
vi.mock('../ui/scrollLock', () => ({ lockScroll: vi.fn(), unlockScroll: vi.fn() }));
vi.mock('../config/runtimeMode', () => ({ isLiveMode: () => false, isDemoMode: () => true }));

const TEST_USER = { uid: 'u1', role: 'owner', name: 'Test', apartment: '1' };

// ─── P-04: vNames must always be [{__id, value}] objects, never plain strings ──

describe('useCreateRequest — P-04 vNames shape', () => {
  test('vNames initialised as object array, not string array', () => {
    const { result } = renderHook(() =>
      useCreateRequest({ user: TEST_USER, type: 'pass', initialCat: 'guest', initialData: null, onClose: vi.fn(), onDone: vi.fn() } as any),
    );
    const { vNames } = result.current;
    expect(Array.isArray(vNames)).toBe(true);
    expect(vNames.length).toBeGreaterThan(0);
    expect(typeof vNames[0]).toBe('object');
    expect(vNames[0]).toHaveProperty('__id');
    expect(vNames[0]).toHaveProperty('value');
  });

  test('vNames resets to object array after category change', () => {
    const { result } = renderHook(() =>
      useCreateRequest({ user: TEST_USER, type: 'pass', initialCat: 'guest', initialData: null, onClose: vi.fn(), onDone: vi.fn() } as any),
    );
    // Change category — triggers the reset effect
    act(() => { result.current.setCat('team'); });

    const { vNames } = result.current;
    expect(vNames.length).toBe(1);
    expect(typeof vNames[0]).toBe('object');
    expect(vNames[0]).toHaveProperty('__id');
    expect(vNames[0].value).toBe('');
  });
});

// ─── date input formatting helpers ───────────────────────────────────────────

describe('useCreateRequest date input formatting helpers', () => {
  test('toLocalDateInputValue formats by local calendar date without UTC shift', () => {
    const d = new Date(2026, 2, 24, 23, 45, 0, 0); // local time
    expect(toLocalDateInputValue(d)).toBe('2026-03-24');
  });

  test('toLocalDateTimeInputValue formats datetime-local value by local time', () => {
    const d = new Date(2026, 2, 24, 5, 7, 59, 999); // local time
    expect(toLocalDateTimeInputValue(d)).toBe('2026-03-24T05:07');
  });

  test('parseLocalDateInputValue parses YYYY-MM-DD as local date', () => {
    const d = parseLocalDateInputValue('2026-03-24');
    expect(d).toBeInstanceOf(Date);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(24);
  });

  test('parseLocalDateInputValue returns null for invalid or out-of-range values', () => {
    expect(parseLocalDateInputValue('2026-02-31')).toBeNull();
    expect(parseLocalDateInputValue('2026-2-3')).toBeNull();
    expect(parseLocalDateInputValue('not-a-date')).toBeNull();
  });
});
