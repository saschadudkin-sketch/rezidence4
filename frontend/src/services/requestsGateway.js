import { isLiveMode } from '../config/runtimeMode';
import { SYNC_STATUS } from '../constants/syncStatuses';
import {
  createRequest,
  uploadRequestPhoto,
  updateRequest as updateRemoteRequest,
  deleteRequest as deleteRemoteRequest,
} from './firebaseService';
import { logger } from './logger';

/**
 * Единая точка mode-aware поведения для создания заявок.
 * Возвращает нормализованные данные так, чтобы UI не держал demo/live условия.
 */
export async function resolveRequestPhotos(reqId, photos) {
  if (!photos || photos.length === 0) return [];

  if (isLiveMode()) {
    const uploaded = [];
    for (let i = 0; i < photos.length; i++) {
      try {
        uploaded.push(await uploadRequestPhoto(reqId + '_' + i, photos[i]));
      } catch (e) {
        logger.warn('[requestsGateway] photo upload failed, keeping original', e.message);
        uploaded.push(photos[i]);
      }
    }
    return uploaded;
  }

  return photos;
}

export async function submitRequest({ request, addLocal }) {
  if (isLiveMode()) {
    try {
      await createRequest({ ...request, id: undefined });
      return SYNC_STATUS.REMOTE;
    } catch (e) {
      logger.warn('[requestsGateway] submitRequest failed, falling back to local', e.message);
      addLocal(request);
      return SYNC_STATUS.LOCAL_FALLBACK;
    }
  }

  addLocal(request);
  return SYNC_STATUS.LOCAL;
}

export async function updateRequestEverywhere({ requestId, patch, updateLocal }) {
  updateLocal(requestId, patch);
  if (!isLiveMode()) return SYNC_STATUS.LOCAL;

  try {
    await updateRemoteRequest(requestId, patch);
    return SYNC_STATUS.REMOTE;
  } catch (e) {
    logger.warn('[requestsGateway] updateRequest failed', e.message);
    return SYNC_STATUS.LOCAL_FALLBACK;
  }
}

export async function deleteRequestEverywhere({ requestId, deleteLocal }) {
  deleteLocal(requestId);
  if (!isLiveMode()) return SYNC_STATUS.LOCAL;

  try {
    await deleteRemoteRequest(requestId);
    return SYNC_STATUS.REMOTE;
  } catch (e) {
    logger.warn('[requestsGateway] deleteRequest failed', e.message);
    return SYNC_STATUS.LOCAL_FALLBACK;
  }
}
