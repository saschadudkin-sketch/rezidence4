/**
 * store/persistence/localStorage.js — FIX [A4] + FIX [P2]
 *
 * A4: Вынесено из AppStore.jsx (370 строк → ~200 строк провайдер)
 * P2: Раздельное сохранение по слайсам — при SSE-обновлении одной заявки
 *     не сериализуем все 6 доменов, только изменившийся.
 */

import { normalizePhone } from '../../utils';
import { PHONE_DB_INITIAL, INITIAL_USERS } from '../slices/usersSlice';
import { isDemoPrivateSessionEnabled } from './storageRegistry';
import { putMedia, getMedia, clearMediaStore } from './mediaStore';

const LS_KEY = 'residenze_v5';
export const LS_SCHEMA_VERSION = 5;

// ─── TTL helpers — SEC6: session-based expiry for demo mode data ──────────────
// In demo mode, localStorage data can persist across browser sessions indefinitely.
// We add a timestamp + TTL so stale data (older than 24 h) is cleared on next load.

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const LS_TTL_KEY = `${LS_KEY}_ttl`;
const SESSION_PHOTO_PREFIX = `${LS_KEY}_sph_`;

function isPrivateDemoSession() {
  return isDemoPrivateSessionEnabled();
}

function sessionGet(key: string) {
  try { return sessionStorage.getItem(SESSION_PHOTO_PREFIX + key); } catch { return null; }
}
function sessionSet(key: string, value: string) {
  try { sessionStorage.setItem(SESSION_PHOTO_PREFIX + key, value); } catch { /* noop */ }
}

function saveTTL() {
  try {
    localStorage.setItem(LS_TTL_KEY, JSON.stringify({ _savedAt: Date.now(), _ttl: TTL_MS }));
  } catch { /* ignore — quota or private mode */ }
}

function checkTTL() {
  try {
    const raw = localStorage.getItem(LS_TTL_KEY);
    if (!raw) return true; // no metadata yet — allow load (first run or old data)
    const meta = JSON.parse(raw);
    if (!meta || !meta._savedAt || !meta._ttl) return true;
    if (Date.now() - meta._savedAt > meta._ttl) {
      // Expired — clear all persisted slices and return false
      clearLS();
      return false;
    }
    return true;
  } catch {
    return true; // parse error — allow load
  }
}

export function clearLS() {
  try {
    for (const key of Object.keys(SLICE_KEYS)) {
      localStorage.removeItem(SLICE_KEYS[key]);
    }
    localStorage.removeItem(LS_TTL_KEY);
    localStorage.removeItem(LS_KEY);
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(SESSION_PHOTO_PREFIX)) sessionStorage.removeItem(k);
    }
    clearMediaStore().catch(() => {});
  } catch { /* ignore */ }
}

// ─── Per-slice keys ───────────────────────────────────────────────────────────
// FIX [P2]: каждый слайс сохраняется отдельно — не сериализуем всё при каждом изменении
const SLICE_KEYS = {
  requests: `${LS_KEY}_s_req`,
  chat:     `${LS_KEY}_s_chat`,
  users:    `${LS_KEY}_s_users`,
  perms:    `${LS_KEY}_s_perms`,
  blacklist:`${LS_KEY}_s_bl`,
  garage:   `${LS_KEY}_s_gar`,
};

// ─── Photo cache helpers ──────────────────────────────────────────────────────

function savePhotos(requests) {
  const photos: Record<string, string> = {};
  const reqsClean = requests.map(r => {
    const base = { ...r,
      createdAt:    r.createdAt    instanceof Date ? r.createdAt.toISOString()    : r.createdAt,
      arrivedAt:    r.arrivedAt    instanceof Date ? r.arrivedAt.toISOString()    : r.arrivedAt,
      scheduledFor: r.scheduledFor instanceof Date ? r.scheduledFor.toISOString() : (r.scheduledFor || null),
      validUntil:   r.validUntil   instanceof Date ? r.validUntil.toISOString()   : (r.validUntil || null),
    };
    if (r.photo?.startsWith('data:')) { photos[r.id] = r.photo; base.photo = '__idb_photo__'; }
    if (r.photos && r.photos.length > 0) {
      r.photos.forEach((p, i) => { if (p?.startsWith('data:')) photos[r.id + '_' + i] = p; });
      base.photos = r.photos.map((p, i) => p?.startsWith('data:') ? '__idb_photo_' + i + '__' : p).filter(Boolean);
    }
    return base;
  });

  // Save photos into IndexedDB (tiered storage) and keep only pointers in localStorage.
  Object.entries(photos).forEach(([id, src]) => {
    sessionSet(id, src); // immediate same-session availability
    putMedia(id, src).catch(() => {});
  });

  return reqsClean;
}

function loadPhotos(requests) {
  return requests.map(r => ({
    ...r,
    createdAt: r.createdAt ? new Date(r.createdAt) : new Date(),
    arrivedAt: r.arrivedAt ? new Date(r.arrivedAt) : null,
    scheduledFor: r.scheduledFor ? new Date(r.scheduledFor) : null,
    validUntil: r.validUntil ? new Date(r.validUntil) : null,
    photo: r.photo === '__idb_photo__' ? (sessionGet(r.id) || null) : r.photo,
    photos: (r.photos || []).map((p, i) =>
      p?.startsWith('__idb_photo_') ? (sessionGet(r.id + '_' + i) || null) : p
    ).filter(Boolean),
  }));
}

export async function hydrateRequestMediaFromIndexedDb(requests) {
  if (!Array.isArray(requests) || !requests.length) return requests;
  const hydrated = await Promise.all(requests.map(async (r) => {
    const photo = r.photo === '__idb_photo__'
      ? (sessionGet(r.id) || await getMedia(r.id) || null)
      : r.photo;
    const photos = await Promise.all((r.photos || []).map(async (p, i) => {
      if (!String(p).startsWith('__idb_photo_')) return p;
      return sessionGet(r.id + '_' + i) || await getMedia(r.id + '_' + i) || null;
    }));
    return { ...r, photo, photos: photos.filter(Boolean) };
  }));
  return hydrated;
}

// ─── Per-slice save functions ─────────────────────────────────────────────────
// FIX [P2]: при SSE-обновлении одной заявки — JSON.stringify только этого слайса

export function saveRequests(reqState) {
  if (isPrivateDemoSession()) return;
  try {
    const reqsClean = savePhotos(reqState.requests);
    localStorage.setItem(SLICE_KEYS.requests, JSON.stringify({
      requests: reqsClean,
      history: reqState.history,
    }));
    saveTTL();
  } catch (e) { console.warn('[persistence] saveRequests failed:', e); }
}

// FIX [AUDIT-2 #19]: ограничиваем количество кешированных сообщений.
// При 1000 сообщений за месяц localStorage для чата занимал 2-5MB.
const MAX_CACHED_MESSAGES = 100;

export function saveChat(chatState) {
  if (isPrivateDemoSession()) return;
  try {
    const recentMessages = chatState.chat.slice(-MAX_CACHED_MESSAGES);
    localStorage.setItem(SLICE_KEYS.chat, JSON.stringify({
      chat: recentMessages.map(m => ({ ...m, at: m.at instanceof Date ? m.at.toISOString() : m.at })),
      chatLastSeen: chatState.chatLastSeen,
    }));
    saveTTL();
  } catch (e) { console.warn('[persistence] saveChat failed:', e); }
}

export function saveUsers(usersState) {
  if (isPrivateDemoSession()) return;
  try {
    localStorage.setItem(SLICE_KEYS.users, JSON.stringify({
      avatars: usersState.avatars,
      extraUsers: Object.fromEntries(
        Object.entries(usersState.users).filter(([uid]) =>
          !Object.values(PHONE_DB_INITIAL).some(u => u.uid === uid)
        )
      ),
    }));
    saveTTL();
  } catch (e) { console.warn('[persistence] saveUsers failed:', e); }
}

export function savePerms(permsState) {
  if (isPrivateDemoSession()) return;
  try {
    localStorage.setItem(SLICE_KEYS.perms, JSON.stringify({
      perms: permsState.perms,
      templates: permsState.templates,
    }));
    saveTTL();
  } catch (e) { console.warn('[persistence] savePerms failed:', e); }
}

export function saveBlacklist(blacklist) {
  if (isPrivateDemoSession()) return;
  try {
    const items = blacklist.blacklist || blacklist || [];
    localStorage.setItem(SLICE_KEYS.blacklist, JSON.stringify({
      blacklist: (Array.isArray(items) ? items : []).map(e => ({
        ...e, addedAt: e.addedAt instanceof Date ? e.addedAt.toISOString() : e.addedAt,
      })),
    }));
    saveTTL();
  } catch (e) { console.warn('[persistence] saveBlacklist failed:', e); }
}

export function saveGarage(garage) {
  if (isPrivateDemoSession()) return;
  try {
    localStorage.setItem(SLICE_KEYS.garage, JSON.stringify({
      garage: garage.garage || garage || {},
    }));
    saveTTL();
  } catch (e) { console.warn('[persistence] saveGarage failed:', e); }
}

// ─── Load all slices ──────────────────────────────────────────────────────────

export function loadFromLS(options: { criticalOnly?: boolean } = {}) {
  const criticalOnly = !!options.criticalOnly;
  if (isPrivateDemoSession()) return null;
  try {
    // SEC6: Check TTL — if data is older than 24 h, clear and return null
    if (!checkTTL()) {
      console.info('[persistence] localStorage TTL expired — cleared');
      return null;
    }

    // Check legacy combined format first
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (!d || d.schemaVersion !== LS_SCHEMA_VERSION) {
        console.warn(`[persistence] schema mismatch: expected v${LS_SCHEMA_VERSION}, got v${d?.schemaVersion}. Resetting.`);
        localStorage.removeItem(LS_KEY);
        return null;
      }
      // Migrate: загрузить из старого формата, при следующем save запишется по слайсам
      return parseLegacy(d);
    }

    // Per-slice format
    const result: Record<string, unknown> = {};
    for (const [, lsKey] of Object.entries(SLICE_KEYS)) {
      const val = localStorage.getItem(lsKey);
      if (val) {
        try {
          const parsed = JSON.parse(val);
          // FIX [I-12]: basic shape validation — if top-level is not a plain object, discard silently
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            Object.assign(result, parsed);
          } else {
            console.warn('[persistence] corrupt slice discarded:', lsKey);
            localStorage.removeItem(lsKey);
          }
        } catch { /* skip corrupt slice */ }
      }
    }
    if (!Object.keys(result).length) return null;

    // FIX [I-12]: validate per-field shapes before consuming
    if (result.requests !== undefined && !Array.isArray(result.requests)) {
      console.warn('[persistence] requests not an array — discarding');
      delete result.requests;
    }
    if (result.chat !== undefined && !Array.isArray(result.chat)) {
      console.warn('[persistence] chat not an array — discarding');
      delete result.chat;
    }
    if (result.blacklist !== undefined && !Array.isArray(result.blacklist)) {
      console.warn('[persistence] blacklist not an array — discarding');
      delete result.blacklist;
    }

    // Post-process
    if (result.requests) {
      result.requests = criticalOnly
        ? (result.requests as Record<string, unknown>[]).slice(0, 40)
        : loadPhotos(result.requests as Record<string, unknown>[]);
    }
    if (!criticalOnly && result.chat) result.chat = (result.chat as Array<Record<string, unknown>>).map(m => ({ ...m, at: m.at ? new Date(m.at as string) : new Date() }));
    if (!criticalOnly && result.blacklist) result.blacklist = (result.blacklist as Array<Record<string, unknown>>).map(e => ({ ...e, addedAt: e.addedAt ? new Date(e.addedAt as string) : new Date() }));
    if (result.extraUsers) {
      
      const newUsers = { ...INITIAL_USERS };
      const newPhoneDb = { ...PHONE_DB_INITIAL };
      Object.entries(result.extraUsers).forEach(([uid, u]) => {
        newUsers[uid] = u; newPhoneDb[normalizePhone(u.phone)] = u;
      });
      result.users = newUsers;
      result.phoneDb = newPhoneDb;
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
  } catch (e) {
    console.warn('[persistence] load failed:', e);
    return null;
  }
}

// ─── Legacy format parser ─────────────────────────────────────────────────────

function parseLegacy(d: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  if (d.requests)     result.requests     = loadPhotos(d.requests as Record<string, unknown>[]);
  if (d.chat)         result.chat         = (d.chat as Array<Record<string, unknown>>).map(m => ({ ...m, at: m.at ? new Date(m.at as string) : new Date() }));
  if (d.chatLastSeen) result.chatLastSeen = d.chatLastSeen;
  if (d.history)      result.history      = d.history;
  if (d.avatars)      result.avatars      = d.avatars;
  if (d.perms)        result.perms        = d.perms;
  if (d.templates)    result.templates    = d.templates;
  if (d.garage)       result.garage       = d.garage;
  if (d.blacklist)    result.blacklist    = (d.blacklist as Array<Record<string, unknown>>).map(e => ({ ...e, addedAt: e.addedAt ? new Date(e.addedAt as string) : new Date() }));
  if (d.extraUsers) {
    
    const newUsers = { ...INITIAL_USERS };
    const newPhoneDb = { ...PHONE_DB_INITIAL };
    Object.entries(d.extraUsers).forEach(([uid, u]) => {
      newUsers[uid] = u; newPhoneDb[normalizePhone(u.phone)] = u;
    });
    result.users = newUsers;
    result.phoneDb = newPhoneDb;
  }
  // Remove legacy key after migration
  localStorage.removeItem(LS_KEY);
  return result;
}
