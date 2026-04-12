import type { AppRequest } from '../../store/slices/requestsSlice';
import type { ChatMessage } from '../../store/slices/chatSlice';
import type { AppUser } from '../../store/slices/usersSlice';
import type { BlacklistEntry } from '../../store/slices/blacklistSlice';
import type { Template, UserPerms } from '../../store/slices/permsSlice';
import type {
  AuthUser,
  ChatDeletePayload,
  ChatMessageInput,
  LiveSyncChatEvent,
  PermsPayload,
  ServiceAck,
  SyncStatus,
} from './serviceDtos';

export type ServiceMode = 'demo' | 'live';
export type ServiceProviderName = 'demo' | 'backend';
export type ServiceMutationResult = SyncStatus | ServiceAck | void;

export interface AuthService {
  sendOtp: (phone: string) => Promise<ServiceAck | void>;
  verifyOtp: (phone: string, code: string) => Promise<AuthUser>;
  getMe: () => Promise<AuthUser>;
  logout: () => Promise<ServiceAck | void>;
}

export interface ChatService {
  getMessages: (params?: { before?: string; limit?: number; search?: string; signal?: AbortSignal }) => Promise<{ messages: ChatMessage[]; hasMore?: boolean }>;
  sendMessage: (message: ChatMessage | ChatMessageInput) => Promise<ChatMessage | ServiceMutationResult>;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => Promise<ServiceMutationResult>;
  deleteMessage: (id: string) => Promise<ServiceMutationResult>;
  markSeen: (uid: string) => Promise<ServiceMutationResult>;
  onMessage: (fn: (payload: ChatMessage) => void) => () => void;
  onMessageUpdate: (fn: (payload: ChatMessage) => void) => () => void;
  onMessageDelete: (fn: (payload: ChatDeletePayload) => void) => () => void;
}

export interface RequestsService {
  resolvePhotos: (requestId: string, photos: string[]) => Promise<string[]>;
  submit: (args: { request: Partial<AppRequest>; addLocal: (request: AppRequest) => void }) => Promise<AppRequest | ServiceMutationResult> | AppRequest | ServiceMutationResult;
  updateEverywhere: (args: { requestId: string; patch: Partial<AppRequest>; updateLocal?: (id: string, patch: Partial<AppRequest>) => void; historyLabel?: string }) => Promise<ServiceMutationResult> | ServiceMutationResult;
  deleteEverywhere: (args: { requestId: string; deleteLocal?: (id: string) => void }) => Promise<ServiceMutationResult> | ServiceMutationResult;
}

export interface AdminService {
  savePermsEverywhere: (args: { uid: string; perms: PermsPayload; saveLocal?: (uid: string, perms: UserPerms) => void }) => Promise<ServiceMutationResult> | ServiceMutationResult;
  saveUserEverywhere: (args: { uid: string; patch: Partial<AppUser>; updateLocal?: (uid: string, patch: Partial<AppUser>, oldPhone?: string) => void; oldPhone?: string }) => Promise<ServiceMutationResult> | ServiceMutationResult;
  removeUserEverywhere: (args: { uid: string; removeLocal?: (uid: string) => void }) => Promise<ServiceMutationResult> | ServiceMutationResult;
}

export interface LiveDataCallbacks {
  onChat?: (payload: LiveSyncChatEvent) => void;
  setAllRequests?: (requests: AppRequest[]) => void;
  onRequests?: (requests: AppRequest[]) => void;
  setAllMessages?: (messages: ChatMessage[]) => void;
  setAllUsers?: (users: AppUser[]) => void;
  onPerms?: (payload: UserPerms) => void;
  onTemplates?: (payload: Template[]) => void;
  setBlacklist?: (entries: BlacklistEntry[]) => void;
  userUid?: string;
  signal?: AbortSignal;
  onBlacklistAdd?: (entry: BlacklistEntry) => void;
  onBlacklistRemove?: (entryId: string) => void;
  onUsers?: (users: AppUser[]) => void;
  onUserAdd?: (user: AppUser) => void;
  onUserUpdate?: (user: AppUser) => void;
  onUserDelete?: (uid: string) => void;
  onRequestUpdate?: (request: AppRequest) => void;
  onRequestAdd?: (request: AppRequest) => void;
  onRequestDelete?: (id: string) => void;
  currentRequests?: AppRequest[];
}

export interface LiveDataService {
  startSync: (callbacks?: LiveDataCallbacks) => Promise<() => void> | (() => void);
}

export interface ServiceContracts {
  provider: ServiceProviderName;
  auth: AuthService;
  chat: ChatService;
  requests: RequestsService;
  admin: AdminService;
  liveData: LiveDataService;
}

export interface ServiceContainer extends ServiceContracts {
  mode: ServiceMode;
}

function getContractValue(target: object, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = target;

  for (const segment of segments) {
    if (typeof current !== 'object' || current === null || !(segment in current)) {
      return undefined;
    }
    current = current[segment as keyof typeof current];
  }

  return current;
}

export function assertServiceContracts(services: ServiceContracts): ServiceContracts {
  const requiredPaths = [
    'auth.sendOtp',
    'auth.verifyOtp',
    'auth.getMe',
    'auth.logout',
    'chat.getMessages',
    'chat.sendMessage',
    'chat.updateMessage',
    'chat.deleteMessage',
    'chat.markSeen',
    'chat.onMessage',
    'chat.onMessageUpdate',
    'chat.onMessageDelete',
    'requests.resolvePhotos',
    'requests.submit',
    'requests.updateEverywhere',
    'requests.deleteEverywhere',
    'admin.savePermsEverywhere',
    'admin.saveUserEverywhere',
    'admin.removeUserEverywhere',
    'liveData.startSync',
  ] as const;

  for (const path of requiredPaths) {
    if (typeof getContractValue(services, path) !== 'function') {
      throw new Error(`[services] Contract violation: "${path}" is missing`);
    }
  }

  return services;
}
