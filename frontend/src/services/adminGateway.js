import { isLiveMode } from '../config/runtimeMode.js';
import { SYNC_STATUS } from '../constants/syncStatuses';
import {
  savePerms as saveRemotePerms,
  saveUser as saveRemoteUser,
  removeUser as removeRemoteUser,
} from './localService';
import { logger } from './logger';

export async function savePermsEverywhere({ uid, perms, saveLocal }) {
  saveLocal(uid, perms);
  if (!isLiveMode()) return SYNC_STATUS.LOCAL;

  try {
    await saveRemotePerms(uid, perms);
    return SYNC_STATUS.REMOTE;
  } catch (e) {
    logger.warn('[adminGateway] savePerms failed', e.message);
    return SYNC_STATUS.LOCAL_FALLBACK;
  }
}

export async function saveUserEverywhere({ uid, patch, updateLocal, oldPhone }) {
  updateLocal(uid, patch, oldPhone);
  if (!isLiveMode()) return SYNC_STATUS.LOCAL;

  try {
    await saveRemoteUser(uid, patch);
    return SYNC_STATUS.REMOTE;
  } catch (e) {
    logger.warn('[adminGateway] saveUser failed', e.message);
    return SYNC_STATUS.LOCAL_FALLBACK;
  }
}

export async function removeUserEverywhere({ uid, removeLocal }) {
  removeLocal(uid);
  if (!isLiveMode()) return SYNC_STATUS.LOCAL;

  try {
    await removeRemoteUser(uid);
    return SYNC_STATUS.REMOTE;
  } catch (e) {
    logger.warn('[adminGateway] removeUser failed', e.message);
    return SYNC_STATUS.LOCAL_FALLBACK;
  }
}
