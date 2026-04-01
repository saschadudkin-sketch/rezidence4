import { isLiveMode } from '../config/runtimeMode.js';
import { SYNC_STATUS } from '../constants/syncStatuses';
import {
  savePerms as saveRemotePerms,
  saveUser as saveRemoteUser,
  removeUser as removeRemoteUser,
  restoreUser as restoreRemoteUser,
  listDeletedUsers as listDeletedRemoteUsers,
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

export async function restoreUserEverywhere({ uid, restoreLocal }) {
  if (restoreLocal) restoreLocal(uid);
  if (!isLiveMode()) return SYNC_STATUS.LOCAL;

  try {
    await restoreRemoteUser(uid);
    return SYNC_STATUS.REMOTE;
  } catch (e) {
    logger.warn('[adminGateway] restoreUser failed', e.message);
    return SYNC_STATUS.LOCAL_FALLBACK;
  }
}

export async function listDeletedUsersEverywhere() {
  if (!isLiveMode()) return [];
  try {
    return await listDeletedRemoteUsers();
  } catch (e) {
    logger.warn('[adminGateway] listDeletedUsers failed', e.message);
    return [];
  }
}
