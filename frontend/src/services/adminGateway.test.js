jest.mock('../config/runtimeMode', () => ({
  isLiveMode: jest.fn(),
}));

jest.mock('./firebaseService', () => ({
  savePerms: jest.fn(),
  saveUser: jest.fn(),
  removeUser: jest.fn(),
}));

import { isLiveMode } from '../config/runtimeMode';
import { SYNC_STATUS } from '../constants/syncStatuses';
import { savePerms, saveUser, removeUser } from './firebaseService';
import { savePermsEverywhere, saveUserEverywhere, removeUserEverywhere } from './adminGateway';

describe('adminGateway', () => {
  let warnSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('savePermsEverywhere: demo local only', async () => {
    isLiveMode.mockReturnValue(false);
    const saveLocal = jest.fn();

    const mode = await savePermsEverywhere({ uid: 'u1', perms: { visitors: [] }, saveLocal });

    expect(mode).toBe(SYNC_STATUS.LOCAL);
    expect(saveLocal).toHaveBeenCalledWith('u1', { visitors: [] });
    expect(savePerms).not.toHaveBeenCalled();
  });

  test('savePermsEverywhere: live local + remote', async () => {
    isLiveMode.mockReturnValue(true);
    savePerms.mockResolvedValue(undefined);
    const saveLocal = jest.fn();

    const mode = await savePermsEverywhere({ uid: 'u1', perms: { visitors: [] }, saveLocal });

    expect(mode).toBe(SYNC_STATUS.REMOTE);
    expect(saveLocal).toHaveBeenCalledWith('u1', { visitors: [] });
    expect(savePerms).toHaveBeenCalledWith('u1', { visitors: [] });
  });

  test('saveUserEverywhere: demo local only', async () => {
    isLiveMode.mockReturnValue(false);
    const updateLocal = jest.fn();

    const mode = await saveUserEverywhere({ uid: 'u2', patch: { name: 'A' }, updateLocal, oldPhone: '+7' });

    expect(mode).toBe(SYNC_STATUS.LOCAL);
    expect(updateLocal).toHaveBeenCalledWith('u2', { name: 'A' }, '+7');
    expect(saveUser).not.toHaveBeenCalled();
  });

  test('saveUserEverywhere: live remote failure returns local_fallback', async () => {
    isLiveMode.mockReturnValue(true);
    saveUser.mockRejectedValueOnce(new Error('offline'));
    const updateLocal = jest.fn();

    const mode = await saveUserEverywhere({ uid: 'u2f', patch: { name: 'B' }, updateLocal, oldPhone: '+7' });

    expect(mode).toBe(SYNC_STATUS.LOCAL_FALLBACK);
    expect(updateLocal).toHaveBeenCalledWith('u2f', { name: 'B' }, '+7');
  });

  test('removeUserEverywhere: live local + remote', async () => {
    isLiveMode.mockReturnValue(true);
    removeUser.mockResolvedValue(undefined);
    const removeLocal = jest.fn();

    const mode = await removeUserEverywhere({ uid: 'u3', removeLocal });

    expect(mode).toBe(SYNC_STATUS.REMOTE);
    expect(removeLocal).toHaveBeenCalledWith('u3');
    expect(removeUser).toHaveBeenCalledWith('u3');
  });

  test('removeUserEverywhere: live remote failure returns local_fallback', async () => {
    isLiveMode.mockReturnValue(true);
    removeUser.mockRejectedValueOnce(new Error('offline'));
    const removeLocal = jest.fn();

    const mode = await removeUserEverywhere({ uid: 'u3f', removeLocal });

    expect(mode).toBe(SYNC_STATUS.LOCAL_FALLBACK);
    expect(removeLocal).toHaveBeenCalledWith('u3f');
  });
});
