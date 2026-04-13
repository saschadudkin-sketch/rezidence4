import { isLiveMode } from '../config/runtimeMode';
import { SYNC_STATUS } from '../constants/syncStatuses';
import {
  savePerms as saveRemotePerms,
  saveUser as saveRemoteUser,
  removeUser as removeRemoteUser,
} from './localService';
import { logger } from './logger';
import type { UserPerms } from '../store/slices/permsSlice';
import type { AppUser } from '../store/slices/usersSlice';

export async function savePermsEverywhere({
  uid,
  perms,
  saveLocal,
}: {
  uid: string;
  perms: UserPerms;
  saveLocal: (uid: string, perms: UserPerms) => void;
}) {
  saveLocal(uid, perms);
  if (!isLiveMode()) return SYNC_STATUS.LOCAL;

  try {
    await saveRemotePerms(uid, perms);
    return SYNC_STATUS.REMOTE;
  } catch (e) {
    logger.warn('[adminGateway] savePerms failed', e instanceof Error ? e.message : String(e));
    return SYNC_STATUS.LOCAL_FALLBACK;
  }
}

export async function saveUserEverywhere({
  uid,
  patch,
  updateLocal,
  oldPhone,
}: {
  uid: string;
  patch: Partial<AppUser>;
  updateLocal: (uid: string, patch: Partial<AppUser>, oldPhone?: string) => void;
  oldPhone?: string;
}) {
  updateLocal(uid, patch, oldPhone);
  if (!isLiveMode()) return SYNC_STATUS.LOCAL;

  try {
    await saveRemoteUser(uid, patch);
    return SYNC_STATUS.REMOTE;
  } catch (e) {
    logger.warn('[adminGateway] saveUser failed', e instanceof Error ? e.message : String(e));
    return SYNC_STATUS.LOCAL_FALLBACK;
  }
}

export async function removeUserEverywhere({
  uid,
  removeLocal,
}: {
  uid: string;
  removeLocal: (uid: string) => void;
}) {
  removeLocal(uid);
  if (!isLiveMode()) return SYNC_STATUS.LOCAL;

  try {
    await removeRemoteUser(uid);
    return SYNC_STATUS.REMOTE;
  } catch (e) {
    logger.warn('[adminGateway] removeUser failed', e instanceof Error ? e.message : String(e));
    return SYNC_STATUS.LOCAL_FALLBACK;
  }
}
