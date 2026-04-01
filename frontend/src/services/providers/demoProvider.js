import { makeDemoRequests } from '../../fixtures/demoData.js';

export function createDemoProvider() {
  return {
    provider: 'demo',
    chat: {
      sendMessage: async ({ localMessage, sendLocal }) => {
        sendLocal(localMessage);
        return 'local';
      },
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
      restoreUserEverywhere: ({ uid, restoreLocal }) => (restoreLocal ? restoreLocal(uid) : 'local'),
      listDeletedUsersEverywhere: ({ listDeletedLocal } = {}) => (listDeletedLocal ? listDeletedLocal() : []),
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
