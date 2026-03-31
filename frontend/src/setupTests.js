import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

// Legacy shim kept intentionally narrow (only APIs still used by legacy specs).
globalThis.jest = {
  fn: vi.fn,
  spyOn: vi.spyOn,
  mock: vi.mock,
  doMock: vi.doMock,
  unmock: vi.unmock,
  doUnmock: vi.doUnmock,
  dontMock: vi.doUnmock,
  clearAllMocks: vi.clearAllMocks,
  resetAllMocks: vi.resetAllMocks,
  restoreAllMocks: vi.restoreAllMocks,
  resetModules: vi.resetModules,
  isolateModules: (fn) => fn(),
  useFakeTimers: vi.useFakeTimers,
  useRealTimers: vi.useRealTimers,
  runAllTimers: vi.runAllTimers,
  runOnlyPendingTimers: vi.runOnlyPendingTimers,
  advanceTimersByTime: vi.advanceTimersByTime,
  setSystemTime: vi.setSystemTime,
};
