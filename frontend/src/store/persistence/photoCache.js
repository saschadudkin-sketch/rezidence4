/**
 * store/persistence/photoCache.js — FIX [P1]
 *
 * ПРОБЛЕМА: В demo-режиме localStorage хранит все заявки с base64-фото (~200KB каждая).
 * При 100 заявках с фото = 20MB в JS heap. localStorage лимит = 5-10MB → QuotaExceededError.
 *
 * РЕШЕНИЕ: Фото хранятся в IndexedDB (лимит ~50-100MB+).
 * Активные заявки остаются в памяти, завершённые — в IndexedDB on-demand.
 */

const DB_NAME = 'residenze_photos';
const STORE_NAME = 'photos';
const DB_VERSION = 1;

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Сохранить фото в IndexedDB.
 * @param {string} id — ключ (requestId или requestId_photoIndex)
 * @param {string} data — base64 data URL
 */
export async function savePhoto(id, data) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ id, data, savedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('[photoCache] save failed:', e);
  }
}

/**
 * Получить фото из IndexedDB.
 * @param {string} id
 * @returns {string|null} base64 data URL
 */
export async function getPhoto(id) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result?.data || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/**
 * Удалить фото из IndexedDB.
 */
export async function deletePhoto(id) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* ignore */ }
}

/**
 * Архивировать фото завершённых заявок из localStorage в IndexedDB.
 * Вызывается периодически (например, при запуске приложения).
 */
const ARCHIVE_STATUSES = new Set(['arrived', 'rejected', 'expired', 'cancelled']);

export async function archiveCompletedPhotos(requests) {
  const LS_KEY = 'residenze_v5';
  let migrated = 0;

  for (const r of requests) {
    if (!ARCHIVE_STATUSES.has(r.status)) continue;

    // Основное фото
    const photoKey = `${LS_KEY}_ph_${r.id}`;
    const photo = localStorage.getItem(photoKey);
    if (photo) {
      await savePhoto(r.id, photo);
      localStorage.removeItem(photoKey);
      migrated++;
    }

    // Дополнительные фото
    for (let i = 0; i < (r.photos?.length || 0); i++) {
      const key = `${LS_KEY}_ph_${r.id}_${i}`;
      const data = localStorage.getItem(key);
      if (data) {
        await savePhoto(`${r.id}_${i}`, data);
        localStorage.removeItem(key);
        migrated++;
      }
    }
  }

  if (migrated > 0) {
    console.info(`[photoCache] archived ${migrated} photos from localStorage to IndexedDB`);
  }
  return migrated;
}

/**
 * Очистить все данные в IndexedDB.
 */
export async function clearAll() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* ignore */ }
}
