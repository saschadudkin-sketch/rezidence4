export type ServiceMode = 'demo' | 'live';
export type ServiceProviderName = 'demo' | 'backend';

export interface AuthService {
  sendOtp: (phone: string) => Promise<unknown>;
  verifyOtp: (phone: string, code: string) => Promise<unknown>;
  getMe: () => Promise<unknown>;
  logout: () => Promise<unknown>;
}

export interface ChatService {
  getMessages: (params?: { before?: string; limit?: number; search?: string }) => Promise<{ messages: any[]; hasMore?: boolean } | any[]>;
  sendMessage: (message: unknown) => Promise<unknown>;
  updateMessage: (id: string, patch: Record<string, unknown>) => Promise<unknown>;
  deleteMessage: (id: string) => Promise<unknown>;
  markSeen: (uid: string) => Promise<unknown>;
  onMessage: (fn: (payload: any) => void) => () => void;
  onMessageUpdate: (fn: (payload: any) => void) => () => void;
  onMessageDelete: (fn: (payload: any) => void) => () => void;
}

export interface RequestsService {
  resolvePhotos: (requestId: string, photos: string[]) => Promise<string[]>;
  submit: (args: { request: any; addLocal: (request: any) => void }) => Promise<unknown> | unknown;
  updateEverywhere: (args: { requestId: string; patch: Record<string, unknown>; updateLocal?: (id: string, patch: Record<string, unknown>) => void; historyLabel?: string }) => Promise<unknown> | unknown;
  deleteEverywhere: (args: { requestId: string; deleteLocal?: (id: string) => void }) => Promise<unknown> | unknown;
}

export interface AdminService {
  savePermsEverywhere: (args: { uid: string; perms: any; saveLocal?: (uid: string, perms: any) => void }) => Promise<unknown> | unknown;
  saveUserEverywhere: (args: { uid: string; patch: Record<string, unknown>; updateLocal?: (uid: string, patch: Record<string, unknown>, oldPhone?: string) => void; oldPhone?: string }) => Promise<unknown> | unknown;
  removeUserEverywhere: (args: { uid: string; removeLocal?: (uid: string) => void }) => Promise<unknown> | unknown;
}

export interface LiveSyncCallbacks {
  onChat?: (payload: any) => void;
  setAllRequests?: (requests: any[]) => void;
  onRequests?: (requests: any[]) => void;
  setAllMessages?: (messages: any[]) => void;
  setAllUsers?: (users: any[]) => void;
  onPerms?: (payload: any) => void;
  onTemplates?: (payload: any) => void;
  setBlacklist?: (entries: any[]) => void;
  userUid?: string;
  signal?: AbortSignal;
  onBlacklistAdd?: (entry: any) => void;
  onBlacklistRemove?: (entryId: string) => void;
  onUserUpdate?: (user: any) => void;
  onUserDelete?: (uid: string) => void;
  onRequestUpdate?: (request: any) => void;
  onRequestAdd?: (request: any) => void;
  onRequestDelete?: (id: string) => void;
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
    const value = path.split('.').reduce<any>((acc, key) => acc?.[key], services as any);
    if (typeof value !== 'function') {
      throw new Error(`[services] Contract violation: "${path}" is missing`);
    }
  }

  return services;
}
