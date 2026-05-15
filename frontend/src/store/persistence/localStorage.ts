import { normalizePhone } from '../../utils';
import { PHONE_DB_INITIAL, INITIAL_USERS } from '../slices/usersSlice';
import type { AppUser, UsersState } from '../slices/usersSlice';
import type { AppRequest, HistoryEntry, RequestsState } from '../slices/requestsSlice';
import type { ChatMessage, ChatState } from '../slices/chatSlice';
import type { PermsState, Template, UserPerms } from '../slices/permsSlice';
import type { BlacklistEntry, BlacklistState } from '../slices/blacklistSlice';
import type { Car, GarageState } from '../slices/garageSlice';
import { isDemoPrivateSessionEnabled } from './storageRegistry';
import { putMedia, getMedia, clearMediaStore } from './mediaStore';
import { isLiveMode } from '../../config/runtimeMode';

const LS_KEY = 'residenze_v5';
export const LS_SCHEMA_VERSION = 5;
const TTL_MS = 24 * 60 * 60 * 1000;
const LS_TTL_KEY = `${LS_KEY}_ttl`;
const SESSION_PHOTO_PREFIX = `${LS_KEY}_sph_`;
const SHOULD_LOG_PERSISTENCE = import.meta.env.DEV;
const MAX_CACHED_MESSAGES = 100;

const SLICE_KEYS = {
  requests: `${LS_KEY}_s_req`,
  chat: `${LS_KEY}_s_chat`,
  users: `${LS_KEY}_s_users`,
  perms: `${LS_KEY}_s_perms`,
  blacklist: `${LS_KEY}_s_bl`,
  garage: `${LS_KEY}_s_gar`,
} as const;

type SliceKey = keyof typeof SLICE_KEYS;
type PersistedPhotoRequest = Omit<AppRequest, 'createdAt' | 'arrivedAt' | 'scheduledFor' | 'validUntil' | 'photo' | 'photos'> & {
  id: string;
  type: AppRequest['type'];
  status: AppRequest['status'];
  createdAt: string | Date;
  arrivedAt?: string | Date | null;
  scheduledFor?: string | Date | null;
  validUntil?: string | Date | null;
  photo?: string | null;
  photos?: Array<string | null>;
};
type PersistedQrMeta = { _savedAt: number; _ttl: number };

export type PersistedStoreData = {
  schemaVersion?: number;
  requests?: AppRequest[];
  history?: Record<string, HistoryEntry[]>;
  chat?: ChatMessage[];
  chatLastSeen?: Record<string, number>;
  users?: Record<string, AppUser>;
  phoneDb?: Record<string, AppUser>;
  avatars?: Record<string, string>;
  extraUsers?: Record<string, AppUser>;
  perms?: Record<string, UserPerms>;
  templates?: Record<string, Template[]>;
  blacklist?: BlacklistEntry[];
  garage?: Record<string, Car[]>;
};

function isPrivateDemoSession(): boolean {
  return isDemoPrivateSessionEnabled();
}

function shouldPersistDomainData(): boolean {
  return !isLiveMode() && !isPrivateDemoSession();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sessionGet(key: string): string | null {
  try {
    return sessionStorage.getItem(SESSION_PHOTO_PREFIX + key);
  } catch {
    return null;
  }
}

function sessionSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(SESSION_PHOTO_PREFIX + key, value);
  } catch {
    // ignore session storage failures
  }
}

function saveTTL(): void {
  try {
    const ttlMeta: PersistedQrMeta = { _savedAt: Date.now(), _ttl: TTL_MS };
    localStorage.setItem(LS_TTL_KEY, JSON.stringify(ttlMeta));
  } catch {
    // ignore quota/private mode issues
  }
}

function checkTTL(): boolean {
  try {
    const raw = localStorage.getItem(LS_TTL_KEY);
    if (!raw) return true;
    const meta = JSON.parse(raw) as Partial<PersistedQrMeta>;
    if (!meta._savedAt || !meta._ttl) return true;
    if (Date.now() - meta._savedAt > meta._ttl) {
      clearLS();
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

export function clearLS(): void {
  try {
    for (const key of Object.keys(SLICE_KEYS) as SliceKey[]) {
      localStorage.removeItem(SLICE_KEYS[key]);
    }
    localStorage.removeItem(LS_TTL_KEY);
    localStorage.removeItem(LS_KEY);
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(SESSION_PHOTO_PREFIX)) sessionStorage.removeItem(key);
    }
    void clearMediaStore().catch(() => {});
  } catch {
    // ignore storage cleanup issues
  }
}

function serializeRequestDate(value: AppRequest['createdAt'] | AppRequest['arrivedAt'] | AppRequest['scheduledFor'] | AppRequest['validUntil']): string | Date | null | undefined {
  if (value instanceof Date) return value.toISOString();
  return value ?? null;
}

function savePhotos(requests: AppRequest[]): PersistedPhotoRequest[] {
  const photos: Record<string, string> = {};
  const cleanedRequests = requests.map((request) => {
    const base: PersistedPhotoRequest = {
      ...request,
      createdAt: serializeRequestDate(request.createdAt) ?? request.createdAt,
      arrivedAt: serializeRequestDate(request.arrivedAt),
      scheduledFor: serializeRequestDate(request.scheduledFor),
      validUntil: serializeRequestDate(request.validUntil),
    };

    if (request.photo?.startsWith('data:')) {
      photos[request.id] = request.photo;
      base.photo = '__idb_photo__';
    }

    if (request.photos && request.photos.length > 0) {
      request.photos.forEach((photo, index) => {
        if (photo?.startsWith('data:')) photos[`${request.id}_${index}`] = photo;
      });
      base.photos = request.photos
        .map((photo, index) => photo?.startsWith('data:') ? `__idb_photo_${index}__` : photo)
        .filter((photo): photo is string => Boolean(photo));
    }

    return base;
  });

  Object.entries(photos).forEach(([id, src]) => {
    sessionSet(id, src);
    void putMedia(id, src).catch(() => {});
  });

  return cleanedRequests;
}

function loadPhotos(requests: PersistedPhotoRequest[]): AppRequest[] {
  return requests.map((request): AppRequest => {
    const sourcePhotos = Array.isArray(request.photos) ? request.photos : [];
    const photos = sourcePhotos
      .map((photo, index) => {
        if (typeof photo !== 'string') return null;
        return photo.startsWith('__idb_photo_') ? (sessionGet(`${request.id}_${index}`) || null) : photo;
      })
      .filter((photo): photo is string => Boolean(photo));

    return {
      ...request,
      id: request.id,
      type: request.type,
      status: request.status,
      createdAt: request.createdAt ? new Date(request.createdAt) : new Date(),
      arrivedAt: request.arrivedAt ? new Date(request.arrivedAt) : null,
      scheduledFor: request.scheduledFor ? new Date(request.scheduledFor) : null,
      validUntil: request.validUntil ? new Date(request.validUntil) : null,
      photo: request.photo === '__idb_photo__'
        ? (sessionGet(request.id) || null)
        : (typeof request.photo === 'string' ? request.photo : null),
      photos,
    };
  });
}

export async function hydrateRequestMediaFromIndexedDb(requests: AppRequest[]): Promise<AppRequest[]> {
  if (!Array.isArray(requests) || requests.length === 0) return requests;

  return Promise.all(requests.map(async (request) => {
    const photo = request.photo === '__idb_photo__'
      ? (sessionGet(request.id) || await getMedia(request.id) || null)
      : request.photo;

    const photos = await Promise.all((request.photos || []).map(async (photo, index) => {
      if (!String(photo).startsWith('__idb_photo_')) return photo;
      return sessionGet(`${request.id}_${index}`) || await getMedia(`${request.id}_${index}`) || null;
    }));

    return {
      ...request,
      photo,
      photos: photos.filter((item): item is string => Boolean(item)),
    };
  }));
}

export function saveRequests(reqState: RequestsState): void {
  if (!shouldPersistDomainData()) return;
  try {
    const cleanedRequests = savePhotos(reqState.requests);
    localStorage.setItem(SLICE_KEYS.requests, JSON.stringify({
      requests: cleanedRequests,
      history: reqState.history,
    }));
    saveTTL();
  } catch (error) {
    if (SHOULD_LOG_PERSISTENCE) console.warn('[persistence] saveRequests failed:', error);
  }
}

export function saveChat(chatState: ChatState): void {
  if (!shouldPersistDomainData()) return;
  try {
    const recentMessages = chatState.chat.slice(-MAX_CACHED_MESSAGES);
    localStorage.setItem(SLICE_KEYS.chat, JSON.stringify({
      chat: recentMessages.map((message) => ({ ...message, at: message.at instanceof Date ? message.at.toISOString() : message.at })),
      chatLastSeen: chatState.chatLastSeen,
    }));
    saveTTL();
  } catch (error) {
    if (SHOULD_LOG_PERSISTENCE) console.warn('[persistence] saveChat failed:', error);
  }
}

export function saveUsers(usersState: UsersState): void {
  if (!shouldPersistDomainData()) return;
  try {
    const initialUids = new Set(Object.values(PHONE_DB_INITIAL).map((user) => user.uid));
    const extraUsers = Object.fromEntries(
      Object.entries(usersState.users).filter(([uid]) => !initialUids.has(uid))
    );

    localStorage.setItem(SLICE_KEYS.users, JSON.stringify({
      avatars: usersState.avatars,
      extraUsers,
    }));
    saveTTL();
  } catch (error) {
    if (SHOULD_LOG_PERSISTENCE) console.warn('[persistence] saveUsers failed:', error);
  }
}

export function savePerms(permsState: PermsState): void {
  if (!shouldPersistDomainData()) return;
  try {
    localStorage.setItem(SLICE_KEYS.perms, JSON.stringify({
      perms: permsState.perms,
      templates: permsState.templates,
    }));
    saveTTL();
  } catch (error) {
    if (SHOULD_LOG_PERSISTENCE) console.warn('[persistence] savePerms failed:', error);
  }
}

export function saveBlacklist(blacklistState: BlacklistState): void {
  if (!shouldPersistDomainData()) return;
  try {
    localStorage.setItem(SLICE_KEYS.blacklist, JSON.stringify({
      blacklist: blacklistState.blacklist.map((entry) => ({
        ...entry,
        addedAt: entry.addedAt instanceof Date ? entry.addedAt.toISOString() : entry.addedAt,
      })),
    }));
    saveTTL();
  } catch (error) {
    if (SHOULD_LOG_PERSISTENCE) console.warn('[persistence] saveBlacklist failed:', error);
  }
}

export function saveGarage(garageState: GarageState): void {
  if (!shouldPersistDomainData()) return;
  try {
    localStorage.setItem(SLICE_KEYS.garage, JSON.stringify({
      garage: garageState.garage,
    }));
    saveTTL();
  } catch (error) {
    if (SHOULD_LOG_PERSISTENCE) console.warn('[persistence] saveGarage failed:', error);
  }
}

function attachUsers(data: PersistedStoreData): PersistedStoreData {
  if (!data.extraUsers) return data;

  const nextUsers: Record<string, AppUser> = { ...INITIAL_USERS };
  const nextPhoneDb: Record<string, AppUser> = { ...PHONE_DB_INITIAL };

  Object.entries(data.extraUsers).forEach(([uid, user]) => {
    nextUsers[uid] = user;
    nextPhoneDb[normalizePhone(user.phone)] = user;
  });

  return {
    ...data,
    users: nextUsers,
    phoneDb: nextPhoneDb,
  };
}

function parseSliceData(raw: string, lsKey: string): Partial<PersistedStoreData> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) {
      if (SHOULD_LOG_PERSISTENCE) console.warn('[persistence] corrupt slice discarded:', lsKey);
      localStorage.removeItem(lsKey);
      return null;
    }
    return parsed as Partial<PersistedStoreData>;
  } catch {
    return null;
  }
}

function parseLegacy(data: PersistedStoreData): PersistedStoreData {
  const result: PersistedStoreData = {};

  if (data.requests) result.requests = loadPhotos(data.requests);
  if (data.chat) result.chat = data.chat.map((message) => ({ ...message, at: message.at ? new Date(message.at) : new Date() }));
  if (data.chatLastSeen) result.chatLastSeen = data.chatLastSeen;
  if (data.history) result.history = data.history;
  if (data.avatars) result.avatars = data.avatars;
  if (data.perms) result.perms = data.perms;
  if (data.templates) result.templates = data.templates;
  if (data.garage) result.garage = data.garage;
  if (data.blacklist) result.blacklist = data.blacklist.map((entry) => ({ ...entry, addedAt: entry.addedAt ? new Date(entry.addedAt) : new Date() }));
  if (data.extraUsers) Object.assign(result, attachUsers({ extraUsers: data.extraUsers }));

  localStorage.removeItem(LS_KEY);
  return result;
}

export function loadFromLS(options: { criticalOnly?: boolean } = {}): PersistedStoreData | null {
  const criticalOnly = Boolean(options.criticalOnly);
  if (!shouldPersistDomainData()) return null;

  try {
    if (!checkTTL()) {
      if (SHOULD_LOG_PERSISTENCE) console.info('[persistence] localStorage TTL expired — cleared');
      return null;
    }

    const rawLegacy = localStorage.getItem(LS_KEY);
    if (rawLegacy) {
      const parsedLegacy = JSON.parse(rawLegacy) as PersistedStoreData;
      if (!parsedLegacy || parsedLegacy.schemaVersion !== LS_SCHEMA_VERSION) {
        if (SHOULD_LOG_PERSISTENCE) console.warn(`[persistence] schema mismatch: expected v${LS_SCHEMA_VERSION}, got v${parsedLegacy?.schemaVersion}. Resetting.`);
        localStorage.removeItem(LS_KEY);
        return null;
      }
      return parseLegacy(parsedLegacy);
    }

    let result: PersistedStoreData = {};
    for (const lsKey of Object.values(SLICE_KEYS)) {
      const rawSlice = localStorage.getItem(lsKey);
      if (!rawSlice) continue;
      const parsedSlice = parseSliceData(rawSlice, lsKey);
      if (parsedSlice) result = { ...result, ...parsedSlice };
    }

    if (Object.keys(result).length === 0) return null;

    if (result.requests && !Array.isArray(result.requests)) delete result.requests;
    if (result.chat && !Array.isArray(result.chat)) delete result.chat;
    if (result.blacklist && !Array.isArray(result.blacklist)) delete result.blacklist;

    if (result.requests) {
      result.requests = criticalOnly
        ? result.requests.slice(0, 40)
        : loadPhotos(result.requests);
    }
    if (!criticalOnly && result.chat) {
      result.chat = result.chat.map((message) => ({ ...message, at: message.at ? new Date(message.at) : new Date() }));
    }
    if (!criticalOnly && result.blacklist) {
      result.blacklist = result.blacklist.map((entry) => ({ ...entry, addedAt: entry.addedAt ? new Date(entry.addedAt) : new Date() }));
    }
    if (result.extraUsers) {
      result = attachUsers(result);
      delete result.extraUsers;
    }

    if (criticalOnly) {
      delete result.chat;
      delete result.chatLastSeen;
      delete result.perms;
      delete result.templates;
      delete result.blacklist;
      delete result.garage;
    }

    return result;
  } catch (error) {
    if (SHOULD_LOG_PERSISTENCE) console.warn('[persistence] load failed:', error);
    return null;
  }
}
