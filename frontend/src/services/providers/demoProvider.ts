import { makeDemoRequests } from '../../fixtures/demoData';
import type { ServiceContracts } from './ServiceContracts';

const noopUnsubscribe = () => {};

export function createDemoProvider(): ServiceContracts {
  return {
    provider: 'demo',
    auth: {
      async sendOtp() { return { ok: true }; },
      async verifyOtp() { return { ok: true }; },
      async getMe() { return null; },
      async logout() { return { ok: true }; },
    },
    chat: {
      async getMessages() {
        return { messages: [], hasMore: false };
      },
      sendMessage: async ({ localMessage, sendLocal }) => {
        sendLocal(localMessage);
        return 'local';
      },
      async updateMessage() {
        return 'local';
      },
      async deleteMessage() {
        return 'local';
      },
      async markSeen() {
        return { ok: true };
      },
      onMessage() { return noopUnsubscribe; },
      onMessageUpdate() { return noopUnsubscribe; },
      onMessageDelete() { return noopUnsubscribe; },
    },
    requests: {
      resolvePhotos: async (_reqId, photos) => photos || [],
      submit: ({ request, addLocal }) => {
        addLocal(request);
        return 'local';
      },
      updateEverywhere: ({ requestId, patch, updateLocal }) => {
        updateLocal(requestId, patch);
      },
      deleteEverywhere: ({ requestId, deleteLocal }) => {
        deleteLocal(requestId);
      },
    },
    admin: {
      savePermsEverywhere: ({ uid, perms, saveLocal }) => saveLocal(uid, perms),
      saveUserEverywhere: ({ uid, patch, updateLocal, oldPhone }) => updateLocal(uid, patch, oldPhone),
      removeUserEverywhere: ({ uid, removeLocal }) => removeLocal(uid),
    },
    liveData: {
      /**
       * Заполняем store демо-данными только если localStorage не содержал
       * сохранённых заявок (currentRequests пришли из INITIAL_STATE — пустой массив).
       * Если пользователь уже работал с приложением — его данные сохраняются.
       */
      startSync: ({ setAllRequests, currentRequests } = {}) => {
        if (setAllRequests && (!currentRequests || currentRequests.length === 0)) {
          // FIX: вызываем фабрику — получаем свежие даты, а не замороженные при импорте
          setAllRequests(makeDemoRequests());
        }
        return () => {};
      },
    },
  };
}
