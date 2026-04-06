/**
 * store/persistence/localStorage.js — FIX [A4] + FIX [P2]
 *
 * A4: Вынесено из AppStore.jsx (370 строк → ~200 строк провайдер)
 * P2: Раздельное сохранение по слайсам — при SSE-обновлении одной заявки
 *     не сериализуем все 6 доменов, только изменившийся.
 */

import { normalizePhone } from '../../utils';
import { PHONE_DB_INITIAL, INITIAL_USERS } from '../slices/usersSlice';

const LS_KEY = 'residenze_v5';
export const LS_SCHEMA_VERSION = 5;

// ─── TTL helpers — SEC6: session-based expiry for demo mode data ──────────────
// In demo mode, localStorage data can persist across browser sessions indefinitely.
// We add a timestamp + TTL so stale data (older than 24 h) is cleared on next load.

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const LS_TTL_KEY = `${LS_KEY}_ttl`;

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
    if (r.photo?.startsWith('data:')) { photos[r.id] = r.photo; base.photo = '__photo__'; }
    if (r.photos && r.photos.length > 0) {
      r.photos.forEach((p, i) => { if (p?.startsWith('data:')) photos[r.id + '_' + i] = p; });
      base.photos = r.photos.map((p, i) => p?.startsWith('data:') ? '__photo_' + i + '__' : p).filter(Boolean);
    }
    return base;
  });

  // Save photos with LRU eviction
  Object.entries(photos).forEach(([id, src]) => {
    try {
      localStorage.setItem(LS_KEY + '_ph_' + id, src);
    } catch {
      console.warn('[persistence] localStorage quota exceeded, cleaning old photos');
      const activeIds = new Set(
        requests.filter(r => ['pending','approved','scheduled'].includes(r.status))
          .flatMap(r => [LS_KEY + '_ph_' + r.id,
            ...(r.photos || []).map((_, i) => LS_KEY + '_ph_' + r.id + '_' + i)])
      );
      const allKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(LS_KEY + '_ph_')) allKeys.push(k);
      }
      allKeys.filter(k => !activeIds.has(k)).forEach(k => { try { localStorage.removeItem(k); } catch { /* noop */ } });
      try { localStorage.setItem(LS_KEY + '_ph_' + id, src); } catch {
        console.warn('[persistence] Photo storage unavailable.');
      }
    }
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
    photo: r.photo === '__photo__' ? (localStorage.getItem(LS_KEY + '_ph_' + r.id) || null) : r.photo,
    photos: (r.photos || []).map((p, i) =>
      p?.startsWith('__photo_') ? (localStorage.getItem(LS_KEY + '_ph_' + r.id + '_' + i) || null) : p
    ).filter(Boolean),
  }));
}

// ─── Per-slice save functions ─────────────────────────────────────────────────
// FIX [P2]: при SSE-обновлении одной заявки — JSON.stringify только этого слайса

export function saveRequests(reqState) {
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
  try {
    localStorage.setItem(SLICE_KEYS.perms, JSON.stringify({
      perms: permsState.perms,
      templates: permsState.templates,
    }));
    saveTTL();
  } catch (e) { console.warn('[persistence] savePerms failed:', e); }
}

export function saveBlacklist(blacklist) {
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
  try {
    localStorage.setItem(SLICE_KEYS.garage, JSON.stringify({
      garage: garage.garage || garage || {},
    }));
    saveTTL();
  } catch (e) { console.warn('[persistence] saveGarage failed:', e); }
}

// ─── Load all slices ──────────────────────────────────────────────────────────

export function loadFromLS() {
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
    if (result.requests) result.requests = loadPhotos(result.requests as Record<string, unknown>[]);
    if (result.chat) result.chat = (result.chat as Array<Record<string, unknown>>).map(m => ({ ...m, at: m.at ? new Date(m.at as string) : new Date() }));
    if (result.blacklist) result.blacklist = (result.blacklist as Array<Record<string, unknown>>).map(e => ({ ...e, addedAt: e.addedAt ? new Date(e.addedAt as string) : new Date() }));
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
