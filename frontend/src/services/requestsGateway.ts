import { isLiveMode } from '../config/runtimeMode';
import { SYNC_STATUS } from '../constants/syncStatuses';
import {
  createRequest,
  uploadRequestPhoto,
  updateRequest as updateRemoteRequest,
  deleteRequest as deleteRemoteRequest,
} from './localService';
import { logger } from './logger';
import type { AppRequest } from '../store/slices/requestsSlice';

/**
 * Единая точка mode-aware поведения для создания заявок.
 * Возвращает нормализованные данные так, чтобы UI не держал demo/live условия.
 */
// FIX [HIGH-2]: Promise.allSettled вместо sequential for-await.
// 10 фото × 200ms RTT = 2s → теперь ~200ms.
// FIX [HIGH-2b]: при неудаче загрузки фото НЕ возвращаем исходное значение
// (может быть data-URL), а пропускаем — RequestsService отклоняет не-/uploads/ URL.
export async function resolveRequestPhotos(reqId: string, photos: string[]): Promise<string[]> {
  if (!photos || photos.length === 0) return [];

  if (isLiveMode()) {
    const results = await Promise.allSettled(
      photos.map((photo, i) => uploadRequestPhoto(reqId + '_' + i, photo)),
    );
    const uploaded: string[] = [];
    results.forEach((r) => {
      if (r.status === 'fulfilled') {
        uploaded.push(r.value as string);
      } else {
        logger.warn('[requestsGateway] photo upload failed, skipping', (r.reason as Error)?.message);
        // Пропускаем вместо fallback на data-URL: сервер не примет не-/uploads/ URL
      }
    });
    return uploaded;
  }

  return photos;
}

export async function submitRequest({
  request,
  addLocal,
}: {
  request: AppRequest;
  addLocal: (req: AppRequest) => void;
}): Promise<string> {
  if (isLiveMode()) {
    try {
      await createRequest({ ...request, id: undefined });
      return SYNC_STATUS.REMOTE;
    } catch (e) {
      logger.warn('[requestsGateway] submitRequest failed, falling back to local', (e as Error).message);
      addLocal(request);
      return SYNC_STATUS.LOCAL_FALLBACK;
    }
  }

  addLocal(request);
  return SYNC_STATUS.LOCAL;
}

/**
 * T-03: Optimistic update pattern:
 *   1. Apply patch locally immediately (optimistic)
 *   2. Send to remote
 *   3. On failure: if rollbackLocal provided, revert the optimistic change
 */
export async function updateRequestEverywhere({
  requestId,
  patch,
  updateLocal,
  rollbackLocal,
}: {
  requestId: string;
  patch: Partial<AppRequest>;
  updateLocal: (id: string, patch: Partial<AppRequest>) => void;
  rollbackLocal?: (id: string) => void;
}): Promise<string> {
  updateLocal(requestId, patch);
  if (!isLiveMode()) return SYNC_STATUS.LOCAL;

  try {
    await updateRemoteRequest(requestId, patch);
    return SYNC_STATUS.REMOTE;
  } catch (e) {
    logger.warn('[requestsGateway] updateRequest failed', (e as Error).message);
    rollbackLocal?.(requestId);
    return SYNC_STATUS.LOCAL_FALLBACK;
  }
}

// FIX [HIGH-3]: добавлен rollbackLocal — симметрично с updateRequestEverywhere.
// Без него удалённый элемент пропадал из UI навсегда при сбое сервера.
export async function deleteRequestEverywhere({
  requestId,
  deleteLocal,
  rollbackLocal,
}: {
  requestId: string;
  deleteLocal: (id: string) => void;
  rollbackLocal?: (id: string) => void;
}): Promise<string> {
  deleteLocal(requestId);
  if (!isLiveMode()) return SYNC_STATUS.LOCAL;

  try {
    await deleteRemoteRequest(requestId);
    return SYNC_STATUS.REMOTE;
  } catch (e) {
    logger.warn('[requestsGateway] deleteRequest failed', (e as Error).message);
    rollbackLocal?.(requestId);
    return SYNC_STATUS.LOCAL_FALLBACK;
  }
}
