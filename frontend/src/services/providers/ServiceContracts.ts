export type ServiceMode = 'demo' | 'live';
export type ServiceProviderName = 'demo' | 'backend';

export interface AuthService {
  sendOtp: (phone: string) => Promise<unknown>;
  verifyOtp: (phone: string, code: string) => Promise<unknown>;
  getMe: () => Promise<unknown>;
  logout: (opts?: { allDevices?: boolean }) => Promise<unknown>;
}

export interface ChatService {
  getMessages: (params?: { before?: string; limit?: number; search?: string }) => Promise<{ messages: unknown[]; hasMore?: boolean }>;
  sendMessage: (message: unknown) => Promise<unknown>;
  updateMessage: (id: string, patch: Record<string, unknown>) => Promise<unknown>;
  deleteMessage: (id: string) => Promise<unknown>;
  markSeen: (uid: string) => Promise<unknown>;
  onMessage: (fn: (payload: unknown) => void) => () => void;
  onMessageUpdate: (fn: (payload: unknown) => void) => () => void;
  onMessageDelete: (fn: (payload: unknown) => void) => () => void;
}

export interface RequestsService {
  resolvePhotos: (requestId: string, photos: string[]) => Promise<string[]>;
  submit: (args: { request: Record<string, unknown>; addLocal: (request: Record<string, unknown>) => void }) => Promise<unknown> | unknown;
  updateEverywhere: (args: { requestId: string; patch: Record<string, unknown>; updateLocal?: (id: string, patch: Record<string, unknown>) => void; historyLabel?: string }) => Promise<unknown> | unknown;
  deleteEverywhere: (args: { requestId: string; deleteLocal?: (id: string) => void }) => Promise<unknown> | unknown;
}

export interface AdminService {
  savePermsEverywhere: (args: { uid: string; perms: unknown; saveLocal?: (uid: string, perms: unknown) => void }) => Promise<unknown> | unknown;
  saveUserEverywhere: (args: { uid: string; patch: Record<string, unknown>; updateLocal?: (uid: string, patch: Record<string, unknown>, oldPhone?: string) => void; oldPhone?: string }) => Promise<unknown> | unknown;
  removeUserEverywhere: (args: { uid: string; removeLocal?: (uid: string) => void }) => Promise<unknown> | unknown;
}

export interface LiveSyncCallbacks {
  onChat?: (payload: { type?: string; message?: Record<string, unknown>; id?: string }) => void;
  setAllRequests?: (requests: Record<string, unknown>[]) => void;
  onRequests?: (requests: Record<string, unknown>[]) => void;
  setAllMessages?: (messages: Record<string, unknown>[]) => void;
  setAllUsers?: (users: Record<string, unknown>[]) => void;
  onPerms?: (payload: unknown) => void;
  onTemplates?: (payload: unknown) => void;
  setBlacklist?: (entries: unknown[]) => void;
  userUid?: string;
  signal?: AbortSignal;
  onBlacklistAdd?: (entry: Record<string, unknown>) => void;
  onBlacklistRemove?: (entryId: string) => void;
  onUsers?: (users: Record<string, unknown>[]) => void;
  onUserAdd?: (user: Record<string, unknown>) => void;
  onUserUpdate?: (user: Record<string, unknown>) => void;
  onUserDelete?: (uid: string) => void;
  onRequestUpdate?: (request: Record<string, unknown>) => void;
  onRequestAdd?: (request: Record<string, unknown>) => void;
  onRequestDelete?: (id: string) => void;
  currentRequests?: unknown[];
}

export interface LiveDataService {
  startSync: (callbacks?: LiveSyncCallbacks) => Promise<() => void> | (() => void);
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
  ];

  for (const path of requiredPaths) {
    const value = path.split('.').reduce<unknown>((acc, key) => {
      if (typeof acc !== 'object' || acc === null) return undefined;
      return (acc as Record<string, unknown>)[key];
    }, services as unknown);
    if (typeof value !== 'function') {
      throw new Error(`[services] Contract violation: "${path}" is missing`);
    }
  }

  return services;
}
