/**
 * TEST-03: QuotaExceededError tests for localStorage save functions.
 *
 * Verifies that all per-slice save functions handle QuotaExceededError
 * gracefully — they must not throw or crash the app when storage is full.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  saveRequests,
  saveChat,
  saveUsers,
  savePerms,
  saveBlacklist,
  saveGarage,
} from './localStorage';

const QUOTA_ERROR = new DOMException('QuotaExceededError', 'QuotaExceededError');

describe('localStorage save functions — QuotaExceededError', () => {
  let setItemSpy;

  beforeEach(() => {
    setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw QUOTA_ERROR;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('saveRequests does not throw on quota exceeded', () => {
    expect(() => saveRequests({ requests: [], history: {} })).not.toThrow();
  });

  it('saveChat does not throw on quota exceeded', () => {
    expect(() => saveChat({ chat: [], chatLastSeen: {} })).not.toThrow();
  });

  it('saveUsers does not throw on quota exceeded', () => {
    expect(() => saveUsers({ users: {}, phoneDb: {}, avatars: {} })).not.toThrow();
  });

  it('savePerms does not throw on quota exceeded', () => {
    expect(() => savePerms({ perms: {}, templates: {} })).not.toThrow();
  });

  it('saveBlacklist does not throw on quota exceeded', () => {
    expect(() => saveBlacklist({ blacklist: [] })).not.toThrow();
  });

  it('saveGarage does not throw on quota exceeded', () => {
    expect(() => saveGarage({ garage: {} })).not.toThrow();
  });

  it('saveRequests attempts to write into localStorage on quota exceeded', () => {
    saveRequests({ requests: [], history: {} });
    expect(setItemSpy).toHaveBeenCalled();
  });
});
