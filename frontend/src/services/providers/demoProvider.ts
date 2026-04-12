import { makeDemoRequests } from '../../fixtures/demoData';
import type { AppRequest } from '../../store/slices/requestsSlice';
import type { PermEntry, Template, UserPerms } from '../../store/slices/permsSlice';
import { PHONE_DB_INITIAL, type AppUser } from '../../store/slices/usersSlice';
import type { ServiceContracts } from './ServiceContracts';
import type { ServiceAck, SyncStatus } from './serviceDtos';

const noopUnsubscribe = () => {};
const demoFallbackUser = PHONE_DB_INITIAL['79161234567'];

function ok(): ServiceAck {
  return { ok: true };
}

function toSyncStatus(status: SyncStatus): SyncStatus {
  return status;
}

function toDemoRequest(request: Record<string, unknown> | Partial<AppRequest>): AppRequest {
  const source = request as Partial<AppRequest>;
  return {
    id: typeof source.id === 'string' ? source.id : `demo-${Date.now()}`,
    type: source.type === 'tech' ? 'tech' : 'pass',
    status: source.status ?? 'pending',
    createdAt: source.createdAt ?? new Date().toISOString(),
    ...source,
  };
}

function normalizePermsPayload(perms: UserPerms | { visitors: readonly PermEntry[]; workers: readonly PermEntry[] } | Template[]): UserPerms | null {
  if (Array.isArray(perms)) return null;
  return {
    visitors: [...perms.visitors],
    workers: [...perms.workers],
  };
}

export function createDemoProvider(): ServiceContracts {
  const fallbackUser: AppUser = demoFallbackUser;

  return {
    provider: 'demo',
    auth: {
      async sendOtp() { return ok(); },
      async verifyOtp() { return fallbackUser; },
      async getMe() { return fallbackUser; },
      async logout() { return ok(); },
    },
    chat: {
      async getMessages() {
        return { messages: [], hasMore: false };
      },
      async sendMessage(message) {
        if ('sendLocal' in message && typeof message.sendLocal === 'function' && 'localMessage' in message && message.localMessage) {
          message.sendLocal(message.localMessage);
        }
        return toSyncStatus('local');
      },
      async updateMessage() {
        return toSyncStatus('local');
      },
      async deleteMessage() {
        return toSyncStatus('local');
      },
      async markSeen() {
        return ok();
      },
      onMessage() { return noopUnsubscribe; },
      onMessageUpdate() { return noopUnsubscribe; },
      onMessageDelete() { return noopUnsubscribe; },
    },
    requests: {
      resolvePhotos: async (_reqId, photos) => photos || [],
      submit: ({ request, addLocal }) => {
        const localRequest = toDemoRequest(request);
        addLocal(localRequest);
        return toSyncStatus('local');
      },
      updateEverywhere: ({ requestId, patch, updateLocal }) => {
        updateLocal?.(requestId, patch);
        return toSyncStatus('local');
      },
      deleteEverywhere: ({ requestId, deleteLocal }) => {
        deleteLocal?.(requestId);
        return toSyncStatus('local');
      },
    },
    admin: {
      savePermsEverywhere: ({ uid, perms, saveLocal }) => {
        const normalizedPerms = normalizePermsPayload(perms);
        if (normalizedPerms) saveLocal?.(uid, normalizedPerms);
        return toSyncStatus('local');
      },
      saveUserEverywhere: ({ uid, patch, updateLocal, oldPhone }) => {
        updateLocal?.(uid, patch, oldPhone);
        return toSyncStatus('local');
      },
      removeUserEverywhere: ({ uid, removeLocal }) => {
        removeLocal?.(uid);
        return toSyncStatus('local');
      },
    },
    liveData: {
      startSync: ({ setAllRequests, currentRequests } = {}) => {
        if (setAllRequests && (!currentRequests || currentRequests.length === 0)) {
          setAllRequests(makeDemoRequests().map((request) => toDemoRequest(request)));
        }
        return () => {};
      },
    },
  };
}
