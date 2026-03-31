import { isLiveMode } from '../config/runtimeMode.js';
import { SYNC_STATUS } from '../constants/syncStatuses';
import { sendMessage as sendRemoteMessage } from './localService';
import { logger } from './logger';

/**
 * Единая точка отправки сообщений чата с учётом режима (demo/live).
 * Возвращает 'remote' или 'local', чтобы UI мог решать, нужен ли optimistic update.
 */
export async function sendChatMessage({ remotePayload, localMessage, sendLocal }) {
  if (isLiveMode()) {
    try {
      await sendRemoteMessage(remotePayload);
      return SYNC_STATUS.REMOTE;
    } catch (e) {
      logger.warn('[chatGateway] sendMessage failed, falling back to local', e.message);
      sendLocal(localMessage);
      return SYNC_STATUS.LOCAL;
    }
  }

  sendLocal(localMessage);
  return SYNC_STATUS.LOCAL;
}
